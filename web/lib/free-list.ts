// Pure teaser-shaping helpers for the public /free-list/[county] lead-magnet
// pages (auction-day distribution channel).
//
// SECURITY MODEL — same principle as /api/data/[county]'s lockProperty():
// masking happens SERVER-SIDE and the masked value is the ONLY value that ever
// reaches the client. There is nothing to "un-blur" in the DOM. These functions
// are pure (no fs, no supabase) so they are unit-testable and safe to import
// from both server components and tests.
//
// What the teaser shows vs. hides:
//   SHOWN  — street NAME (number redacted), city/state, property type, taxes
//            due (already public on the county's own list), estimated-value
//            BAND (never the exact ARV), masked parcel prefix.
//   HIDDEN — exact ARV / land value, deal score, ROI, max bid, comps, owner
//            PII, full parcel, street number. That is the paid product.

export const FREE_LIST_COUNTIES = ['dekalb', 'gwinnett', 'clayton'] as const
export type FreeListCounty = (typeof FREE_LIST_COUNTIES)[number]

// Where site chrome (navbar) points when it links "the" free list. Keep this
// on the county with the NEAREST upcoming auction — urgency converts. Update
// as auction cycles roll (Gwinnett Aug 4 → DeKalb Sep 1 after that sale).
export const DEFAULT_FREE_LIST_COUNTY: FreeListCounty = 'gwinnett'

export function isFreeListCounty(slug: string): slug is FreeListCounty {
  return (FREE_LIST_COUNTIES as readonly string[]).includes(slug)
}

export const COUNTY_LABELS: Record<FreeListCounty, string> = {
  dekalb: 'DeKalb County',
  gwinnett: 'Gwinnett County',
  clayton: 'Clayton County',
}

// How many masked rows the teaser serves at most. Big enough to demonstrate
// data quality, small enough that the full list is still the product.
export const TEASER_ROW_LIMIT = 50

// deal_score >= this counts as a "strong deal" in the aggregate hero stat.
// Aggregate COUNTS are safe to publish — they never identify which rows.
export const STRONG_DEAL_SCORE = 75

// The complete shape a teaser row is allowed to carry. Rows are constructed
// field-by-field (never spread from the raw pipeline object), so a new
// pipeline field can never leak here by accident.
export interface TeaserRow {
  parcelMasked: string
  addressMasked: string
  city: string | null
  state: string | null
  propertyType: string | null
  taxDue: number | null
  valueBand: string | null
}

export interface TeaserStats {
  totalProperties: number
  strongDeals: number
}

const MASK = '•••'

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Redact every digit run in an address so the street NAME survives but the
// house/unit number does not ("4036 SMITHFIELD TRL" -> "••• SMITHFIELD TRL",
// "241 MAYNARD TER 25" -> "••• MAYNARD TER •••"). A fixed-width mask is used
// so even the digit COUNT of the number does not leak.
export function maskAddress(address: unknown, owner?: unknown): string {
  const raw = str(address)
  if (!raw) return '—'
  const scrubbed = scrubNamePrefix(scrubEntityPrefix(scrubOwnerName(raw, owner)))
  if (!scrubbed) return '—'
  return scrubbed.replace(/\d+/g, MASK).replace(/\s{2,}/g, ' ').trim() || '—'
}

// County lists sometimes prefix the situs street with the owning ENTITY's name
// even when the separate owner field is empty (real examples in the Gwinnett
// 8/4 dataset: "SHACKELFORD PROPERTIES LLC GA HWY 124", "SPRING SWALLOW LODGE
// LLC JIMMY CARTER BLVD"). Strip everything through the LAST strong entity
// token so only the street survives. Tokens are deliberately narrow (LLC/INC/
// CORP/…) — words like TRUST or ESTATES appear in legitimate street names.
const ENTITY_TOKEN_RE = /\b(?:LLC|L\.L\.C\.?|INC|CORP|CORPORATION|LTD|LLP)\b\.?/gi

function scrubEntityPrefix(address: string): string {
  let lastEnd = -1
  for (const m of address.matchAll(ENTITY_TOKEN_RE)) {
    lastEnd = (m.index ?? 0) + m[0].length
  }
  if (lastEnd === -1) return address
  return address.slice(lastEnd).trim()
}

// PERSON owner names have no entity token to key on ("SPENCER VIVIAN 2191
// ROCKBRIDGE RD", "KUN WOO RHEE LIVING TRUST 840 RIVERDANCE DR 4" — real
// Gwinnett 8/4 shapes). Normal situs addresses START with the house number, so
// leading words followed by a digit run WITH a street after it are an owner
// prefix — drop them. Highway/route addresses whose only digits TRAIL the name
// ("GA HWY 124") are kept: there the digits are the route/number, not a house
// number separating owner from street. Fail-safe direction: over-masking loses
// a little context; under-masking prints a person's name on a public page.
function scrubNamePrefix(address: string): string {
  const trimmed = address.trim()
  if (!/\d/.test(trimmed) || /^\d/.test(trimmed)) return trimmed
  const firstDigit = trimmed.search(/\d/)
  const fromDigit = trimmed.slice(firstDigit)
  const afterFirstRun = fromDigit.replace(/^[\d-]+/, '')
  if (!/[A-Za-z]/.test(afterFirstRun)) return trimmed // "GA HWY 124" style
  return fromDigit.trim()
}

// Some county lists print the OWNER name inside the address field when the
// situs address is missing (e.g. "SHACKELFORD PROPERTIES LLC GA HWY 124").
// Owner identity is PII we never ship on any tier (see /api/data PII_FIELDS),
// so strip it out of the public teaser string too.
function scrubOwnerName(address: string, owner: unknown): string {
  const o = str(owner)
  if (!o || o.length < 4) return address
  const idx = address.toUpperCase().indexOf(o.toUpperCase())
  if (idx === -1) return address
  return (address.slice(0, idx) + address.slice(idx + o.length)).trim()
}

// Keep only a short prefix of the parcel/tax id ("15 021 08 023" ->
// "15 ••• ••• •••", "R4321 320" -> "R4••• •••"). Enough to look real, not
// enough to look the parcel up on the county's site.
export function maskParcel(taxId: unknown): string {
  const raw = str(taxId)
  if (!raw) return '—'
  const tokens = raw.split(/\s+/)
  const head = tokens[0]
  const maskedHead = head.length <= 2 ? head : head.slice(0, 2) + MASK
  const rest = tokens.slice(1).map(() => MASK)
  return [maskedHead, ...rest].join(' ')
}

function fmtBandEdge(v: number): string {
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1000)}K`
}

// Collapse an exact estimate into a $50K band ("$300K–$350K"). The band proves
// we HAVE a number without giving the number away.
export function valueBand(value: number | null | undefined): string | null {
  const v = num(value)
  if (v == null || v <= 0) return null
  if (v < 25_000) return 'Under $25K'
  if (v < 50_000) return '$25K–$50K'
  if (v >= 1_000_000) return 'Over $1M'
  const lower = Math.floor(v / 50_000) * 50_000
  return `${fmtBandEdge(lower)}–${fmtBandEdge(lower + 50_000)}`
}

// Best available value estimate for banding: ARV for structures, county land
// value for vacant land. avg_comp_price is deliberately NOT used for land —
// nearby house comps do not price a lot.
function estimatedValue(p: Record<string, unknown>): number | null {
  const arv = num(p.arv)
  if (arv != null && arv > 0) return arv
  const land = num(p.land_value)
  if (land != null && land > 0) return land
  return null
}

// Build the public teaser rows. Rows are sorted by raw parcel id — a NEUTRAL,
// county-assigned order — never by deal score or ROI: publishing the pipeline's
// ranked order would give away which properties our engine likes for free.
export function buildTeaserRows(
  properties: readonly Record<string, unknown>[],
  limit: number = TEASER_ROW_LIMIT,
): TeaserRow[] {
  const sorted = [...properties].sort((a, b) =>
    String(a.tax_id ?? '').localeCompare(String(b.tax_id ?? '')),
  )
  return sorted.slice(0, Math.max(0, limit)).map(p => ({
    parcelMasked: maskParcel(p.tax_id),
    addressMasked: maskAddress(p.full_address, p.owner),
    city: str(p.city),
    state: str(p.state),
    propertyType: str(p.property_type),
    taxDue: num(p.tax_due),
    valueBand: valueBand(estimatedValue(p)),
  }))
}

export function teaserStats(
  properties: readonly Record<string, unknown>[],
): TeaserStats {
  const strongDeals = properties.filter(p => {
    const s = num(p.deal_score)
    return s != null && s >= STRONG_DEAL_SCORE
  }).length
  return { totalProperties: properties.length, strongDeals }
}

// Absolute "Data as of" date for the freshness stamp. Mirrors the dashboard
// header stamp added in PR #17 (web/app/dashboard/DashboardClient.tsx
// formatAsOf) and the mobile DataFreshness formatDate output ("May 23, 2026").
// Returns null on missing/unparseable input so the caller can skip the stamp.
export function formatAsOf(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  // Handle compact YYYYMMDD format (e.g. "20260322").
  const normalized = /^\d{8}$/.test(dateStr)
    ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
    : dateStr
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
