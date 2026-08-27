import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserAccess } from '@/lib/access'
import { checkRateLimit } from '@/lib/rate-limit'
import { csvCell } from '@/lib/csv'

const MAX_EXPORT_ROWS = 5000
const MAX_EXPLICIT_IDS = 500

interface ExportCsvErrorResponse {
  error: {
    code: string
    message: string
    upgradeUrl?: string
    retryAfterSeconds?: number
  }
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extras?: { upgradeUrl?: string; retryAfterSeconds?: number },
): NextResponse<ExportCsvErrorResponse> {
  return NextResponse.json({ error: { code, message, ...extras } }, { status })
}

function isValidCounty(county: string): boolean {
  const ALLOWED = new Set([
    'fulton', 'dekalb', 'cobb', 'gwinnett', 'cherokee', 'henry',
    'rockdale', 'clayton', 'coweta', 'fayette', 'hall', 'newton',
    'walton', 'barrow',
  ])
  return ALLOWED.has(county.toLowerCase().trim())
}

/**
 * POST /api/export
 * Called by: Web Dashboard "Export CSV" button (future UI addition)
 * Data: Reads from auction_pipeline / lead_pipeline only (Expert users
 *       have unlimited access — export is limited to their curated pipeline).
 *       Writes audit to export_audit_logs table.
 * User instruction: "For the expert plan, it should just be the properties
 *       in their pipeline that they've added." (User message 2026-05-31)
 */

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip')?.trim() ??
    'unknown'
  const supabase = await createClient()

  /* 1. AUTHENTICATION */
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return jsonError(401, 'UNAUTHENTICATED', 'Please sign in to export data.')
  }

  /* 2. AUTHORIZATION (plan gate) */
  const { effectivePlan, isAdmin } = await getCurrentUserAccess()
  const { data: entitlement } = await supabase
    .from('plan_entitlements')
    .select('csv_export')
    .eq('plan', effectivePlan)
    .single()

  if (!isAdmin && !entitlement?.csv_export) {
    return jsonError(
      403,
      'UNAUTHORIZED',
      'CSV export is available on the Expert plan. Upgrade to unlock exports.',
      { upgradeUrl: '/pricing' },
    )
  }

  /* 3. INPUT VALIDATION */
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError(400, 'INVALID_PARAMS', 'Request body must be valid JSON.')
  }

  const contentType = String(body.contentType ?? 'auction')
  const county = body.county ? String(body.county) : undefined
  const batchId = body.batchId ? String(body.batchId) : undefined
  const format = String(body.format ?? 'full')
  const ids = body.ids as string[] | undefined

  if (contentType !== 'auction' && contentType !== 'off_market') {
    return jsonError(
      400, 'INVALID_PARAMS', 'contentType must be "auction" or "off_market".',
    )
  }

  if (county !== undefined && !isValidCounty(county)) {
    return jsonError(400, 'INVALID_PARAMS', 'Invalid county filter.')
  }

  if (batchId !== undefined && (batchId.length < 1 || batchId.length > 100)) {
    return jsonError(400, 'INVALID_PARAMS', 'Invalid batchId filter.')
  }

  if (ids !== undefined) {
    if (!isAdmin) {
      return jsonError(403, 'DATA_ACCESS_DENIED', 'Explicit ID selection is admin-only.')
    }
    if (
      !Array.isArray(ids) ||
      ids.some((i) => typeof i !== 'string' || i.length !== 36) ||
      ids.length > MAX_EXPLICIT_IDS
    ) {
      return jsonError(
        400, 'INVALID_PARAMS',
        `ids must be an array of 1–${MAX_EXPLICIT_IDS} UUID strings.`,
      )
    }
  }

  if (format !== 'full' && format !== 'compact') {
    return jsonError(400, 'INVALID_PARAMS', 'format must be "full" or "compact".')
  }

  /* 4. RATE LIMITING */
  const rateKey = `export:${user.id}`
  const rate = await checkRateLimit(rateKey, 60, 1)
  if (!rate.ok) {
    return jsonError(
      429, 'RATE_LIMITED',
      `Exports are limited to 1 per minute. Please wait ${rate.retryAfterSeconds}s.`,
      { retryAfterSeconds: rate.retryAfterSeconds },
    )
  }

  /* 5. SCOPE VALIDATION */
  const exportableIds = await resolveExportableIds({
    supabase, userId: user.id, contentType, county, batchId, explicitIds: ids, isAdmin,
  })

  if (ids && exportableIds.length > MAX_EXPLICIT_IDS) {
    return jsonError(400, 'SCOPE_TOO_LARGE', `Cannot export more than ${MAX_EXPLICIT_IDS} explicit IDs.`)
  }
  if (!ids && exportableIds.length > MAX_EXPORT_ROWS) {
    return jsonError(400, 'SCOPE_TOO_LARGE', `Result set exceeds ${MAX_EXPORT_ROWS} rows. Narrow your filters.`)
  }

  /* 6. AUDIT LOG */
  let auditId: string | null = null
  try {
    const { data: audit } = await supabase
      .from('export_audit_logs')
      .insert({
        user_id: user.id,
        user_email: user.email ?? null,
        plan: effectivePlan,
        ip_address: ip,
        content_type: contentType,
        county_filter: county ?? null,
        batch_id_filter: batchId ?? null,
        format,
        explicit_ids: ids ?? null,
        requested_at: new Date().toISOString(),
        result_count: exportableIds.length,
        success: true,
        error_message: null,
      })
      .select('id')
      .single()
    auditId = audit?.id ?? null
  } catch (e) {
    console.error('[export] audit insert failed:', e)
  }

  /* 7. STREAM CSV */
  try {
    const stream = createCsvStream({ supabase, ids: exportableIds, contentType, format })
    const filename = `bidwise-export-${contentType}-${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (auditId) {
      try {
        await supabase
          .from('export_audit_logs')
          .update({ success: false, error_message: (err as Error).message })
          .eq('id', auditId)
      } catch {
        /* best-effort audit update; ignore failures */
      }
    }
    console.error('[export] stream error:', err)
    return jsonError(500, 'INTERNAL_ERROR', 'Failed to generate CSV. Please try again.')
  }
}

/**
 * resolveExportableIds — for Expert exports, returns ONLY the user's pipeline.
 * (Unlocked properties are intentionally excluded per product direction:
 *  "For the expert plan, it should just be the properties in their pipeline.")
 */
async function resolveExportableIds(args: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  contentType: string
  county?: string
  batchId?: string
  explicitIds?: string[]
  isAdmin: boolean
}): Promise<string[]> {
  const { supabase, userId, contentType, county, explicitIds } = args

  if (explicitIds) return explicitIds

  if (contentType === 'off_market') {
    // lead_pipeline.lead_id IS the lead's id (FK → off_market_leads.id),
    // which matches visible_off_market_leads_safe.id directly.
    const { data: pipeline } = await supabase
      .from('lead_pipeline')
      .select('lead_id')
      .eq('user_id', userId)

    const ids = new Set<string>()
    ;(pipeline ?? []).forEach((r) => {
      const leadId = (r as { lead_id?: string }).lead_id
      if (leadId) ids.add(leadId)
    })
    return Array.from(ids)
  }

  // Auction pipeline keys on (county, parcel_id) — its `id` column is the
  // pipeline row's own PK, NOT the property id. We must map each pipeline
  // entry back to the property id exposed by visible_properties_safe.
  let pipelineQuery = supabase
    .from('auction_pipeline')
    .select('county, parcel_id')
    .eq('user_id', userId)
  if (county) {
    pipelineQuery = pipelineQuery.eq('county', county.toLowerCase().trim())
  }
  const { data: pipeline } = await pipelineQuery

  const pairs = (pipeline ?? [])
    .map((r) => r as { county?: string; parcel_id?: string })
    .filter((r) => r.county && r.parcel_id)
  if (pairs.length === 0) return []

  const wantedKeys = new Set(pairs.map((r) => `${r.county}|${r.parcel_id}`))
  const parcelIds = Array.from(new Set(pairs.map((r) => r.parcel_id as string)))

  // Match on parcel_id (indexed), then disambiguate by county in JS since
  // parcel_id can collide across counties.
  const { data: rows } = await supabase
    .from('visible_properties_safe')
    .select('id, county, parcel_id')
    .in('parcel_id', parcelIds)

  const ids = new Set<string>()
  ;(rows ?? []).forEach((r) => {
    const row = r as { id?: string; county?: string; parcel_id?: string }
    if (row.id && wantedKeys.has(`${row.county}|${row.parcel_id}`)) {
      ids.add(row.id)
    }
  })

  return Array.from(ids)
}

function createCsvStream(args: {
  supabase: Awaited<ReturnType<typeof createClient>>
  ids: string[]
  contentType: string
  format: string
}): ReadableStream<Uint8Array> {
  const { supabase, ids, contentType, format } = args
  const encoder = new TextEncoder()

  const isAuction = contentType === 'auction'
  const table = isAuction ? 'visible_properties_safe' : 'visible_off_market_leads_safe'

  // Output columns (also the CSV header).
  const columns = isAuction
    ? (format === 'compact'
        ? ['parcel_id','county','address','city','state','zip','property_type','deal_score','min_bid','arv','roi_pct','max_bid']
        : ['id','parcel_id','county','address','city','state','zip','property_type','beds','baths','sqft','year_built','lot_size','auction_date','min_bid','deal_score','tax_due','arv','rehab_cost','all_in_cost','net_profit','roi_pct','max_bid','risk_score','crime_score','flood_zone','comp_count','arv_confidence','batch_id'])
    : ['id','address','city','state','zip_code','county','equity_tier','deal_score','deal_type','owner_type','years_owned','open_liens','foreclosure_status','listing_status','last_sold_price','last_sold_date','assessed_value','tax_amount','owner_name','owner_phone','owner_email','mailing_address','mailing_city','mailing_state','mailing_zip','year_built','building_sqft','beds','baths','est_value','propstream_found','batch_id']

  // For the auction feed, `visible_properties_safe` nulls financials on locked
  // rows and exposes a `locked` flag. We also read `locked` (without emitting
  // it) so we can drop locked rows entirely — a locked placeholder row has no
  // financials worth exporting and would just be deal-less noise in the CSV.
  const selectColumns = isAuction ? [...columns, 'locked'] : columns

  const CHUNK = 200
  let index = 0
  let headerSent = false

  return new ReadableStream({
    async pull(controller) {
      if (!headerSent) {
        controller.enqueue(encoder.encode('﻿' + columns.join(',') + '\n'))
        headerSent = true
      }
      if (index >= ids.length) {
        controller.close()
        return
      }
      const chunk = ids.slice(index, index + CHUNK)
      index += CHUNK

      const { data, error } = await supabase
        .from(table)
        .select(selectColumns.join(','))
        .in('id', chunk)

      if (error) {
        controller.error(error)
        return
      }

      for (const row of data ?? []) {
        const record = row as unknown as Record<string, unknown>
        // Never export locked rows: their financials are nulled by the view and
        // they carry no usable deal data. (off_market rows are always unlocked.)
        if (record.locked === true) continue
        // csvCell adds CSV-injection protection (scraped owner/address strings)
        // on top of RFC-4180 quoting.
        const line = columns.map((col) => csvCell(record[col])).join(',') + '\n'
        controller.enqueue(encoder.encode(line))
      }
    },
  })
}
