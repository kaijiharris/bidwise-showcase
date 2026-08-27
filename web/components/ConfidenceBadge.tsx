// Presentational confidence chip for BidWise deal cards (Wave 3).
//
// Renders a small colored badge from either an ARV confidence tier or a
// score tier (or both). It is *pure* and *null-safe*: given no usable tier it
// renders nothing, so cards built on pre-Wave-1/2 data (which lack these
// fields) look exactly as they did before.
//
// Palette follows PropertyCard's scoreColor conventions:
//   VERIFIED   / HIGH           → emerald
//   PROMISING  / MEDIUM         → amber
//   SPECULATIVE/ LOW            → slate (neutral gray)
//   DISQUALIFIED/ ESTIMATE_ONLY → rose

export type ArvConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'ESTIMATE_ONLY'
export type ScoreTier = 'VERIFIED' | 'PROMISING' | 'SPECULATIVE' | 'DISQUALIFIED'

type BadgeStyle = {
  label: string
  className: string
  title: string
}

// Normalizes free-form tier strings (the pipeline emits upper-, lower-, and
// mixed-case) to the canonical enum so old/dirty data still maps correctly.
function normalize(tier: string): string {
  return tier.trim().toUpperCase().replace(/[\s-]+/g, '_')
}

// Shared NO-BID / ESTIMATE-ONLY predicate. A parcel's ROI/profit numbers are
// untrustworthy when the guardrails screened it out (is_no_bid) OR its value is
// a bare estimate — either the land model's estimate_only flag or a thin-comp
// arv_confidence === 'ESTIMATE_ONLY'. The flag matters on its own: land rows
// carry a graded arv_confidence (often MEDIUM) and, when locked, the _safe view
// masks arv_confidence entirely, so estimate_only is the only reliable signal.
// Every card/row/detail surface routes its ROI display through this so a no-bid
// parcel never shows a misleading return. Null-safe: absent fields → false →
// normal display.
export function isNoBidState(
  isNoBid: boolean | null | undefined,
  arvConfidence: string | null | undefined,
  estimateOnly?: boolean | null,
): boolean {
  return (
    isNoBid === true ||
    estimateOnly === true ||
    normalize(arvConfidence || '') === 'ESTIMATE_ONLY'
  )
}

// The label to show in the suppressed-ROI slot. is_no_bid wins over the softer
// ESTIMATE_ONLY signal.
export function noBidLabel(
  isNoBid: boolean | null | undefined,
  arvConfidence: string | null | undefined,
  estimateOnly?: boolean | null,
): 'NO BID' | 'ESTIMATE ONLY' {
  if (isNoBid === true) return 'NO BID'
  if (estimateOnly === true || normalize(arvConfidence || '') === 'ESTIMATE_ONLY') {
    return 'ESTIMATE ONLY'
  }
  return 'NO BID'
}

// Each palette is dual-theme: a light-mode base (solid tint + darker text, to
// match the dashboard's TypeBadge conventions) with `dark:` overrides that keep
// the translucent dark look used on PropertyCard's pure-dark surface.
const EMERALD = 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30'
const AMBER   = 'bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30'
const SLATE   = 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:ring-white/10'
const ROSE    = 'bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30'

const ARV_STYLES: Record<ArvConfidenceTier, BadgeStyle> = {
  HIGH: {
    label: 'High confidence',
    className: EMERALD,
    title: 'ARV backed by strong, recent comparable sales',
  },
  MEDIUM: {
    label: 'Medium confidence',
    className: AMBER,
    title: 'ARV backed by limited or older comparable sales',
  },
  LOW: {
    label: 'Low confidence',
    className: SLATE,
    title: 'ARV is a rough estimate — few usable comparables',
  },
  ESTIMATE_ONLY: {
    label: 'Estimate only',
    className: ROSE,
    title: 'No reliable comparables — value is an estimate, not a valuation',
  },
}

const SCORE_STYLES: Record<ScoreTier, BadgeStyle> = {
  VERIFIED: {
    label: 'Verified',
    className: EMERALD,
    title: 'Deal score verified against comparable sales',
  },
  PROMISING: {
    label: 'Promising',
    className: AMBER,
    title: 'Promising deal — some assumptions still unverified',
  },
  SPECULATIVE: {
    label: 'Speculative',
    className: SLATE,
    title: 'Speculative — score rests on thin or estimated data',
  },
  DISQUALIFIED: {
    label: 'Disqualified',
    className: ROSE,
    title: 'Screened out by the deal guardrails — do not bid',
  },
}

function resolveStyle(
  arvConfidence: string | null | undefined,
  scoreTier: string | null | undefined,
): BadgeStyle | null {
  // score_tier is the richer signal (it already folds in guardrails), so it
  // wins when both are present.
  if (scoreTier) {
    const key = normalize(scoreTier)
    if (key in SCORE_STYLES) return SCORE_STYLES[key as ScoreTier]
  }
  if (arvConfidence) {
    const key = normalize(arvConfidence)
    if (key in ARV_STYLES) return ARV_STYLES[key as ArvConfidenceTier]
  }
  return null
}

export default function ConfidenceBadge({
  arvConfidence,
  scoreTier,
}: {
  arvConfidence?: string | null
  scoreTier?: string | null
}) {
  const style = resolveStyle(arvConfidence, scoreTier)
  // Graceful degradation: unknown / absent tier renders nothing.
  if (!style) return null

  return (
    <span
      title={style.title}
      className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${style.className}`}
    >
      {style.label}
    </span>
  )
}
