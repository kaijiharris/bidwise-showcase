// Canonical web Top-Deal gate (lib/topDeals.ts) — mirror of the Python
// predicate in execution/utils/top_deals.py. Unified public bar (operator
// decision 2026-07-17): ROI >= 100 + confidence requirements, rendered
// FLAG-FIRST from the pipeline-stamped `top_deal` verdict; the client-side
// fallback gate applies only to unstamped archive data.

import { describe, it, expect } from 'vitest'
import {
  TOP_DEAL_MAX_ROI,
  TOP_DEAL_MIN_COMPS,
  TOP_DEAL_MIN_ROI,
  isRankableDeal,
  isTopDeal,
  type RankableDealFields,
} from '@/lib/topDeals'

function sfr(over: Partial<RankableDealFields> = {}): RankableDealFields {
  return {
    roi: 150,
    propType: 'SFR',
    estimateOnly: false,
    isNoBid: false,
    arvConf: 'HIGH',
    comps: 6,
    topDeal: null,
    ...over,
  }
}

describe('isRankableDeal', () => {
  it('ranks a trustworthy residential parcel', () => {
    expect(isRankableDeal(sfr())).toBe(true)
  })

  it('never ranks a parcel without ROI', () => {
    expect(isRankableDeal(sfr({ roi: null }))).toBe(false)
  })

  it('never ranks Vacant Land', () => {
    expect(isRankableDeal(sfr({ propType: 'Vacant Land' }))).toBe(false)
  })

  it('never ranks the land model estimate_only heuristic', () => {
    expect(isRankableDeal(sfr({ estimateOnly: true }))).toBe(false)
  })

  it('never ranks a NO-BID guardrail screen-out', () => {
    expect(isRankableDeal(sfr({ isNoBid: true }))).toBe(false)
  })

  it('never ranks a thin-comp ESTIMATE_ONLY valuation (case-insensitive)', () => {
    expect(isRankableDeal(sfr({ arvConf: 'ESTIMATE_ONLY' }))).toBe(false)
    expect(isRankableDeal(sfr({ arvConf: 'estimate only' }))).toBe(false)
  })
})

describe('isTopDeal — flag-first', () => {
  it('a stamped true verdict wins even when client fields look thin', () => {
    // The pipeline evaluated the FULL gate (incl. server-only arv_source);
    // the client must not second-guess it.
    expect(isTopDeal(sfr({ topDeal: true, comps: 0, arvConf: '' }))).toBe(true)
  })

  it('a stamped false verdict wins even when client numbers look great', () => {
    expect(isTopDeal(sfr({ topDeal: false, roi: 195 }))).toBe(false)
  })

  it('a masked/absent flag falls back to the client gate', () => {
    expect(isTopDeal(sfr({ topDeal: null }))).toBe(true)
    expect(isTopDeal(sfr({ topDeal: undefined }))).toBe(true)
  })
})

describe('isTopDeal — fallback gate (unstamped archive data)', () => {
  it('pins the unified public bar', () => {
    expect(TOP_DEAL_MIN_ROI).toBe(100)
    expect(TOP_DEAL_MAX_ROI).toBe(200)
    expect(TOP_DEAL_MIN_COMPS).toBe(3)
  })

  it('applies the ROI >= 100 bar inclusively', () => {
    expect(isTopDeal(sfr({ roi: 100 }))).toBe(true)
    expect(isTopDeal(sfr({ roi: 99.9 }))).toBe(false)
  })

  it('over-clamp artifact ROIs never rank', () => {
    expect(isTopDeal(sfr({ roi: 482 }))).toBe(false)
    expect(isTopDeal(sfr({ roi: TOP_DEAL_MAX_ROI }))).toBe(true)
  })

  it('thin comps never top', () => {
    expect(isTopDeal(sfr({ comps: TOP_DEAL_MIN_COMPS - 1 }))).toBe(false)
    expect(isTopDeal(sfr({ comps: TOP_DEAL_MIN_COMPS }))).toBe(true)
  })

  it('the LOW dispersion tier never tops (case/format-insensitive)', () => {
    expect(isTopDeal(sfr({ arvConf: 'LOW' }))).toBe(false)
    expect(isTopDeal(sfr({ arvConf: 'low' }))).toBe(false)
    expect(isTopDeal(sfr({ arvConf: 'MEDIUM' }))).toBe(true)
  })

  it('an untrustworthy parcel never tops regardless of ROI', () => {
    expect(isTopDeal(sfr({ roi: 195, isNoBid: true }))).toBe(false)
    expect(isTopDeal(sfr({ roi: 195, arvConf: 'ESTIMATE_ONLY' }))).toBe(false)
  })
})
