import { TRIAL_DAYS } from './trial'

export type Faq = { q: string; a: string }

export const FAQS: Faq[] = [
  {
    q: 'What does BidWise analyze?',
    a: 'Each month when county auction listings are released, BidWise analyzes every property on the list — pulling comparable sales, public records, and tax history including back-tax depth. Each property receives a deal score and ROI estimate so you can decide quickly whether it is worth pursuing.',
  },
  {
    q: 'What markets and property types are covered?',
    a: 'BidWise focuses on auction properties — tax deed sales, foreclosure auctions, and courthouse steps sales. Geographic coverage expands by county. Off-market and MLS data may be added in the future through compliant, licensed partnerships only.',
  },
  {
    q: 'How accurate are the comparable sales?',
    a: 'Comps are aggregated from public records and third-party real-estate data sources. BidWise applies filters for property type, square footage, and proximity and shows confidence indicators so you know how much weight to place on each comp.',
  },
  {
    q: 'Does BidWise guarantee returns?',
    a: 'No. BidWise is a research and analysis tool. It improves the quality of your inputs — investing still involves real risk. We help you make better-informed decisions. Outcomes are yours.',
  },
  {
    q: 'Why is a credit card required for the trial?',
    a: `To activate a real account, not a limited demo. Your card is not charged until day ${TRIAL_DAYS}. Cancel any time before that with no charge.`,
  },
  {
    q: 'Can I switch plans after signing up?',
    a: 'Yes, any time. Upgrades take effect immediately. Downgrades take effect at the next billing cycle. Annual billing saves roughly 30%.',
  },
  {
    q: 'Where does the data come from?',
    a: 'Property records, tax history, and auction lists come from county and public data feeds. Comparable sales are aggregated from public records and third-party real-estate data sources, then filtered by property type, size, and proximity and shown with confidence indicators so you can weigh each one.',
  },
  {
    q: "I'm a beginner. Will I understand how to use it?",
    a: "Yes. The platform is designed to be usable without a real estate background. Deal scores, rehab estimates, and financials are clearly labeled so you can evaluate properties while still doing your own diligence before bidding.",
  },
  {
    q: 'What counties does BidWise cover today?',
    a: 'BidWise shows counties only when there is an active auction list with analyzed properties available. Current live coverage is DeKalb County (September 1 sale), Gwinnett County (August 4 sale), and Clayton County (August 4 sale). Cobb is tracked and returns as soon as its next property list is posted.',
  },
  {
    q: 'How often is the data updated?',
    a: 'Auction listings refresh monthly when counties publish their schedules. Comparable sales, public records, and tax history pull on demand when a property is analyzed, so you see current information at the moment of decision.',
  },
  {
    q: 'Is there a mobile app?',
    a: 'BidWise is a fully responsive web platform that works on any device. A native iOS and Android app is on the roadmap for 2026. The mobile web experience is fully featured today.',
  },
  {
    q: 'Can I export data for my team or lender?',
    a: 'CSV export is included on the Expert tier for deals your account is entitled to view. Starter and Pro keep the workflow inside BidWise.',
  },
]
