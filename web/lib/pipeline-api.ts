// Web client for the auction_pipeline table — the server-backed deal pipeline
// shared with the mobile app (mobile/lib/pipeline-api.ts writes the same rows,
// so a deal saved on the web dashboard appears on the phone and vice versa).
//
// This replaces the localStorage-only 'bw_pipeline' persistence: a paying
// subscriber's tracked deals now survive cache clears and device switches, and
// /api/export (which reads auction_pipeline by (county, parcel_id)) finally
// has real rows for web users.
//
// Contract: every function THROWS on failure — callers own the optimistic
// update + revert/toast. RLS (migration 003) scopes all reads/writes to the
// signed-in user; user_id is still set explicitly on insert because the
// insert policy checks it.

import { createClient } from '@/lib/supabase/client'

export type PipelineStatus = 'watchlist' | 'diligence' | 'bidding' | 'pass'

const STATUSES: readonly PipelineStatus[] = ['watchlist', 'diligence', 'bidding', 'pass']

export interface PipelineDeal {
  /** Server uuid once synced; a `local-…` composite before sync succeeds. */
  id: string
  /** County parcel/tax id — the cross-device identity (unique per user). */
  parcelId: string
  addr: string
  county: string
  roi: number | null
  score: number | null
  status: PipelineStatus
  addedAt: string
}

// Columns we read back. notes/updated_at exist (mobile uses notes) but the web
// pipeline UI doesn't render them yet.
const COLUMNS = 'id, county, parcel_id, address, city, zip, auction_date, roi, deal_score, status, added_at'

interface ServerRow {
  id: string
  county: string
  parcel_id: string
  address: string
  city: string | null
  zip: string | null
  auction_date: string | null
  roi: number | null
  deal_score: number | null
  status: string
  added_at: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when a deal's id is a server row uuid (synced) rather than a local composite. */
export function isServerDealId(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * Cross-device parcel identity: real tax/parcel id when the dataset has one,
 * else the same `${county}-${propId}` composite the mobile app falls back to —
 * both clients MUST agree or the unique (user_id, parcel_id) key can't dedupe.
 */
export function parcelIdFor(input: { taxId?: string | null; county: string; id: number | string }): string {
  const taxId = typeof input.taxId === 'string' ? input.taxId.trim() : ''
  return taxId || `${input.county}-${input.id}`
}

function mapRow(row: ServerRow): PipelineDeal {
  const status = (STATUSES as readonly string[]).includes(row.status)
    ? (row.status as PipelineStatus)
    : 'watchlist'
  return {
    id: row.id,
    parcelId: row.parcel_id,
    addr: row.address,
    county: row.county,
    roi: row.roi,
    score: row.deal_score,
    status,
    addedAt: row.added_at,
  }
}

async function requireUserId(): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('Not signed in')
  return data.user.id
}

export async function fetchPipeline(): Promise<PipelineDeal[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('auction_pipeline')
    .select(COLUMNS)
    .order('added_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as ServerRow[]).map(mapRow)
}

export interface AddToPipelineInput {
  parcelId: string
  addr: string
  county: string
  city?: string | null
  zip?: string | null
  auctionDate?: string | null
  roi: number | null
  score: number | null
  status?: PipelineStatus
}

export async function addToPipelineServer(input: AddToPipelineInput): Promise<PipelineDeal> {
  const userId = await requireUserId()
  const supabase = createClient()
  const { data, error } = await supabase
    .from('auction_pipeline')
    .upsert(
      {
        user_id: userId,
        county: input.county,
        parcel_id: input.parcelId,
        address: input.addr,
        city: input.city ?? null,
        zip: input.zip ?? null,
        auction_date: input.auctionDate ?? null,
        roi: input.roi,
        deal_score: input.score,
        status: input.status ?? 'watchlist',
      },
      { onConflict: 'user_id,parcel_id' },
    )
    .select(COLUMNS)
    .single()
  if (error) throw error
  return mapRow(data as unknown as ServerRow)
}

export async function updatePipelineStatusServer(id: string, status: PipelineStatus): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('auction_pipeline')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

export async function removeFromPipelineServer(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('auction_pipeline').delete().eq('id', id)
  if (error) throw error
}

/** Delete every pipeline row the user owns (the dashboard's "Clear all"). */
export async function clearPipelineServer(): Promise<void> {
  const userId = await requireUserId()
  const supabase = createClient()
  const { error } = await supabase.from('auction_pipeline').delete().eq('user_id', userId)
  if (error) throw error
}

// Legacy cached deal — the pre-sync localStorage shape carried a numeric
// propId and no parcelId. Kept loose: cache contents are untrusted input.
interface LegacyCachedDeal {
  id?: unknown
  parcelId?: unknown
  propId?: unknown
  addr?: unknown
  county?: unknown
  roi?: unknown
  score?: unknown
  status?: unknown
  addedAt?: unknown
}

/**
 * One-time (idempotent) migration: push localStorage-era deals up to the
 * server. Rows whose id is already a server uuid are skipped; the rest upsert
 * on (user_id, parcel_id), so re-running never duplicates. Returns how many
 * rows were sent.
 */
export async function syncLegacyDeals(cached: readonly LegacyCachedDeal[]): Promise<number> {
  const rows = cached
    .filter(d => !(typeof d.id === 'string' && isServerDealId(d.id)))
    .map(d => {
      const county = typeof d.county === 'string' && d.county ? d.county : null
      const addr = typeof d.addr === 'string' && d.addr ? d.addr : null
      const explicit = typeof d.parcelId === 'string' && d.parcelId ? d.parcelId : null
      const derived =
        county && (typeof d.propId === 'number' || typeof d.propId === 'string')
          ? `${county}-${d.propId}`
          : null
      const parcelId = explicit ?? derived
      if (!county || !addr || !parcelId) return null
      return {
        county,
        parcel_id: parcelId,
        address: addr,
        roi: typeof d.roi === 'number' ? d.roi : null,
        deal_score: typeof d.score === 'number' ? d.score : null,
        status: (STATUSES as readonly string[]).includes(String(d.status))
          ? (d.status as PipelineStatus)
          : 'watchlist',
        added_at: typeof d.addedAt === 'string' && d.addedAt ? d.addedAt : new Date().toISOString(),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (rows.length === 0) return 0

  const userId = await requireUserId()
  const supabase = createClient()
  const { error } = await supabase
    .from('auction_pipeline')
    .upsert(
      rows.map(r => ({ ...r, user_id: userId })),
      { onConflict: 'user_id,parcel_id' },
    )
  if (error) throw error
  return rows.length
}
