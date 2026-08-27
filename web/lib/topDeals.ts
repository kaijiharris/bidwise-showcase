// Canonical "Top Deal" gate — web mirror of execution/utils/top_deals.py.
// KEEP IN SYNC with the Python module and the mobile feed filter.
//
// RESOLVED 2026-07-17 (operator decision): ONE public bar everywhere —
// ROI >= 100, on a rankable parcel, with confidence requirements (comp-
// evidenced ARV, >= TOP_DEAL_MIN_COMPS comps, not the LOW dispersion tier,
// not an over-clamp artifact ROI). The pipeline summary, the auction-index
// badge, this dashboard, and the mobile feed all use it.
//
// FLAG-FIRST: the pipeline stamps `top_deal` onto every exported record
// (stamp_top_deals) because the full gate reads arv_source, which the data
// API strips for every tier (INTERNAL_SOURCE_FIELDS). A present flag IS the
// verdict. The fallback below applies only to unstamped archive data and
// checks what the client can see — it under-approximates the server gate.

import { isNoBidState } from '@/components/ConfidenceBadge'

export const TOP_DEAL_MIN_ROI = 100
// Mirror of ROI_SANITY_CEILING — over-clamp ROIs are artifacts, not returns.
export const TOP_DEAL_MAX_ROI = 200
export const TOP_DEAL_MIN_COMPS = 3

export interface RankableDealFields {
  roi: number | null
  propType: string
  estimateOnly?: boolean | null
  isNoBid?: boolean | null
  arvConf: string
  comps?: number | null
  topDeal?: boolean | null
}

export function isRankableDeal(p: RankableDealFields): boolean {
  return (
    p.roi != null &&
    p.propType !== 'Vacant Land' &&
    p.estimateOnly !== true &&
    !isNoBidState(p.isNoBid, p.arvConf)
  )
}

// Client-checkable half of the confidence gate (no arv_source on the client).
function isConfidentFallback(p: RankableDealFields): boolean {
  const tier = (p.arvConf || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  return (
    (p.comps ?? 0) >= TOP_DEAL_MIN_COMPS &&
    tier !== 'LOW' &&
    (p.roi ?? 0) <= TOP_DEAL_MAX_ROI
  )
}

export function isTopDeal(
  p: RankableDealFields,
  minRoi: number = TOP_DEAL_MIN_ROI,
): boolean {
  // The pipeline verdict wins whenever present — it evaluated the full gate,
  // including the server-only fields. (Locked records have it masked to null
  // along with roi, so they fall through and fail the rankable check.)
  if (p.topDeal != null) return p.topDeal === true
  return isRankableDeal(p) && (p.roi as number) >= minRoi && isConfidentFallback(p)
}
