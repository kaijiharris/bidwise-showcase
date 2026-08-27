import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import RevealSection from '@/components/RevealSection'
import ParcelLines from '@/components/blueprint/ParcelLines'
import SheetHeading from '@/components/blueprint/SheetHeading'
import ProcedureStep, { type Procedure } from '@/components/blueprint/ProcedureStep'
import TitleBlock from '@/components/blueprint/TitleBlock'
import DealCardPinned, { type PinnedDeal } from '@/components/blueprint/DealCardPinned'
import { TRIAL_DAYS } from '@/lib/trial'
import {
  Search, BarChart3, CheckCircle, ArrowRight, Target,
  Shield, MapPin, FileText, TrendingUp, Zap,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'How BidWise Works | Auction Property Analysis in 3 Steps',
  description:
    'See how BidWise turns monthly county auction lists into pre-scored investment opportunities. Comps, deal scores, and a max-bid number — all done for you.',
  alternates: { canonical: `${SITE_URL}/how-it-works` },
  openGraph: {
    title: 'How BidWise Works — Auction Property Analysis',
    description:
      'Pre-scored auction listings, ROI estimates, and deal scores delivered monthly. See the full workflow.',
    url: `${SITE_URL}/how-it-works`,
    type: 'website',
  },
}

/* ── Blueprint Instrument rollout (2026-07-08) — /how-it-works ─────────────────
   Direction: internal-notes/business/bidwise-design-direction-2026-07-06.md.
   Each step is a survey/procedure entry; DealCardPinned is the explainer visual;
   one inverted paper-white chapter (methodology). Copy + HowTo schema unchanged. */

const STEPS: Procedure[] = [
  {
    index: '01',
    tag: 'INGEST',
    icon: Search,
    title: 'County auction lists drop',
    spec: 'Listings ingested automatically each month',
    body: 'When a supported county publishes an auction list, BidWise pulls every property on the list — addresses, parcel IDs, opening bids, sale dates, and lien depth. No manual data entry, no scrolling through county PDFs.',
    bullets: [
      'Tax deed sales, foreclosure auctions, and courthouse-steps listings',
      'Pulled within 24 hours of county publication',
      'Parcel IDs, opening bids, sale dates, and lien depth captured',
    ],
  },
  {
    index: '02',
    tag: 'ANALYZE',
    icon: BarChart3,
    title: 'Every property gets analyzed',
    spec: 'Comps, scores — automatically',
    body: 'Each listing runs through our analysis pipeline: comparable sales filtered by type/size/proximity, deal score, ROI estimate, and rehab cost projection. You see the answer before you pull the first record.',
    bullets: [
      'Comparable sales with confidence indicators',
      'Deal score, ROI estimate, and max-bid recommendation',
      'Opening bid and back-tax depth surfaced upfront',
      'Rehab estimates by property age and condition signals',
    ],
  },
  {
    index: '03',
    tag: 'BID',
    icon: CheckCircle,
    title: 'Bid prepared. Win confident.',
    spec: 'Walk in knowing your number',
    body: 'Build a watchlist of the top scored properties. Get alerts as auction dates approach. Show up with a max bid you trust — not a gut number. Most members evaluate 50+ properties in the time it used to take to research one.',
    bullets: [
      'Watchlist tracks deals from discovery through auction day',
      'Auction date alerts so you never miss a sale',
      'Lender-ready deal reports (Pro+ tier)',
      'CSV export for partners and team review (Expert tier)',
    ],
  },
]

const FEATURES = [
  { icon: Target, title: 'Deal Scoring', desc: 'An objective 0–100 deal score with a clear BID / NO-BID call on every property. No gut calls.' },
  { icon: Shield, title: 'Back-Tax Exposure', desc: 'Opening bid and back-tax depth surfaced on every property before you commit a dollar.' },
  { icon: BarChart3, title: 'Comparable Sales', desc: 'Filtered by type, size, and proximity with confidence indicators.' },
  { icon: MapPin, title: 'Auction Discovery', desc: 'Track every upcoming sale by county with one dashboard.' },
  { icon: FileText, title: 'Deal Reports', desc: 'Formatted summaries for lenders and partners. CSV export on Expert.' },
  { icon: TrendingUp, title: 'ROI Estimates', desc: 'Rehab + ARV projections so you can stress-test the math fast.' },
]

const WHY_BIDWISE = [
  { problem: 'Spending nights pulling comps manually', solution: 'Every property pre-analyzed before auction lists drop' },
  { problem: 'Guessing on max bid and overpaying', solution: 'Data-backed max bid with confidence indicators' },
  { problem: 'Missing red flags until after you bid', solution: 'Back-tax depth and lien risks surfaced upfront' },
  { problem: 'Losing to investors with better information', solution: 'Same data they pay $1000+/mo for — at investor pricing' },
]

/* Representative output artifact for the explainer visual — mirrors the homepage
   example, clearly labelled so it never reads as a real, specific deal. */
const PINNED_DEAL: PinnedDeal = {
  address: '2847 Dunwoody Ln NE',
  meta: 'ATLANTA, GA 30338 · SFR · 3BD/2BA',
  score: 91,
  verdict: 'BID',
  parcelId: '18-092-04-051',
  stats: [
    { label: 'Max Bid', value: '$34,500', accent: true },
    { label: 'ARV', value: '$198K' },
    { label: 'ROI', value: '+248%' },
  ],
  comps: [
    { label: '2901 HENDERSON RD · 0.3 MI', value: '$192K' },
    { label: '3102 DUNWOODY CLUB DR · 0.5 MI', value: '$204K' },
  ],
}

/* Paper-white chapter: invert the bp tokens via CSS-variable cascade so every
   bp component adapts without a theme prop (same technique as the homepage). */
const PAPER_TOKENS = {
  '--bp-panel': '#FFFFFF',
  '--bp-panel-deep': '#FFFFFF',
  '--bp-accent': '#2563EB',
  '--bp-accent-bright': '#1D4ED8',
  '--bp-accent-soft': 'rgba(37,99,235,0.07)',
  '--bp-accent-line': 'rgba(37,99,235,0.45)',
  '--bp-hairline': 'rgba(16,21,30,0.14)',
  '--bp-hairline-strong': 'rgba(16,21,30,0.32)',
  '--bp-text-1': '#10151E',
  '--bp-text-2': '#3F4854',
  '--bp-text-3': '#697180',
} as React.CSSProperties

export default function HowItWorksPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'How BidWise analyzes auction properties',
    description:
      'BidWise turns monthly county auction lists into pre-scored investment opportunities with comparable sales, deal scores, and max-bid recommendations.',
    step: STEPS.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.title,
      text: s.body,
    })),
  }

  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section
        aria-labelledby="hiw-hero-heading"
        className="relative overflow-hidden border-b border-[var(--bp-hairline)] px-5 pb-16 pt-32 sm:px-8 lg:pt-40"
      >
        <ParcelLines className="opacity-30" />
        <div className="relative mx-auto max-w-6xl">
          <p className="bp-label mb-5 !text-[var(--bp-accent)]">HOW BIDWISE WORKS · PROCEDURE</p>
          <h1
            id="hiw-hero-heading"
            className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight text-[var(--bp-text-1)] sm:text-5xl md:text-6xl"
          >
            Pre-scored auction deals,
            <br />
            <span className="text-[var(--bp-text-3)]">every month.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--bp-text-2)]">
            BidWise turns county auction lists into ranked investment opportunities — with comps, deal scores, and a recommended max bid on every property.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="bp-btn-primary px-7 py-3.5 text-sm">
              Start My Free Trial
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Link href="/pricing" className="bp-btn-ghost px-7 py-3.5 text-sm">
              Compare Plans
            </Link>
          </div>
        </div>
      </section>

      {/* ── SHT 01 — PROCEDURE (the three steps + delivered deal card) ──────── */}
      <RevealSection>
        <section aria-labelledby="hiw-procedure-heading" className="relative overflow-hidden px-5 py-24 sm:px-8 lg:py-32">
          <ParcelLines className="opacity-20" />
          <div className="relative mx-auto max-w-6xl">
            <SheetHeading
              sheet="SHT 01 · PROCEDURE"
              id="hiw-procedure-heading"
              title={
                <>
                  From county list
                  <br />
                  to bid-ready, in three moves.
                </>
              }
              sub="No manual comps, no PDF scrolling. Every listing arrives already analyzed — you review the answer, not the raw data."
            />

            <ol className="space-y-16">
              {STEPS.map(step => (
                <ProcedureStep key={step.index} step={step} />
              ))}
            </ol>

            {/* Delivered-artifact plate: the deal card as it lands in the dashboard. */}
            <figure className="mt-20">
              <TitleBlock label="FIG 04 · DEAL CARD AS DELIVERED" index="OUTPUT SHEET" bodyClassName="p-5 sm:p-8">
                <DealCardPinned deal={PINNED_DEAL} />
              </TitleBlock>
              <figcaption className="bp-label mt-5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>PARCEL {PINNED_DEAL.parcelId}</span>
                <span aria-hidden="true" className="text-[var(--bp-text-3)]">·</span>
                <span>DEKALB COUNTY, GA</span>
                <span aria-hidden="true" className="text-[var(--bp-text-3)]">·</span>
                <span className="!text-[var(--bp-accent)]">EXAMPLE OUTPUT — REPRESENTATIVE PARCEL</span>
              </figcaption>
            </figure>
          </div>
        </section>
      </RevealSection>

      {/* ── SHT 02 — METHODOLOGY (the one paper-white chapter) ──────────────── */}
      <RevealSection>
        <section
          aria-labelledby="hiw-why-heading"
          className="bg-[var(--bp-paper)] px-5 py-24 sm:px-8 lg:py-32"
          style={PAPER_TOKENS}
        >
          <div className="mx-auto max-w-6xl">
            <SheetHeading
              sheet="SHT 02 · METHODOLOGY"
              id="hiw-why-heading"
              title={
                <>
                  Stop racing investors
                  <br />
                  with better information.
                </>
              }
              sub="The edge was never effort — it was data. BidWise puts the same analysis the pros pay for on every parcel, before the auction."
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {WHY_BIDWISE.map((item, i) => (
                <TitleBlock
                  key={item.problem}
                  label={`SWITCH ${String(i + 1).padStart(2, '0')}`}
                  index="BEFORE / AFTER"
                  className="flex flex-col bg-white"
                  bodyClassName="flex flex-1 flex-col gap-4 p-6"
                >
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className="mt-0.5 font-mono text-xs font-semibold tracking-widest text-rose-500">
                      OLD
                    </span>
                    <p className="text-sm leading-relaxed text-[var(--bp-text-3)] line-through decoration-rose-400/40">
                      {item.problem}
                    </p>
                  </div>
                  <div className="flex items-start gap-3 border-t border-[var(--bp-hairline)] pt-4">
                    <Zap size={15} className="mt-0.5 shrink-0 text-[var(--bp-accent)]" aria-hidden="true" />
                    <p className="text-sm font-medium leading-relaxed text-[var(--bp-text-1)]">{item.solution}</p>
                  </div>
                </TitleBlock>
              ))}
            </div>
          </div>
        </section>
      </RevealSection>

      {/* ── SHT 03 — CAPABILITIES (inside the platform) ─────────────────────── */}
      <RevealSection>
        <section aria-labelledby="hiw-features-heading" className="relative overflow-hidden px-5 py-24 sm:px-8 lg:py-32">
          <ParcelLines className="opacity-20" />
          <div className="relative mx-auto max-w-6xl">
            <SheetHeading
              sheet="SHT 03 · CAPABILITIES"
              id="hiw-features-heading"
              title="Everything in one membership."
              sub="One instrument panel for the whole workflow — discovery, analysis, risk, and export."
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => {
                const Icon = f.icon
                return (
                  <TitleBlock key={f.title} label={`CAP ${String(i + 1).padStart(2, '0')}`} bodyClassName="p-6">
                    <span className="mb-4 inline-flex h-11 w-11 items-center justify-center border border-[var(--bp-hairline)] bg-[var(--bp-accent-soft)]">
                      <Icon size={19} strokeWidth={1.75} className="text-[var(--bp-accent)]" aria-hidden="true" />
                    </span>
                    <h3 className="text-base font-bold text-[var(--bp-text-1)]">{f.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--bp-text-2)]">{f.desc}</p>
                  </TitleBlock>
                )
              })}
            </div>
          </div>
        </section>
      </RevealSection>

      {/* ── SHT 04 — LEAD TIME (time-to-value) ──────────────────────────────── */}
      <RevealSection>
        <section aria-labelledby="hiw-speed-heading" className="border-t border-[var(--bp-hairline)] px-5 py-24 sm:px-8 lg:py-32">
          <div className="mx-auto max-w-6xl">
            <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div>
                <p className="bp-label mb-5 !text-[var(--bp-accent)]">SHT 04 · LEAD TIME</p>
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-[clamp(4rem,12vw,8rem)] font-bold leading-none tracking-[-0.04em] text-[var(--bp-text-1)]">
                    &lt;10
                  </span>
                  <span className="bp-label pb-3 !text-sm">MINUTES</span>
                </div>
                <h2 id="hiw-speed-heading" className="mt-6 max-w-md text-2xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-3xl">
                  From signup to your first analyzed deal.
                </h2>
              </div>
              <ul className="space-y-4 lg:pb-4">
                {[
                  'No sales call. No demo gate. No onboarding course.',
                  'Sign up with email and pick your county.',
                  'The next batch of analyzed listings is in your dashboard the moment it lands.',
                ].map(line => (
                  <li key={line} className="flex items-start gap-3 border-t border-[var(--bp-hairline)] pt-4 text-base leading-relaxed text-[var(--bp-text-2)]">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 bg-[var(--bp-accent)]" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </RevealSection>

      {/* ── SHT 05 — ISSUE FOR BID (CTA band) ───────────────────────────────── */}
      <RevealSection>
        <section
          aria-labelledby="hiw-cta-heading"
          className="relative overflow-hidden border-t border-[var(--bp-hairline)] px-5 py-24 sm:px-8 lg:py-32"
        >
          <ParcelLines className="opacity-30" />
          <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <p className="bp-label mb-5 !text-[var(--bp-accent)]">SHT 05 · ISSUE FOR BID</p>
              <h2 id="hiw-cta-heading" className="text-4xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-6xl">
                Know your number.
                <br />
                <span className="text-[var(--bp-text-3)]">Win the deal.</span>
              </h2>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-[var(--bp-text-2)]">
                {TRIAL_DAYS} days free. No card charged until day {TRIAL_DAYS}. Cancel anytime before then with no charge.
              </p>
            </div>

            <div className="w-full max-w-sm space-y-3">
              <Link href="/signup" className="bp-btn-primary w-full px-8 py-4 text-base">
                Start My Free Trial
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/pricing" className="bp-btn-ghost w-full px-8 py-4 text-base">
                Compare Plans
              </Link>
              <p className="bp-label pt-2 text-center">{`${TRIAL_DAYS}-DAY TRIAL · CANCEL BEFORE DAY ${TRIAL_DAYS}, NO CHARGE`}</p>
            </div>
          </div>
        </section>
      </RevealSection>

      <Footer />
    </div>
  )
}
