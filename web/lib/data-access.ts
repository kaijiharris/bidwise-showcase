// Server-only authorization helpers for the authenticated data API.
//
// Resolves the caller's identity from a Supabase bearer token (or cookie
// session) and computes what they're allowed to see: their effective plan, the
// monthly auction-unlock allowance, and which specific properties they've
// already unlocked this calendar month.
//
// Deny-by-default: an authenticated user with NO active subscription gets
// `plan: null` (locked everything), NOT a free 'starter' tier.

import { createClient as createServiceClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { isAdmin as isConfiguredAdmin } from '@/lib/admin'

export type EntitlementPlan = 'starter' | 'pro' | 'expert'

// Billing system of record for the active subscription row (migration 028).
// 'stripe' = web checkout; 'revenuecat' = iOS in-app purchase.
export type BillingProvider = 'stripe' | 'revenuecat'

// Monthly auction unlock allowance per plan. null = unlimited.
export const AUCTION_UNLOCK_LIMITS: Record<EntitlementPlan, number | null> = {
  starter: 10,
  pro: 25,
  expert: null,
}

// Thrown when entitlement cannot be DETERMINED (as opposed to determined to be
// "no plan"). Callers must surface this as a 5xx, never as a locked dataset —
// masking a paying customer because the DB hiccuped is worse than erroring.
export class AccessResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AccessResolutionError'
  }
}

export interface ResolvedAccess {
  user: User
  isAdmin: boolean
  // null when the user has no active subscription (deny-by-default). Admins are
  // treated as 'expert'.
  plan: EntitlementPlan | null
  unlockLimit: number | null // monthly allowance; null = unlimited
  // Billing provider of the active subscription row; null when there is none.
  // Drives the iOS unlimited-unlock rule in resolveAccessForUser below.
  provider: BillingProvider | null
}

export function serviceClient(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

function normalizeEntitlementPlan(plan: string | null | undefined): EntitlementPlan | null {
  return plan === 'pro' || plan === 'expert' || plan === 'starter' ? plan : null
}

function normalizeProvider(provider: string | null | undefined): BillingProvider | null {
  return provider === 'revenuecat' || provider === 'stripe' ? provider : null
}

// Resolve the user from an Authorization: Bearer <jwt> header. Returns null if
// no/invalid token. The service client verifies the JWT signature for us.
export async function getUserFromBearer(
  authHeader: string | null,
  svc: SupabaseClient,
): Promise<User | null> {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null
  const { data, error } = await svc.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

// Look up the user's active subscription + admin flag and compute the effective
// plan. No active sub → plan: null (locked).
export async function resolveAccessForUser(
  user: User,
  svc: SupabaseClient,
): Promise<ResolvedAccess> {
  const [
    { data: profile, error: profileError },
    { data: subscription, error: subError },
  ] = await Promise.all([
    svc.from('user_profiles').select('role').eq('id', user.id).maybeSingle(),
    svc
      .from('subscriptions')
      .select('plan, status, current_period_end, provider')
      .eq('user_id', user.id)
      .in('status', ['active', 'trialing'])
      .order('current_period_end', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ])

  // A FAILED query is not the same as "no subscription". Swallowing the error
  // here converts a transient DB fault or a PostgREST schema-cache miss into
  // "this paying customer has no plan" — every property masked, no log line, no
  // alert. That failure mode got materially more likely when `provider` was
  // added to the select: an unrefreshed schema cache fails the whole query.
  // Deny-by-default is correct for a MISSING row, never for an UNKNOWN one.
  if (subError) {
    throw new AccessResolutionError(
      subError.code ?? 'unknown',
      `subscriptions lookup failed for user ${user.id}: ${subError.message}`
    )
  }
  if (profileError) {
    throw new AccessResolutionError(
      profileError.code ?? 'unknown',
      `user_profiles lookup failed for user ${user.id}: ${profileError.message}`
    )
  }

  const isAdmin =
    profile?.role === 'admin' || isConfiguredAdmin(user.email)

  const provider = normalizeProvider(subscription?.provider)

  if (isAdmin) {
    return { user, isAdmin: true, plan: 'expert', unlockLimit: null, provider }
  }

  const plan = normalizeEntitlementPlan(subscription?.plan)

  // iOS in-app purchases are unlimited-unlock regardless of plan label.
  //
  // Why: the RevenueCat webhook maps EVERY iOS product to plan 'pro'
  // (revenuecat-webhook/mapping.ts planForProduct), but the mobile app ships no
  // per-property unlock flow at all — it never calls POST /api/unlocks, and the
  // iOS paywall promises full access outright. Without this branch an iOS
  // subscriber inherits web 'pro''s 25/month allowance with no way to spend it,
  // so every property renders masked (null financials + "Unlock to view
  // address") for a paying customer. Web/Stripe 'pro' keeps its 25/month cap.
  const unlockLimit =
    plan === null
      ? 0
      : provider === 'revenuecat'
        ? null
        : AUCTION_UNLOCK_LIMITS[plan]

  return { user, isAdmin: false, plan, unlockLimit, provider }
}

// Build the set of unlock keys the user has already unlocked THIS calendar
// month. Keys use the same shape the dashboard uses for legacy JSON props:
//   `${county}:${auction_date}:${parcel_id}`
// content_unlocks stores content_id (a properties.id UUID); we map those UUIDs
// back to (county, auction_date, parcel_id) via the properties table.
export async function getUnlockedKeysForMonth(
  userId: string,
  svc: SupabaseClient,
): Promise<Set<string>> {
  const keys = new Set<string>()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data: unlocks, error } = await svc
    .from('content_unlocks')
    .select('content_id')
    .eq('user_id', userId)
    .eq('content_type', 'auction_property')
    .gte('unlocked_at', monthStart)

  if (error || !unlocks || unlocks.length === 0) return keys

  const ids = unlocks
    .map(u => (u as { content_id?: string }).content_id)
    .filter((v): v is string => Boolean(v))
  if (ids.length === 0) return keys

  const { data: rows } = await svc
    .from('properties')
    .select('county, auction_date, parcel_id')
    .in('id', ids)

  for (const r of rows ?? []) {
    const row = r as { county?: string; auction_date?: string; parcel_id?: string }
    keys.add(
      [row.county || 'unknown', row.auction_date || 'no-date', row.parcel_id].join(':'),
    )
  }
  return keys
}
