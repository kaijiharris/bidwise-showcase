import { describe, it, expect } from 'vitest'
import {
  premiumRateForYears,
  computeRedemption,
  minBidForTargetProfit,
  fmtUsd,
  fmtPct,
} from '@/lib/redemption'

// The public calculator's math. Georgia's simplified rule: 20% premium for the
// first year OR FRACTION, +10% for each additional year or fraction — partial
// years always round UP. These tests pin that behavior plus the annualization
// direction (faster redemption => higher annualized return).

describe('premiumRateForYears', () => {
  it('is 20% in year one and +10% per additional year', () => {
    expect(premiumRateForYears(1)).toBeCloseTo(0.2)
    expect(premiumRateForYears(2)).toBeCloseTo(0.3)
    expect(premiumRateForYears(3)).toBeCloseTo(0.4)
  })
  it('never drops below the first-year rate', () => {
    expect(premiumRateForYears(0)).toBeCloseTo(0.2)
    expect(premiumRateForYears(-3)).toBeCloseTo(0.2)
  })
})

describe('computeRedemption', () => {
  it('computes the canonical year-one case ($35,000 bid, 12 months)', () => {
    const r = computeRedemption({ purchasePrice: 35_000, monthsHeld: 12 })
    expect(r).not.toBeNull()
    expect(r!.premiumYears).toBe(1)
    expect(r!.premiumRate).toBeCloseTo(0.2)
    expect(r!.premium).toBeCloseTo(7_000)
    expect(r!.redemptionAmount).toBeCloseTo(42_000)
    expect(r!.returnOnCash).toBeCloseTo(0.2)
    // Held exactly a year: annualized == simple return.
    expect(r!.annualizedReturn).toBeCloseTo(0.2)
  })

  it('rounds partial years UP (13 months = 2 premium years at 30%)', () => {
    const r = computeRedemption({ purchasePrice: 10_000, monthsHeld: 13 })
    expect(r!.premiumYears).toBe(2)
    expect(r!.premiumRate).toBeCloseTo(0.3)
    expect(r!.redemptionAmount).toBeCloseTo(13_000)
  })

  it('a fast redemption boosts the ANNUALIZED return (the tool teaching moment)', () => {
    const fast = computeRedemption({ purchasePrice: 20_000, monthsHeld: 3 })!
    const slow = computeRedemption({ purchasePrice: 20_000, monthsHeld: 12 })!
    // Same 20% simple premium either way…
    expect(fast.returnOnCash).toBeCloseTo(slow.returnOnCash)
    // …but the 3-month hold annualizes far higher: (1.2)^4 - 1 ≈ 107%.
    expect(fast.annualizedReturn).toBeCloseTo(Math.pow(1.2, 4) - 1)
    expect(fast.annualizedReturn).toBeGreaterThan(slow.annualizedReturn)
  })

  it('treats additional costs as reimbursed, not profit — they dilute return on cash', () => {
    const r = computeRedemption({ purchasePrice: 10_000, monthsHeld: 12, additionalCosts: 2_000 })!
    expect(r.premium).toBeCloseTo(2_000) // premium on the PRICE only
    expect(r.redemptionAmount).toBeCloseTo(14_000) // price + premium + extras
    expect(r.profit).toBeCloseTo(2_000)
    expect(r.returnOnCash).toBeCloseTo(2_000 / 12_000)
  })

  it.each([
    ['zero price', { purchasePrice: 0, monthsHeld: 12 }],
    ['negative price', { purchasePrice: -5, monthsHeld: 12 }],
    ['zero months', { purchasePrice: 10_000, monthsHeld: 0 }],
    ['NaN price', { purchasePrice: NaN, monthsHeld: 12 }],
    ['negative extras', { purchasePrice: 10_000, monthsHeld: 12, additionalCosts: -1 }],
  ])('returns null on nonsense input (%s)', (_name, input) => {
    expect(computeRedemption(input)).toBeNull()
  })
})

describe('minBidForTargetProfit', () => {
  it('inverts the premium: $10k profit in year one needs a $50k bid', () => {
    expect(minBidForTargetProfit({ targetProfit: 10_000, monthsHeld: 12 })).toBeCloseTo(50_000)
  })
  it('uses the multi-year rate for longer holds ($10k at 30% -> ~$33.3k)', () => {
    expect(minBidForTargetProfit({ targetProfit: 10_000, monthsHeld: 18 })).toBeCloseTo(10_000 / 0.3)
  })
  it('null-guards bad input', () => {
    expect(minBidForTargetProfit({ targetProfit: 0, monthsHeld: 12 })).toBeNull()
    expect(minBidForTargetProfit({ targetProfit: 10_000, monthsHeld: 0 })).toBeNull()
  })
})

describe('formatters', () => {
  it('formats whole-dollar USD and one-decimal percent', () => {
    expect(fmtUsd(42_000)).toBe('$42,000')
    expect(fmtPct(0.2)).toBe('20.0%')
    expect(fmtPct(1.0736)).toBe('107.4%')
  })
})
