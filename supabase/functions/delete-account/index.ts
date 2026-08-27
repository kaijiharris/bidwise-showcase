// supabase/functions/delete-account/index.ts
//
// In-app account deletion (Apple App Store Guideline 5.1.1(v) + GDPR/CCPA
// right-to-erasure). Invoked by an authenticated mobile/web client via
//   supabase.functions.invoke('delete-account')
//
// Flow:
//   1. Verify the caller's JWT (anon-key client bound to the caller's token).
//   2. Resolve the caller's user id from that token.
//   3. With the SERVICE-ROLE key, delete every row this user owns across all
//      user-data tables, then delete the auth user itself.
//
// Idempotent: re-invoking after the user is gone returns success (the auth
// user no longer exists, the row deletes are no-ops). Returns JSON
// { success: true } on success, { success: false, error } on failure — never
// the user id, raw table errors, or other internal detail (those are logged
// server-side via console only).
//
// Auth model: NEVER trust a user_id from the request body — it is always
// taken from the verified JWT. The service-role key is read from the
// environment and is never returned to the client.

// @ts-expect-error Deno std import (resolved at deploy time, not in tsconfig)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-expect-error Supabase client (resolved at deploy time)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

// @ts-expect-error Deno global (resolved at deploy time)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
// @ts-expect-error Deno global
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
// @ts-expect-error Deno global
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

// CORS: this function is called from the web app and the mobile app. Allow the
// invoke contract (Authorization + apikey + content-type). Origin stays '*'
// because the bearer JWT — not the origin — is the security boundary here.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

// User-owned tables keyed by `user_id`. Order doesn't matter for correctness
// (auth.users delete cascades via FK ON DELETE CASCADE), but we delete
// explicitly so the function works even on tables whose FK cascade wasn't
// declared, and so erasure is provable/auditable. `lead_pipeline` references
// off_market_leads, which is also user-owned, so deleting the user's leads
// after their pipeline rows avoids any FK ordering surprise.
const USER_ID_TABLES: string[] = [
  "auction_pipeline",
  "lead_pipeline",
  "watchlists",
  "off_market_leads",
  "saved_properties",
  "property_unlocks",
  "content_unlocks",
  "plan_usage_events",
  "user_trials",
  "device_tokens",
  "notification_prefs",
  "subscriptions",
  "user_profiles",
]

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS })
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "method_not_allowed" }, 405)
  }

  // ── 1. Verify the caller's JWT ───────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader.startsWith("Bearer ")) {
    return json({ success: false, error: "missing_authorization" }, 401)
  }

  // anon client bound to the caller's token — getUser() validates the JWT
  // signature + expiry against the auth server.
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: userData, error: userErr } = await authClient.auth.getUser()
  if (userErr || !userData?.user) {
    return json({ success: false, error: "invalid_token" }, 401)
  }
  const userId = userData.user.id

  // ── 2. Service-role client for the actual erasure ────────────────────────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const tablesDeleted: string[] = []
  const tableErrors: Record<string, string> = {}

  // ── 3a. watchlist_leads has no user_id column (PK: watchlist_id, lead_id).
  // Purge it explicitly via the user's watchlists BEFORE deleting watchlists,
  // so erasure works even where the FK cascade isn't declared. ──────────────
  {
    const { data: wl, error: wlErr } = await admin
      .from("watchlists")
      .select("id")
      .eq("user_id", userId)
    if (!wlErr && wl && wl.length > 0) {
      const ids = wl.map((r: { id: string }) => r.id)
      const { error: delErr } = await admin
        .from("watchlist_leads")
        .delete()
        .in("watchlist_id", ids)
      if (delErr && delErr.code !== "42P01" && delErr.code !== "42703") {
        tableErrors["watchlist_leads"] = delErr.message
      } else if (!delErr) {
        tablesDeleted.push("watchlist_leads")
      }
    }
  }

  // ── 3b. Delete user-owned rows. Missing tables / columns are tolerated so a
  // schema that differs slightly per environment never blocks erasure. ──────
  for (const table of USER_ID_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", userId)
    if (error) {
      // 42P01 = undefined_table, 42703 = undefined_column → table not present
      // in this env; treat as nothing-to-delete rather than a failure.
      if (error.code === "42P01" || error.code === "42703") continue
      tableErrors[table] = error.message
    } else {
      tablesDeleted.push(table)
    }
  }

  // user_profiles.id == auth uid (not user_id). Clean it up by primary key too,
  // in case the user_id-keyed delete above didn't match this schema.
  {
    const { error } = await admin.from("user_profiles").delete().eq("id", userId)
    if (error && error.code !== "42P01" && error.code !== "42703") {
      tableErrors["user_profiles:id"] = error.message
    }
  }

  // ── 4. Delete the auth user itself (this is the legally load-bearing step;
  // FK cascades clean up anything we missed). ──────────────────────────────
  const { error: deleteUserErr } = await admin.auth.admin.deleteUser(userId)
  if (deleteUserErr) {
    // "User not found" → already deleted; idempotent success.
    const msg = deleteUserErr.message ?? ""
    const alreadyGone = /not.?found/i.test(msg) || deleteUserErr.status === 404
    if (!alreadyGone) {
      // Log the detail server-side only; never echo raw error strings / the
      // user id / per-table errors to the client.
      console.error("[delete-account] auth.deleteUser failed", {
        userId,
        detail: msg,
        tables_deleted: tablesDeleted,
        table_errors: tableErrors,
      })
      return json({ success: false, error: "delete_failed" }, 500)
    }
  }

  // Per-table errors (if any) are non-fatal once the auth user is gone, but we
  // still surface them in the server logs for follow-up — not to the client.
  if (Object.keys(tableErrors).length > 0) {
    console.warn("[delete-account] completed with table errors", {
      userId,
      tables_deleted: tablesDeleted,
      table_errors: tableErrors,
    })
  }

  // Minimal response: no user_id, no table details.
  return json({ success: true })
})
