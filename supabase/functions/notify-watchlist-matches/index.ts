// supabase/functions/notify-watchlist-matches/index.ts
//
// Scans every active alert-enabled watchlist for off-market leads that match
// its criteria and haven't yet been emailed, then sends a digest email per
// (user, watchlist) via Resend and records the match in watchlist_leads so
// we don't re-send.
//
// Invocation: scheduled cron (pg_cron + pg_net) — see deployment guide.
// Auth: service-role key from env. NEVER hardcode the Resend key here.

// @ts-expect-error Deno std import (resolved at deploy time, not in mobile tsconfig)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-expect-error Supabase client (resolved at deploy time)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

// ── Types (mirrors mobile/lib/types.ts) ─────────────────────────────────────

interface WatchlistCriteria {
  equity_min?: number
  deal_types?: string[]
  counties?: string[]
  distress_signals?: string[]
  max_open_liens?: number
  owner_types?: string[]
  min_years_owned?: number
  min_deal_score?: number
}

interface Watchlist {
  id: string
  user_id: string
  name: string
  criteria: WatchlistCriteria
}

interface Lead {
  id: string
  /** Owner. REQUIRED for tenant isolation — see the filter in run(). */
  user_id: string
  address: string
  city: string | null
  state: string | null
  county: string | null
  estimated_equity: number | null
  owner_type: string | null
  years_owned: number | null
  open_liens: number | null
  equity_tier: string | null
  deal_score: number | null
  deal_type: string | null
  distress_signals: string[]
}

// ── Matching logic (1:1 port of mobile/lib/leads-api.ts leadMatchesWatchlist) ─

function leadMatchesWatchlist(lead: Lead, c: WatchlistCriteria): boolean {
  if (c.counties && c.counties.length > 0) {
    const leadCounty = (lead.county ?? "").toLowerCase()
    if (!c.counties.some((x) => x.toLowerCase() === leadCounty)) return false
  }
  if (c.equity_min != null) {
    if ((lead.estimated_equity ?? -Infinity) < c.equity_min) return false
  }
  if (c.min_deal_score != null) {
    if ((lead.deal_score ?? -Infinity) < c.min_deal_score) return false
  }
  if (c.deal_types && c.deal_types.length > 0) {
    if (!lead.deal_type || !c.deal_types.includes(lead.deal_type)) return false
  }
  if (c.owner_types && c.owner_types.length > 0) {
    if (!lead.owner_type || !c.owner_types.includes(lead.owner_type)) return false
  }
  if (c.max_open_liens != null) {
    if ((lead.open_liens ?? 0) > c.max_open_liens) return false
  }
  if (c.min_years_owned != null) {
    if ((lead.years_owned ?? 0) < c.min_years_owned) return false
  }
  if (c.distress_signals && c.distress_signals.length > 0) {
    const signals = lead.distress_signals ?? []
    if (!c.distress_signals.every((s) => signals.includes(s))) return false
  }
  return true
}

// ── Email rendering ─────────────────────────────────────────────────────────

function formatMoney(n: number | null): string {
  if (n == null) return "—"
  return `$${Math.round(n).toLocaleString()}`
}

// Send a batched push to all Expo push tokens for a given user. Expo's
// /push/send endpoint accepts an array — one HTTP call per user, not per
// token. Returns the count of *accepted* messages (best effort; per-token
// receipt validation would be a second async step we skip for now).
async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<{ accepted: number; error?: string }> {
  if (tokens.length === 0) return { accepted: 0 }
  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title,
    body,
    data,
  }))
  try {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    })
    if (!resp.ok) {
      return { accepted: 0, error: `expo push ${resp.status} ${await resp.text()}` }
    }
    return { accepted: tokens.length }
  } catch (e) {
    return { accepted: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

function escapeHtml(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderEmailHtml(watchlistName: string, matches: Lead[]): string {
  const rows = matches
    .map(
      (l) => `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #1A2433;color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">
          <div style="font-size:14px;font-weight:600;">${escapeHtml(l.address)}</div>
          <div style="font-size:12px;color:#94A3B8;margin-top:2px;">
            ${escapeHtml([l.city, l.state, l.county ? `${l.county} County` : null].filter(Boolean).join(" · "))}
          </div>
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid #1A2433;text-align:right;color:#2DE2FF;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;font-size:14px;font-weight:700;">
          ${formatMoney(l.estimated_equity)}
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid #1A2433;text-align:right;color:#10A7FF;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;font-size:13px;font-weight:600;">
          ${l.deal_score != null ? Math.round(l.deal_score) : "—"}
        </td>
      </tr>`
    )
    .join("")

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#08111F;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#94A3B8;font-weight:500;">
      BidWise · Watchlist Alert
    </div>
    <h1 style="font-size:24px;color:#F8FAFC;margin:8px 0 4px;letter-spacing:-0.5px;">
      ${escapeHtml(matches.length)} new match${matches.length === 1 ? "" : "es"}
    </h1>
    <div style="font-size:14px;color:#94A3B8;margin-bottom:24px;">
      for your watchlist <strong style="color:#2DE2FF;">${escapeHtml(watchlistName)}</strong>
    </div>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#111B2B;border-radius:12px;border:1px solid #1A2433;border-collapse:separate;overflow:hidden;">
      <thead>
        <tr>
          <th align="left" style="padding:10px 16px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#94A3B8;background:#0B5CFF1A;">Property</th>
          <th align="right" style="padding:10px 16px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#94A3B8;background:#0B5CFF1A;">Equity</th>
          <th align="right" style="padding:10px 16px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#94A3B8;background:#0B5CFF1A;">Score</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="margin-top:20px;font-size:12px;color:#6B778A;">
      Open the BidWise app to review and add these to your pipeline.
    </div>
  </div>
</body>
</html>`
}

// ── Main handler ────────────────────────────────────────────────────────────

// @ts-expect-error Deno global (resolved at deploy time)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
// @ts-expect-error Deno global
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
// @ts-expect-error Deno global
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!
// Tenancy: bidwiseinvest.com is the BidWise Resend-verified sender domain.
// @ts-expect-error Deno global
const FROM_EMAIL = Deno.env.get("WATCHLIST_FROM_EMAIL") ?? "alerts@bidwiseinvest.com"
// @ts-expect-error Deno global
const MAX_MATCHES_PER_EMAIL = Number(Deno.env.get("WATCHLIST_MAX_MATCHES") ?? "20")

interface PerWatchlistResult {
  id: string
  name: string
  new_matches: number
}

interface RunResult {
  watchlists_scanned: number
  emails_sent: number
  pushes_sent: number
  matches_recorded: number
  errors: string[]
  dry_run?: boolean
  per_watchlist?: PerWatchlistResult[]
}

async function run(dryRun: boolean): Promise<RunResult> {
  const result: RunResult = {
    watchlists_scanned: 0,
    emails_sent: 0,
    pushes_sent: 0,
    matches_recorded: 0,
    errors: [],
    dry_run: dryRun,
    per_watchlist: [],
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  })

  const { data: watchlists, error: wlErr } = await supabase
    .from("watchlists")
    .select("id, user_id, name, criteria")
    .eq("is_active", true)
    .eq("alert_email", true)

  if (wlErr) throw new Error(`fetch watchlists: ${wlErr.message}`)
  result.watchlists_scanned = watchlists?.length ?? 0
  if (!watchlists || watchlists.length === 0) return result

  // TENANT ISOLATION. This runs with the SERVICE ROLE key, which bypasses RLS —
  // so the owner scoping that protects off_market_leads everywhere else does not
  // apply here and must be done explicitly. Previously this selected the whole
  // table and matched it against every watchlist, so a match could pair user A's
  // watchlist with user B's private lead and email B's street addresses to A.
  // Two independent guards, because one of them silently failing is a data
  // breach: scope the query to the owners we are actually notifying, then
  // re-check ownership per lead at match time below.
  const ownerIds = [...new Set((watchlists as Watchlist[]).map((w) => w.user_id))]
  const { data: leads, error: lErr } = await supabase
    .from("off_market_leads")
    .select(
      "id, user_id, address, city, state, county, estimated_equity, owner_type, years_owned, open_liens, equity_tier, deal_score, deal_type, distress_signals"
    )
    .in("user_id", ownerIds)
  if (lErr) throw new Error(`fetch leads: ${lErr.message}`)
  if (!leads || leads.length === 0) return result

  // Pre-load already-notified pairs so we only send for genuinely new matches.
  const { data: alreadyNotified } = await supabase
    .from("watchlist_leads")
    .select("watchlist_id, lead_id")
    .eq("notified", true)
  const seen = new Set<string>(
    (alreadyNotified ?? []).map(
      (r: { watchlist_id: string; lead_id: string }) => `${r.watchlist_id}:${r.lead_id}`
    )
  )

  for (const wl of watchlists as Watchlist[]) {
    try {
      // `l.user_id === wl.user_id` is the second isolation guard and is NOT
      // redundant with the `.in()` above: that query narrows to the set of all
      // owners being notified this run, which still lets one owner's leads reach
      // another owner's watchlist during the in-memory match. Never remove it.
      const matches = (leads as Lead[]).filter(
        (l) =>
          l.user_id === wl.user_id &&
          !seen.has(`${wl.id}:${l.id}`) &&
          leadMatchesWatchlist(l, wl.criteria)
      )

      // Always record per-watchlist counts so dry-run callers can see the
      // distribution even when there's nothing to send.
      result.per_watchlist!.push({
        id: wl.id,
        name: wl.name,
        new_matches: matches.length,
      })

      if (matches.length === 0) continue

      // Dry-run short-circuits BEFORE any side effect: no Resend call, no
      // watchlist_leads upsert. The caller still sees the per_watchlist row
      // above so they can preview the impact.
      if (dryRun) continue

      const { data: userRes, error: uErr } = await supabase.auth.admin.getUserById(wl.user_id)
      if (uErr || !userRes?.user?.email) {
        result.errors.push(`watchlist ${wl.id}: no email for user ${wl.user_id}`)
        continue
      }
      const toEmail = userRes.user.email

      const shown = matches.slice(0, MAX_MATCHES_PER_EMAIL)
      const html = renderEmailHtml(wl.name, shown)

      const resendResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: toEmail,
          subject: `${matches.length} new match${matches.length === 1 ? "" : "es"} · ${wl.name}`,
          html,
        }),
      })

      if (!resendResp.ok) {
        const body = await resendResp.text()
        result.errors.push(`watchlist ${wl.id}: resend ${resendResp.status} ${body}`)
        continue
      }
      result.emails_sent += 1

      // Fan out push notifications to this user's registered devices.
      // Push is best-effort: failures get logged but don't block recording
      // the matches as notified (email already succeeded).
      const { data: tokenRows } = await supabase
        .from("device_tokens")
        .select("token")
        .eq("user_id", wl.user_id)
      const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token)
      if (tokens.length > 0) {
        const push = await sendExpoPush(
          tokens,
          `${matches.length} new match${matches.length === 1 ? "" : "es"}`,
          `${wl.name} · tap to review`,
          { watchlist_id: wl.id, match_count: matches.length }
        )
        result.pushes_sent += push.accepted
        if (push.error) {
          result.errors.push(`watchlist ${wl.id}: ${push.error}`)
        }
      }

      // Record matches as notified (idempotent on PK conflict).
      const rows = matches.map((m) => ({
        watchlist_id: wl.id,
        lead_id: m.id,
        notified: true,
      }))
      const { error: insErr } = await supabase
        .from("watchlist_leads")
        .upsert(rows, { onConflict: "watchlist_id,lead_id" })
      if (insErr) {
        result.errors.push(`watchlist ${wl.id}: record matches: ${insErr.message}`)
      } else {
        result.matches_recorded += rows.length
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push(`watchlist ${wl.id}: ${msg}`)
    }
  }

  return result
}

// Shared secret guard. This function sends emails + push and exposes per-
// watchlist match counts, so it must never be publicly triggerable. The
// pg_cron job invokes it with the service-role key in the Authorization header;
// an optional NOTIFY_WATCHLIST_SECRET allows a non-service-role caller (e.g. the
// mobile admin card) without handing out the service-role key. Constant-time-ish
// comparison via length + char checks is overkill for a bearer secret, so a
// direct equality check is acceptable here.
function isAuthorized(req: Request): boolean {
  const header = req.headers.get("Authorization") ?? ""
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (!bearer) return false
  if (SUPABASE_SERVICE_ROLE && bearer === SUPABASE_SERVICE_ROLE) return true
  // @ts-expect-error Deno global (resolved at deploy time)
  const secret = Deno.env.get("NOTIFY_WATCHLIST_SECRET") ?? ""
  if (secret && bearer === secret) return true
  return false
}

serve(async (req: Request) => {
  // ── 0. Auth guard — BEFORE any body parse or DB query ────────────────────
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    // Body is optional. pg_cron sends none; the mobile admin card sends
    // { dryRun: true | false }. Anything that isn't valid JSON is treated
    // as an empty body (real run).
    let dryRun = false
    if (req.method === "POST") {
      try {
        const body = await req.json()
        if (body && typeof body === "object" && body.dryRun === true) {
          dryRun = true
        }
      } catch {
        // ignore parse errors; treat as empty body
      }
    }

    const result = await run(dryRun)
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
