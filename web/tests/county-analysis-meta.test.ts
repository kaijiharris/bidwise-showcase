// analysisMeta honesty guard (Cycle 22). The /tax-sale/<county> page must
// attribute its parcel count to the date we analyzed it, not assert it as the
// county's CURRENT list — the county revises the list until sale day and its
// source can be down (DeKalb was 503 for days in July 2026 while the page still
// showed a stale "171 properties on the list"). These tests pin the pure
// date/staleness logic the page copy depends on.
//
// NOW uses no 'Z' so it is parsed in the same (local) zone as analysisMeta's
// internal `${date}T12:00:00`, making the day-difference math exact on any
// runner timezone (both sides are local noon).
import { describe, expect, it } from 'vitest'
import { analysisMeta, STALE_ANALYSIS_DAYS } from '@/lib/county-pages'

const NOW = new Date('2026-07-20T12:00:00')

describe('analysisMeta', () => {
  it('labels and flags the real DeKalb case as stale (8 days old, source down)', () => {
    const m = analysisMeta('2026-07-12T02:01:51.341602', NOW)
    expect(m.analysisDateISO).toBe('2026-07-12')
    expect(m.analysisDateLabel).toBe('July 12, 2026')
    expect(m.analysisStale).toBe(true)
  })

  it('a fresh analysis is labeled but NOT stale', () => {
    const m = analysisMeta('2026-07-19T09:00:00', NOW)
    expect(m.analysisDateLabel).toBe('July 19, 2026')
    expect(m.analysisStale).toBe(false)
  })

  it('exactly STALE_ANALYSIS_DAYS old is not yet stale; one day older is', () => {
    expect(STALE_ANALYSIS_DAYS).toBe(7)
    expect(analysisMeta('2026-07-13', NOW).analysisStale).toBe(false) // 7 days
    expect(analysisMeta('2026-07-12', NOW).analysisStale).toBe(true) //  8 days
  })

  it('accepts a date-only string (no time component)', () => {
    const m = analysisMeta('2026-07-10', NOW)
    expect(m.analysisDateISO).toBe('2026-07-10')
    expect(m.analysisStale).toBe(true)
  })

  it('a future-dated analysis is never stale', () => {
    expect(analysisMeta('2026-08-01', NOW).analysisStale).toBe(false)
  })

  it('null / empty / garbage -> no label, not stale (page falls back to generic copy)', () => {
    for (const bad of [null, '', 'not-a-date', 'xxxx-yy-zz']) {
      const m = analysisMeta(bad as string | null, NOW)
      expect(m.analysisDateISO).toBeNull()
      expect(m.analysisDateLabel).toBeNull()
      expect(m.analysisStale).toBe(false)
    }
  })
})
