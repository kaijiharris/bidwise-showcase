// supabase/functions/notify-tax-sale/index.ts
//
// Daily watchdog over county tax-sale listings (DeKalb HTML table, Gwinnett
// listing PDF, Cobb placeholder PDF, Clayton month-named PDFs — see
// sources.ts). For each source it fetches the official listing, parses it,
// and diffs against the last observed state in `tax_sale_snapshots`
// (diff + severity logic lives in diff.ts). Every invocation is recorded in
// `tax_sale_monitor_runs` — including no-change days — so "did it run today"
// is always answerable in SQL.
//
// Event types (see diff.ts for the full severity/notification matrix):
//   • new_date     — an auction date we've never seen appears     → NEW_LIST
//   • populated    — a known date's listing goes empty → populated → NEW_LIST
//   • changed      — parcels added/removed, or the listing file was
//                    replaced (sourceRef fingerprint)             → LIST_CHANGED
//   • date_removed — a FUTURE date vanished from the listing      → CANCELLED
//                    (or DATE_CHANGED when a new date appears in the same run)
//
// Channels:
//   • Operator — Resend email on every event; Expo push + optional Twilio SMS
//     best-effort. Snapshot watermark advances only after the email succeeds
//     (at-least-once delivery).
//   • Subscribers — NEW_LIST / DATE_CHANGED / CANCELLED only, HARD-GATED by
//     TAX_SALE_SUBSCRIBER_DRY_RUN (default true = preview only; see
//     subscribers.ts). The run log records exactly who would have been sent.
//
// Invocation: scheduled cron (pg_cron + pg_net) — see DEPLOY.md.
// Manual:  POST { "dryRun": true } to preview events without sending or
//          writing snapshot state (the check itself is still run-logged).
// Auth: Bearer service-role key (what pg_cron sends) or NOTIFY_TAX_SALE_SECRET.
//
// Requires migrations 008 (table), 016 (source_ref), 020 (run log + delisting).

// @ts-ignore Deno std import (resolved at deploy time, not in tsconfig)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-ignore Supabase client (resolved at deploy time)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

import {
  activeAcknowledgedOutage,
  observeSource,
  SOURCES,
  SUBSCRIBER_ELIGIBLE_COUNTIES,
} from "./sources.ts"
import {
  classifySeverities,
  diffCounty,
  escapeHtml,
  eventHeadline,
  subscriberEvents,
} from "./diff.ts"
import type { ChangeEvent, DesiredSnapshot, EventType, Severity, SnapshotRow } from "./diff.ts"
import { notifySubscribers, subscriberSendingEnabled } from "./subscribers.ts"
import type { SubscriberNotifyResult } from "./subscribers.ts"

// Loosely-typed supabase client for helper signatures. The esm.sh client's
// generics don't survive ReturnType<typeof createClient> (it instantiates to
// <unknown, never>, which rejects every real call), and row-level typing adds
// nothing inside this function — the service-role client is passed around
// untyped on purpose.
// deno-lint-ignore no-explicit-any
type Db = any

// ── Env ──────────────────────────────────────────────────────────────────────

// @ts-ignore Deno global (resolved at deploy time)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
// @ts-ignore Deno global
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
// @ts-ignore Deno global
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!
// Reuse the watchlist sender domain by default (verified in Resend already).
// Tenancy: bidwiseinvest.com is the BidWise Resend-verified sender domain.
// @ts-ignore Deno global
const FROM_EMAIL = Deno.env.get("TAX_SALE_FROM_EMAIL") ?? Deno.env.get("WATCHLIST_FROM_EMAIL") ?? "alerts@bidwiseinvest.com"
// Operator inbox that receives the alert.
// @ts-ignore Deno global
const ALERT_EMAIL = Deno.env.get("TAX_SALE_ALERT_EMAIL") ?? "alerts@bidwiseinvest.com"
// Optional: user whose registered devices get the push. If unset we resolve by
// ALERT_EMAIL via the auth admin API (best-effort).
// @ts-ignore Deno global
const ALERT_USER_ID = Deno.env.get("TAX_SALE_ALERT_USER_ID") ?? ""
// Cap properties listed in the email body so a freshly-dropped sale doesn't
// produce a 200-row email.
// @ts-ignore Deno global
const MAX_ROWS_IN_EMAIL = Number(Deno.env.get("TAX_SALE_MAX_ROWS") ?? "40")

// Optional SMS channel — skipped silently unless ALL required Twilio secrets
// are present (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TAX_SALE_SMS_TO, and a
// sender: TAX_SALE_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID).
// @ts-ignore Deno global
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? ""
// @ts-ignore Deno global
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? ""
// Comma-separated E.164 recipients, e.g. "+14045551234,+14045556789".
// @ts-ignore Deno global
const TAX_SALE_SMS_TO = Deno.env.get("TAX_SALE_SMS_TO") ?? ""
// E.164 Twilio number the SMS is sent from.
// @ts-ignore Deno global
const TAX_SALE_SMS_FROM = Deno.env.get("TAX_SALE_SMS_FROM") ?? ""
// Alternative sender: a Twilio Messaging Service (takes precedence).
// @ts-ignore Deno global
const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? ""

// ── Operator email ───────────────────────────────────────────────────────────

function emailSubject(events: ChangeEvent[]): string {
  if (events.length === 1) return eventHeadline(events[0])
  const counties = [...new Set(events.map((e) => e.county))].join(", ")
  return `${events.length} tax-sale listing updates — ${counties}`
}

function renderEventSection(e: ChangeEvent): string {
  const shown = e.rows.slice(0, MAX_ROWS_IN_EMAIL)
  const more = e.rows.length - shown.length
  const propRows = shown
    .map(
      (r) => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #1A2433;color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;font-size:13px;">
          <div style="font-weight:600;">${escapeHtml(r.address || "(no address)")}</div>
          <div style="font-size:11px;color:#94A3B8;margin-top:2px;">${escapeHtml(r.parcelId)} · ${escapeHtml(r.owner)}</div>
        </td>
        <td style="padding:10px 16px;border-bottom:1px solid #1A2433;text-align:right;color:#2DE2FF;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;font-size:13px;font-weight:700;white-space:nowrap;">
          ${escapeHtml(r.taxDue || "—")}
        </td>
      </tr>`
    )
    .join("")
  const moreRow =
    more > 0
      ? `<tr><td colspan="2" style="padding:10px 16px;color:#6B778A;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">+ ${more} more — open the listing for the full set.</td></tr>`
      : ""
  const table =
    shown.length > 0
      ? `
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#111B2B;border-radius:12px;border:1px solid #1A2433;border-collapse:separate;overflow:hidden;">
      <thead><tr>
        <th align="left" style="padding:10px 16px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#94A3B8;background:#0B5CFF1A;">Property</th>
        <th align="right" style="padding:10px 16px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#94A3B8;background:#0B5CFF1A;">Tax due</th>
      </tr></thead>
      <tbody>${propRows}${moreRow}</tbody>
    </table>`
      : ""
  const link = e.sourceUrl
    ? `<div style="margin-top:8px;font-size:13px;"><a href="${escapeHtml(e.sourceUrl)}" style="color:#2DE2FF;">Open the official listing →</a></div>`
    : ""
  const severityTag = e.severity
    ? `<span style="font-size:10px;letter-spacing:1px;color:#94A3B8;">[${escapeHtml(e.severity)}]</span> `
    : ""

  return `
  <div style="margin-top:24px;">
    <div style="font-size:16px;color:#F8FAFC;font-weight:700;margin-bottom:10px;">${severityTag}${escapeHtml(eventHeadline(e))}</div>
    ${table}
    ${link}
  </div>`
}

function renderEmailHtml(events: ChangeEvent[]): string {
  const sections = events.map(renderEventSection).join("")
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#08111F;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#94A3B8;font-weight:500;">
      BidWise · Tax Sale Watch
    </div>
    <h1 style="font-size:22px;color:#F8FAFC;margin:8px 0 4px;letter-spacing:-0.5px;">
      ${escapeHtml(events.length)} listing update${events.length === 1 ? "" : "s"} on the county sites
    </h1>
    <div style="font-size:14px;color:#94A3B8;">
      You're seeing this before the public scramble. Review and prep bids early.
    </div>
    ${sections}
    <div style="margin-top:24px;font-size:12px;color:#6B778A;">
      Sources: official county tax-sale listings (DeKalb, Gwinnett, Cobb, Clayton, Fulton).
    </div>
  </div>
</body>
</html>`
}

async function sendEmail(events: ChangeEvent[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ALERT_EMAIL,
        subject: emailSubject(events),
        html: renderEmailHtml(events),
      }),
    })
    if (!resp.ok) return { ok: false, error: `resend ${resp.status} ${await resp.text()}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Push (best-effort) ───────────────────────────────────────────────────────

async function resolvePushTokens(supabase: Db): Promise<string[]> {
  let userId = ALERT_USER_ID
  if (!userId) {
    // Best-effort resolve the operator's user_id by email.
    try {
      const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
      const match = data?.users?.find(
        (u: { id: string; email?: string }) => (u.email ?? "").toLowerCase() === ALERT_EMAIL.toLowerCase()
      )
      if (match) userId = match.id
    } catch {
      // ignore — push just stays empty
    }
  }
  if (!userId) return []
  const { data: tokenRows } = await supabase
    .from("device_tokens")
    .select("token")
    .eq("user_id", userId)
  return (tokenRows ?? []).map((r: { token: string }) => r.token)
}

async function sendPush(tokens: string[], events: ChangeEvent[]): Promise<{ accepted: number; error?: string }> {
  if (tokens.length === 0) return { accepted: 0 }
  const title = events.length === 1 ? eventHeadline(events[0]) : `${events.length} tax-sale listing updates`
  const body =
    events.length === 1
      ? "Tap to review — you're ahead of the public listing."
      : events.map((e) => eventHeadline(e)).join(" · ").slice(0, 178)
  const messages = tokens.map((to) => ({ to, sound: "default", title, body, data: { kind: "tax_sale" } }))
  try {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
      body: JSON.stringify(messages),
    })
    if (!resp.ok) return { accepted: 0, error: `expo push ${resp.status} ${await resp.text()}` }
    return { accepted: tokens.length }
  } catch (e) {
    return { accepted: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── SMS (best-effort, env-gated) ─────────────────────────────────────────────
// Raw Twilio REST call — no SDK in the edge runtime. Basic auth (SID:token),
// form-encoded body, one POST per recipient. Skips silently when unconfigured.

function smsConfigured(): boolean {
  return Boolean(
    TWILIO_ACCOUNT_SID &&
      TWILIO_AUTH_TOKEN &&
      TAX_SALE_SMS_TO &&
      (TAX_SALE_SMS_FROM || TWILIO_MESSAGING_SERVICE_SID)
  )
}

async function sendSms(events: ChangeEvent[]): Promise<{ sent: number; error?: string }> {
  if (!smsConfigured()) return { sent: 0 }
  const body = (
    events.length === 1
      ? `BidWise: ${eventHeadline(events[0])}`
      : `BidWise: ${events.length} tax-sale updates — ` + events.map(eventHeadline).join(" | ")
  ).slice(0, 320) // ≤ 2 SMS segments
  const auth = "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`

  let sent = 0
  const errors: string[] = []
  const recipients = TAX_SALE_SMS_TO.split(",").map((s: string) => s.trim()).filter(Boolean)
  for (const to of recipients) {
    const form = new URLSearchParams({ To: to, Body: body })
    if (TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", TWILIO_MESSAGING_SERVICE_SID)
    else form.set("From", TAX_SALE_SMS_FROM)
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      })
      if (resp.ok) sent++
      else errors.push(`twilio ${resp.status} ${(await resp.text()).slice(0, 160)}`)
    } catch (e) {
      errors.push(`twilio: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { sent, error: errors.length > 0 ? errors.join("; ") : undefined }
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface EventSummary {
  county: string
  auction_date: string
  type: EventType
  severity: Severity | null
  count: number
  added: number
  removed: number
  note: string | null
}

interface RunResult {
  sources_checked: number
  events: EventSummary[]
  // Distinct severities this run, or ["NO_CHANGE"] when nothing fired.
  severities: Array<Severity | "NO_CHANGE">
  emails_sent: number
  pushes_sent: number
  sms_sent: number
  subscriber_audience: number
  subscriber_emails_sent: number
  subscriber_dry_run: boolean
  subscriber_preview: Array<{ email: string; subject: string }>
  snapshots_upserted: number
  errors: string[]
  // Failures of sources with an active, unexpired acknowledgedOutage (see
  // sources.ts). Kept OUT of `errors` so the run logs ok and watchdog-health
  // stays quiet for the known outage while still alarming on any other
  // source. Surfaced here (HTTP response) and via console.log (function logs).
  acknowledged_outages: string[]
  dry_run: boolean
  run_logged: boolean
}

interface Collected {
  sourcesChecked: number
  events: ChangeEvent[] // severity-classified
  desired: DesiredSnapshot[]
  errors: string[]
  acknowledged: string[]
}

async function collectEvents(
  supabase: Db,
  todayIso: string
): Promise<Collected> {
  const out: Collected = { sourcesChecked: 0, events: [], desired: [], errors: [], acknowledged: [] }

  for (const src of SOURCES) {
    out.sourcesChecked++
    // Failures of a source under an active acknowledgedOutage are recorded but
    // not alarmed on (see sources.ts). Only FAILURES route there — a partial
    // success's notes still count as errors, so an acked source that comes
    // back degraded (e.g. served by fallback) surfaces normally.
    const ack = activeAcknowledgedOutage(src, todayIso)
    try {
      const obs = await observeSource(src)
      out.errors.push(...obs.notes)

      // Transient-failure guard: zero observations from a source whose listing
      // should always exist (DeKalb table, Gwinnett PDF) means a fetch or
      // maintenance blip, NOT that everything was pulled. Skip — don't diff,
      // don't overwrite. Sources where empty is a real state (Cobb placeholder,
      // Clayton between sales) declare emptyOk and still diff, so a vanished
      // FUTURE date can surface as date_removed.
      if (obs.dates.length === 0 && !obs.emptyOk) {
        const msg = `${src.county}: 0 listings parsed — treating as transient, skipped`
        if (ack) out.acknowledged.push(`${msg} [acknowledged until ${ack.until}: ${ack.reason}]`)
        else out.errors.push(msg)
        continue
      }

      const { data: existing, error } = await supabase
        .from("tax_sale_snapshots")
        .select("county, auction_date, parcel_ids, property_count, source_ref, delisted_at")
        .eq("county", src.county)
      if (error) {
        out.errors.push(`${src.county}: load snapshots: ${error.message}`)
        continue
      }

      const { events, desired } = diffCounty(
        src.county,
        obs.dates,
        (existing ?? []) as SnapshotRow[],
        {
          todayIso,
          listingUrl: src.url,
          // A degraded read (probe errors, parse-fallback notes) makes absence
          // untrustworthy — never infer a cancellation from a flaky fetch.
          detectRemovals: obs.notes.length === 0,
        }
      )
      out.events.push(...events)
      out.desired.push(...desired)
    } catch (e) {
      const msg = `${src.county}: ${e instanceof Error ? e.message : String(e)}`
      if (ack) out.acknowledged.push(`${msg} [acknowledged until ${ack.until}: ${ack.reason}]`)
      else out.errors.push(msg)
    }
  }

  out.events = classifySeverities(out.events)
  return out
}

async function upsertSnapshots(
  supabase: Db,
  rows: DesiredSnapshot[],
  bumpChanged: Set<string>,
  nowIso: string
): Promise<{ upserted: number; error?: string }> {
  if (rows.length === 0) return { upserted: 0 }
  const payload = rows.map((r) => {
    const base: Record<string, unknown> = {
      county: r.county,
      auction_date: r.auction_date,
      parcel_ids: r.parcel_ids,
      property_count: r.property_count,
      source_ref: r.source_ref,
      delisted_at: r.delisted_at, // always null — an observed date is live
      last_seen_at: nowIso,
    }
    // Advance the watermark only for dates whose state actually changed.
    if (bumpChanged.has(`${r.county}:${r.auction_date}`)) base.last_changed_at = nowIso
    return base
  })
  const { error, count } = await supabase
    .from("tax_sale_snapshots")
    .upsert(payload, { onConflict: "county,auction_date", count: "exact" })
  if (error) return { upserted: 0, error: error.message }
  return { upserted: count ?? rows.length }
}

// date_removed watermark: flag the row so the cancellation doesn't re-fire
// daily. Only called after the operator email succeeded (same at-least-once
// gate as the upsert path).
async function markDelisted(
  supabase: Db,
  events: ChangeEvent[],
  nowIso: string,
  result: RunResult
): Promise<void> {
  for (const e of events) {
    if (e.type !== "date_removed") continue
    const { error } = await supabase
      .from("tax_sale_snapshots")
      .update({ delisted_at: nowIso, last_changed_at: nowIso })
      .eq("county", e.county)
      .eq("auction_date", e.auctionDate)
    if (error) result.errors.push(`delist ${e.county} ${e.auctionDate}: ${error.message}`)
  }
}

function toEventSummary(e: ChangeEvent): EventSummary {
  return {
    county: e.county,
    auction_date: e.auctionDate,
    type: e.type,
    severity: e.severity,
    count: e.count,
    added: e.added,
    removed: e.removed,
    note: e.note,
  }
}

function runSeverities(events: ChangeEvent[]): Array<Severity | "NO_CHANGE"> {
  if (events.length === 0) return ["NO_CHANGE"]
  return [...new Set(events.map((e) => e.severity).filter((s): s is Severity => s !== null))]
}

function applySubscriberResult(result: RunResult, sub: SubscriberNotifyResult): void {
  result.subscriber_audience = sub.audience
  result.subscriber_emails_sent = sub.sent
  result.subscriber_dry_run = sub.dryRun
  result.subscriber_preview = sub.preview
  result.errors.push(...sub.errors)
}

// Every check — real, dry, or no-change — leaves a row in
// tax_sale_monitor_runs. Failure to log never fails the run (the alert
// already went out); it's surfaced in `errors` instead.
async function logRun(
  supabase: Db,
  result: RunResult,
  startedAtMs: number
): Promise<void> {
  try {
    const { error } = await supabase.from("tax_sale_monitor_runs").insert({
      dry_run: result.dry_run,
      sources_checked: result.sources_checked,
      event_count: result.events.length,
      no_change: result.events.length === 0,
      events: result.events,
      errors: result.errors,
      emails_sent: result.emails_sent,
      pushes_sent: result.pushes_sent,
      sms_sent: result.sms_sent,
      subscriber_audience: result.subscriber_audience,
      subscriber_emails_sent: result.subscriber_emails_sent,
      subscriber_dry_run: result.subscriber_dry_run,
      subscriber_preview: result.subscriber_preview,
      snapshots_upserted: result.snapshots_upserted,
      duration_ms: Date.now() - startedAtMs,
      ok: result.errors.length === 0,
    })
    if (error) {
      result.errors.push(`run log: ${error.message} (is migration 020 applied?)`)
      return
    }
    result.run_logged = true
  } catch (e) {
    result.errors.push(`run log: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function deliverAndRecord(
  supabase: Db,
  collected: Collected,
  subEvents: ChangeEvent[],
  result: RunResult
): Promise<void> {
  const nowIso = new Date().toISOString()
  const eventDateKeys = new Set(collected.events.map((e) => `${e.county}:${e.auctionDate}`))
  const noEventRows = collected.desired.filter((r) => !eventDateKeys.has(`${r.county}:${r.auction_date}`))
  const eventRows = collected.desired.filter((r) => eventDateKeys.has(`${r.county}:${r.auction_date}`))

  // Always refresh last_seen for unchanged dates (keeps the table truthful).
  if (noEventRows.length > 0) {
    const up = await upsertSnapshots(supabase, noEventRows, new Set(), nowIso)
    result.snapshots_upserted += up.upserted
    if (up.error) result.errors.push(`upsert (no-event): ${up.error}`)
  }

  if (collected.events.length === 0) return

  // Deliver to the operator, then advance the watermark only on email success
  // so a failed send re-triggers next run instead of being silently swallowed.
  const email = await sendEmail(collected.events)
  if (!email.ok) {
    result.errors.push(`email: ${email.error}`)
    return // event-date snapshots intentionally NOT advanced → retry next cron
  }
  result.emails_sent = 1

  // Subscriber fan-out (hard-gated by TAX_SALE_SUBSCRIBER_DRY_RUN), push, and
  // SMS are best-effort — logged, never blocking the watermark.
  try {
    const sub = await notifySubscribers(supabase, subEvents, subscriberSendingEnabled())
    applySubscriberResult(result, sub)
  } catch (e) {
    result.errors.push(`subscribers: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    const tokens = await resolvePushTokens(supabase)
    const push = await sendPush(tokens, collected.events)
    result.pushes_sent = push.accepted
    if (push.error) result.errors.push(push.error)
  } catch (e) {
    result.errors.push(`push: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    const sms = await sendSms(collected.events)
    result.sms_sent = sms.sent
    if (sms.error) result.errors.push(sms.error)
  } catch (e) {
    result.errors.push(`sms: ${e instanceof Error ? e.message : String(e)}`)
  }

  const up = await upsertSnapshots(supabase, eventRows, eventDateKeys, nowIso)
  result.snapshots_upserted += up.upserted
  if (up.error) result.errors.push(`upsert (event): ${up.error}`)

  await markDelisted(supabase, collected.events, nowIso, result)
}

async function run(dryRun: boolean): Promise<RunResult> {
  const startedAtMs = Date.now()
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  const todayIso = new Date().toISOString().slice(0, 10)

  const collected = await collectEvents(supabase, todayIso)
  const result: RunResult = {
    sources_checked: collected.sourcesChecked,
    events: collected.events.map(toEventSummary),
    severities: runSeverities(collected.events),
    emails_sent: 0,
    pushes_sent: 0,
    sms_sent: 0,
    subscriber_audience: 0,
    subscriber_emails_sent: 0,
    subscriber_dry_run: !subscriberSendingEnabled(),
    subscriber_preview: [],
    snapshots_upserted: 0,
    errors: [...collected.errors],
    acknowledged_outages: [...collected.acknowledged],
    dry_run: dryRun,
    run_logged: false,
  }
  // Not in the run row (errors must stay clean for watchdog_health), but
  // never invisible: function logs keep the trail while the ack is active.
  for (const line of result.acknowledged_outages) {
    console.log(`acknowledged outage: ${line}`)
  }

  // Customer fan-out is gated per county: a source is watched + operator-alerted
  // always, but only subscriber-eligible counties (Source.subscriberEligible)
  // reach paying subscribers. This keeps a customer-dark county (e.g. Fulton,
  // not yet on the site) out of subscriber email even if the global dry-run
  // flag is open. The operator alert (sendEmail) is unaffected.
  const subEvents = subscriberEvents(collected.events).filter((e) =>
    SUBSCRIBER_ELIGIBLE_COUNTIES.has(e.county)
  )

  if (dryRun) {
    // Preview: no alerts, no snapshot writes. The subscriber audience is still
    // computed (read-only, forced dry-run) so the preview shows exactly who
    // a real run would notify — and the check itself is run-logged.
    try {
      const sub = await notifySubscribers(supabase, subEvents, false)
      applySubscriberResult(result, sub)
    } catch (e) {
      result.errors.push(`subscribers: ${e instanceof Error ? e.message : String(e)}`)
    }
    await logRun(supabase, result, startedAtMs)
    return result
  }

  await deliverAndRecord(supabase, collected, subEvents, result)
  await logRun(supabase, result, startedAtMs)
  return result
}

// Shared secret guard — this function sends email/push/SMS to the operator and
// (when the gate is open) to every subscriber, so it must never be publicly
// triggerable once deployed with --no-verify-jwt. pg_cron invokes it with the
// service-role key; an optional NOTIFY_TAX_SALE_SECRET allows a non-service-
// role caller without handing out the service-role key.
function isAuthorized(req: Request): boolean {
  const header = req.headers.get("Authorization") ?? ""
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (!bearer) return false
  if (SUPABASE_SERVICE_ROLE && bearer === SUPABASE_SERVICE_ROLE) return true
  // @ts-ignore Deno global (resolved at deploy time)
  const secret = Deno.env.get("NOTIFY_TAX_SALE_SECRET") ?? ""
  return Boolean(secret && bearer === secret)
}

serve(async (req: Request) => {
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }
  try {
    let dryRun = false
    if (req.method === "POST") {
      try {
        const body = await req.json()
        if (body && typeof body === "object" && body.dryRun === true) dryRun = true
      } catch {
        // empty/invalid body → real run
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
