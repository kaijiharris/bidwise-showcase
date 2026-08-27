// Affiliate attribution helpers shared by the QR redirect (/a/[code]), the
// auth callback (profile stamp), the Stripe checkout route (metadata + self-
// referral guard) and the vendor application intake (ip hashing).
//
// Server-only: uses node:crypto and the SERVICE-ROLE key (the affiliates
// tables have no anon read policy — see migration 016). Never import from a
// client component.

import { createHash } from 'crypto'
import {
  createClient as createServiceClient,
  type SupabaseClient,
} from '@supabase/supabase-js'

// <2-char human prefix>-<6 Crockford base32 chars>, e.g. AJ-7K2MQ4. Crockford
// excludes I, L, O, U so printed codes can't be misread. Store uppercase;
// compare case-insensitively (normalizeAffiliateCode uppercases first).
export const AFFILIATE_CODE_RE = /^[A-Z]{2}-[0-9A-HJKMNP-TV-Z]{6}$/

export const AFFILIATE_COOKIE_NAME = 'bw_aff'
// 60 days: SaaS-considered-purchase norm. BidWise's auction-met funnel has a
// long pre-signup gap (scan at auction → signup weeks later → free trial),
// so the retail default of 30 would expire before checkout. Last-touch:
// a newer scan overwrites; first-write-wins once stamped on the profile.
export const AFFILIATE_COOKIE_MAX_AGE_DAYS = 60

export interface AffiliateRow {
  id: string
  code: string
  email: string
  user_id: string | null
  status: 'active' | 'paused' | 'terminated'
  commission_model?: string
  commission_flat_cents?: number
  commission_pct?: number | null
  commission_months?: number | null
}

export type AffiliateEventInsert = {
  affiliate_id: string
  event_type: 'scan' | 'signup' | 'subscription_started' | 'conversion_paid' | 'conversion_voided'
  user_id?: string | null
  stripe_subscription_id?: string | null
  plan?: string | null
  billing_cycle?: string | null
  commission_model?: string | null
  commission_flat_cents?: number | null
  commission_pct?: number | null
  commission_months?: number | null
  ip_hash?: string | null
  user_agent?: string | null
  metadata?: Record<string, unknown>
}

/** Uppercase + validate a scanned/stored code. Returns null on any mismatch. */
export function normalizeAffiliateCode(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  return AFFILIATE_CODE_RE.test(code) ? code : null
}

/** Salted, one-way IP hash — raw IPs are never stored (see migration 016). */
export function hashIp(ip: string): string {
  const salt = process.env.AFF_IP_SALT ?? ''
  if (!salt) {
    // Fail-open like rate-limit.ts: hashing still happens, just unsalted.
    console.warn('[affiliates] AFF_IP_SALT is not set — ip hashes are unsalted')
  }
  return createHash('sha256').update(ip + salt).digest('hex')
}

// Attribution writes are fail-open by design: a scanner on courthouse wifi
// must never wait on a slow/unreachable Supabase. Default fetch stalls 7-8s
// before erroring; cap it so the redirect (and cookie) go out fast.
const SERVICE_FETCH_TIMEOUT_MS = 2000

/** Service-role client — same trust model as the Stripe webhook. */
export function getServiceClient(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: {
        fetch: (url, init) =>
          fetch(url, {
            ...init,
            signal: AbortSignal.timeout(SERVICE_FETCH_TIMEOUT_MS),
          }),
      },
    },
  )
}

/**
 * Reject `work` if it outruns `ms`. The AbortSignal cap above is not enough on
 * its own: supabase-js retries a failed request internally, so a dead-network
 * call still takes ~15s wall-clock (measured) despite each fetch aborting at 2s.
 * A hard race abandons the await regardless of those retries, so a redirect
 * route can fall through to its fail-open path in bounded time. The background
 * promise is left to settle and be GC'd — attribution is best-effort anyway.
 */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`operation exceeded ${ms}ms deadline`)),
      ms,
    )
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

/** Minimal cookie-header parser (route handlers get a plain Request). */
export function readCookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

/** First client IP from x-forwarded-for (Vercel sets it), or 'unknown'. */
export function clientIpFrom(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || 'unknown'
}

/**
 * Look up an affiliate by (already-normalized) code. Returns the row only when
 * the affiliate is ACTIVE — paused/terminated partners keep their landing page
 * working but stop accruing attribution. Throws on DB errors (callers decide
 * whether attribution failure is fatal; for redirects it never is).
 */
export async function lookupActiveAffiliate(
  supabase: SupabaseClient,
  code: string,
): Promise<AffiliateRow | null> {
  const { data, error } = await supabase
    .from('affiliates')
    .select('id, code, email, user_id, status, commission_model, commission_flat_cents, commission_pct, commission_months')
    .eq('code', code)
    .maybeSingle()
  if (error) throw new Error(`affiliates lookup failed: ${error.message}`)
  if (!data) return null
  const affiliate = data as AffiliateRow
  return affiliate.status === 'active' ? affiliate : null
}

/**
 * Self-referral guard: an affiliate subscribing through their own QR never
 * earns commission. Matches on payout email (case-insensitive) or linked user id.
 * Blocked BEFORE payout, per the anti-fraud research in the spec.
 */
export function isSelfReferral(
  affiliate: Pick<AffiliateRow, 'email' | 'user_id'>,
  user: { id: string; email?: string | null },
): boolean {
  if (affiliate.user_id && affiliate.user_id === user.id) return true
  const affEmail = affiliate.email?.trim().toLowerCase()
  const userEmail = user.email?.trim().toLowerCase()
  return Boolean(affEmail && userEmail && affEmail === userEmail)
}

/**
 * Append a row to the attribution ledger. NEVER throws — attribution is
 * best-effort everywhere it is called from a user-facing flow. Returns false
 * (and logs) on failure. 23505 (unique-index dedup) counts as success.
 */
export async function recordAffiliateEvent(
  supabase: SupabaseClient,
  event: AffiliateEventInsert,
): Promise<boolean> {
  try {
    const { error } = await supabase.from('affiliate_events').insert({
      metadata: {},
      ...event,
    })
    if (error && error.code !== '23505') {
      console.error(
        `[affiliates] ${event.event_type} event insert failed:`,
        error.message,
      )
      return false
    }
    return true
  } catch (err) {
    console.error(`[affiliates] ${event.event_type} event insert threw:`, err)
    return false
  }
}
