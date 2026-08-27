// Georgia tax-deed redemption math — the pure core behind the public
// /tools/redemption-calculator lead magnet.
//
// Model (simplified, general Georgia rule — the page carries the disclaimer):
//   • The redeeming owner pays the tax-sale purchase price plus a premium of
//     20% for the FIRST year or fraction thereof, and 10% for EACH additional
//     year or fraction thereof. Any partial year counts as a whole year.
//   • Recoverable extras (taxes the investor paid after the sale, certain
//     costs/notice expenses) exist in the statute but vary by case — the
//     calculator accepts them as one optional "additional recoverable costs"
//     input rather than pretending to model them.
//
// Everything here is deterministic and unit-tested; the page is a thin form
// over these functions. This is research math, not legal or investment advice.

export interface RedemptionInput {
  /** Winning bid (purchase price) at the tax sale, in dollars. */
  purchasePrice: number
  /** How long until redemption, in months (any fraction of a year = full year). */
  monthsHeld: number
  /** Optional recoverable extras (post-sale taxes paid, allowable costs). */
  additionalCosts?: number
}

export interface RedemptionResult {
  /** Whole redemption years the premium is computed over (ceil of months/12). */
  premiumYears: number
  /** Total premium rate applied to the purchase price, e.g. 0.30 for year 2. */
  premiumRate: number
  /** Premium dollars on the purchase price. */
  premium: number
  /** What the redeeming owner must pay: price + premium + additional costs. */
  redemptionAmount: number
  /** Investor profit if redeemed: premium (extras are reimbursement, not profit). */
  profit: number
  /** Simple return on the money out the door (price + extras). */
  returnOnCash: number
  /** Annualized over the ACTUAL months held (what the money really earned). */
  annualizedReturn: number
}

const FIRST_YEAR_RATE = 0.2
const ADDITIONAL_YEAR_RATE = 0.1

function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/** Premium rate for a hold of N whole-or-partial years (year 1 = 20%, +10%/yr). */
export function premiumRateForYears(premiumYears: number): number {
  const years = Math.max(1, Math.ceil(premiumYears))
  return FIRST_YEAR_RATE + ADDITIONAL_YEAR_RATE * (years - 1)
}

/**
 * Compute the redemption economics for a Georgia tax-deed purchase.
 * Returns null on nonsensical input (the form validates, this backstops).
 */
export function computeRedemption(input: RedemptionInput): RedemptionResult | null {
  const price = input.purchasePrice
  const months = input.monthsHeld
  const extras = input.additionalCosts ?? 0
  if (!isPositiveFinite(price) || !isPositiveFinite(months)) return null
  if (!Number.isFinite(extras) || extras < 0) return null

  const premiumYears = Math.max(1, Math.ceil(months / 12))
  const premiumRate = premiumRateForYears(premiumYears)
  const premium = price * premiumRate
  const redemptionAmount = price + premium + extras
  const cashOut = price + extras
  const returnOnCash = premium / cashOut
  // Annualize over the real hold: (1 + r)^(12/months) - 1. For months <= 12
  // the premium is fixed at 20%, so a fast redemption is a WIN for the
  // investor — the tool should make that visible.
  const annualizedReturn = Math.pow(1 + returnOnCash, 12 / months) - 1

  return {
    premiumYears,
    premiumRate,
    premium,
    redemptionAmount,
    profit: premium,
    returnOnCash,
    annualizedReturn,
  }
}

export interface MaxBidInput {
  /** Cash the investor is willing to put out the door (bid budget), dollars. */
  targetProfit: number
  /** Months the investor assumes until redemption. */
  monthsHeld: number
}

/**
 * Inverse mode: "I want at least $X of premium profit if the owner redeems —
 * what's the MINIMUM winning bid that yields it?" Because the premium is a
 * percentage of the bid, a target premium implies bid = target / rate.
 */
export function minBidForTargetProfit(input: MaxBidInput): number | null {
  if (!isPositiveFinite(input.targetProfit) || !isPositiveFinite(input.monthsHeld)) return null
  const rate = premiumRateForYears(Math.ceil(input.monthsHeld / 12))
  return input.targetProfit / rate
}

/** "$34,500" — shared formatter so the page and tests agree. */
export function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** "23.4%" */
export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}
