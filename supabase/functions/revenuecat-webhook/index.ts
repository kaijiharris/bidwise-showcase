// supabase/functions/revenuecat-webhook/index.ts
//
// RevenueCat → Supabase subscription reconciliation (App Store prep step 2 of
// 3 — directives/revenuecat_reconciliation_scope.md). An iOS in-app purchase
// today grants access only inside the app (client-side `pro` entitlement
// check); this webhook writes the same fact into the `subscriptions` table so
// the WEB dashboard, API masking, exports, revenue queries, and the
// repeat-trial guard all see IAP subscribers.
//
// Auth: RevenueCat dashboard → Integrations → Webhooks lets the operator set a
// literal Authorization header value. Mint REVENUECAT_WEBHOOK_SECRET the same
// way as NOTIFY_TAX_SALE_SECRET (Mgmt API /secrets), then configure RC to send
// exactly `Bearer <secret>`. Strict-equality check; fails CLOSED (503) when
// the secret env is unset, so the function is inert until provisioned.
//
// Response contract (RevenueCat retries aggressively on non-2xx):
//   • Malformed / unmapped / anonymous-user events → 200 {handled:false} —
//     retrying would never help.
//   • DB write failure → 500 — transient, we WANT the retry.
//
// Deploy: supabase functions deploy revenuecat-webhook --no-verify-jwt
//         (auth is the static secret above, not a user JWT — RC is a server).
// Requires migration 028 (provider + revenuecat_subscription_id columns).

// @ts-ignore Deno std import (resolved at deploy time, not in tsconfig)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-ignore Supabase client (resolved at deploy time)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

import { mapRevenueCatEvent } from "./mapping.ts"

// @ts-ignore Deno global (resolved at deploy time)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
// @ts-ignore Deno global
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
// @ts-ignore Deno global
const WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") ?? ""

function isAuthorized(req: Request): boolean {
  if (!WEBHOOK_SECRET) return false
  const header = req.headers.get("authorization") ?? ""
  return header === WEBHOOK_SECRET || header === `Bearer ${WEBHOOK_SECRET}`
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json(405, { error: "POST only" })
  }
  if (!WEBHOOK_SECRET) {
    // Fail closed but loudly distinguishable from a bad credential: the
    // function is deployed without being provisioned yet.
    return json(503, { error: "REVENUECAT_WEBHOOK_SECRET not configured" })
  }
  if (!isAuthorized(req)) {
    return json(401, { error: "unauthorized" })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json(200, { handled: false, reason: "body is not JSON" })
  }

  // RevenueCat wraps the event: { api_version, event: {...} }. Accept a bare
  // event object too (manual testing convenience).
  const event =
    payload && typeof payload === "object" && "event" in payload
      ? (payload as { event: Record<string, unknown> }).event
      : (payload as Record<string, unknown>)
  if (!event || typeof event !== "object") {
    return json(200, { handled: false, reason: "no event object in payload" })
  }

  const result = mapRevenueCatEvent(event)
  if (result.kind === "skip") {
    console.log(JSON.stringify({ handled: false, type: event.type, reason: result.reason }))
    return json(200, { handled: false, reason: result.reason })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
  const { error } = await db
    .from("subscriptions")
    .upsert(result.row, { onConflict: "revenuecat_subscription_id" })
  if (error) {
    // 500 on purpose: RC retries, and a transient DB error should be retried.
    console.error(JSON.stringify({ handled: false, type: event.type, db_error: error.message }))
    return json(500, { error: "subscription upsert failed" })
  }

  console.log(
    JSON.stringify({
      handled: true,
      type: event.type,
      status: result.row.status,
      user_id: result.row.user_id,
    }),
  )
  return json(200, { handled: true, status: result.row.status })
})
