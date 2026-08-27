// supabase/functions/notify-tax-sale/diff_test.ts
//
// Unit tests for the watchdog's pure decision logic (diff.ts): event
// detection, severity classification, and the subscriber notification matrix.
// Run with:  deno test supabase/functions/notify-tax-sale/diff_test.ts
// No network, no database, no secrets required (std assert is fetched and
// cached by Deno on first run).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"

import {
  classifySeverities,
  diffCounty,
  subscriberEvents,
} from "./diff.ts"
import type { ChangeEvent, SnapshotRow } from "./diff.ts"
import type { DateObservation } from "./sources.ts"

const TODAY = "2026-07-12"
const OPTS = { todayIso: TODAY, listingUrl: "https://county.example/listing", detectRemovals: true }

function obs(auctionDate: string, parcelIds: string[], sourceRef: string | null = null): DateObservation {
  return { auctionDate, parcelIds, rows: [], sourceRef, sourceUrl: "https://county.example/listing" }
}

function snap(
  auction_date: string,
  parcel_ids: string[],
  overrides: Partial<SnapshotRow> = {}
): SnapshotRow {
  return {
    county: "DeKalb",
    auction_date,
    parcel_ids,
    property_count: parcel_ids.length,
    source_ref: null,
    delisted_at: null,
    ...overrides,
  }
}

function classified(events: ChangeEvent[]): ChangeEvent[] {
  return classifySeverities(events)
}

// ── Detection ────────────────────────────────────────────────────────────────

Deno.test("unseen auction date fires new_date and severity NEW_LIST", () => {
  const { events } = diffCounty("DeKalb", [obs("2026-08-04", ["A", "B"])], [], OPTS)
  assertEquals(events.length, 1)
  assertEquals(events[0].type, "new_date")
  assertEquals(events[0].added, 2)
  assertEquals(classified(events)[0].severity, "NEW_LIST")
})

Deno.test("known date going 0 → N fires populated (NEW_LIST)", () => {
  const { events } = diffCounty(
    "DeKalb",
    [obs("2026-08-04", ["A", "B", "C"])],
    [snap("2026-08-04", [])],
    OPTS
  )
  assertEquals(events.length, 1)
  assertEquals(events[0].type, "populated")
  assertEquals(classified(events)[0].severity, "NEW_LIST")
})

Deno.test("parcel churn with unchanged count still fires changed (LIST_CHANGED)", () => {
  const { events } = diffCounty(
    "DeKalb",
    [obs("2026-08-04", ["A", "B", "E", "F"])],
    [snap("2026-08-04", ["A", "B", "C", "D"])],
    OPTS
  )
  assertEquals(events.length, 1)
  assertEquals(events[0].type, "changed")
  assertEquals(events[0].added, 2)
  assertEquals(events[0].removed, 2)
  assertEquals(classified(events)[0].severity, "LIST_CHANGED")
})

Deno.test("replaced listing file with no parcel delta fires fingerprint changed", () => {
  const { events } = diffCounty(
    "Gwinnett",
    [obs("2026-08-04", ["A"], "url#sha256:new")],
    [snap("2026-08-04", ["A"], { county: "Gwinnett", source_ref: "url#sha256:old" })],
    OPTS
  )
  assertEquals(events.length, 1)
  assertEquals(events[0].type, "changed")
  assertEquals(events[0].note, "listing file replaced")
  assertEquals(classified(events)[0].severity, "LIST_CHANGED")
})

Deno.test("identical observation fires nothing (NO_CHANGE run)", () => {
  const { events, desired } = diffCounty(
    "DeKalb",
    [obs("2026-08-04", ["A", "B"])],
    [snap("2026-08-04", ["A", "B"])],
    OPTS
  )
  assertEquals(events.length, 0)
  assertEquals(desired.length, 1) // last_seen still refreshes
})

// ── Removal / cancellation ───────────────────────────────────────────────────

Deno.test("future date vanishing fires date_removed → CANCELLED", () => {
  const { events } = diffCounty("Cobb", [], [snap("2026-11-03", ["X"], { county: "Cobb" })], OPTS)
  assertEquals(events.length, 1)
  assertEquals(events[0].type, "date_removed")
  assertEquals(classified(events)[0].severity, "CANCELLED")
})

Deno.test("past dates vanishing never fire (sold listings expire naturally)", () => {
  const { events } = diffCounty("DeKalb", [], [snap("2026-07-07", ["X"])], OPTS)
  assertEquals(events.length, 0)
})

Deno.test("already-delisted dates do not re-fire", () => {
  const { events } = diffCounty(
    "Cobb",
    [],
    [snap("2026-11-03", ["X"], { county: "Cobb", delisted_at: "2026-07-10T13:00:00Z" })],
    OPTS
  )
  assertEquals(events.length, 0)
})

Deno.test("degraded source read (detectRemovals=false) suppresses removal events", () => {
  const { events } = diffCounty(
    "Clayton",
    [],
    [snap("2026-08-04", ["X"], { county: "Clayton" })],
    { ...OPTS, detectRemovals: false }
  )
  assertEquals(events.length, 0)
})

Deno.test("delisted date re-appearing fires new_date with relist note and clears the flag", () => {
  const { events, desired } = diffCounty(
    "Cobb",
    [obs("2026-11-03", ["X", "Y"])],
    [snap("2026-11-03", ["X"], { county: "Cobb", delisted_at: "2026-07-10T13:00:00Z" })],
    OPTS
  )
  assertEquals(events.length, 1)
  assertEquals(events[0].type, "new_date")
  assert(events[0].note !== null && events[0].note.includes("relisted"))
  assertEquals(desired[0].delisted_at, null)
})

// ── Reschedule pairing + subscriber matrix ───────────────────────────────────

Deno.test("removal + new date in one run classifies both as DATE_CHANGED", () => {
  const { events } = diffCounty(
    "Gwinnett",
    [obs("2026-09-01", ["A"])],
    [snap("2026-08-04", ["A"], { county: "Gwinnett" })],
    OPTS
  )
  const withSev = classified(events)
  assertEquals(withSev.length, 2)
  for (const e of withSev) assertEquals(e.severity, "DATE_CHANGED")
})

Deno.test("subscriber digest keeps only the new-date side of a reschedule", () => {
  const { events } = diffCounty(
    "Gwinnett",
    [obs("2026-09-01", ["A"])],
    [snap("2026-08-04", ["A"], { county: "Gwinnett" })],
    OPTS
  )
  const subs = subscriberEvents(classified(events))
  assertEquals(subs.length, 1)
  assertEquals(subs[0].type, "new_date")
})

Deno.test("LIST_CHANGED events never reach subscribers; NEW_LIST and CANCELLED do", () => {
  const { events } = diffCounty(
    "DeKalb",
    [obs("2026-08-04", ["A", "Z"]), obs("2026-10-06", ["Q"])],
    [snap("2026-08-04", ["A", "B"]), snap("2026-09-01", ["C"])],
    OPTS
  )
  const withSev = classified(events)
  const types = new Set(withSev.map((e) => e.severity))
  // changed(LIST_CHANGED) + new_date/date_removed pair → DATE_CHANGED×2
  assert(types.has("LIST_CHANGED"))
  const subs = subscriberEvents(withSev)
  assert(subs.every((e) => e.severity !== "LIST_CHANGED"))
  assertEquals(subs.length, 1) // reschedule pair collapsed to the new-date side
})
