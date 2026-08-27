const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return currency.format(value)
}

/**
 * Compact currency: $331 · $8K · $526.4K · $1.9M.
 *
 * Scaled by hand rather than with `Intl.NumberFormat({notation:'compact'})`.
 * The engine this app ships on drops the `notation` option and honours only the
 * `maximumFractionDigits` beside it, so that formatter emitted "$526,369.6" and
 * "$1,931,307.8" on the deal cards and the analytics tile — an unrounded cent
 * figure that reads as broken software, and wide enough to collide with the edge
 * of a four-metric card. Doing the scaling here makes the output independent of
 * how much of ICU the runtime happens to carry.
 *
 * One decimal at most, and a trailing ".0" is dropped so 8,000 reads "$8K".
 */
export function formatCompactCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'

  const negative = value < 0
  // Round to whole dollars before choosing a tier, so $999.60 lands in the same
  // tier as $1,000 and reads "$1K" rather than "$1,000".
  const abs = Math.round(Math.abs(value))

  const TIERS: { threshold: number; suffix: string }[] = [
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1_000, suffix: 'K' },
  ]
  const tier = TIERS.find((t) => abs >= t.threshold)

  // Below 1K there is no unit to shorten, so render whole dollars — "$331",
  // never "$0.3K".
  if (!tier) return `${negative ? '-' : ''}${currency.format(abs)}`

  let rounded = Math.round((abs / tier.threshold) * 10) / 10
  let suffix = tier.suffix
  // Rounding can push a value up a tier (999,950 → 1000.0K). Promote it so it
  // renders "$1M" rather than "$1000K".
  const next = TIERS[TIERS.indexOf(tier) - 1]
  if (rounded >= 1000 && next) {
    rounded = Math.round((abs / next.threshold) * 10) / 10
    suffix = next.suffix
  }

  const body = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${negative ? '-' : ''}$${body}${suffix}`
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${Math.round(value)}%`
}

/**
 * A calendar date, rendered as "Sep 1, 2026".
 *
 * Date-only input is anchored at LOCAL noon. `new Date('2026-09-01')` is spec'd
 * as UTC midnight, which renders as the PREVIOUS day in every US timezone — so
 * the property detail screen printed "Auction · Aug 31, 2026 · in 30 days" for
 * a September 1 sale, contradicting itself and the feed header one tap away.
 * On a product whose whole promise is per-parcel accuracy, the auction date is
 * the worst possible field to be wrong. `daysUntil` below already guards this;
 * the guard simply never reached here.
 *
 * Input carrying a time (an AI-brief timestamp, `2026-07-12T02:01:51`) keeps
 * native parsing — that is a real instant, and shifting it would be the bug.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const d = new Date(dateOnly ? `${iso}T12:00:00` : iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Whole days from today (local) until a date-only string like "2026-09-01".
 * Returns null for missing/unparseable input, 0 for today, negative for past.
 *
 * Parses date-only strings as LOCAL dates on purpose: `new Date('YYYY-MM-DD')`
 * is spec'd as UTC midnight, which renders as the previous day in any US
 * timezone — an auction dated Sep 1 must never display as "in 36 days" when
 * it is 37, or worse, tag the wrong day as past.
 *
 * Callers MUST hide the tag for null/past/today rather than render "in -3
 * days" — a countdown on an ended auction (Cobb) would imply a live sale.
 */
export function daysUntil(dateOnly: string | null | undefined): number | null {
  if (!dateOnly) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly)
  if (!m) return null
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

export function isNew(createdAt: string, withinDays = 7): boolean {
  const created = new Date(createdAt).getTime()
  if (Number.isNaN(created)) return false
  return Date.now() - created <= withinDays * 24 * 60 * 60 * 1000
}

/**
 * Mirrors web/lib/county-pages.ts STALE_ANALYSIS_DAYS — keep the two in sync
 * (a test pins them together) so web and mobile flip to "as of" framing on the
 * same day. The county keeps revising its list until sale day, so once our
 * snapshot ages past this we stop asserting it as current.
 */
export const STALE_ANALYSIS_DAYS = 7

export interface AnalysisFreshness {
  kind: 'fresh' | 'stale' | 'unknown'
  label: string
}

/**
 * Honest freshness framing for an analysis timestamp (AuctionMeta.generated):
 *
 *   fresh   → "Analyzed Jul 12, 2026"   — within STALE_ANALYSIS_DAYS
 *   stale   → "As of Jul 12, 2026"      — older; callers escalate the tint
 *   unknown → "Freshness unknown"       — missing/unparseable; never hide it
 *
 * Pure and clock-injectable so it is deterministic under test (same approach
 * as web's analysisMeta). Tolerates a full ISO timestamp
 * ("2026-07-12T02:01:51.451578") by reading the date portion, and parses it at
 * local noon so no US timezone can shift the rendered day.
 */
export function analysisFreshness(
  generated: string | null,
  now: Date = new Date()
): AnalysisFreshness {
  const unknown: AnalysisFreshness = { kind: 'unknown', label: 'Freshness unknown' }
  if (!generated) return unknown
  const datePart = generated.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return unknown
  const d = new Date(`${datePart}T12:00:00`)
  if (Number.isNaN(d.getTime())) return unknown
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const ageDays = (now.getTime() - d.getTime()) / 86_400_000
  return ageDays > STALE_ANALYSIS_DAYS
    ? { kind: 'stale', label: `As of ${label}` }
    : { kind: 'fresh', label: `Analyzed ${label}` }
}
