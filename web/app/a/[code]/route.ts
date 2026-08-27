// GET /a/[code] — affiliate QR redirect (dynamic-QR pattern).
//
// The printed QR encodes https://<host>/a/<CODE> and nothing else: the
// destination lives HERE, so it can change forever without reprinting, and
// every scan is logged server-side even if the visitor bounces immediately.
//
// Guarantees, in priority order:
//   1. The human at the auction table ALWAYS lands on the site — malformed
//      codes, unknown codes, rate limits and DB outages all still redirect.
//   2. Attribution is best-effort: active affiliate → scan event + 60-day
//      httpOnly last-touch bw_aff cookie + UTM-tagged landing.
//   3. No PII in the ledger: salted IP hash only, truncated user agent.

import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  AFFILIATE_COOKIE_MAX_AGE_DAYS,
  AFFILIATE_COOKIE_NAME,
  clientIpFrom,
  getServiceClient,
  hashIp,
  lookupActiveAffiliate,
  normalizeAffiliateCode,
  recordAffiliateEvent,
  withDeadline,
} from '@/lib/affiliates'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const USER_AGENT_MAX_LENGTH = 256
// Generous: QR scans at a live auction can burst from one venue IP/NAT.
const SCAN_RATE_WINDOW_SECONDS = 60
const SCAN_RATE_MAX_PER_WINDOW = 30
// The visitor must land fast even on courthouse wifi. If attribution (up to
// three DB round-trips) outruns this, we fall through to the fail-open redirect
// and re-validate the code downstream. Healthy networks finish in well under it.
const ATTRIBUTION_DEADLINE_MS = 1500

function redirectHome(request: Request): NextResponse {
  return NextResponse.redirect(new URL('/', request.url))
}

function buildDestination(request: Request, code: string): URL {
  const dest = new URL('/', request.url)
  // Partner in utm_source (never lumped together), stable utm_medium.
  dest.searchParams.set('utm_source', code)
  dest.searchParams.set('utm_medium', 'qr')
  dest.searchParams.set('utm_campaign', 'affiliate')
  return dest
}

function attributedRedirect(dest: URL, code: string): NextResponse {
  const res = NextResponse.redirect(dest)
  // httpOnly + server-only reads keep attribution unforgeable by page scripts.
  // Last-touch: unconditionally overwrite any existing bw_aff.
  res.cookies.set(AFFILIATE_COOKIE_NAME, code, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * AFFILIATE_COOKIE_MAX_AGE_DAYS,
  })
  return res
}

/** True when this (affiliate, ip) already scanned today — raw rows are the
 *  audit trail, the dedup flag is what reporting counts. */
async function scannedToday(
  supabase: SupabaseClient,
  affiliateId: string,
  ipHash: string,
): Promise<boolean> {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { data } = await supabase
    .from('affiliate_events')
    .select('id')
    .eq('affiliate_id', affiliateId)
    .eq('ip_hash', ipHash)
    .eq('event_type', 'scan')
    .gte('created_at', startOfDay.toISOString())
    .limit(1)
  return (data?.length ?? 0) > 0
}

// The DB-touching attribution work, isolated so the whole sequence can run
// under a single response deadline (lookup → rate check → dedup → event).
async function attributeScan(
  request: Request,
  code: string,
  dest: URL,
): Promise<NextResponse> {
  const supabase = getServiceClient()
  const affiliate = await lookupActiveAffiliate(supabase, code)
  // Unknown or paused/terminated: the page stays live, attribution stops.
  if (!affiliate) return redirectHome(request)

  const ipHash = hashIp(clientIpFrom(request))
  const rl = await checkRateLimit(
    `aff-scan:${ipHash}`,
    SCAN_RATE_WINDOW_SECONDS,
    SCAN_RATE_MAX_PER_WINDOW,
  )
  if (!rl.ok) {
    // Bot-volume territory: protect the ledger, but still land the visitor.
    return NextResponse.redirect(dest)
  }

  const dedup = await scannedToday(supabase, affiliate.id, ipHash)
  await recordAffiliateEvent(supabase, {
    affiliate_id: affiliate.id,
    event_type: 'scan',
    ip_hash: ipHash,
    user_agent: (request.headers.get('user-agent') ?? '').slice(0, USER_AGENT_MAX_LENGTH),
    metadata: { dedup },
  })
  return attributedRedirect(dest, code)
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code: rawCode } = await ctx.params
  const code = normalizeAffiliateCode(rawCode)
  // Malformed code: clean exit, no cookie, no log. Never 404 a printed QR.
  if (!code) return redirectHome(request)

  const dest = buildDestination(request, code)

  try {
    return await withDeadline(attributeScan(request, code, dest), ATTRIBUTION_DEADLINE_MS)
  } catch (err) {
    // Slow, unreachable, or failed DB must never strand the visitor. Cookie is
    // still set: the code is re-validated at every consumption point
    // (callback, checkout).
    console.error('[affiliate-redirect] scan handling failed:', err)
    return attributedRedirect(dest, code)
  }
}
