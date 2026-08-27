// supabase/functions/notify-tax-sale/sources_test.ts
//
// Tests for the Fulton observer added in Cycle 10 (the first observer unit
// tests in this function). Two layers:
//   • Pure: fultonSaleDateFromHref + fultonUpcomingByDate over REAL Fulton
//     Sheriff filenames (captured from the live tax-sales page 2026-07-15).
//   • Integration: observeSource({kind:"fulton"}) with globalThis.fetch stubbed
//     (no network, so no --allow-net). Covers the upcoming-sale, multi-posting,
//     between-sales, layout-changed, and DETERMINISM cases.
//
// Run with:  deno test supabase/functions/notify-tax-sale/sources_test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts"

import {
  activeAcknowledgedOutage,
  fetchTextFrom,
  fultonSaleDateFromHref,
  fultonUpcomingByDate,
  observeSource,
  SUBSCRIBER_ELIGIBLE_COUNTIES,
} from "./sources.ts"
import type { Source } from "./sources.ts"

const FULTON: Source = {
  county: "Fulton",
  kind: "fulton",
  url: "https://fultoncountyga.gov/inside-fulton-county/fulton-county-departments/sheriff/tax-sales",
}
const BASE = "https://fultoncountyga.gov/"
// Fixed "today" for the integration tests so they stay deterministic and never
// rot when wall-clock passes the fixture sale date (2026-08-04).
const NOW = new Date("2026-07-15T00:00:00Z")

// Real hrefs off the live page (2026-07-15). The date filter uses a FIXED
// "today" so these tests never drift with the wall clock.
const HREF_AUG = "/-/media/Departments/Sheriff/Tax-Sales/2026/Sheriffs-August-4-2026-Levy-Sale-List--1st-Posting.pdf"
const HREF_AUG_2ND = "/-/media/Departments/Sheriff/Tax-Sales/2026/Sheriffs-August-4-2026-Levy-Sale-List--2nd-Posting.pdf"
const HREF_FEB = "/-/media/Departments/Sheriff/Tax-Sales/2026/Sheriffs-February-3-2026-Sale-List--1st-Posting-192026.pdf"
const HREF_UNDATED = "/-/media/Departments/Sheriff/Tax-Sales/2026/1st-Website-Posting---Sale-List-4-10-2026.pdf"
const HREF_EXCESS = "/-/media/Departments/Sheriff/Tax-Sales/Tax-Sales-Excess-Funds-Application-EDITED.pdf"
const HREF_WATER = "/-/media/Departments/Public-Works/Water-Quality-Reports/2022-CCR_FINAL.pdf"

function page(hrefs: string[]): string {
  const anchors = hrefs.map((h) => `<a href="${h}">list</a>`).join("\n")
  return `<html><body><h1>Sheriff Tax Sales</h1>${anchors}</body></html>`
}

// ── Subscriber eligibility gate ──────────────────────────────────────────────

Deno.test("Fulton is watched but NOT subscriber-eligible (customer-dark this cycle)", () => {
  // The deploy-safety guard: even if the global dry-run flag is opened, Fulton
  // events are filtered out of the customer fan-out (see index.ts) until it
  // goes public. The live counties remain eligible.
  assert(!SUBSCRIBER_ELIGIBLE_COUNTIES.has("Fulton"))
  for (const c of ["DeKalb", "Gwinnett", "Cobb", "Clayton"]) {
    assert(SUBSCRIBER_ELIGIBLE_COUNTIES.has(c), `${c} should be subscriber-eligible`)
  }
})

// ── Pure: fultonSaleDateFromHref ─────────────────────────────────────────────

Deno.test("fultonSaleDateFromHref reads the sale date from the filename", () => {
  assertEquals(fultonSaleDateFromHref(HREF_AUG), "2026-08-04")
  assertEquals(fultonSaleDateFromHref(HREF_FEB), "2026-02-03")
  assertEquals(
    fultonSaleDateFromHref(
      "/x/FCSO-1st-Website-Posting--Sheriffs-June-2-2026-Levy-Sale.pdf",
    ),
    "2026-06-02",
  )
})

Deno.test("fultonSaleDateFromHref returns the FIRST date, ignoring the posting date", () => {
  // "…February-3-2026…-192026.pdf": sale date Feb 3, posting date 1/9/2026.
  assertEquals(fultonSaleDateFromHref(HREF_FEB), "2026-02-03")
})

Deno.test("fultonSaleDateFromHref rejects a numeric date that is NOT a first Tuesday", () => {
  // Posting-date-named artifact "…4-10-2026.pdf": no month name, and April 10
  // 2026 is not the first Tuesday (April 7 is), so it is not a sale date.
  assertEquals(fultonSaleDateFromHref(HREF_UNDATED), null)
})

Deno.test("fultonSaleDateFromHref accepts a numeric date that IS a first Tuesday", () => {
  // A numeric-named re-post of the Aug 4 list: 8-4-2026 lands on the first
  // Tuesday, so it is tracked (guards against a false CANCELLED if the county
  // ever posts a sale list under a numeric filename).
  assertEquals(
    fultonSaleDateFromHref("/x/FCSO-1st-Website-Posting--Sale-List-8-4-2026.pdf"),
    "2026-08-04",
  )
  // 8-11-2026 is past the first week → posting date, not a sale date.
  assertEquals(
    fultonSaleDateFromHref("/x/Some-Notice-8-11-2026.pdf"),
    null,
  )
})

Deno.test("fultonSaleDateFromHref parses an ordinal month-name form", () => {
  // pdf.ts longDateToIso supports an optional ordinal suffix; pin it so a
  // future regex tweak can't silently drop ordinal-named lists.
  assertEquals(
    fultonSaleDateFromHref("/x/Sheriffs-August-4th-2026-Levy-Sale.pdf"),
    "2026-08-04",
  )
})

// ── Pure: fultonUpcomingByDate ───────────────────────────────────────────────

Deno.test("fultonUpcomingByDate keeps only today-or-later sales, one entry per date", () => {
  const html = page([HREF_WATER, HREF_AUG, HREF_FEB, HREF_UNDATED, HREF_EXCESS])
  const { byDate, sawSalePdf } = fultonUpcomingByDate(html, BASE, "2026-07-15")
  assert(sawSalePdf)
  assertEquals([...byDate.keys()], ["2026-08-04"]) // Feb past, undated skipped
  assertEquals(byDate.get("2026-08-04"), [
    "https://fultoncountyga.gov" + HREF_AUG,
  ])
})

Deno.test("fultonUpcomingByDate groups multiple postings under one date", () => {
  const html = page([HREF_AUG, HREF_AUG_2ND])
  const { byDate } = fultonUpcomingByDate(html, BASE, "2026-07-15")
  assertEquals(byDate.get("2026-08-04")?.length, 2)
})

Deno.test("fultonUpcomingByDate excludes the excess-funds application and non-tax-sale PDFs", () => {
  const html = page([HREF_WATER, HREF_EXCESS])
  const { byDate, sawSalePdf } = fultonUpcomingByDate(html, BASE, "2026-07-15")
  assertEquals(byDate.size, 0)
  assert(!sawSalePdf) // neither is a Tax-Sales-path, non-excluded PDF
})

Deno.test("fultonUpcomingByDate: candidates exist but all past → between-sales (sawSalePdf, empty)", () => {
  const html = page([HREF_FEB]) // Feb 3 is before 2026-07-15
  const { byDate, sawSalePdf } = fultonUpcomingByDate(html, BASE, "2026-07-15")
  assert(sawSalePdf)
  assertEquals(byDate.size, 0)
})

Deno.test("fultonUpcomingByDate keeps TWO upcoming dates as separate keys", () => {
  // Near a month boundary Fulton lists the current and next month's sales.
  const HREF_SEP = "/-/media/Departments/Sheriff/Tax-Sales/2026/Sheriffs-September-1-2026-Levy-Sale-List--1st-Posting.pdf"
  const { byDate } = fultonUpcomingByDate(page([HREF_AUG, HREF_SEP]), BASE, "2026-07-15")
  assertEquals([...byDate.keys()].sort(), ["2026-08-04", "2026-09-01"])
  assertEquals(byDate.get("2026-09-01")?.length, 1)
})

Deno.test("fultonUpcomingByDate handles a ?t= cache-buster and uppercase .PDF", () => {
  const busted = HREF_AUG.replace(/\.pdf$/i, ".PDF") + "?t=1699999999"
  const { byDate } = fultonUpcomingByDate(page([busted]), BASE, "2026-07-15")
  // Recognized as an upcoming Aug-4 sale despite the query string + uppercase ext.
  assertEquals([...byDate.keys()], ["2026-08-04"])
  assert(byDate.get("2026-08-04")?.[0]?.includes("?t=")) // query kept until observeFulton strips it
})

// ── Integration: observeSource (fetch stubbed) ───────────────────────────────

async function withStubbedFetch(
  handler: (url: string) => Response | Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(handler(String(input)))) as typeof fetch
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

// A distinct body per URL so each posting fingerprints differently, like real
// distinct scans. observeFulton reads resp.arrayBuffer() and runs sha256Hex on
// the resulting bytes, so a string body hashes exactly like real PDF bytes. The
// padding keeps it over observeFulton's 1000-byte error-stub floor (a real scan
// is ~MBs).
function pdfBody(url: string): string {
  return "PDFBYTES::" + url + "\n" + "x".repeat(1100)
}

function respond(url: string): Response {
  if (/\.pdf$/i.test(url)) {
    return new Response(pdfBody(url), { status: 200 })
  }
  // The tax-sales page: one upcoming (Aug 4) + past + noise.
  return new Response(
    page([HREF_WATER, HREF_AUG, HREF_FEB, HREF_UNDATED, HREF_EXCESS]),
    { status: 200, headers: { "content-type": "text/html" } },
  )
}

Deno.test("observeSource(fulton) yields one existence-only observation for the upcoming sale", async () => {
  await withStubbedFetch(respond, async () => {
    const obs = await observeSource(FULTON, NOW)
    assertEquals(obs.emptyOk, false)
    assertEquals(obs.notes, [])
    assertEquals(obs.dates.length, 1)
    const d = obs.dates[0]
    assertEquals(d.auctionDate, "2026-08-04")
    assertEquals(d.parcelIds, []) // image-only scan — no parcels
    assertEquals(d.rows, [])
    assert(d.sourceRef && /#sha256:[0-9a-f]{16}$/.test(d.sourceRef))
    assertEquals(
      d.sourceUrl,
      "https://fultoncountyga.gov" + HREF_AUG,
    )
  })
})

Deno.test("observeSource(fulton) is DETERMINISTIC across runs (no key/fingerprint drift)", async () => {
  // The single correctness risk for an image-PDF existence source: if the
  // (county,date) key or fingerprint drifts run-to-run, every run looks like
  // new_date + date_removed and the diff never converges. Same input → byte-
  // identical observation.
  let first: string | undefined
  await withStubbedFetch(respond, async () => {
    first = JSON.stringify(await observeSource(FULTON, NOW))
  })
  let second: string | undefined
  await withStubbedFetch(respond, async () => {
    second = JSON.stringify(await observeSource(FULTON, NOW))
  })
  assertEquals(first, second)
})

Deno.test("observeSource(fulton) merges two postings of one sale into a stable joined fingerprint", async () => {
  const handler = (url: string): Response => {
    if (/\.pdf$/i.test(url)) return new Response(pdfBody(url), { status: 200 })
    return new Response(page([HREF_AUG, HREF_AUG_2ND]), {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }
  await withStubbedFetch(handler, async () => {
    const obs = await observeSource(FULTON, NOW)
    assertEquals(obs.dates.length, 1)
    const ref = obs.dates[0].sourceRef ?? ""
    assertEquals(ref.split("|").length, 2) // both postings fingerprinted
    assert(ref.includes("1st-Posting") && ref.includes("2nd-Posting"))
  })
})

Deno.test("observeSource(fulton) reports between-sales as emptyOk with no dates", async () => {
  const handler = (url: string): Response => {
    if (/\.pdf$/i.test(url)) return new Response(pdfBody(url), { status: 200 })
    return new Response(page([HREF_FEB, HREF_UNDATED]), {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }
  await withStubbedFetch(handler, async () => {
    const obs = await observeSource(FULTON, NOW)
    assertEquals(obs.emptyOk, true)
    assertEquals(obs.dates, [])
  })
})

Deno.test("observeSource(fulton) throws when the page has no tax-sale PDFs (layout changed)", async () => {
  const handler = (url: string): Response => {
    if (/\.pdf$/i.test(url)) return new Response(pdfBody(url), { status: 200 })
    return new Response(page([HREF_WATER]), {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }
  await withStubbedFetch(handler, async () => {
    await assertRejects(
      () => observeSource(FULTON, NOW),
      Error,
      "layout changed",
    )
  })
})

async function fultonRefFor(hrefs: string[]): Promise<string> {
  const handler = (url: string): Response => {
    if (/\.pdf/i.test(url)) return new Response(pdfBody(url), { status: 200 })
    return new Response(page(hrefs), {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }
  let ref = ""
  await withStubbedFetch(handler, async () => {
    ref = (await observeSource(FULTON, NOW)).dates[0]?.sourceRef ?? ""
  })
  return ref
}

Deno.test("observeSource(fulton) fingerprint is STABLE under posting DOM reorder", async () => {
  // The determinism guard: a CMS reordering the two postings in the DOM must
  // NOT change sourceRef (observeFulton sorts postings before joining). Without
  // the sort this fires spurious 'changed' alerts on every reorder.
  const inOrder = await fultonRefFor([HREF_AUG, HREF_AUG_2ND])
  const reversed = await fultonRefFor([HREF_AUG_2ND, HREF_AUG])
  assertEquals(inOrder, reversed)
  assertEquals(inOrder.split("|").length, 2)
})

Deno.test("observeSource(fulton) fingerprint is SENSITIVE to a new posting", async () => {
  // Adding a 2nd posting must change sourceRef → diff.ts fires 'listing file
  // replaced'. Proves the fingerprint actually detects updates.
  const one = await fultonRefFor([HREF_AUG])
  const two = await fultonRefFor([HREF_AUG, HREF_AUG_2ND])
  assert(one !== two)
})

Deno.test("observeSource(fulton) fingerprint is SENSITIVE to in-place byte changes", async () => {
  // Same posting URL, different scan bytes across two runs (a re-upload under
  // the same filename) must change sourceRef.
  let rev = 0
  const handler = (url: string): Response => {
    if (/\.pdf/i.test(url)) {
      return new Response("SCAN-v" + rev + "::" + url + "x".repeat(1100), { status: 200 })
    }
    return new Response(page([HREF_AUG]), {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }
  let first = "", second = ""
  await withStubbedFetch(handler, async () => {
    first = (await observeSource(FULTON, NOW)).dates[0].sourceRef ?? ""
    rev = 1
    second = (await observeSource(FULTON, NOW)).dates[0].sourceRef ?? ""
  })
  assert(first !== second)
})

Deno.test("observeSource(fulton) strips the ?t= cache-buster from ref and url", async () => {
  const busted = HREF_AUG + "?t=1699999999"
  const handler = (url: string): Response => {
    if (/\.pdf/i.test(url)) return new Response(pdfBody(url), { status: 200 })
    return new Response(page([busted]), {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }
  await withStubbedFetch(handler, async () => {
    const d = (await observeSource(FULTON, NOW)).dates[0]
    assert(!d.sourceRef?.includes("?t="))
    assert(!d.sourceUrl?.includes("?t="))
  })
})

// ── DeKalb domain migration (2026-07-19): fallback URL handling ──────────────
// The county moved dekalbtax.org → dekalbtaxga.gov; the observer tries the new
// host first and falls back to the legacy one, noting which actually served.

const DEKALB: Source = {
  county: "DeKalb",
  kind: "dekalb",
  url: "https://publicaccess.dekalbtaxga.gov/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
  fallbackUrls: [
    "https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
  ],
  subscriberEligible: true,
}

// Minimal listing row matching the positional contract: >=15 cells, DD-MON-YYYY
// date in cell 0, parcel in cell 1, tax due in cell 14. Synthetic values.
function dekalbRow(parcel: string): string {
  const cells = [
    "01-SEP-2026", parcel, "", "SALE-1", "OWNER NAME", "123 MAIN ST",
    "", "", "", "", "", "", "", "", "$1,234.56",
  ]
  return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`
}
const DEKALB_HTML = `<html><body><table>${dekalbRow("12 345 67 890")}${dekalbRow("12 345 67 891")}</table></body></html>`

Deno.test("fetchTextFrom returns the primary with no notes when it succeeds", async () => {
  const got = await fetchTextFrom(["https://a/", "https://b/"], (u) =>
    u === "https://a/" ? Promise.resolve("A") : Promise.reject(new Error("unreachable")))
  assertEquals(got.text, "A")
  assertEquals(got.url, "https://a/")
  assertEquals(got.notes, [])
})

Deno.test("fetchTextFrom serves the fallback and notes the primary failure", async () => {
  const got = await fetchTextFrom(["https://a/", "https://b/"], (u) =>
    u === "https://b/" ? Promise.resolve("B") : Promise.reject(new Error("HTTP 503")))
  assertEquals(got.text, "B")
  assertEquals(got.url, "https://b/")
  assertEquals(got.notes.length, 1)
  assert(got.notes[0].includes("https://a/"))
  assert(got.notes[0].includes("HTTP 503"))
  assert(got.notes[0].includes("https://b/"))
})

Deno.test("fetchTextFrom rejects naming every URL when all fail", async () => {
  await assertRejects(
    () => fetchTextFrom(["https://a/", "https://b/"], () => Promise.reject(new Error("dns fail"))),
    Error,
    "https://b/",
  )
})

// ── Acknowledged outages (2026-07-21): expiry semantics ──────────────────────
// An ack silences a KNOWN external outage until its `until` date (exclusive),
// then re-arms. The routing itself lives in index.ts collectEvents; the
// date logic is this pure helper.

Deno.test("activeAcknowledgedOutage is null when no ack is configured", () => {
  assertEquals(activeAcknowledgedOutage(DEKALB, "2026-07-21"), null)
})

Deno.test("activeAcknowledgedOutage returns the ack strictly before its until date", () => {
  const acked: Source = {
    ...DEKALB,
    acknowledgedOutage: { until: "2026-07-28", reason: "county DNS broken" },
  }
  assertEquals(activeAcknowledgedOutage(acked, "2026-07-21")?.reason, "county DNS broken")
  assertEquals(activeAcknowledgedOutage(acked, "2026-07-27")?.until, "2026-07-28")
})

Deno.test("activeAcknowledgedOutage expires on the until date — loud again", () => {
  const acked: Source = {
    ...DEKALB,
    acknowledgedOutage: { until: "2026-07-28", reason: "county DNS broken" },
  }
  assertEquals(activeAcknowledgedOutage(acked, "2026-07-28"), null)
  assertEquals(activeAcknowledgedOutage(acked, "2026-08-01"), null)
})

Deno.test("observeSource(dekalb) serves from the legacy host when the new domain is down", async () => {
  const handler = (url: string): Response =>
    url.startsWith("https://publicaccess.dekalbtaxga.gov/")
      ? new Response("Service Unavailable", { status: 503 })
      : new Response(DEKALB_HTML, { status: 200, headers: { "content-type": "text/html" } })
  await withStubbedFetch(handler, async () => {
    const obs = await observeSource(DEKALB, NOW)
    assertEquals(obs.dates.length, 1)
    assertEquals(obs.dates[0].auctionDate, "2026-09-01")
    assertEquals(obs.dates[0].parcelIds.length, 2)
    assertEquals(obs.dates[0].sourceUrl, DEKALB.fallbackUrls![0])
    assertEquals(obs.notes.length, 1)
    assert(obs.notes[0].includes("fallback"))
  })
})

Deno.test("observeSource(dekalb) uses the new domain silently when it answers", async () => {
  const handler = (): Response =>
    new Response(DEKALB_HTML, { status: 200, headers: { "content-type": "text/html" } })
  await withStubbedFetch(handler, async () => {
    const obs = await observeSource(DEKALB, NOW)
    assertEquals(obs.dates[0].sourceUrl, DEKALB.url)
    assertEquals(obs.notes, [])
  })
})
