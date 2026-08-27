// supabase/functions/notify-tax-sale/sources.ts
//
// Per-county source observers for the tax-sale watchdog. Each observer fetches
// its county's official listing and returns a uniform SourceObservation:
// one DateObservation per auction date seen, carrying the parcel-ID set (may
// be empty for existence-only sources), display rows for the alert email, and
// a `sourceRef` fingerprint ("<pdf-url>#sha256:<hex16>") for PDF sources so a
// re-uploaded file alerts even when parcel parsing yields nothing.
//
// Source shapes (validated against the live pages 2026-07-02):
//   • DeKalb   — server-generated HTML <table>; positional-regex parse.
//   • Gwinnett — listing is a PDF link on the tax-sales page (link discovery
//     ported from execution/parse_gwinnett.py); PINs parsed from the PDF.
//   • Cobb     — page links a placeholder PDF literally named "There are no
//     Tax Sale parcels at this time.pdf" between sales; a real filename
//     replacing it IS the alert. Its ?t=<timestamp> cache-buster is stripped
//     from the fingerprint. The <a> tag uses `href= "` (space) — the anchor
//     regex must tolerate that.
//   • Clayton  — month-named PDFs (july_2026_tax_sale.pdf) under an
//     unlistable directory; probed by generating candidate names for the
//     next 6 months. Parcels + sale date parsed from the PDF text.
//   • Fulton   — monthly Sheriff "levy sale" lists linked from the tax-sales
//     page as SCANNED image-only PDFs (no extractable text). Existence +
//     fingerprint only, like Cobb; the sale date is read from the FILENAME
//     ("…August-4-2026…"), and only today-or-later sales are kept.

import {
  extractPdfTextVariants,
  firstTuesdayIso,
  longDateToIso,
  modeSlashDateToIso,
  monthName,
  monthYearFromText,
  nextFirstTuesdayIso,
  sha256Hex,
} from "./pdf.ts"

// ── Contract ─────────────────────────────────────────────────────────────────

export interface ParsedRow {
  auctionDate: string | null // ISO yyyy-mm-dd (only DeKalb rows carry it)
  parcelId: string
  saleId: string
  owner: string
  address: string
  taxDue: string
}

export interface DateObservation {
  auctionDate: string // ISO yyyy-mm-dd — the (county, date) snapshot key
  parcelIds: string[] // sorted unique; [] = existence-only (fingerprint diff)
  rows: ParsedRow[] // for the alert email body
  sourceRef: string | null // stable fingerprint for PDF sources
  sourceUrl: string | null // clickable listing URL for the alert
}

export interface SourceObservation {
  dates: DateObservation[]
  // true → an empty `dates` is a legitimate "no sale scheduled" state
  // (Cobb placeholder, Clayton with no month PDF up), NOT a transient failure.
  emptyOk: boolean
  notes: string[] // non-fatal oddities, surfaced into the run's errors list
}

export type SourceKind = "dekalb" | "gwinnett" | "cobb" | "clayton" | "fulton"

// A known, operator-acknowledged source outage. While `until` (ISO date,
// exclusive) is in the future, this source's fetch/parse failures are recorded
// as acknowledged_outages instead of errors, so the daily watchdog-health
// alarm stays quiet for THIS source but keeps firing for any other source
// that breaks. On/after `until` the ack expires and failures are loud again —
// an ack can defer an alarm, never bury one. Success always wins: the moment
// the source serves again, normal observation (and diffing) resumes.
export interface AcknowledgedOutage {
  until: string // ISO yyyy-mm-dd, exclusive — loud again from this date
  reason: string
}

// Pure so it's unit-testable: an ack is active strictly before its
// `until` date (ISO strings compare lexicographically).
export function activeAcknowledgedOutage(
  src: Source,
  todayIso: string,
): AcknowledgedOutage | null {
  const ack = src.acknowledgedOutage
  return ack && todayIso < ack.until ? ack : null
}

export interface Source {
  county: string
  kind: SourceKind
  url: string
  // Extra URLs tried in order when `url` fails (fetch error or non-OK after
  // retries). For domain migrations where the county's old host may recover,
  // serve stale, or die entirely while the new one propagates.
  fallbackUrls?: string[]
  // Route this source's failures out of the watchdog error alarm until the
  // ack expires. Only for outages the operator has verified are external and
  // unfixable from our side (see AcknowledgedOutage above).
  acknowledgedOutage?: AcknowledgedOutage
  // Customer fan-out gate. A source is ALWAYS watched and operator-alerted;
  // only when this is explicitly `true` do its NEW_LIST/CANCELLED events reach
  // paying subscribers. Omit (or set false) to monitor a county internally
  // while it is still dark to customers — e.g. a county not yet on the public
  // site, or one whose lists are existence-only (no scored deals to promise).
  // Safe-by-default: a new source is customer-dark until this is set.
  subscriberEligible?: boolean
}

export const SOURCES: Source[] = [
  {
    // DeKalb migrated dekalbtax.org → dekalbtaxga.gov (observed 2026-07-19).
    // The new site's own listing link points at publicaccess.dekalbtaxga.gov,
    // which had no DNS record yet at migration time, while the legacy .org
    // host answered 503 site-wide. Primary = the county's forward direction;
    // legacy host kept as fallback in case it recovers first.
    county: "DeKalb",
    kind: "dekalb",
    url: "https://publicaccess.dekalbtaxga.gov/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
    fallbackUrls: [
      "https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
    ],
    // Verified 2026-07-21: publicaccess.dekalbtaxga.gov is a lame delegation
    // (its Route53 nameservers REFUSE queries — confirmed via Cloudflare and
    // Google DoH, so it resolves nowhere), the legacy host still answers 503
    // site-wide, and the county's own dekalbtaxga.gov/tax-sale-listing/
    // redirect targets the dead host. The listing is unreachable everywhere
    // until DeKalb fixes its DNS zone; nothing on our side can serve it.
    // Expiry 07-28 re-arms the alarm a week before the Aug 4 sale so a
    // still-dead listing gets loud exactly when it starts costing us.
    acknowledgedOutage: {
      until: "2026-07-28",
      reason:
        "county DNS migration broke both listing hosts (new host: lame delegation; legacy host: HTTP 503)",
    },
    subscriberEligible: true,
  },
  {
    county: "Gwinnett",
    kind: "gwinnett",
    url: "https://www.gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales",
    subscriberEligible: true,
  },
  {
    county: "Cobb",
    kind: "cobb",
    url: "https://www.cobbtax.gov/property/tax_sale/index.php",
    subscriberEligible: true,
  },
  {
    county: "Clayton",
    kind: "clayton",
    url: "https://publicaccess.claytoncountyga.gov/content/PDF/",
    subscriberEligible: true,
  },
  {
    // Fulton is WATCHED + operator-alerted, but customer-dark this cycle: its
    // lists are scanned (existence-only, no scored deals) and it is not yet on
    // the public site. Flip subscriberEligible → true when Fulton goes live
    // there (scope: directives/fulton_onboarding_scope.md step D).
    county: "Fulton",
    kind: "fulton",
    url: "https://fultoncountyga.gov/inside-fulton-county/fulton-county-departments/sheriff/tax-sales",
  },
]

// Counties whose alerts may reach paying subscribers (see Source.subscriberEligible).
// index.ts filters the subscriber fan-out through this set so a customer-dark
// county (e.g. Fulton) is still watched and operator-alerted without emailing
// customers about a county with no site presence.
export const SUBSCRIBER_ELIGIBLE_COUNTIES: ReadonlySet<string> = new Set(
  SOURCES.filter((s) => s.subscriberEligible === true).map((s) => s.county),
)

// `now` is injectable purely so date-relative observers (Fulton's upcoming
// filter) are deterministic under test; production callers omit it.
export async function observeSource(
  src: Source,
  now: Date = new Date(),
): Promise<SourceObservation> {
  const obs = await observeByKind(src, now)
  return { ...obs, dates: mergeByDate(obs.dates) }
}

function observeByKind(src: Source, now: Date): Promise<SourceObservation> {
  switch (src.kind) {
    case "dekalb":
      return observeDeKalb(src)
    case "gwinnett":
      return observeGwinnett(src)
    case "cobb":
      return observeCobb(src)
    case "clayton":
      return observeClayton(src)
    case "fulton":
      return observeFulton(src, now)
  }
}

// ── Shared fetch/text helpers ────────────────────────────────────────────────

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { headers: FETCH_HEADERS })
      if (!resp.ok) {
        await resp.body?.cancel()
        throw new Error(`HTTP ${resp.status}`)
      }
      return resp
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(
    `fetch ${url} failed after ${retries} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  )
}

async function fetchText(url: string): Promise<string> {
  return await (await fetchWithRetry(url)).text()
}

// Try each URL in order, returning the first success plus a note when a
// fallback (any URL past the first) served the content. `fetchOne` is
// injectable purely for tests; production callers omit it.
export async function fetchTextFrom(
  urls: string[],
  fetchOne: (url: string) => Promise<string> = fetchText,
): Promise<{ text: string; url: string; notes: string[] }> {
  const failures: string[] = []
  for (const url of urls) {
    try {
      const text = await fetchOne(url)
      const notes =
        failures.length > 0
          ? [`primary URL failed (${failures.join("; ")}); served from fallback ${url}`]
          : []
      return { text, url, notes }
    } catch (e) {
      failures.push(`${url}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`all ${urls.length} source URLs failed: ${failures.join("; ")}`)
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetchWithRetry(url)).arrayBuffer())
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
}

function cleanCell(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (e) => ENTITIES[e] ?? " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim()
}

interface Anchor {
  href: string
  text: string
}

// Tolerates whitespace around `=` (Cobb writes `href= "…"`).
function extractAnchors(html: string): Anchor[] {
  const out: Anchor[] = []
  const re = /<a\s[^>]*?href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    out.push({ href: m[1].trim(), text: cleanCell(m[2]) })
  }
  return out
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function stripQuery(url: string): string {
  return url.split("?")[0]
}

function uniqSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort()
}

function firstNonNull<T>(items: string[], fn: (s: string) => T | null): T | null {
  for (const it of items) {
    const v = fn(it)
    if (v !== null) return v
  }
  return null
}

// Defensive: two observations must never share a (county, auction_date) key —
// a duplicate key in one upsert batch is a Postgres error.
function mergeByDate(dates: DateObservation[]): DateObservation[] {
  const byDate = new Map<string, DateObservation>()
  for (const d of dates) {
    const prev = byDate.get(d.auctionDate)
    if (!prev) {
      byDate.set(d.auctionDate, d)
      continue
    }
    const seen = new Set(prev.rows.map((r) => r.parcelId))
    byDate.set(d.auctionDate, {
      auctionDate: d.auctionDate,
      parcelIds: uniqSorted([...prev.parcelIds, ...d.parcelIds]),
      rows: [...prev.rows, ...d.rows.filter((r) => !seen.has(r.parcelId))],
      sourceRef:
        prev.sourceRef && d.sourceRef && prev.sourceRef !== d.sourceRef
          ? `${prev.sourceRef}|${d.sourceRef}`
          : prev.sourceRef ?? d.sourceRef,
      sourceUrl: prev.sourceUrl ?? d.sourceUrl,
    })
  }
  return [...byDate.values()]
}

// ── DeKalb — HTML table ──────────────────────────────────────────────────────
// Column positions in the "Script output" table (0-indexed):
// 0 Tax Sale Date · 1 Parcel ID · 3 Tax Sale ID · 4 Owner · 5 Address · 14 Total Tax Due
// The page contains the literal string "currently unavailable" even when data
// IS present — maintenance is detected by row-count == 0, never that string.

const DEKALB_COL = { date: 0, parcel: 1, saleId: 3, owner: 4, address: 5, taxDue: 14 } as const
const DEKALB_MIN_CELLS = 15

const MONTHS_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
}

function parseDekalbDate(raw: string): string | null {
  const s = raw.trim()
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/) // 07-JUL-2026
  if (m) {
    const mm = MONTHS_ABBR[m[2].toLowerCase()]
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
  return null
}

// Positional parse: any <tr> whose first <td> is a DD-MON-YYYY date and which
// has >= 15 cells is a property row.
function parseDekalbListing(html: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
  const dateRe = /^\d{1,2}-[A-Za-z]{3}-\d{4}$/

  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells: string[] = []
    let cellMatch: RegExpExecArray | null
    cellRe.lastIndex = 0
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(cleanCell(cellMatch[1]))
    }
    if (cells.length < DEKALB_MIN_CELLS || !dateRe.test(cells[DEKALB_COL.date])) continue

    const parcelId = (cells[DEKALB_COL.parcel] ?? "").trim()
    if (!parcelId) continue

    rows.push({
      auctionDate: parseDekalbDate(cells[DEKALB_COL.date]),
      parcelId,
      saleId: cells[DEKALB_COL.saleId] ?? "",
      owner: cells[DEKALB_COL.owner] ?? "",
      address: cells[DEKALB_COL.address] ?? "",
      taxDue: cells[DEKALB_COL.taxDue] ?? "",
    })
  }
  return rows
}

async function observeDeKalb(src: Source): Promise<SourceObservation> {
  const { text: html, url: servedFrom, notes } = await fetchTextFrom([
    src.url,
    ...(src.fallbackUrls ?? []),
  ])
  const byDate = new Map<string, ParsedRow[]>()
  for (const r of parseDekalbListing(html)) {
    if (!r.auctionDate) continue
    const arr = byDate.get(r.auctionDate) ?? []
    byDate.set(r.auctionDate, [...arr, r])
  }
  const dates = [...byDate.entries()].map(([auctionDate, rows]) => ({
    auctionDate,
    parcelIds: uniqSorted(rows.map((r) => r.parcelId)),
    rows,
    sourceRef: null,
    sourceUrl: servedFrom,
  }))
  return { dates, emptyOk: false, notes }
}

// ── Gwinnett — PDF linked from the tax-sales page ────────────────────────────
// Link discovery ported from execution/parse_gwinnett.py: priority 1 is a link
// whose text/href says "list" AND "tax sale"/"tax-sale" (excluding "results"),
// priority 2 is any /documents/ href containing "tax-sale". Live example:
// href="/documents/d/egov/august-2026-tax-sale-web-list?" text="List of Properties".

const GWINNETT_MIN_PINS = 3 // fewer = extraction failure → fingerprint-only diff
const GWINNETT_PIN_RE = /\bR\d{4}\s?\d{3}[A-Z]?\b/g
const GWINNETT_PIN_LINE_RE = /^R\d{4}\s?\d{3}[A-Z]?$/

function findGwinnettPdfUrl(html: string, pageUrl: string): string {
  const origin = new URL(pageUrl).origin
  const candidates: Array<{ priority: number; href: string }> = []
  for (const a of extractAnchors(html)) {
    const text = a.text.toLowerCase()
    const href = a.href.toLowerCase()
    if (text.includes("result") || href.includes("result")) continue
    const isList = text.includes("list") || href.includes("list")
    const isSale = text.includes("tax sale") || href.includes("tax-sale")
    if (isList && isSale) {
      candidates.push({ priority: 1, href: a.href })
    } else if (href.includes("/documents/") && href.includes("tax-sale")) {
      candidates.push({ priority: 2, href: a.href })
    }
  }
  if (candidates.length === 0) {
    throw new Error("no tax-sale list PDF link found on page")
  }
  const sorted = [...candidates].sort((x, y) => x.priority - y.priority)
  let href = sorted[0].href
  if (href.startsWith("/")) href = origin + href
  href = href.replace(/\?$/, "") // live href ends "…-web-list?"
  if (!href.includes("?download")) {
    href += href.includes("?") ? "&download=true" : "?download=true"
  }
  return href
}

// Decoded text is line-structured: PIN \n OWNER \n ADDRESS \n $AMOUNT.
function gwinnettRowsFromText(text: string): ParsedRow[] {
  const lines = text.split("\n").map((l) => l.trim())
  const out: ParsedRow[] = []
  const seen = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    if (!GWINNETT_PIN_LINE_RE.test(lines[i])) continue
    const parcelId = lines[i].replace(/\s+/g, " ")
    if (seen.has(parcelId)) continue
    seen.add(parcelId)
    const amount = /^\$?[\d,]+\.\d{2}$/.test(lines[i + 3] ?? "") ? lines[i + 3] : ""
    out.push({
      auctionDate: null,
      parcelId,
      saleId: "",
      owner: lines[i + 1] ?? "",
      address: lines[i + 2] ?? "",
      taxDue: amount,
    })
  }
  return out
}

function gwinnettParse(variants: string[]): { pins: string[]; rows: ParsedRow[] } {
  const pinSet = new Set<string>()
  let rows: ParsedRow[] = []
  for (const text of variants) {
    for (const m of text.matchAll(GWINNETT_PIN_RE)) {
      pinSet.add(m[0].replace(/\s+/g, " "))
    }
    const vRows = gwinnettRowsFromText(text)
    if (vRows.length > rows.length) rows = vRows // rows from the best-decoding variant
  }
  return { pins: uniqSorted([...pinSet]), rows }
}

function gwinnettSaleDate(variants: string[], pdfUrl: string): string {
  const fromText = firstNonNull(variants, longDateToIso)
  if (fromText) return fromText
  const my = monthYearFromText(pdfUrl)
  if (my) return firstTuesdayIso(my.year, my.month)
  return nextFirstTuesdayIso(new Date())
}

async function observeGwinnett(src: Source): Promise<SourceObservation> {
  const html = await fetchText(src.url)
  const pdfUrl = findGwinnettPdfUrl(html, src.url)
  const bytes = await fetchBytes(pdfUrl)
  const sha = await sha256Hex(bytes)
  const variants = await extractPdfTextVariants(bytes)
  const { pins, rows } = gwinnettParse(variants)
  const parsed = pins.length >= GWINNETT_MIN_PINS
  const notes = parsed
    ? []
    : [`Gwinnett: only ${pins.length} PINs parsed — falling back to fingerprint diff`]
  return {
    emptyOk: false,
    notes,
    dates: [
      {
        auctionDate: gwinnettSaleDate(variants, pdfUrl),
        parcelIds: parsed ? pins : [],
        rows: parsed ? rows : [],
        sourceRef: `${stripQuery(pdfUrl)}#sha256:${sha.slice(0, 16)}`,
        sourceUrl: pdfUrl,
      },
    ],
  }
}

// ── Cobb — placeholder PDF until a sale is scheduled ─────────────────────────

const COBB_PLACEHOLDER_RE = /no\s+tax\s+sale\s+parcels/i

async function observeCobb(src: Source): Promise<SourceObservation> {
  const html = await fetchText(src.url)
  const base = html.match(/<base\s+href\s*=\s*"([^"]+)"/i)?.[1] ?? new URL(src.url).origin + "/"
  const links = extractAnchors(html).filter((a) => {
    const href = safeDecode(a.href)
    return /\.pdf(\?|$)/i.test(href) && /delinquent/i.test(href) && !/booklet/i.test(href)
  })
  if (links.length === 0) {
    throw new Error("no delinquent-tax PDF link found on page (layout changed?)")
  }
  const real = links.filter((l) => !COBB_PLACEHOLDER_RE.test(safeDecode(l.href)))
  if (real.length === 0) {
    return { emptyOk: true, dates: [], notes: [] } // placeholder up → legitimately no sale
  }
  const link = real[0]
  const pdfUrl = new URL(link.href, base).toString()
  const bytes = await fetchBytes(pdfUrl)
  const sha = await sha256Hex(bytes)
  const variants = await extractPdfTextVariants(bytes)
  const auctionDate =
    longDateToIso(link.text) ??
    firstNonNull(variants, longDateToIso) ??
    firstNonNull(variants, modeSlashDateToIso) ??
    nextFirstTuesdayIso(new Date())
  // Cobb parcel format is unvalidated (no real listing has existed to test
  // against) — existence + content-hash diff only. ?t= cache-buster stripped.
  return {
    emptyOk: false,
    notes: [],
    dates: [
      {
        auctionDate,
        parcelIds: [],
        rows: [],
        sourceRef: `${stripQuery(pdfUrl)}#sha256:${sha.slice(0, 16)}`,
        sourceUrl: stripQuery(pdfUrl),
      },
    ],
  }
}

// ── Clayton — month-named PDFs in an unlistable directory ────────────────────
// Records read "05176A D012 /OWNER NAME"; the slash is the parse anchor. The
// sale date appears as mm/dd/yyyy on every row (mode = sale date).

const CLAYTON_MONTHS_AHEAD = 6
const CLAYTON_PARCEL_RE = /\b(\d{5}[A-Z]?\s+[A-Z]?\d{3,6}[A-Z]?)\s*\/\s*([A-Z][A-Z'’.\- \n]{0,60})?/g

function claytonCandidates(
  now: Date,
  baseUrl: string
): Array<{ url: string; year: number; month: number }> {
  const out: Array<{ url: string; year: number; month: number }> = []
  let y = now.getUTCFullYear()
  let m = now.getUTCMonth() + 1
  for (let i = 0; i < CLAYTON_MONTHS_AHEAD; i++) {
    out.push({ url: `${baseUrl}${monthName(m)}_${y}_tax_sale.pdf`, year: y, month: m })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

function claytonRows(variants: string[]): ParsedRow[] {
  const byId = new Map<string, ParsedRow>()
  for (const text of variants) {
    for (const m of text.matchAll(CLAYTON_PARCEL_RE)) {
      const parcelId = m[1].replace(/\s+/g, " ")
      if (byId.has(parcelId)) continue
      byId.set(parcelId, {
        auctionDate: null,
        parcelId,
        saleId: "",
        owner: (m[2] ?? "").replace(/\s+/g, " ").trim(),
        address: "",
        taxDue: "",
      })
    }
  }
  return [...byId.values()]
}

async function observeClayton(src: Source): Promise<SourceObservation> {
  const dates: DateObservation[] = []
  const notes: string[] = []
  for (const cand of claytonCandidates(new Date(), src.url)) {
    const resp = await fetch(cand.url, { headers: FETCH_HEADERS })
    if (!resp.ok) {
      await resp.body?.cancel()
      // 404 = that month's PDF simply isn't up (normal). Anything else is
      // surfaced as a note, not a failure — other months may still work.
      if (resp.status !== 404) notes.push(`Clayton probe ${cand.url}: HTTP ${resp.status}`)
      continue
    }
    const bytes = new Uint8Array(await resp.arrayBuffer())
    if (bytes.length < 1000) continue // error stub, not a listing
    const sha = await sha256Hex(bytes)
    const variants = await extractPdfTextVariants(bytes)
    const rows = claytonRows(variants)
    dates.push({
      auctionDate:
        firstNonNull(variants, modeSlashDateToIso) ?? firstTuesdayIso(cand.year, cand.month),
      parcelIds: uniqSorted(rows.map((r) => r.parcelId)),
      rows,
      sourceRef: `${cand.url}#sha256:${sha.slice(0, 16)}`,
      sourceUrl: cand.url,
    })
  }
  // No month PDF up at all = legitimate between-sales lull, not a failure.
  return { dates, emptyOk: true, notes }
}

// ── Fulton — image-only Sheriff levy-sale PDFs, existence + fingerprint ──────
// Fulton's Sheriff posts monthly first-Tuesday tax ("levy") sale lists as
// SCANNED, image-only PDFs (zero embedded fonts → extractPdfTextVariants yields
// nothing). So, like Cobb, this is existence + content-fingerprint only — no
// parcel parsing. Two Fulton-specific differences from Cobb:
//   1. The tax-sales page links MANY PDFs at once — every month, multiple
//      "postings" per sale, and prior years — so we keep only sale PDFs whose
//      FILENAME date is today-or-later, emitting one DateObservation per
//      upcoming sale date (all of that date's postings fingerprinted together).
//   2. The scan has no text, so the sale date comes from the FILENAME
//      ("…August-4-2026…" → 2026-08-04). This MUST be deterministic across
//      runs: a run-relative fallback (nextFirstTuesdayIso) would drift the
//      (county,date) key and turn every run into a spurious new_date +
//      date_removed pair, defeating the fingerprint diff. Files with no
//      parseable filename date (posting-date-named artifacts) are skipped,
//      never guessed.

// A Fulton tax-sale document lives under the Sheriff "Tax-Sales" media path.
// Keyed on the PATH, not a filename token, so a renamed list is still caught;
// the excess-funds application and any booklet/instruction docs are excluded.
const FULTON_PATH_RE = /tax-sales/i
const FULTON_EXCLUDE_RE = /excess|application|booklet|instruction|faq/i

// Sale date from the PDF filename (the scan carries no text). Filenames
// hyphen/underscore-separate, so separators are normalized to spaces first.
//   • Primary — a full month-name date ("August 4 2026" → 2026-08-04). Fulton's
//     authoritative levy lists are consistently month-named; the county's
//     explicit day is trusted (it may holiday-shift off the first Tuesday).
//   • Fallback — a numeric "M D YYYY" date, accepted ONLY when it lands on the
//     first Tuesday of its month (the GA sale convention). This lets a
//     numeric-named sale list ("8 4 2026" → Aug 4, a first Tuesday) be tracked
//     while a posting/notice-date artifact ("4 10 2026" → Apr 10, not a first
//     Tuesday) is rejected — no guessing, and no false sale key.
// Null when neither form yields a sale date.
export function fultonSaleDateFromHref(href: string): string | null {
  const name = safeDecode(href.split("/").pop() ?? "").replace(/[-_]+/g, " ")
  const named = longDateToIso(name)
  if (named) return named
  return firstTuesdayNumericDate(name)
}

function firstTuesdayNumericDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{4})\b/) // M D YYYY (US order)
  if (!m) return null
  const month = Number(m[1]), day = Number(m[2]), year = Number(m[3])
  // The first Tuesday is always the 1st–7th; anything past the 7th cannot be a
  // sale date and is almost certainly a posting date — reject before the check.
  if (month < 1 || month > 12 || day < 1 || day > 7) return null
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  return firstTuesdayIso(year, month) === iso ? iso : null
}

// Pure: from the tax-sales page HTML, collect UPCOMING sale PDFs grouped by
// their filename-derived sale date. `todayIso` (yyyy-mm-dd) gates out past
// sales; ISO strings compare chronologically. `sawSalePdf` distinguishes
// "between sales" (candidate PDFs exist but none upcoming → emptyOk) from
// "page layout changed" (no candidate PDFs at all → throw).
export function fultonUpcomingByDate(
  html: string,
  base: string,
  todayIso: string,
): { byDate: Map<string, string[]>; sawSalePdf: boolean } {
  const byDate = new Map<string, string[]>()
  let sawSalePdf = false
  for (const a of extractAnchors(html)) {
    const href = safeDecode(a.href)
    if (!/\.pdf(\?|$)/i.test(href)) continue
    if (!FULTON_PATH_RE.test(href) || FULTON_EXCLUDE_RE.test(href)) continue
    sawSalePdf = true
    const date = fultonSaleDateFromHref(href)
    if (date === null || date < todayIso) continue // undated artifact or past sale
    let abs: string
    try {
      abs = new URL(a.href, base).toString() // may throw on a malformed href
    } catch {
      continue
    }
    const arr = byDate.get(date) ?? []
    if (!arr.includes(abs)) arr.push(abs)
    byDate.set(date, arr)
  }
  return { byDate, sawSalePdf }
}

async function observeFulton(
  src: Source,
  now: Date,
): Promise<SourceObservation> {
  const html = await fetchText(src.url)
  const base = fultonBaseUrl(html, src.url)
  const todayIso = now.toISOString().slice(0, 10)
  const { byDate, sawSalePdf } = fultonUpcomingByDate(html, base, todayIso)

  if (!sawSalePdf) {
    // Not one tax-sale PDF on the page — the layout almost certainly changed.
    throw new Error("no Fulton tax-sale PDF links found on page (layout changed?)")
  }
  if (byDate.size === 0) {
    return { dates: [], emptyOk: true, notes: [] } // between sales — legitimate
  }

  const notes: string[] = []
  const dates: DateObservation[] = []
  for (const [auctionDate, urls] of [...byDate.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  )) {
    // Fingerprint EVERY posting for this date, in a stable order, so a new
    // posting (or an in-place re-upload of the same filename) changes the
    // sourceRef and fires the "listing file replaced" alert.
    const refs: string[] = []
    let firstUrl = ""
    for (const pdfUrl of [...urls].sort()) {
      const bytes = await fetchBytes(pdfUrl)
      if (bytes.length < 1000) {
        // A real scanned list is ~MBs; a sub-KB body is an error stub, not a
        // listing — skip it rather than fingerprint garbage (cf. Clayton).
        notes.push(`Fulton: ${stripQuery(pdfUrl)} returned ${bytes.length} bytes — skipped`)
        continue
      }
      const sha = await sha256Hex(bytes)
      refs.push(`${stripQuery(pdfUrl)}#sha256:${sha.slice(0, 16)}`)
      if (!firstUrl) firstUrl = stripQuery(pdfUrl)
    }
    if (refs.length === 0) continue // every posting for this date was a stub
    dates.push({
      auctionDate,
      parcelIds: [], // image-only scan — existence + fingerprint, no parcels
      rows: [],
      sourceRef: refs.join("|"),
      sourceUrl: firstUrl,
    })
  }
  return { dates, emptyOk: false, notes }
}

// The listing hrefs are root-relative ("/-/media/…"), so the base MUST be an
// absolute URL. Only trust a page <base href> if it parses as absolute — a
// path-only <base href="/"> (some gov CMSs emit one) would make new URL() throw
// on every anchor and fail the whole observation.
function fultonBaseUrl(html: string, pageUrl: string): string {
  const raw = html.match(/<base\s+href\s*=\s*"([^"]+)"/i)?.[1]
  if (raw) {
    try {
      return new URL(raw).toString()
    } catch {
      /* fall through to the page origin */
    }
  }
  return new URL(pageUrl).origin + "/"
}
