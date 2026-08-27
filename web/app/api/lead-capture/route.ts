import { NextRequest, NextResponse } from 'next/server'
import { serviceClient } from '@/lib/data-access'
import { checkRateLimit } from '@/lib/rate-limit'
import { isFreeListCounty } from '@/lib/free-list'
import { sendFreeListEmail } from '@/lib/free-list-email'

/**
 * POST /api/lead-capture
 * Called by: web/app/free-list/[county]/LeadCaptureForm.tsx (public teaser
 *            pages — visitors are by definition logged out, so this route is
 *            middleware-public and validates everything itself).
 * Data: INSERTs into public.lead_captures (migration 017) via the service-role
 *       client. RLS on the table is deny-by-default — this route is the single
 *       write path, so validation + rate limiting here IS the security
 *       boundary for the table.
 */

// Route reads request headers + writes per-request; never cache.
export const dynamic = 'force-dynamic'

// Pragmatic email shape check (local@domain.tld). Full RFC 5322 is not the
// goal — the goal is rejecting garbage and keeping the DB CHECK (<=254, has @)
// from ever firing.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_EMAIL_LEN = 254
const MAX_SOURCE_LEN = 64
const MAX_UTM_LEN = 128

// 5 captures per IP per minute — generous for a human at an auction, hostile
// to a scripted flood. No-ops when Vercel KV env vars are absent (dev).
const RATE_WINDOW_SECONDS = 60
const RATE_MAX_PER_WINDOW = 5

function badRequest(reason: string): NextResponse {
  return NextResponse.json(
    { error: reason },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  )
}

// Optional free-text field: absent/empty -> null, non-string or overlong ->
// undefined (validation failure the caller turns into a 400).
function optionalField(v: unknown, maxLen: number): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || v.trim().length === 0) return undefined
  const trimmed = v.trim()
  return trimmed.length <= maxLen ? trimmed : undefined
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return badRequest('Invalid JSON body')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('Invalid JSON body')
  }

  // Honeypot: the form ships a visually-hidden "website" field humans never
  // fill. A non-empty value means a bot — report success, store nothing.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json(
      { success: true },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // ── VALIDATION (fail fast, specific messages) ─────────────────────────────
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!rawEmail || rawEmail.length > MAX_EMAIL_LEN || !EMAIL_RE.test(rawEmail)) {
    return badRequest('Enter a valid email address')
  }

  const county = typeof body.county === 'string' ? body.county.trim().toLowerCase() : ''
  if (!isFreeListCounty(county)) {
    return badRequest('Unknown county')
  }

  const source = optionalField(body.source, MAX_SOURCE_LEN)
  const utmSource = optionalField(body.utm_source, MAX_UTM_LEN)
  const utmMedium = optionalField(body.utm_medium, MAX_UTM_LEN)
  const utmCampaign = optionalField(body.utm_campaign, MAX_UTM_LEN)
  if (
    source === undefined ||
    utmSource === undefined ||
    utmMedium === undefined ||
    utmCampaign === undefined
  ) {
    return badRequest('Invalid tracking fields')
  }

  // ── RATE LIMIT (per IP — callers are anonymous) ───────────────────────────
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip')?.trim() ??
    'unknown'
  const rl = await checkRateLimit(
    `lead-capture:${ip}`,
    RATE_WINDOW_SECONDS,
    RATE_MAX_PER_WINDOW,
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests — try again in a minute' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSeconds),
          'Cache-Control': 'no-store',
        },
      },
    )
  }

  // ── INSERT (service role — the table's RLS denies everyone else) ──────────
  // ignoreDuplicates + the UNIQUE (email, county) index make a re-submit
  // idempotent: the visitor sees success, the lead is stored exactly once.
  const svc = serviceClient()
  const { error } = await svc.from('lead_captures').upsert(
    {
      email: rawEmail,
      county,
      source: source ?? 'free-list',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
    },
    { onConflict: 'email,county', ignoreDuplicates: true },
  )

  if (error) {
    // Log the detail server-side; never leak DB internals to an anonymous caller.
    console.error('[lead-capture] insert failed:', error)
    return NextResponse.json(
      { error: 'Unable to save your email right now — please try again' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // ── FULFILLMENT ────────────────────────────────────────────────────────────
  // The form promises "one email with the full analyzed list" — send it now.
  // Non-fatal by contract (sendFreeListEmail never throws): the lead is stored
  // either way, and a resubmit (rate-limited above) retries the send. Awaited,
  // not fire-and-forget — the serverless runtime may freeze after the response.
  const fulfillment = await sendFreeListEmail({ to: rawEmail, county })
  if (!fulfillment.ok) {
    console.error(`[lead-capture] fulfillment email not sent for ${county} lead`)
  }

  return NextResponse.json(
    { success: true },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
