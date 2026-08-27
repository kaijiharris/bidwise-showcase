/**
 * BidWise Off-Market Lead Engine — TypeScript Types
 * ===================================================
 * All types in this file are EXCLUSIVELY for PropStream-sourced
 * off-market leads. These are intentionally kept separate from:
 *   - NormalizedProperty  (auction listings)
 *   - PipelineDeal        (auction pipeline)
 *
 * Import from this file anywhere in the /dashboard/leads/* routes.
 */

// ── Enumerations ──────────────────────────────────────────────────────────────

export type EquityTier =
  | 'HIGH_EQUITY'   // ≥ $100K — strong cash-out candidate
  | 'MED_EQUITY'    // $30K–$100K — deal with right price
  | 'LOW_EQUITY'    // < $30K — thin margin
  | 'UNDERWATER'    // negative equity — avoid
  | 'UNKNOWN'       // PropStream data unavailable

export type DealType =
  | 'flip'
  | 'wholesale'
  | 'rental'
  | 'buy_and_hold'
  | 'distressed'
  | 'unknown'

/**
 * Off-market pipeline stages — entirely separate from the auction PipelineDeal stages.
 * Auction: watchlist | diligence | bidding | pass
 * Off-market: new | qualified | outreach | negotiating | under_contract | closed | dead
 */
export type LeadStage =
  | 'new'
  | 'qualified'
  | 'outreach'
  | 'negotiating'
  | 'under_contract'
  | 'closed'
  | 'dead'

export type DistressSignal =
  | 'absentee_owner'
  | 'foreclosure'
  | 'lis_pendens'
  | 'open_liens'
  | 'long_held'       // owned > 10 years
  | 'vacant'
  | 'listed'          // currently on market (motivated if expired listing)
  | 'tax_delinquent'

// ── Core Lead Record ──────────────────────────────────────────────────────────

export interface OffMarketLead {
  id: string
  user_id: string
  created_at: string
  updated_at: string

  // Address
  address: string
  city: string
  state: string
  zip_code: string
  county: string

  // PropStream enrichment
  estimated_equity: number | null
  mortgage_balance: number | null
  owner_type: string | null        // 'Absentee Owner' | 'Owner Occupied' | null
  years_owned: number | null
  open_liens: number | null
  foreclosure_status: string | null
  listing_status: string | null
  last_sold_price: number | null
  last_sold_date: string | null
  assessed_value: number | null
  tax_amount?: number;

  // New Fields from XLSX Export
  mailing_address?: string;
  mailing_city?: string;
  mailing_state?: string;
  mailing_zip?: string;
  owner_name?: string;
  owner_phone?: string;
  owner_email?: string;
  year_built?: number;
  building_sqft?: number;
  beds?: number;
  baths?: number;
  est_value?: number;

  propstream_found: boolean

  // BidWise scoring
  equity_tier: EquityTier
  deal_score: number               // 0–100
  deal_type: DealType
  distress_signals: DistressSignal[]

  // Enrichment metadata
  propstream_enriched_at: string | null
  propstream_error: string | null
  source: string
  batch_id: string | null

  // AI brief
  ai_brief: string | null
  ai_brief_generated_at: string | null
}

// Lightweight version for list/feed views (no heavy text fields)
export type OffMarketLeadSummary = Pick<
  OffMarketLead,
  | 'id'
  | 'address'
  | 'city'
  | 'state'
  | 'zip_code'
  | 'county'
  | 'estimated_equity'
  | 'owner_type'
  | 'years_owned'
  | 'open_liens'
  | 'foreclosure_status'
  | 'equity_tier'
  | 'deal_score'
  | 'deal_type'
  | 'distress_signals'
  | 'propstream_found'
  | 'created_at'
>

// ── Watchlist ─────────────────────────────────────────────────────────────────

export interface WatchlistCriteria {
  equity_min?: number              // minimum estimated equity in dollars
  deal_types?: DealType[]          // filter to specific deal types
  counties?: string[]              // e.g. ['dekalb', 'gwinnett']
  distress_signals?: DistressSignal[]
  max_open_liens?: number
  owner_types?: string[]           // e.g. ['Absentee Owner']
  min_years_owned?: number
  min_deal_score?: number          // e.g. 60
}

export interface Watchlist {
  id: string
  user_id: string
  created_at: string
  updated_at: string
  name: string
  description: string | null
  criteria: WatchlistCriteria
  alert_email: boolean
  alert_sms: boolean
  is_active: boolean
}

export interface WatchlistLead {
  watchlist_id: string
  lead_id: string
  matched_at: string
  notified: boolean
  // Joined data (when fetched with lead)
  lead?: OffMarketLeadSummary
}

// ── Lead Pipeline ─────────────────────────────────────────────────────────────

export interface LeadActivityEntry {
  at: string          // ISO timestamp
  action: string      // e.g. 'stage_change' | 'note_added' | 'alert_sent'
  from?: string       // previous stage (for stage_change)
  to?: string         // new stage
  by?: string         // user email
  note?: string
}

export interface LeadPipelineRecord {
  id: string
  user_id: string
  lead_id: string
  created_at: string
  updated_at: string
  stage: LeadStage
  notes: string | null
  assigned_to: string | null
  activity_log: LeadActivityEntry[]
  // Joined data
  lead?: OffMarketLeadSummary
}

// ── Display Helpers ───────────────────────────────────────────────────────────

/** Human-readable labels for each equity tier */
export const EQUITY_TIER_LABELS: Record<EquityTier, string> = {
  HIGH_EQUITY: 'High Equity',
  MED_EQUITY:  'Mid Equity',
  LOW_EQUITY:  'Low Equity',
  UNDERWATER:  'Underwater',
  UNKNOWN:     'Unknown',
}

/** Tailwind color classes for equity tier badges */
export const EQUITY_TIER_COLORS: Record<EquityTier, { bg: string; text: string; border: string }> = {
  HIGH_EQUITY: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-700/50' },
  MED_EQUITY:  { bg: 'bg-amber-50 dark:bg-amber-900/30',    text: 'text-amber-700 dark:text-amber-400',    border: 'border-amber-200 dark:border-amber-700/50'   },
  LOW_EQUITY:  { bg: 'bg-orange-50 dark:bg-orange-900/30',  text: 'text-orange-700 dark:text-orange-400',  border: 'border-orange-200 dark:border-orange-700/50' },
  UNDERWATER:  { bg: 'bg-red-50 dark:bg-red-900/30',        text: 'text-red-700 dark:text-red-400',        border: 'border-red-200 dark:border-red-700/50'       },
  UNKNOWN:     { bg: 'bg-slate-100 dark:bg-white/10',       text: 'text-slate-500 dark:text-slate-400',    border: 'border-slate-200 dark:border-white/15'       },
}

/** Human-readable labels for deal types */
export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  flip:         'Fix & Flip',
  wholesale:    'Wholesale',
  rental:       'Rental',
  buy_and_hold: 'Buy & Hold',
  distressed:   'Distressed',
  unknown:      'Unclassified',
}

/** Human-readable labels for pipeline stages */
export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new:             'New Lead',
  qualified:       'Qualified',
  outreach:        'In Outreach',
  negotiating:     'Negotiating',
  under_contract:  'Under Contract',
  closed:          'Closed',
  dead:            'Dead',
}

/** Colors for pipeline stage columns */
export const LEAD_STAGE_COLORS: Record<LeadStage, string> = {
  new:             'text-blue-600 dark:text-blue-400',
  qualified:       'text-indigo-600 dark:text-indigo-400',
  outreach:        'text-violet-600 dark:text-violet-400',
  negotiating:     'text-amber-600 dark:text-amber-400',
  under_contract:  'text-emerald-600 dark:text-emerald-400',
  closed:          'text-emerald-700 dark:text-emerald-300',
  dead:            'text-slate-500 dark:text-slate-400',
}

/** Emoji + label for distress signals shown on lead cards */
export const DISTRESS_SIGNAL_DISPLAY: Record<DistressSignal, { icon: string; label: string }> = {
  absentee_owner: { icon: '🏠', label: 'Absentee' },
  foreclosure:    { icon: '⚖️', label: 'Foreclosure' },
  lis_pendens:    { icon: '📋', label: 'Lis Pendens' },
  open_liens:     { icon: '🔗', label: 'Open Liens' },
  long_held:      { icon: '📅', label: 'Long-Held' },
  vacant:         { icon: '🚪', label: 'Vacant' },
  listed:         { icon: '🏷️', label: 'Listed' },
  tax_delinquent: { icon: '💸', label: 'Tax Delinquent' },
}
