// supabase/functions/revenuecat-webhook/mapping.ts
//
// Pure RevenueCat-webhook-event → subscriptions-row mapping. No I/O, no env —
// index.ts owns auth + the PostgREST upsert; this module owns every decision
// about WHAT to write, so the whole policy is unit-testable (sources.ts /
// diff.ts precedent).
//
// Contract notes (see directives/revenuecat_reconciliation_scope.md):
//   • app_user_id is the Supabase auth uid — guaranteed by the mobile app
//     (configurePurchases(userId) sets appUserID before any purchase). Events
//     with a non-uuid app_user_id (e.g. "$RCAnonymousID:...") are SKIPPED with
//     a 200 upstream so RevenueCat does not retry forever.
//   • Conflict key = original_transaction_id (stable across renewals for one
//     Apple subscription) → subscriptions.revenuecat_subscription_id UNIQUE.
//   • plan: single 'pro' entitlement today — every product maps to plan='pro'
//     until tiered IAP exists. Revisit planForProduct when tiers ship.
//   • CANCELLATION means auto-renew was switched OFF while the current period
//     is still paid — access stands until EXPIRATION, so it is a deliberate
//     no-op here (the scope doc pins this).

export type RcPeriodType = "NORMAL" | "TRIAL" | "INTRO"

/** The subset of a RevenueCat webhook `event` object this mapping reads. */
export interface RcEvent {
  type?: string
  app_user_id?: string
  original_transaction_id?: string
  product_id?: string
  new_product_id?: string
  period_type?: RcPeriodType | string
  purchased_at_ms?: number
  expiration_at_ms?: number | null
}

export interface SubscriptionUpsert {
  user_id: string
  provider: "revenuecat"
  revenuecat_subscription_id: string
  plan: "starter" | "pro" | "expert"
  status: "trialing" | "active" | "past_due" | "canceled"
  billing_cycle: "monthly" | "annual" | null
  trial_end: string | null
  current_period_end: string | null
  updated_at: string
}

export type MapResult =
  | { kind: "upsert"; row: SubscriptionUpsert }
  | { kind: "skip"; reason: string }

// RFC-4122-shaped uuid (any version) — Supabase auth uids are uuids; RC
// anonymous ids ("$RCAnonymousID:...") and arbitrary strings are not.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isSupabaseUuid(id: string | undefined): id is string {
  return typeof id === "string" && UUID_RE.test(id)
}

/** Single 'pro' entitlement today — see header before adding tiers. */
export function planForProduct(_productId: string | undefined): "pro" {
  return "pro"
}

// Product-id naming wins; falls back to the paid-period length when the id is
// uninformative. >180 days can only be an annual product in our catalog.
const DAY_MS = 24 * 60 * 60 * 1000

export function inferBillingCycle(event: RcEvent): "monthly" | "annual" | null {
  const productId = (event.new_product_id ?? event.product_id ?? "").toLowerCase()
  if (/annual|yearly|year/.test(productId)) return "annual"
  if (/month/.test(productId)) return "monthly"
  const start = event.purchased_at_ms
  const end = event.expiration_at_ms
  if (typeof start === "number" && typeof end === "number" && end > start) {
    return end - start > 180 * DAY_MS ? "annual" : "monthly"
  }
  return null
}

function isoOrNull(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

// status per event type. CANCELLATION / unknown types are handled (skipped)
// before this table is consulted.
const STATUS_FOR_TYPE: Record<string, SubscriptionUpsert["status"]> = {
  INITIAL_PURCHASE: "active",
  RENEWAL: "active",
  UNCANCELLATION: "active",
  PRODUCT_CHANGE: "active",
  EXPIRATION: "canceled",
  BILLING_ISSUE: "past_due",
}

/**
 * Decide what (if anything) to write for one RevenueCat webhook event.
 * `nowMs` is injectable so tests pin updated_at (sources.ts clock precedent).
 */
export function mapRevenueCatEvent(event: RcEvent, nowMs: number = Date.now()): MapResult {
  const type = event.type ?? "(missing)"

  if (!isSupabaseUuid(event.app_user_id)) {
    return { kind: "skip", reason: `app_user_id is not a Supabase uuid (${type})` }
  }
  if (type === "CANCELLATION") {
    // Auto-renew off, current period still paid — entitlement stands until
    // EXPIRATION arrives. Writing 'canceled' now would cut off paid access.
    return { kind: "skip", reason: "CANCELLATION keeps access until expiration" }
  }
  const status = STATUS_FOR_TYPE[type]
  if (!status) {
    return { kind: "skip", reason: `unhandled event type ${type}` }
  }
  if (!event.original_transaction_id) {
    return { kind: "skip", reason: `no original_transaction_id on ${type}` }
  }

  const trialing = status === "active" && event.period_type === "TRIAL"
  const periodEnd = isoOrNull(event.expiration_at_ms)

  return {
    kind: "upsert",
    row: {
      user_id: event.app_user_id,
      provider: "revenuecat",
      revenuecat_subscription_id: event.original_transaction_id,
      plan: planForProduct(event.new_product_id ?? event.product_id),
      status: trialing ? "trialing" : status,
      billing_cycle: inferBillingCycle(event),
      trial_end: trialing ? periodEnd : null,
      current_period_end: periodEnd,
      updated_at: new Date(nowMs).toISOString(),
    },
  }
}
