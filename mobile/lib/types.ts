// Domain types ported from the web dashboard so mobile is a 1:1 mirror.
// Source-of-truth lives in web/app/dashboard/PropertyDetailPanel.tsx and
// web/app/dashboard/DashboardClient.tsx; keep these aligned.

export type Role = 'admin' | 'client'

export interface UserProfile {
  id: string
  email: string
  role: Role
  full_name: string | null
  county_preference: string | null
}

export type SubscriptionPlan = 'starter' | 'pro' | 'expert'
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
export type BillingCycle = 'monthly' | 'annual'

export interface Subscription {
  id: string
  user_id: string
  plan: SubscriptionPlan
  status: SubscriptionStatus
  billing_cycle: BillingCycle
  trial_end: string | null
  current_period_end: string | null
  stripe_subscription_id: string | null
}

// ─── COUNTY REGISTRY ─────────────────────────────────────────────────────────

export interface County {
  slug: 'dekalb' | 'gwinnett' | 'cobb' | 'clayton'
  name: string
  state: string
  auctionType: string
  nextAuction: string | null
  dataFile: string
}

export const COUNTIES: County[] = [
  {
    slug: 'dekalb',
    name: 'DeKalb County',
    state: 'GA',
    auctionType: 'Tax Deed Sale',
    nextAuction: 'May 5, 2026',
    dataFile: '/data/dekalb.json',
  },
  {
    slug: 'gwinnett',
    name: 'Gwinnett County',
    state: 'GA',
    auctionType: 'Tax Deed Sale',
    nextAuction: 'May 5, 2026',
    dataFile: '/data/gwinnett.json',
  },
  {
    slug: 'cobb',
    name: 'Cobb County',
    state: 'GA',
    auctionType: 'Tax Deed Sale',
    nextAuction: 'May 5, 2026',
    dataFile: '/data/cobb.json',
  },
  {
    // Parity with web: web/lib/county-data.ts KNOWN_COUNTIES includes 'clayton',
    // and the /api/data/<county> endpoints are server-driven, so the slug is all
    // mobile needs. Display metadata mirrors web/app/dashboard/DashboardClient.tsx.
    slug: 'clayton',
    name: 'Clayton County',
    state: 'GA',
    auctionType: 'Tax Deed Sale',
    nextAuction: 'July 7, 2026',
    dataFile: '/data/clayton.json',
  },
]

// ─── AUCTION DATA ────────────────────────────────────────────────────────────

export interface AuctionEntry {
  auction_date: string
  label: string
  file: string
  total_properties: number
  residential: number
  multi_family: number
  commercial: number
  land: number
  top_deals: number
  generated: string
}

export interface CompItem {
  a: string
  d: string
  p: number
  sqft?: number | null
  beds?: number | null
  baths?: number | null
  psf?: number | null
  top5?: boolean
  saleDate?: string
}

export type PropType = 'SFR' | 'Vacant Land' | 'Commercial' | 'Multi-Family' | 'Unknown'

export interface NormalizedProperty {
  id: number
  county: string
  addr: string
  city: string
  zip: string
  propType: PropType
  auctionDate: string | null
  beds: number | null
  baths: number | null
  sqft: number | null
  yearBuilt: number | null
  lotAcres: number | null
  taxDue: number
  rehab: number
  arv: number | null
  countyAppraisedValue: number | null
  landValue: number | null
  landValueSource: string
  landAcreageFlag: string
  asisProfit: number | null
  asisRoi: number | null
  asisAllIn: number | null
  asisSalePrice: number | null
  profit: number | null
  roi: number | null
  score: number | null
  risk: number | null
  allIn: number
  closing: number
  legalClosing: number
  comps: number
  compPoolSize: number
  compQual: string
  arvConf: string
  dataConf: string
  // Pipeline-stamped public Top-Deal verdict (execution/utils/top_deals.py);
  // null on unstamped archive data — the feed falls back to a client gate.
  topDeal: boolean | null
  structureConfirmed: boolean
  dealRating: string
  arvCalc: string
  rehabCalc: string
  rehabNotes: string
  closeCalc: string
  allInCalc: string
  profitCalc: string
  roiCalc: string
  investViability: string
  taxId: string
  recommendedMaxBid: number | null
  assessorAddress: string
  appraisedValue: number | null
  minBid: number | null
  comparables: CompItem[]
  scoreType: 'roi' | 'equity' | 'lot_value' | 'none' | 'N/A' | null
  zillowUrl: string | null
}

export interface AuctionMeta {
  count: number
  generated: string | null
  county: string
  auctionDate: string | null
}

// ─── FEED FILTERS (mobile) ───────────────────────────────────────────────────

export type SortField = 'roi' | 'score' | 'profit' | 'taxDue'

export interface FeedFilter {
  propType: PropType | 'all'
  city: string | null
  search: string
  sortField: SortField
  sortDir: 1 | -1
}

export const DEFAULT_FILTER: FeedFilter = {
  propType: 'all',
  city: null,
  search: '',
  sortField: 'roi',
  sortDir: -1,
}

// ─── PIPELINE ────────────────────────────────────────────────────────────────

export type PipelineStatus = 'watchlist' | 'diligence' | 'bidding' | 'pass'

export const PIPELINE_STATUSES: PipelineStatus[] = ['watchlist', 'diligence', 'bidding', 'pass']

export interface PipelineDeal {
  id: string
  user_id: string
  county: string
  parcel_id: string
  address: string
  city: string | null
  zip: string | null
  auction_date: string | null
  roi: number | null
  deal_score: number | null
  status: PipelineStatus
  notes: string | null
  added_at: string
  updated_at: string
}

// ─── OFF-MARKET LEADS ────────────────────────────────────────────────────────
// Ported from web/types/off-market.ts. Keep aligned with that file.

export type EquityTier =
  | 'HIGH_EQUITY'
  | 'MED_EQUITY'
  | 'LOW_EQUITY'
  | 'UNDERWATER'
  | 'UNKNOWN'

export type DealType =
  | 'flip'
  | 'wholesale'
  | 'rental'
  | 'buy_and_hold'
  | 'distressed'
  | 'unknown'

export type LeadStage =
  | 'new'
  | 'qualified'
  | 'outreach'
  | 'negotiating'
  | 'under_contract'
  | 'closed'
  | 'dead'

export const LEAD_STAGES: LeadStage[] = [
  'new',
  'qualified',
  'outreach',
  'negotiating',
  'under_contract',
  'closed',
  'dead',
]

export type DistressSignal =
  | 'absentee_owner'
  | 'foreclosure'
  | 'lis_pendens'
  | 'open_liens'
  | 'long_held'
  | 'vacant'
  | 'listed'
  | 'tax_delinquent'

export interface OffMarketLead {
  id: string
  user_id: string
  created_at: string
  updated_at: string

  address: string
  city: string | null
  state: string | null
  zip_code: string | null
  county: string | null

  estimated_equity: number | null
  mortgage_balance: number | null
  owner_type: string | null
  years_owned: number | null
  open_liens: number | null
  foreclosure_status: string | null
  listing_status: string | null
  last_sold_price: number | null
  last_sold_date: string | null
  assessed_value: number | null
  tax_amount: number | null
  propstream_found: boolean

  owner_name: string | null
  owner_phone: string | null
  owner_email: string | null
  mailing_address: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  year_built: number | null
  building_sqft: number | null
  beds: number | null
  baths: number | null
  est_value: number | null

  equity_tier: EquityTier | null
  deal_score: number | null
  deal_type: DealType | null
  distress_signals: DistressSignal[]

  propstream_enriched_at: string | null
  propstream_error: string | null
  source: string | null
  batch_id: string | null

  ai_brief: string | null
  ai_brief_generated_at: string | null
}

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

// ── Watchlists ──────────────────────────────────────────────────────────────

export interface WatchlistCriteria {
  equity_min?: number
  deal_types?: DealType[]
  counties?: string[]
  distress_signals?: DistressSignal[]
  max_open_liens?: number
  owner_types?: string[]
  min_years_owned?: number
  min_deal_score?: number
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

export interface LeadPipelineRecord {
  id: string
  user_id: string
  lead_id: string
  created_at: string
  updated_at: string
  stage: LeadStage
  notes: string | null
  // Populated by fetchLeadPipelineWithLead (Supabase join).
  lead?: OffMarketLeadSummary
}

// Deal Desk on mobile mirrors web's 4-column Kanban; 'new'/'closed'/'dead' are
// remapped or filtered out at the UI layer.
export const LEAD_DESK_STAGES: LeadStage[] = [
  'qualified',
  'outreach',
  'negotiating',
  'under_contract',
]

// Display labels — same wording as web (web/types/off-market.ts).
export const EQUITY_TIER_LABELS: Record<EquityTier, string> = {
  HIGH_EQUITY: 'High Equity',
  MED_EQUITY: 'Mid Equity',
  LOW_EQUITY: 'Low Equity',
  UNDERWATER: 'Underwater',
  UNKNOWN: 'Unknown',
}

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  flip: 'Fix & Flip',
  wholesale: 'Wholesale',
  rental: 'Rental',
  buy_and_hold: 'Buy & Hold',
  distressed: 'Distressed',
  unknown: 'Unclassified',
}

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New Lead',
  qualified: 'Qualified',
  outreach: 'In Outreach',
  negotiating: 'Negotiating',
  under_contract: 'Under Contract',
  closed: 'Closed',
  dead: 'Dead',
}

export const DISTRESS_SIGNAL_LABELS: Record<DistressSignal, string> = {
  absentee_owner: 'Absentee',
  foreclosure: 'Foreclosure',
  lis_pendens: 'Lis Pendens',
  open_liens: 'Open Liens',
  long_held: 'Long-Held',
  vacant: 'Vacant',
  listed: 'Listed',
  tax_delinquent: 'Tax Delinquent',
}
