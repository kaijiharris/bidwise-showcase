// supabase/functions/notify-tax-sale/diff.ts
//
// Pure diff + severity classification for the tax-sale watchdog. No Deno
// APIs, no network, no database — index.ts feeds observations and snapshot
// rows in, classified events come out. Kept side-effect-free so the decision
// logic is unit-testable with `deno test diff_test.ts` (no secrets needed).
//
// Event model (internal type → operator/subscriber severity):
//   new_date     → NEW_LIST      (or DATE_CHANGED when paired with a removal)
//   populated    → NEW_LIST
//   changed      → LIST_CHANGED
//   date_removed → CANCELLED     (or DATE_CHANGED when paired with a new date)
//   (no events)  → NO_CHANGE     — run-level only; logged, never alerted
//
// Notification matrix:
//   NEW_LIST / DATE_CHANGED / CANCELLED → operator + subscribers
//   LIST_CHANGED                        → operator only
//   NO_CHANGE                           → run log only

import type { DateObservation, ParsedRow } from "./sources.ts"

export type EventType = "new_date" | "populated" | "changed" | "date_removed"

export type Severity = "NEW_LIST" | "LIST_CHANGED" | "DATE_CHANGED" | "CANCELLED"

/** Severities that fan out to paying subscribers (gated by the dry-run flag). */
export const SUBSCRIBER_SEVERITIES: ReadonlySet<Severity> = new Set([
  "NEW_LIST",
  "DATE_CHANGED",
  "CANCELLED",
])

export interface ChangeEvent {
  county: string
  auctionDate: string
  type: EventType
  severity: Severity | null // assigned by classifySeverities()
  count: number // property count for the date after this observation
  added: number
  removed: number
  rows: ParsedRow[] // properties for this date (for the email body)
  sourceUrl: string | null // official listing link (for the email body)
  note: string | null // e.g. "listing file replaced" for fingerprint-only diffs
}

export interface SnapshotRow {
  county: string
  auction_date: string
  parcel_ids: string[]
  property_count: number
  source_ref: string | null
  delisted_at: string | null // set when a future date vanished (migration 020)
}

export interface DesiredSnapshot {
  county: string
  auction_date: string
  parcel_ids: string[]
  property_count: number
  source_ref: string | null
  delisted_at: null // an observed date is live by definition — clears any flag
}

interface DiffOptions {
  todayIso: string // yyyy-mm-dd (UTC) — removal detection ignores past dates
  listingUrl: string | null // county page URL for date_removed events
  // false = the source read was degraded (probe errors, parse fallback notes):
  // absence of a date is NOT trustworthy, so removal detection is skipped.
  detectRemovals: boolean
}

// Compares one county's observations against its existing snapshot rows.
// Returns alertable events plus the desired snapshot rows for every observed
// date (so callers can advance state after delivery).
export function diffCounty(
  county: string,
  observations: DateObservation[],
  existing: SnapshotRow[],
  opts: DiffOptions
): { events: ChangeEvent[]; desired: DesiredSnapshot[] } {
  const existingByDate = new Map<string, SnapshotRow>()
  for (const e of existing) existingByDate.set(e.auction_date, e)

  const events: ChangeEvent[] = []
  const desired: DesiredSnapshot[] = []

  for (const obs of observations) {
    desired.push({
      county,
      auction_date: obs.auctionDate,
      parcel_ids: obs.parcelIds,
      property_count: obs.parcelIds.length,
      source_ref: obs.sourceRef,
      delisted_at: null,
    })
    const event = diffOneDate(county, obs, existingByDate.get(obs.auctionDate))
    if (event) events.push(event)
  }

  if (opts.detectRemovals) {
    events.push(...removedDateEvents(county, observations, existing, opts))
  }

  return { events, desired }
}

function diffOneDate(
  county: string,
  obs: DateObservation,
  prior: SnapshotRow | undefined
): ChangeEvent | null {
  const count = obs.parcelIds.length
  const base = {
    county,
    auctionDate: obs.auctionDate,
    severity: null,
    count,
    rows: obs.rows,
    sourceUrl: obs.sourceUrl,
    note: null as string | null,
  }

  if (!prior) {
    // Never seen this date → the headline event.
    return { ...base, type: "new_date", added: count, removed: 0 }
  }
  if (prior.delisted_at) {
    // Was observed to vanish, now it's back — alert like a fresh listing.
    return {
      ...base,
      type: "new_date",
      added: count,
      removed: 0,
      note: "relisted — this date had disappeared from the county listing",
    }
  }

  const priorSet = new Set(prior.parcel_ids)
  const newSet = new Set(obs.parcelIds)
  const added = obs.parcelIds.filter((p) => !priorSet.has(p)).length
  const removed = prior.parcel_ids.filter((p) => !newSet.has(p)).length

  if (prior.property_count === 0 && count > 0) {
    return { ...base, type: "populated", added, removed }
  }
  if (added > 0 || removed > 0) {
    return { ...base, type: "changed", added, removed }
  }
  if (obs.sourceRef && prior.source_ref && obs.sourceRef !== prior.source_ref) {
    // No parcel-level delta but the listing file itself changed — the diff
    // signal for sources where parcel parsing isn't (yet) available.
    return { ...base, type: "changed", added: 0, removed: 0, note: "listing file replaced" }
  }
  return null
}

// A FUTURE date we were tracking that no longer appears on a cleanly-read
// source = cancellation/reschedule signal. Past dates expire naturally
// (counties pull listings after the sale) and never fire.
function removedDateEvents(
  county: string,
  observations: DateObservation[],
  existing: SnapshotRow[],
  opts: DiffOptions
): ChangeEvent[] {
  const observedDates = new Set(observations.map((o) => o.auctionDate))
  return existing
    .filter(
      (row) =>
        row.delisted_at === null &&
        row.auction_date > opts.todayIso &&
        !observedDates.has(row.auction_date)
    )
    .map((row) => ({
      county,
      auctionDate: row.auction_date,
      type: "date_removed" as const,
      severity: null,
      count: row.property_count,
      added: 0,
      removed: row.property_count,
      rows: [],
      sourceUrl: opts.listingUrl,
      note: "date no longer on the county listing",
    }))
}

// ── Severity ─────────────────────────────────────────────────────────────────

// A removal + a new date for the SAME county in the SAME run is the signature
// of a reschedule → both sides classify as DATE_CHANGED. A removal alone is a
// CANCELLED signal. Returns new objects (no mutation).
export function classifySeverities(events: ChangeEvent[]): ChangeEvent[] {
  const hasNewDate = new Set(
    events.filter((e) => e.type === "new_date").map((e) => e.county)
  )
  const hasRemoval = new Set(
    events.filter((e) => e.type === "date_removed").map((e) => e.county)
  )
  return events.map((e) => ({ ...e, severity: severityFor(e, hasNewDate, hasRemoval) }))
}

function severityFor(
  e: ChangeEvent,
  hasNewDate: Set<string>,
  hasRemoval: Set<string>
): Severity {
  if (e.type === "date_removed") return hasNewDate.has(e.county) ? "DATE_CHANGED" : "CANCELLED"
  if (e.type === "new_date") return hasRemoval.has(e.county) ? "DATE_CHANGED" : "NEW_LIST"
  if (e.type === "populated") return "NEW_LIST"
  return "LIST_CHANGED"
}

// Events that go to subscribers. For a reschedule pair the new-date event
// carries the message — the removal side is dropped so subscribers aren't
// told "cancelled" and "moved" as two separate items.
export function subscriberEvents(events: ChangeEvent[]): ChangeEvent[] {
  const eligible = events.filter((e) => e.severity !== null && SUBSCRIBER_SEVERITIES.has(e.severity))
  const rescheduledCounties = new Set(
    eligible
      .filter((e) => e.type === "new_date" && e.severity === "DATE_CHANGED")
      .map((e) => e.county)
  )
  return eligible.filter(
    (e) => !(e.type === "date_removed" && rescheduledCounties.has(e.county))
  )
}

// ── Shared presentation helpers (pure) ───────────────────────────────────────

export function escapeHtml(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function prettyDate(iso: string): string {
  // 2026-08-04 → Aug 4, 2026  (string-split, no Date parsing → no TZ drift)
  const [y, m, d] = iso.split("-")
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${names[Number(m)]} ${Number(d)}, ${y}`
}

export function eventHeadline(e: ChangeEvent): string {
  const when = prettyDate(e.auctionDate)
  if (e.type === "date_removed") {
    return e.severity === "DATE_CHANGED"
      ? `${e.county} ${when} sale removed — rescheduled (see new date)`
      : `${e.county} ${when} sale removed from the county listing — possible cancellation`
  }
  if (e.type === "new_date") {
    if (e.count === 0) return `New ${e.county} sale — ${when} (listing posted)`
    return `New ${e.county} sale — ${when} (${e.count} propert${e.count === 1 ? "y" : "ies"})`
  }
  if (e.type === "populated")
    return `${e.county} ${when} listing populated — ${e.count} propert${e.count === 1 ? "y" : "ies"}`
  if (e.note && e.added === 0 && e.removed === 0) return `${e.county} ${when} — ${e.note}`
  const parts: string[] = []
  if (e.added) parts.push(`${e.added} added`)
  if (e.removed) parts.push(`${e.removed} removed`)
  return `${e.county} ${when} listing changed — ${parts.join(", ")} (now ${e.count})`
}
