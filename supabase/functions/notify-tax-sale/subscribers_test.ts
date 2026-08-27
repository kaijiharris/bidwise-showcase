// supabase/functions/notify-tax-sale/subscribers_test.ts
//
// Tests for the notification-preferences layer (migration 022) in the
// subscriber fan-out. Pins the consent contract:
//   • no prefs row  → default ON, all counties
//   • opt-out       → excluded from audience, preview, and sends
//   • county filter → per-recipient event subsets, subjects, and bodies
//   • prefs table unreadable → FAIL CLOSED (no sends, loud error)
// Supabase client and fetch are stubbed — no network, no --allow-net. The
// module under test reads env at load (RESEND_API_KEY etc.), so tests need
// --allow-env (values may be absent; only the READ needs permission).
//
// Run with:  deno test --allow-env supabase/functions/notify-tax-sale/subscribers_test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"

import {
  DEFAULT_PREF,
  eventsForSubscriber,
  getNotificationPrefs,
  mergePrefs,
  notifySubscribers,
  renderSubscriberEmailHtml,
} from "./subscribers.ts"
import type { ChangeEvent } from "./diff.ts"

// ── Fixtures ─────────────────────────────────────────────────────────────────

function ev(county: string, count = 10): ChangeEvent {
  return {
    county,
    auctionDate: "2026-08-04",
    type: "new_date",
    severity: "NEW_LIST",
    count,
    added: count,
    removed: 0,
    rows: [],
    sourceUrl: null,
    note: null,
  } as ChangeEvent
}

const EV_DEKALB = ev("DeKalb", 153)
const EV_GWINNETT = ev("Gwinnett", 70)

interface StubOpts {
  subscriptions?: Array<{ user_id: string | null; status: string }>
  profiles?: Array<{ id: string; email: string | null }>
  prefRows?: Array<{ user_id: string; tax_sale_alerts: boolean | null; counties: string[] | null }>
  prefsError?: string
}

// Mirrors the exact call shape the module uses: .from(t).select(c).in(col, vals)
// resolving to {data, error}, plus auth.admin.getUserById.
// deno-lint-ignore no-explicit-any
function stubDb(opts: StubOpts): any {
  return {
    from(table: string) {
      return {
        select() {
          return {
            in() {
              if (table === "subscriptions") {
                return Promise.resolve({ data: opts.subscriptions ?? [], error: null })
              }
              if (table === "user_profiles") {
                return Promise.resolve({ data: opts.profiles ?? [], error: null })
              }
              if (table === "notification_prefs") {
                if (opts.prefsError) {
                  return Promise.resolve({ data: null, error: { message: opts.prefsError } })
                }
                return Promise.resolve({ data: opts.prefRows ?? [], error: null })
              }
              return Promise.resolve({ data: [], error: { message: `unexpected table ${table}` } })
            },
          }
        },
      }
    },
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null } }) } },
  }
}

const TWO_SUBSCRIBERS: StubOpts = {
  subscriptions: [
    { user_id: "user-a", status: "active" },
    { user_id: "user-b", status: "trialing" },
  ],
  profiles: [
    { id: "user-a", email: "a@example.com" },
    { id: "user-b", email: "b@example.com" },
  ],
}

// ── eventsForSubscriber (pure) ───────────────────────────────────────────────

Deno.test("eventsForSubscriber: opt-out yields nothing", () => {
  const out = eventsForSubscriber([EV_DEKALB, EV_GWINNETT], {
    taxSaleAlerts: false,
    counties: null,
  })
  assertEquals(out, [])
})

Deno.test("eventsForSubscriber: null counties = everything; slugs filter case-insensitively; [] = nothing", () => {
  const events = [EV_DEKALB, EV_GWINNETT]
  assertEquals(eventsForSubscriber(events, DEFAULT_PREF).length, 2)
  const only = eventsForSubscriber(events, { taxSaleAlerts: true, counties: ["dekalb"] })
  assertEquals(only.map((e) => e.county), ["DeKalb"]) // "DeKalb" matches slug "dekalb"
  assertEquals(eventsForSubscriber(events, { taxSaleAlerts: true, counties: [] }), [])
})

// ── notifySubscribers with prefs (stubbed client) ────────────────────────────

Deno.test("no prefs rows → default ON: full audience, combined subject", async () => {
  const res = await notifySubscribers(stubDb(TWO_SUBSCRIBERS), [EV_DEKALB, EV_GWINNETT], false)
  assertEquals(res.audience, 2)
  assertEquals(res.dryRun, true)
  assertEquals(res.preview.length, 2)
  assert(res.preview[0].subject.includes("2 Georgia tax-sale updates"))
})

Deno.test("opted-out subscriber drops from audience and preview", async () => {
  const res = await notifySubscribers(
    stubDb({
      ...TWO_SUBSCRIBERS,
      prefRows: [{ user_id: "user-b", tax_sale_alerts: false, counties: null }],
    }),
    [EV_DEKALB, EV_GWINNETT],
    false
  )
  assertEquals(res.audience, 1)
  assertEquals(res.preview.map((p) => p.email), ["a@example.com"])
})

Deno.test("county filter produces a per-recipient subject", async () => {
  const res = await notifySubscribers(
    stubDb({
      ...TWO_SUBSCRIBERS,
      prefRows: [{ user_id: "user-b", tax_sale_alerts: true, counties: ["gwinnett"] }],
    }),
    [EV_DEKALB, EV_GWINNETT],
    false
  )
  assertEquals(res.audience, 2)
  const byEmail = new Map(res.preview.map((p) => [p.email, p.subject]))
  assert(byEmail.get("a@example.com")!.includes("2 Georgia tax-sale updates"))
  assert(byEmail.get("b@example.com")!.includes("Gwinnett")) // single-county headline
  assert(!byEmail.get("b@example.com")!.includes("DeKalb"))
})

Deno.test("every event filtered out for everyone → empty audience, no error", async () => {
  const res = await notifySubscribers(
    stubDb({
      ...TWO_SUBSCRIBERS,
      prefRows: [
        { user_id: "user-a", tax_sale_alerts: true, counties: ["cobb"] },
        { user_id: "user-b", tax_sale_alerts: false, counties: null },
      ],
    }),
    [EV_DEKALB],
    false
  )
  assertEquals(res.audience, 0)
  assertEquals(res.preview, [])
  assertEquals(res.errors, [])
})

Deno.test("prefs table unreadable → FAIL CLOSED: no sends, loud error, dry-run, audience 0", async () => {
  const res = await notifySubscribers(
    stubDb({ ...TWO_SUBSCRIBERS, prefsError: "relation does not exist" }),
    [EV_DEKALB],
    true // sending enabled — must STILL refuse
  )
  assertEquals(res.sent, 0)
  assertEquals(res.dryRun, true)
  assertEquals(res.preview, [])
  assertEquals(res.audience, 0) // nobody was determined sendable
  assert(res.errors.some((e) => e.includes("fail-closed")))
  assert(res.errors.some((e) => e.includes("2 subscriber(s) skipped")))
})

// ── Duplicate accounts sharing one address (most-restrictive merge) ──────────

Deno.test("mergePrefs: any opt-out wins; county lists intersect; null is identity", () => {
  assertEquals(mergePrefs([]), DEFAULT_PREF)
  assertEquals(
    mergePrefs([DEFAULT_PREF, { taxSaleAlerts: false, counties: null }]).taxSaleAlerts,
    false
  )
  assertEquals(
    mergePrefs([{ taxSaleAlerts: true, counties: ["dekalb", "gwinnett"] }, DEFAULT_PREF]).counties,
    ["dekalb", "gwinnett"] // null = all, so the list survives
  )
  assertEquals(
    mergePrefs([
      { taxSaleAlerts: true, counties: ["DeKalb", "gwinnett"] },
      { taxSaleAlerts: true, counties: ["gwinnett", "cobb"] },
    ]).counties,
    ["gwinnett"] // intersection, case-normalized
  )
})

Deno.test("shared email: an opted-out duplicate blocks the address in BOTH row orders", async () => {
  const shared: StubOpts = {
    subscriptions: [
      { user_id: "user-a", status: "active" },
      { user_id: "user-b", status: "active" },
    ],
    profiles: [
      { id: "user-a", email: "jane@example.com" },
      { id: "user-b", email: "JANE@example.com" }, // same address, different case
    ],
    prefRows: [{ user_id: "user-b", tax_sale_alerts: false, counties: null }],
  }
  const res1 = await notifySubscribers(stubDb(shared), [EV_DEKALB], false)
  assertEquals(res1.audience, 0)
  // reversed profile order — the outcome must be identical
  const reversed = {
    ...shared,
    profiles: [...shared.profiles!].reverse(),
  }
  const res2 = await notifySubscribers(stubDb(reversed), [EV_DEKALB], false)
  assertEquals(res2.audience, 0)
})

Deno.test("shared email: county filters intersect across duplicate accounts", async () => {
  const res = await notifySubscribers(
    stubDb({
      subscriptions: [
        { user_id: "user-a", status: "active" },
        { user_id: "user-b", status: "active" },
      ],
      profiles: [
        { id: "user-a", email: "jane@example.com" },
        { id: "user-b", email: "jane@example.com" },
      ],
      prefRows: [
        { user_id: "user-a", tax_sale_alerts: true, counties: ["dekalb"] },
        { user_id: "user-b", tax_sale_alerts: true, counties: ["gwinnett"] },
      ],
    }),
    [EV_DEKALB, EV_GWINNETT],
    false
  )
  // intersection is empty → the address gets nothing (and exactly one entry ever existed)
  assertEquals(res.audience, 0)
})

Deno.test("getNotificationPrefs chunks large id sets (defeats silent truncation)", async () => {
  const inCalls: number[] = []
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from() {
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              inCalls.push(ids.length)
              return Promise.resolve({
                data: ids.map((id) => ({ user_id: id, tax_sale_alerts: false, counties: null })),
                error: null,
              })
            },
          }
        },
      }
    },
  }
  const ids = Array.from({ length: 120 }, (_, i) => `u${i}`)
  const { prefs, error } = await getNotificationPrefs(db, ids)
  assertEquals(error, null)
  assertEquals(prefs.size, 120) // every row surfaced across chunks
  assertEquals(inCalls, [50, 50, 20]) // chunked, never one giant .in()
})

Deno.test("enabled sends deliver per-recipient bodies (opt-outs never emailed)", async () => {
  const sent: Array<{ to: string; subject: string; html: string }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    return Promise.resolve(new Response("{}", { status: 200 }))
  }) as typeof fetch
  try {
    const res = await notifySubscribers(
      stubDb({
        ...TWO_SUBSCRIBERS,
        prefRows: [{ user_id: "user-b", tax_sale_alerts: true, counties: ["gwinnett"] }],
      }),
      [EV_DEKALB, EV_GWINNETT],
      true
    )
    assertEquals(res.sent, 2)
    assertEquals(res.dryRun, false)
    const toB = sent.find((s) => s.to === "b@example.com")!
    assert(toB.html.includes("Gwinnett") && !toB.html.includes("DeKalb"))
    const toA = sent.find((s) => s.to === "a@example.com")!
    assert(toA.html.includes("Gwinnett") && toA.html.includes("DeKalb"))
    // replies must reach a monitored inbox (the footer's promised opt-out path)
    assert(sent.every((s) => (s as { reply_to?: string }).reply_to === "support@bidwiseinvest.com"))
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test("subscriber email footer carries the unsubscribe instruction", () => {
  const html = renderSubscriberEmailHtml([EV_DEKALB])
  assert(html.includes("unsubscribe"))
  assert(html.includes("reply to this email"))
})
