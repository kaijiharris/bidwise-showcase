// supabase/functions/revenuecat-webhook/mapping_test.ts
//
// Pure-function tests for the RevenueCat event → subscriptions-row mapping.
// No network, no env — fixtures are synthetic (uuid + fake transaction ids).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  inferBillingCycle,
  isSupabaseUuid,
  mapRevenueCatEvent,
  type RcEvent,
} from "./mapping.ts"

const UID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"
const TXN = "100000123456789"
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0) // 2026-07-20T12:00:00Z
const AUG4 = Date.UTC(2026, 7, 4) // expiration fixture

function baseEvent(overrides: Partial<RcEvent> = {}): RcEvent {
  return {
    type: "INITIAL_PURCHASE",
    app_user_id: UID,
    original_transaction_id: TXN,
    product_id: "bw_pro_monthly",
    period_type: "NORMAL",
    purchased_at_ms: NOW,
    expiration_at_ms: AUG4,
    ...overrides,
  }
}

function expectUpsert(result: ReturnType<typeof mapRevenueCatEvent>) {
  if (result.kind !== "upsert") {
    throw new Error(`expected upsert, got skip: ${result.kind === "skip" ? result.reason : ""}`)
  }
  return result.row
}

Deno.test("INITIAL_PURCHASE (normal) → active pro row with conflict key + provider", () => {
  const row = expectUpsert(mapRevenueCatEvent(baseEvent(), NOW))
  assertEquals(row.user_id, UID)
  assertEquals(row.provider, "revenuecat")
  assertEquals(row.revenuecat_subscription_id, TXN)
  assertEquals(row.plan, "pro")
  assertEquals(row.status, "active")
  assertEquals(row.billing_cycle, "monthly")
  assertEquals(row.trial_end, null)
  assertEquals(row.current_period_end, new Date(AUG4).toISOString())
  assertEquals(row.updated_at, new Date(NOW).toISOString())
})

Deno.test("INITIAL_PURCHASE with period_type TRIAL → trialing with trial_end", () => {
  const row = expectUpsert(mapRevenueCatEvent(baseEvent({ period_type: "TRIAL" }), NOW))
  assertEquals(row.status, "trialing")
  assertEquals(row.trial_end, new Date(AUG4).toISOString())
})

Deno.test("RENEWAL and UNCANCELLATION → active", () => {
  for (const type of ["RENEWAL", "UNCANCELLATION"]) {
    const row = expectUpsert(mapRevenueCatEvent(baseEvent({ type }), NOW))
    assertEquals(row.status, "active")
  }
})

Deno.test("CANCELLATION → skip (access stands until expiration)", () => {
  const result = mapRevenueCatEvent(baseEvent({ type: "CANCELLATION" }), NOW)
  assertEquals(result.kind, "skip")
})

Deno.test("EXPIRATION → canceled", () => {
  const row = expectUpsert(mapRevenueCatEvent(baseEvent({ type: "EXPIRATION" }), NOW))
  assertEquals(row.status, "canceled")
})

Deno.test("BILLING_ISSUE → past_due", () => {
  const row = expectUpsert(mapRevenueCatEvent(baseEvent({ type: "BILLING_ISSUE" }), NOW))
  assertEquals(row.status, "past_due")
})

Deno.test("PRODUCT_CHANGE → active, billing cycle from new_product_id", () => {
  const row = expectUpsert(
    mapRevenueCatEvent(
      baseEvent({ type: "PRODUCT_CHANGE", new_product_id: "bw_pro_annual" }),
      NOW,
    ),
  )
  assertEquals(row.status, "active")
  assertEquals(row.billing_cycle, "annual")
})

Deno.test("anonymous RevenueCat id → skip (never a Supabase uid)", () => {
  const result = mapRevenueCatEvent(
    baseEvent({ app_user_id: "$RCAnonymousID:87c6049c58069238dce29853f60b1746" }),
    NOW,
  )
  assertEquals(result.kind, "skip")
})

Deno.test("missing / non-uuid app_user_id → skip", () => {
  for (const bad of [undefined, "", "not-a-uuid", "12345"]) {
    const result = mapRevenueCatEvent(baseEvent({ app_user_id: bad }), NOW)
    assertEquals(result.kind, "skip")
  }
})

Deno.test("missing original_transaction_id → skip (no conflict key)", () => {
  const result = mapRevenueCatEvent(baseEvent({ original_transaction_id: undefined }), NOW)
  assertEquals(result.kind, "skip")
})

Deno.test("unknown event types → skip, never throw", () => {
  for (const type of ["TRANSFER", "TEST", "SUBSCRIBER_ALIAS", undefined]) {
    const result = mapRevenueCatEvent(baseEvent({ type }), NOW)
    assertEquals(result.kind, "skip")
  }
})

Deno.test("billing cycle inference: name wins, duration is fallback, unknown is null", () => {
  // Name-based
  assertEquals(inferBillingCycle(baseEvent({ product_id: "bw_pro_yearly" })), "annual")
  assertEquals(inferBillingCycle(baseEvent({ product_id: "bw_pro_monthly" })), "monthly")
  // Duration-based (uninformative name): 365 days → annual, 30 days → monthly
  const DAY = 24 * 60 * 60 * 1000
  assertEquals(
    inferBillingCycle(
      baseEvent({ product_id: "bw_pro", purchased_at_ms: NOW, expiration_at_ms: NOW + 365 * DAY }),
    ),
    "annual",
  )
  assertEquals(
    inferBillingCycle(
      baseEvent({ product_id: "bw_pro", purchased_at_ms: NOW, expiration_at_ms: NOW + 30 * DAY }),
    ),
    "monthly",
  )
  // No name signal, no usable duration
  assertEquals(
    inferBillingCycle(
      baseEvent({ product_id: "bw_pro", purchased_at_ms: undefined, expiration_at_ms: null }),
    ),
    null,
  )
})

Deno.test("missing expiration_at_ms → null period end (row still writable)", () => {
  const row = expectUpsert(mapRevenueCatEvent(baseEvent({ expiration_at_ms: null }), NOW))
  assertEquals(row.current_period_end, null)
})

Deno.test("uuid validator: accepts RFC-4122 shapes, rejects everything else", () => {
  assertEquals(isSupabaseUuid(UID), true)
  assertEquals(isSupabaseUuid(UID.toUpperCase()), true)
  assertEquals(isSupabaseUuid("$RCAnonymousID:abc"), false)
  assertEquals(isSupabaseUuid(undefined), false)
})
