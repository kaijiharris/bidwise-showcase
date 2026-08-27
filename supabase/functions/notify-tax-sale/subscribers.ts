// supabase/functions/notify-tax-sale/subscribers.ts
//
// Subscriber fan-out for the tax-sale watchdog. Emails every active/trialing
// BidWise subscriber when a subscriber-grade event fires (NEW_LIST /
// DATE_CHANGED / CANCELLED — see the matrix in diff.ts). LIST_CHANGED noise
// (parcel churn, PDF re-uploads) stays operator-only.
//
// ── HARD GATE ────────────────────────────────────────────────────────────────
// Real sends require the operator to explicitly set
//     TAX_SALE_SUBSCRIBER_DRY_RUN=false
// Any other value — including unset — keeps the channel in DRY RUN: nothing
// is sent, and the run log (tax_sale_monitor_runs.subscriber_preview) records
// exactly who WOULD have received which subject line.
//
// Audience = subscriptions.status IN ('active','trialing') → user_profiles
// email (fallback: auth admin lookup). A sanity cap
// (TAX_SALE_MAX_SUBSCRIBER_EMAILS, default 500) forces dry-run behavior if
// the audience is implausibly large — fail loud, never mass-send by accident.
//
// ── PREFERENCES (migration 026) ─────────────────────────────────────────────
// Each recipient's notification_prefs row filters what they get:
//   • no row            → DEFAULT_PREF: alerts ON, all counties
//   • tax_sale_alerts=false → nothing (opt-out)
//   • counties=null     → all counties;  counties=[…slugs] → only those
// Prefs are honored PER RECIPIENT: subject + digest are built from each
// subscriber's own event subset. Addresses are de-duplicated AFTER prefs are
// loaded, merging duplicate accounts MOST-RESTRICTIVELY (any opt-out wins;
// county lists intersect) so an opted-out account can never leak through a
// duplicate's default-ON. If the prefs table cannot be read, sends FAIL
// CLOSED for the run (never risk emailing an opted-out user); the error is
// loud in the run log and the operator digest still goes out separately.

import type { ChangeEvent } from "./diff.ts"
import { escapeHtml, prettyDate } from "./diff.ts"

// @ts-ignore Deno global (resolved at deploy time)
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!
// Tenancy: bidwiseinvest.com is the BidWise Resend-verified sender domain.
// @ts-ignore Deno global
const FROM_EMAIL = Deno.env.get("TAX_SALE_FROM_EMAIL") ?? Deno.env.get("WATCHLIST_FROM_EMAIL") ?? "alerts@bidwiseinvest.com"
// @ts-ignore Deno global
const DASHBOARD_URL = Deno.env.get("TAX_SALE_DASHBOARD_URL") ?? "https://bidwiseinvest.com/dashboard"
// @ts-ignore Deno global
const MAX_SUBSCRIBER_EMAILS = Number(Deno.env.get("TAX_SALE_MAX_SUBSCRIBER_EMAILS") ?? "500")

/** True only when the operator has explicitly flipped the gate open. */
export function subscriberSendingEnabled(): boolean {
  // @ts-ignore Deno global
  return (Deno.env.get("TAX_SALE_SUBSCRIBER_DRY_RUN") ?? "true").toLowerCase() === "false"
}

export interface Subscriber {
  userId: string
  email: string
}

export interface SubscriberNotifyResult {
  audience: number
  sent: number
  dryRun: boolean
  preview: Array<{ email: string; subject: string }>
  errors: string[]
}

// Loosely-typed supabase client (mirrors `Db` in index.ts). This module only
// uses: .from(t).select(c).in(col, vals) and .auth.admin.getUserById(id) —
// kept untyped so the real client, whose generics reject structural
// interfaces, passes straight through and tests can stub it.
// deno-lint-ignore no-explicit-any
type DbClient = any

// ── Audience ─────────────────────────────────────────────────────────────────

export async function getActiveSubscribers(
  supabase: DbClient
): Promise<{ subscribers: Subscriber[]; errors: string[] }> {
  const errors: string[] = []
  const { data: subs, error: subErr } = await supabase
    .from("subscriptions")
    .select("user_id, status")
    .in("status", ["active", "trialing"])
  if (subErr) return { subscribers: [], errors: [`subscribers: load subscriptions: ${subErr.message}`] }

  const userIds = [
    ...new Set(
      ((subs ?? []) as Array<{ user_id: string | null }>)
        .map((s) => s.user_id)
        .filter((id): id is string => Boolean(id))
    ),
  ]
  if (userIds.length === 0) return { subscribers: [], errors }

  const { data: profiles, error: profErr } = await supabase
    .from("user_profiles")
    .select("id, email")
    .in("id", userIds)
  if (profErr) errors.push(`subscribers: load profiles: ${profErr.message}`)

  const emailByUser = new Map<string, string>()
  for (const p of (profiles ?? []) as Array<{ id: string; email: string | null }>) {
    if (p.email) emailByUser.set(p.id, p.email)
  }
  // Profiles created before the email column was backfilled may be blank —
  // fall back to the auth admin API per missing user (small N).
  for (const id of userIds.filter((u) => !emailByUser.has(u))) {
    try {
      const { data } = await supabase.auth.admin.getUserById(id)
      if (data?.user?.email) emailByUser.set(id, data.user.email)
      else errors.push(`subscribers: no email found for user ${id}`)
    } catch (e) {
      errors.push(`subscribers: auth lookup ${id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // NOTE: deliberately NOT de-duplicated by email here. Duplicate accounts
  // sharing an address are merged in notifySubscribers AFTER prefs load, so
  // the most restrictive preference wins (consent-correct regardless of the
  // unordered row order this map was built from).
  const subscribers: Subscriber[] = [...emailByUser].map(([userId, email]) => ({ userId, email }))
  return { subscribers, errors }
}

// ── Preferences ──────────────────────────────────────────────────────────────

export interface NotificationPref {
  taxSaleAlerts: boolean
  counties: string[] | null // lowercase slugs; null = all counties
}

// What a subscriber WITHOUT a notification_prefs row gets: everything. This is
// the deliberate default (migration 026) so no signup change or backfill is
// needed — a row only exists once a user changes something.
export const DEFAULT_PREF: NotificationPref = { taxSaleAlerts: true, counties: null }

// Most-restrictive merge for duplicate accounts sharing one email address:
// if ANY account opted out, the address is out; county lists INTERSECT
// (null = all counties, the identity element). Consent-correct no matter
// which duplicate a query happens to return first.
export function mergePrefs(prefs: NotificationPref[]): NotificationPref {
  if (prefs.length === 0) return DEFAULT_PREF
  if (prefs.some((p) => !p.taxSaleAlerts)) return { taxSaleAlerts: false, counties: null }
  let counties: string[] | null = null
  for (const p of prefs) {
    if (p.counties === null) continue
    const lowered = p.counties.map((c) => c.toLowerCase())
    counties = counties === null
      ? lowered
      : counties.filter((c) => lowered.includes(c))
  }
  return { taxSaleAlerts: true, counties }
}

// Pure: the subset of this run's events a subscriber should receive.
// Comparison is by lowercased county name, so display names ("DeKalb") match
// stored slugs ("dekalb"). An empty counties array matches nothing.
export function eventsForSubscriber(
  events: ChangeEvent[],
  pref: NotificationPref
): ChangeEvent[] {
  if (!pref.taxSaleAlerts) return []
  if (pref.counties === null) return events
  const allowed = new Set(pref.counties.map((c) => c.toLowerCase()))
  return events.filter((e) => allowed.has(e.county.toLowerCase()))
}

// Chunk size for the prefs lookup. PostgREST TRUNCATES results at the
// project's max-rows limit WITHOUT raising an error; a truncated result would
// silently turn missing opt-out rows into default-ON (fail-open). Querying in
// small chunks keeps every response far below any plausible max-rows setting,
// and any real error still takes the fail-closed path in notifySubscribers.
const PREFS_QUERY_CHUNK = 50

export async function getNotificationPrefs(
  supabase: DbClient,
  userIds: string[]
): Promise<{ prefs: Map<string, NotificationPref>; error: string | null }> {
  const prefs = new Map<string, NotificationPref>()
  for (let i = 0; i < userIds.length; i += PREFS_QUERY_CHUNK) {
    const chunk = userIds.slice(i, i + PREFS_QUERY_CHUNK)
    const { data, error } = await supabase
      .from("notification_prefs")
      .select("user_id, tax_sale_alerts, counties")
      .in("user_id", chunk)
    if (error) return { prefs, error: `subscribers: load notification_prefs: ${error.message}` }
    for (const row of (data ?? []) as Array<{
      user_id: string
      tax_sale_alerts: boolean | null
      counties: string[] | null
    }>) {
      prefs.set(row.user_id, {
        taxSaleAlerts: row.tax_sale_alerts !== false,
        counties: Array.isArray(row.counties) ? row.counties : null,
      })
    }
  }
  return { prefs, error: null }
}

// ── Rendering ────────────────────────────────────────────────────────────────

export function subscriberHeadline(e: ChangeEvent): string {
  const when = prettyDate(e.auctionDate)
  if (e.severity === "CANCELLED")
    return `${e.county} County ${when} tax sale is no longer listed`
  if (e.severity === "DATE_CHANGED")
    return `${e.county} County tax sale rescheduled — now ${when}`
  if (e.count === 0) return `New ${e.county} County tax sale scheduled — ${when}`
  return `New ${e.county} County auction list is live — ${e.count} propert${e.count === 1 ? "y" : "ies"}, sale ${when}`
}

function subscriberSubline(e: ChangeEvent): string {
  if (e.severity === "CANCELLED")
    return "The county removed this sale from its listing. We'll alert you the moment it's rescheduled."
  if (e.severity === "DATE_CHANGED")
    return "Update your calendar — bidding preparation deadlines move with it."
  return "Your scored deals are ready on your dashboard."
}

export function subscriberEmailSubject(events: ChangeEvent[]): string {
  if (events.length === 1) return subscriberHeadline(events[0])
  const counties = [...new Set(events.map((e) => e.county))].join(", ")
  return `${events.length} Georgia tax-sale updates — ${counties}`
}

export function renderSubscriberEmailHtml(events: ChangeEvent[]): string {
  const cards = events
    .map(
      (e) => `
    <div style="margin-top:16px;padding:16px 20px;background:#F6F8FB;border:1px solid #E3E9F1;border-radius:12px;">
      <div style="font-size:16px;font-weight:700;color:#0B1526;">${escapeHtml(subscriberHeadline(e))}</div>
      <div style="font-size:13px;color:#51607A;margin-top:4px;">${escapeHtml(subscriberSubline(e))}</div>
    </div>`
    )
    .join("")
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#51607A;font-weight:600;">
      BidWise · Auction Alert
    </div>
    <h1 style="font-size:22px;color:#0B1526;margin:8px 0 4px;letter-spacing:-0.5px;">
      ${escapeHtml(events.length === 1 ? "An auction you follow just moved" : "Auction updates from the county sites")}
    </h1>
    <div style="font-size:14px;color:#51607A;">
      Straight from the official county listings — before the public scramble.
    </div>
    ${cards}
    <a href="${escapeHtml(DASHBOARD_URL)}"
       style="display:inline-block;margin-top:24px;padding:12px 24px;background:#0B5CFF;color:#FFFFFF;font-size:14px;font-weight:700;border-radius:10px;text-decoration:none;">
      View your scored deals →
    </a>
    <div style="margin-top:24px;font-size:12px;color:#8A96A8;">
      You're receiving this because you have an active BidWise subscription.
      Sources: official county tax-sale listings.<br>
      To stop these alerts, reply to this email with &ldquo;unsubscribe&rdquo;
      and we&rsquo;ll turn them off.
    </div>
  </div>
</body>
</html>`
}

// ── Delivery ─────────────────────────────────────────────────────────────────

// Replies land at a MONITORED inbox — the footer promises reply-to-unsubscribe
// works, so the reply must reach a human until the one-click flow ships.
// @ts-ignore Deno global
const REPLY_TO = Deno.env.get("TAX_SALE_REPLY_TO") ?? "support@bidwiseinvest.com"

async function sendOne(to: string, subject: string, html: string): Promise<string | null> {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, reply_to: REPLY_TO }),
    })
    if (!resp.ok) return `resend ${resp.status} ${(await resp.text()).slice(0, 160)}`
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// Sends (or previews) the subscriber digest. `enabled` comes from
// subscriberSendingEnabled(); callers force `false` for function-level dry
// runs. Best-effort by design: failures are reported in `errors` but never
// block the operator alert or the snapshot watermark.
export async function notifySubscribers(
  supabase: DbClient,
  events: ChangeEvent[],
  enabled: boolean
): Promise<SubscriberNotifyResult> {
  const result: SubscriberNotifyResult = {
    audience: 0,
    sent: 0,
    dryRun: !enabled,
    preview: [],
    errors: [],
  }
  if (events.length === 0) return result

  const { subscribers, errors } = await getActiveSubscribers(supabase)
  result.errors.push(...errors)
  if (subscribers.length === 0) return result

  const { prefs, error: prefErr } = await getNotificationPrefs(
    supabase,
    subscribers.map((s) => s.userId)
  )
  if (prefErr) {
    // FAIL CLOSED: without prefs we cannot honor opt-outs, so skip subscriber
    // sends entirely this run. The operator digest is a separate channel, so
    // the miss is visible the same day; the error below lands in the run log.
    // audience stays 0 — nobody was determined sendable (its meaning on every
    // healthy run); the raw count lives in the error for observability.
    result.errors.push(
      `${prefErr} — ${subscribers.length} subscriber(s) skipped (fail-closed on opt-outs)`
    )
    result.dryRun = true
    return result
  }

  // De-duplicate by address AFTER prefs, merging duplicate accounts
  // most-restrictively (mergePrefs), then build per-recipient event subsets:
  // opted-out addresses and addresses whose county filter excludes every
  // event in this run drop out of the audience.
  const byEmail = new Map<string, { email: string; prefList: NotificationPref[] }>()
  for (const s of subscribers) {
    const key = s.email.toLowerCase()
    const entry = byEmail.get(key) ?? { email: s.email, prefList: [] }
    entry.prefList.push(prefs.get(s.userId) ?? DEFAULT_PREF)
    byEmail.set(key, entry)
  }
  const recipients = [...byEmail.values()]
    .map((r) => ({
      subscriber: { email: r.email },
      events: eventsForSubscriber(events, mergePrefs(r.prefList)),
    }))
    .filter((r) => r.events.length > 0)
  result.audience = recipients.length
  if (recipients.length === 0) return result

  result.preview = recipients.map((r) => ({
    email: r.subscriber.email,
    subject: subscriberEmailSubject(r.events),
  }))

  let send = enabled
  if (send && recipients.length > MAX_SUBSCRIBER_EMAILS) {
    result.errors.push(
      `subscribers: audience ${recipients.length} exceeds cap ${MAX_SUBSCRIBER_EMAILS} — forced dry-run; raise TAX_SALE_MAX_SUBSCRIBER_EMAILS if intentional`
    )
    send = false
  }
  if (!send) {
    result.dryRun = true
    return result
  }

  for (const r of recipients) {
    const err = await sendOne(
      r.subscriber.email,
      subscriberEmailSubject(r.events),
      renderSubscriberEmailHtml(r.events)
    )
    if (err === null) result.sent++
    else result.errors.push(`subscribers: ${r.subscriber.email}: ${err}`)
  }
  return result
}
