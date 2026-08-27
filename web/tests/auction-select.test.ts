import { describe, it, expect } from 'vitest'
import { pickDefaultEntry } from '@/lib/auction-select'

// minimal index entry; pickDefaultEntry only needs auction_date + total_properties
const e = (auction_date: string, total_properties: number) => ({ auction_date, total_properties })
const TODAY = '2026-06-30'

describe('pickDefaultEntry — 4-tier preference (populated content beats empty placeholders)', () => {
  // TIER A — soonest UPCOMING with deals is the biddable default.
  it('picks the soonest UPCOMING populated auction (tier a)', () => {
    const index = [e('2026-12-01', 10), e('2026-07-15', 12), e('2026-09-01', 8)]
    expect(pickDefaultEntry(index, TODAY).auction_date).toBe('2026-07-15')
  })

  it('treats an auction dated today as upcoming (tier a, today-inclusive)', () => {
    const index = [e('2026-06-02', 5), e(TODAY, 9)]
    expect(pickDefaultEntry(index, TODAY).auction_date).toBe(TODAY)
  })

  it('prefers a biddable UPCOMING auction over a populated past one (tier a beats tier b)', () => {
    const index = [e('2026-06-02', 28), e('2026-08-04', 35)]
    expect(pickDefaultEntry(index, TODAY).auction_date).toBe('2026-08-04')
  })

  // TIER B — CORE BUG: an empty upcoming placeholder must NOT shadow a populated past list.
  it('CORE BUG: empty upcoming + populated past → the populated PAST list (tier b)', () => {
    // A self-declared placeholder (Cobb no_current_sale_list, total=0) used to
    // shadow a populated recent list and render blank. Prefer real content.
    const index = [e('2026-06-02', 28), e('2026-11-03', 0), e('2026-08-04', 0)]
    expect(pickDefaultEntry(index, TODAY).auction_date).toBe('2026-06-02')
  })

  it('all-past-populated is order-independent: date-ascending input → latest populated', () => {
    const index = [e('2026-05-05', 40), e('2026-06-02', 28)]
    expect(pickDefaultEntry(index, TODAY).auction_date).toBe('2026-06-02')
  })

  it('all-past-populated is order-independent: newest-first input → latest populated', () => {
    // proves the fix no longer depends on array order (kills the old index.find bug)
    const index = [e('2026-06-02', 28), e('2026-05-05', 40)]
    expect(pickDefaultEntry(index, TODAY).auction_date).toBe('2026-06-02')
  })

  it('single past populated entry → that entry (tier b)', () => {
    expect(pickDefaultEntry([e('2026-06-02', 28)], TODAY).auction_date).toBe('2026-06-02')
  })

  // TIER C — nearest upcoming EMPTY is a genuine "list drops soon" countdown.
  it('only empty upcoming (no populated content anywhere) → nearest upcoming empty (tier c)', () => {
    const index = [e('2026-07-15', 0), e('2026-09-01', 0)]
    expect(pickDefaultEntry(index, TODAY).auction_date).toBe('2026-07-15')
  })

  it('all empty, some upcoming → nearest upcoming empty (tier c)', () => {
    const index = [e('2026-06-02', 0), e('2026-08-04', 0)]
    expect(pickDefaultEntry(index, TODAY).auction_date).toBe('2026-08-04')
  })

  // TIER D — newest-overall fallback (all past, all empty).
  it('all past and all empty → newest overall (tier d)', () => {
    const index = [e('2026-06-02', 0), e('2026-05-05', 0)]
    expect(pickDefaultEntry(index, TODAY).auction_date).toBe('2026-06-02')
  })

  it('single empty entry → that entry, never undefined, never throws', () => {
    expect(pickDefaultEntry([e('2026-11-03', 0)], TODAY).auction_date).toBe('2026-11-03')
  })

  // EMPTY-INDEX GUARD — fail loud instead of returning undefined-as-T.
  it('empty index → throws "pickDefaultEntry: empty index"', () => {
    expect(() => pickDefaultEntry([], TODAY)).toThrow('pickDefaultEntry: empty index')
  })
})
