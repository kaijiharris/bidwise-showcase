// Tests the MOBILE date helpers in mobile/lib/format.ts from the web vitest
// harness. The mobile app has no test runner of its own, and that module is
// dependency-free TypeScript, so importing it across the package boundary is
// safe and beats leaving date math untested. If mobile ever gains its own
// harness, move this file there. (The web CI job installs mobile's deps for
// exactly this import — see the comment in .github/workflows/ci.yml.)
//
// Both suites below defend the same lesson from opposite directions: a
// date-only string is parsed as UTC midnight by spec, which is the PREVIOUS day
// in every US timezone. analysisFreshness and formatDate each anchor at local
// noon to avoid it, and each shipped a user-visible wrong date before doing so.
//
// analysisFreshness additionally mirrors web/lib/county-pages.ts `analysisMeta`
// semantics (STALE_ANALYSIS_DAYS, strict `>` at the boundary) so web and mobile
// flip to "as of" framing on the same day — one test pins the two thresholds
// together so they cannot drift apart silently.
import { describe, expect, test } from 'vitest'
import { analysisFreshness, formatDate, STALE_ANALYSIS_DAYS } from '../../mobile/lib/format'
import { STALE_ANALYSIS_DAYS as WEB_STALE_ANALYSIS_DAYS } from '../lib/county-pages'

const noon = (day: string) => new Date(`${day}T12:00:00`)

describe('formatDate', () => {
  // Every one of these rendered a day early before the fix. The detail screen
  // read "Auction · Aug 31, 2026 · in 30 days" for the Sept 1 DeKalb sale,
  // disagreeing with both the countdown beside it and the feed header.
  test.each([
    ['2026-09-01', 'Sep 1, 2026'],
    ['2026-08-04', 'Aug 4, 2026'],
    ['2026-07-07', 'Jul 7, 2026'],
  ])('date-only %s renders as %s, not the day before', (input, expected) => {
    expect(formatDate(input)).toBe(expected)
  })

  test('a Jan 1 auction keeps its YEAR — the worst case of the same bug', () => {
    // UTC-midnight parsing turned this into "Dec 31, 2025".
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026')
  })

  test('input carrying a time is left alone — it is a real instant', () => {
    expect(formatDate('2026-07-12T02:01:51.451578')).toBe('Jul 12, 2026')
  })

  test('missing or unparseable input renders the em dash, never a fake date', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('')).toBe('—')
    expect(formatDate('not-a-date')).toBe('—')
  })
})

describe('analysisFreshness', () => {
  test('fresh analysis reads "Analyzed <date>" (real DeKalb payload shape)', () => {
    expect(analysisFreshness('2026-07-12T02:01:51.451578', noon('2026-07-14'))).toEqual({
      kind: 'fresh',
      label: 'Analyzed Jul 12, 2026',
    })
  })

  test('exactly the threshold is still fresh — mirrors web `>` semantics', () => {
    expect(analysisFreshness('2026-07-12', noon('2026-07-19')).kind).toBe('fresh')
  })

  test('older than the threshold flips to "As of <date>" and reports stale', () => {
    expect(analysisFreshness('2026-07-12', new Date('2026-07-19T12:01:00'))).toEqual({
      kind: 'stale',
      label: 'As of Jul 12, 2026',
    })
  })

  test('a dataset published without analysis_date is "Freshness unknown", not hidden', () => {
    expect(analysisFreshness(null, noon('2026-08-02'))).toEqual({
      kind: 'unknown',
      label: 'Freshness unknown',
    })
  })

  test('garbage input degrades to unknown — never a crash, never a fake date', () => {
    expect(analysisFreshness('not-a-date', noon('2026-08-02')).kind).toBe('unknown')
    expect(analysisFreshness('2026-99-99T00:00:00', noon('2026-08-02')).kind).toBe('unknown')
    expect(analysisFreshness('', noon('2026-08-02')).kind).toBe('unknown')
  })

  test('mobile threshold stays pinned to the web threshold', () => {
    expect(STALE_ANALYSIS_DAYS).toBe(WEB_STALE_ANALYSIS_DAYS)
  })
})
