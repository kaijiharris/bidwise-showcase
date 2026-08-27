import { OffMarketLead, EquityTier, DealType, DistressSignal } from '@/types/off-market'

/**
 * BidWise off-market lead scoring.
 *
 * Designed to **spread** 0–100, not pile every motivated lead at the ceiling.
 * The old base-50 + generous-bonuses formula clamped almost every PropStream
 * "motivated seller" upload at 100, making the score useless as a tiebreaker.
 *
 * New scoring scale (rough calibration):
 *   100  exceptional — high equity + multiple distress signals + lis pendens
 *    75  strong candidate (high equity + absentee + active foreclosure)
 *    50  decent (mid equity + at least one signal)
 *    25  weak (low equity, no signals)
 *     0  underwater or hopeless
 */
export function calculateDealScore(data: Partial<OffMarketLead>): {
  score: number;
  deal_type: DealType;
  signals: DistressSignal[];
  equity_tier: EquityTier;
} {
  let score = 0
  const signals: DistressSignal[] = []
  let equity_tier: EquityTier = 'UNKNOWN'

  // 1. Equity tier — the single biggest driver. Bigger spread between tiers.
  const equity = data.estimated_equity
  if (equity !== undefined && equity !== null) {
    if (equity < 0) {
      equity_tier = 'UNDERWATER'
      // No bonus, no penalty — tier itself signals "avoid".
    } else if (equity < 30000) {
      equity_tier = 'LOW_EQUITY'
      score += 10
    } else if (equity < 100000) {
      equity_tier = 'MED_EQUITY'
      score += 25
    } else {
      equity_tier = 'HIGH_EQUITY'
      score += 40
    }
  }

  // 2. Absentee Owner — small but meaningful (motivated seller signal).
  const owner_type = data.owner_type || ''
  if (owner_type.toLowerCase() === 'absentee owner') {
    score += 15
    signals.push('absentee_owner')
  }

  // 3. Foreclosure status — lis_pendens (active legal action) > general foreclosure.
  const foreclosure = data.foreclosure_status || ''
  if (foreclosure && !['none', '', 'n/a'].includes(foreclosure.toLowerCase())) {
    if (foreclosure.toLowerCase().includes('lis pendens')) {
      score += 26
      signals.push('lis_pendens')
    } else {
      score += 18
      signals.push('foreclosure')
    }
  }

  // 4. Open liens — light liens hint at distress; extreme liens hurt deal-ability.
  const liens = data.open_liens
  if (liens && liens > 0) {
    signals.push('open_liens')
    if (liens <= 2) score += 5
    else if (liens <= 5) score += 0
    else score -= 8
  }

  // 5. Years owned — long-held properties have entrenched owners but ripe equity.
  const years = data.years_owned
  if (years && years > 20) {
    score += 12
    signals.push('long_held')
  } else if (years && years > 10) {
    score += 8
    signals.push('long_held')
  }

  // 6. Listing status — already-listed = motivated, but slightly less leverage.
  const listing = data.listing_status || ''
  if (listing && !['none', '', 'n/a'].includes(listing.toLowerCase())) {
    score += 5
    signals.push('listed')
  }

  // Clamp 0..100
  score = Math.max(0, Math.min(100, score))

  // Deal Type Classification — unchanged from original.
  let deal_type: DealType = 'unknown'
  if (['HIGH_EQUITY', 'MED_EQUITY'].includes(equity_tier) && signals.includes('absentee_owner')) {
    deal_type = 'wholesale'
  } else if (equity_tier === 'HIGH_EQUITY' && signals.includes('foreclosure')) {
    deal_type = 'flip'
  } else if (signals.includes('long_held') && signals.includes('absentee_owner')) {
    deal_type = 'rental'
  } else if (score > 70) {
    deal_type = 'flip'
  } else if (signals.includes('lis_pendens') || signals.includes('open_liens')) {
    deal_type = 'distressed'
  }

  return { score, deal_type, signals, equity_tier }
}
