export type BillingCycle = 'monthly' | 'annual'

// First-paint billing cycle for /pricing. Kept as monthly so the pricing page's
// initial prices match the homepage plan cards ($39/$109/$249); annual stays one
// toggle-click away. Changing this alone re-defaults the page (audit M-6).
export const DEFAULT_BILLING_CYCLE: BillingCycle = 'monthly'

export type TierFeatures = Record<string, string | boolean>

export type Tier = {
  key: 'starter' | 'pro' | 'expert'
  name: string
  tagline: string
  monthlyPrice: number
  annualPrice: number
  annualMonthly: number
  badge: string | null
  highlight: boolean
  /** Top 4 features shown on the homepage card. Phrasing optimized for scanning. */
  highlights: string[]
  /** Full feature matrix — keys must match FEATURE_GROUPS entries below. */
  features: TierFeatures
}

export const TIERS: Tier[] = [
  {
    key: 'starter',
    name: 'Starter',
    tagline: 'Build your foundation.',
    monthlyPrice: 39,
    annualPrice: 329,
    annualMonthly: 27,
    badge: null,
    highlight: false,
    highlights: [
      '10 auction unlocks per month',
      'Active county auction batches',
      'Deal score + ROI on every listing',
      'Email alerts when new batch drops',
    ],
    features: {
      'Auction listing unlocks': '10 / month across all counties',
      'County coverage': 'Active published lists only',
      'Monthly deal batch': true,
      'Comparable sales': 'Comp support summary',
      'Deal scoring': 'Score + ROI',
      'Off-market deals': false,
      'AI Intel Brief': false,
      'Deal Desk pipeline': false,
      'Saved properties': 'Up to 25 active',
      'Watchlist': false,
      'Auction date alerts': false,
      'New batch email alerts': true,
      'CSV export': false,
      'Help center': true,
      'Email support': false,
      'Priority email support': false,
    },
  },
  {
    key: 'pro',
    name: 'Pro',
    tagline: 'Work faster. Win more.',
    monthlyPrice: 109,
    annualPrice: 899,
    annualMonthly: 75,
    badge: 'Most Popular',
    highlight: true,
    highlights: [
      '25 auction unlocks per month',
      'Advanced comps + confidence',
      '5 off-market unlocks per month',
      'Watchlists + email alerts',
    ],
    features: {
      'Auction listing unlocks': '25 / month across all counties',
      'County coverage': 'Active published lists only',
      'Monthly deal batch': true,
      'Comparable sales': 'Advanced',
      'Deal scoring': 'Full + confidence scores',
      'Off-market deals': '5 unlocks / month',
      'AI Intel Brief': 'For unlocked off-market leads',
      'Deal Desk pipeline': false,
      'Saved properties': 'Unlimited',
      'Watchlist': true,
      'Auction date alerts': 'Included with email alerts',
      'New batch email alerts': true,
      'CSV export': false,
      'Help center': true,
      'Email support': true,
      'Priority email support': false,
    },
  },
  {
    key: 'expert',
    name: 'Expert',
    tagline: 'Your unfair advantage.',
    monthlyPrice: 249,
    annualPrice: 1999,
    annualMonthly: 167,
    badge: null,
    highlight: false,
    highlights: [
      'Unlimited auction unlocks',
      'Deep rehab & hold-cost modeling',
      'Deal Desk + unlimited off-market',
      'CSV export + priority support',
    ],
    features: {
      'Auction listing unlocks': 'Unlimited',
      'County coverage': 'Active published lists only',
      'Monthly deal batch': true,
      'Comparable sales': 'Advanced',
      'Deal scoring': 'Deep + rehab & hold modeling',
      'Off-market deals': 'Unlimited',
      'AI Intel Brief': true,
      'Deal Desk pipeline': true,
      'Saved properties': 'Unlimited',
      'Watchlist': true,
      'Auction date alerts': 'Included with email alerts',
      'New batch email alerts': true,
      'CSV export': 'Unlocked deals',
      'Help center': true,
      'Email support': true,
      'Priority email support': '1-business-day first response',
    },
  },
]

export const FEATURE_GROUPS: Record<string, string[]> = {
  'Auction Deal Feed': [
    'Auction listing unlocks',
    'County coverage',
    'Monthly deal batch',
    'Comparable sales',
    'Deal scoring',
  ],
  'Off-Market Engine': [
    'Off-market deals',
    'AI Intel Brief',
    'Deal Desk pipeline',
  ],
  'Workflow': [
    'Saved properties',
    'Watchlist',
    'Auction date alerts',
    'New batch email alerts',
    'CSV export',
  ],
  'Support & Resources': [
    'Help center',
    'Email support',
    'Priority email support',
  ],
}
