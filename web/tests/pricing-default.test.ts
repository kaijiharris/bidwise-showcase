import { describe, it, expect } from 'vitest'
import { DEFAULT_BILLING_CYCLE, TIERS } from '@/lib/pricing-data'

describe('DEFAULT_BILLING_CYCLE — pricing page first-paint', () => {
  it('defaults to monthly so first-paint matches the homepage monthly prices', () => {
    // The homepage plan cards render monthly prices ($39/$109/$249). The pricing
    // page must first-paint the same cycle, or a prospect perceives a mismatch
    // between two pages seconds apart (audit M-6 / demo-walk step 3).
    expect(DEFAULT_BILLING_CYCLE).toBe('monthly')
  })

  it('the monthly prices it selects are the homepage figures', () => {
    const monthly = TIERS.map(t => t.monthlyPrice)
    expect(monthly).toEqual([39, 109, 249])
  })
})
