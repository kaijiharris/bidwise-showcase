import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { SITE_URL } from '@/lib/site'
import Footer from '@/components/Footer'
import HeroSection from '@/components/HeroSection'
import RevealSection from '@/components/RevealSection'
import ParcelLines from '@/components/blueprint/ParcelLines'
import TitleBlock from '@/components/blueprint/TitleBlock'
import CountyMap, { type County } from '@/components/blueprint/CountyMap'
import ScoreGauge from '@/components/blueprint/ScoreGauge'
import CompsTable, { type CompRow } from '@/components/blueprint/CompsTable'
import AuctionCalendar, { type CalendarMark } from '@/components/blueprint/AuctionCalendar'
import StatBand, { type Stat } from '@/components/blueprint/StatBand'
import StepRule, { type Step } from '@/components/blueprint/StepRule'
import LegendRow, { type LegendSymbol } from '@/components/blueprint/LegendRow'
import DealCardPinned, { type PinnedDeal } from '@/components/blueprint/DealCardPinned'
import { FAQS } from '@/lib/faq-data'
import { TIERS } from '@/lib/pricing-data'
import { TRIAL_DAYS } from '@/lib/trial'

// Homepage self-canonical. The root layout deliberately sets NO canonical
// (a layout canonical is inherited by every page without one, marking them
// homepage duplicates) — each page owns its own; this is the homepage's.
export const metadata: Metadata = {
  alternates: { canonical: SITE_URL },
}

/* ── Blueprint Instrument homepage (reconciled 2026-07-08) ────────────────────
   Direction doc: internal-notes/business/bidwise-design-direction-2026-07-06.md
   Reconciles two parallel builds into one canonical page. Components stay
   prop-driven + CSS-variable-themed so the system rolls to every other page.
   Sequence: hero → SHT 01 instrument panel → SHT 02 field data (stat band) →
   SHT 03 procedure (+ pinned deal card) → SHT 04 methodology (paper chapter) →
   SHT 05 rate schedule → SHT 06 inquiries → SHT 07 issue-for-bid CTA.

   County coverage is driven by web/lib/county-data.ts → KNOWN_COUNTIES
   ['dekalb','gwinnett','cobb','clayton']. As of 2026-07-14: DeKalb (Sep 1),
   Gwinnett (Aug 4), and Clayton (Aug 4, 24 parcels) have current upcoming
   analyzed lists; Cobb's next list lands ~Nov 3. Keep the COUNTIES statuses
   below honest to the data in web/data/<county>_auctions.json. */

/* ── Page content (data lives here; components stay reusable) ────────────────── */

const COUNTIES: County[] = [
  { id: 'dekalb', name: 'DeKalb', status: 'TAX DEED · SEP 01' },
  { id: 'gwinnett', name: 'Gwinnett', status: 'TAX DEED · AUG 04' },
  { id: 'clayton', name: 'Clayton', status: 'TAX DEED · AUG 04' },
  { id: 'cobb', name: 'Cobb', status: 'TAX DEED · NOV 03' },
]

const COMPS: CompRow[] = [
  { address: '2901 Henderson Rd', distance: '0.3 MI', price: '$192K' },
  { address: '3102 Dunwoody Club Dr', distance: '0.5 MI', price: '$204K' },
  { address: '2688 Sterling Acres Dr', distance: '0.7 MI', price: '$187K' },
  { address: '3415 Midvale Rd', distance: '0.9 MI', price: '$211K' },
]

const AUCTION_MARKS: CalendarMark[] = [
  { day: 4, label: 'DEKALB' },
  { day: 4, label: 'GWINNETT' },
  { day: 4, label: 'COBB' },
  { day: 4, label: 'CLAYTON' },
]

const MEMBERSHIP_LEGEND: { symbol: LegendSymbol; title: string; description: string; meta: string }[] = [
  {
    symbol: 'dash',
    title: 'Every listing scored before auction day',
    description: 'Monthly county lists fully analyzed before the sale — comps, rehab estimates, and a deal score on every parcel.',
    meta: 'ALL PLANS',
  },
  {
    symbol: 'square',
    title: 'Back-tax exposure on every parcel',
    description: 'Opening bid and back-tax depth surfaced for every listing before you commit a dollar.',
    meta: 'ALL PLANS',
  },
  {
    symbol: 'dot',
    title: 'Watchlist through auction day',
    description: 'Track deals from discovery to the podium in your working pipeline.',
    meta: 'ALL PLANS',
  },
]

const STATS: Stat[] = [
  { value: 4, pad: 2, label: 'GA metro counties tracked', sublabel: 'DeKalb · Gwinnett · Clayton live — Cobb next list Nov 3' },
  { value: 100, suffix: '%', label: 'Listings scored', sublabel: 'Every parcel, before auction day' },
  { value: 5, prefix: '<', pad: 2, label: 'Minutes per deal', sublabel: 'From listing to max bid' },
]

const STEPS: Step[] = [
  {
    tag: 'INPUT',
    title: 'Monthly auction lists drop',
    description:
      'When county auction listings are released each month, BidWise pulls every property on the list and runs full analysis before auction day.',
  },
  {
    tag: 'ANALYSIS',
    title: 'Browse scored deals',
    description:
      'Comps, rehab estimates, and a deal score for every listing. Log in and your research is already done.',
  },
  {
    tag: 'OUTPUT',
    title: 'Bid with confidence',
    description:
      'Know your max number before the auction. Save properties, track what matters, show up prepared.',
  },
]

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

/* Factual proof points only — no fabricated testimonials or "VERIFIED" stamps.
   Each claim restates product facts already asserted elsewhere on this page
   (MOD 02/03, membership legend). Swap in real customer quotes post-launch,
   only once they exist and can be substantiated. */
const PROOF_POINTS = [
  {
    index: 'COMPS',
    title: 'Comps you can trace',
    body: 'Every comparable is listed with its address, distance, and price — filtered by type, size, and proximity. The max bid comes from the sales behind it, not a hunch.',
    ref: 'REF · MOD 03 · COMPARABLE SALES',
  },
  {
    index: 'TAXES',
    title: 'Back-tax exposure, on the sheet',
    body: 'Opening bid and back-tax depth surfaced on every parcel before you commit a dollar. The tax-risk column is filled in up front.',
    ref: 'REF · LEGEND · ALL PLANS',
  },
  {
    index: 'SCORE',
    title: 'Scoring, not gut feel',
    body: 'An objective 0–100 deal score with a clear BID / NO-BID call on every parcel, ARV, rehab estimate, and max bid printed beside it. The math is on the card — check it yourself.',
    ref: 'REF · MOD 02 · DEAL SCORE',
  },
]

/* Paper-white chapter: invert the blueprint tokens via CSS-variable cascade so
   every bp component adapts without a theme prop. */
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

function SheetHeading({
  sheet,
  id,
  title,
  sub,
  link,
}: {
  sheet: string
  id: string
  title: React.ReactNode
  sub?: string
  link?: { href: string; label: string }
}) {
  return (
    <div className="mb-14 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-2xl">
        <p className="bp-label mb-5 !text-[var(--bp-accent)]">{sheet}</p>
        <h2 id={id} className="text-4xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-5xl">
          {title}
        </h2>
        {sub && <p className="mt-4 max-w-xl text-lg leading-relaxed text-[var(--bp-text-2)]">{sub}</p>}
      </div>
      {link && (
        <Link
          href={link.href}
          className="bp-label inline-flex shrink-0 items-center gap-2 !text-[var(--bp-accent)] transition-colors hover:!text-[var(--bp-text-1)]"
        >
          {link.label} <ArrowRight size={13} aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-[var(--bp-hairline)]">
      <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-4 py-5 text-sm font-semibold text-[var(--bp-text-1)] transition-colors hover:text-[var(--bp-accent)]">
        {q}
        <ChevronDown
          size={15}
          aria-hidden="true"
          className="shrink-0 text-[var(--bp-text-3)] transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <p className="pb-5 text-sm leading-relaxed text-[var(--bp-text-2)]">{a}</p>
    </details>
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      <HeroSection />

      <main>
        {/* ── SHT 01 — THE INSTRUMENT PANEL (bento modules) ─────────────────── */}
        <RevealSection>
          <section aria-labelledby="platform-heading" className="relative overflow-hidden px-5 py-24 sm:px-8 lg:py-32">
            <ParcelLines className="opacity-40" />
            <div className="relative mx-auto max-w-6xl">
              <SheetHeading
                sheet="SHT 01 · THE PLATFORM"
                id="platform-heading"
                title={
                  <>
                    The whole deal,
                    <br />
                    on one sheet.
                  </>
                }
                sub="Dashboard, comps, back-tax exposure, and auction calendar in one instrument panel — the research is done before you open the county list."
              />

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <TitleBlock
                  label="MOD 01 · COUNTY COVERAGE"
                  index="GA-METRO"
                  className="lg:col-span-7 lg:row-span-2"
                  bodyClassName="p-4 sm:p-6"
                >
                  <CountyMap counties={COUNTIES} />
                </TitleBlock>

                <TitleBlock label="MOD 02 · DEAL SCORE" index="0–100" className="lg:col-span-5">
                  <ScoreGauge score={91} verdict="BID" className="mx-auto max-w-[260px]" />
                  <p className="mt-5 text-center text-sm leading-relaxed text-[var(--bp-text-2)]">
                    An objective 0–100 deal score with a clear BID / NO-BID call. No gut feelings, no spreadsheet math.
                  </p>
                </TitleBlock>

                <TitleBlock label="MOD 03 · COMPARABLE SALES" index="4 COMPS" className="lg:col-span-5">
                  <CompsTable rows={COMPS} footnote="HIGH CONFIDENCE · FILTERED BY TYPE, SIZE, PROXIMITY" />
                </TitleBlock>

                <TitleBlock label="MOD 04 · AUCTION CALENDAR" index="MONTHLY" className="lg:col-span-7">
                  <AuctionCalendar month="FIRST-TUESDAY SALES" days={31} startOffset={6} marks={AUCTION_MARKS} />
                </TitleBlock>

                <TitleBlock label="MOD 05 · START" index={`${TRIAL_DAYS} DAYS`} className="lg:col-span-5">
                  <p className="text-2xl font-bold leading-snug tracking-tight text-[var(--bp-text-1)]">
                    Every module, every county, free for {TRIAL_DAYS} days.
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--bp-text-2)]">
                    No charge until day {TRIAL_DAYS}. Cancel any time before that and pay nothing.
                  </p>
                  <Link href="/signup" className="bp-btn-primary mt-6 w-full px-6 py-3.5 text-sm">
                    Start Free Trial
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </TitleBlock>
              </div>

              {/* membership legend */}
              <div className="mt-10 border-t border-[var(--bp-hairline)]">
                <p className="bp-label pt-5">LEGEND · INCLUDED IN MEMBERSHIP</p>
                <div className="mt-2">
                  {MEMBERSHIP_LEGEND.map(item => (
                    <LegendRow key={item.title} {...item} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        </RevealSection>

        {/* ── SHT 02 — FIELD DATA (oversized stat band) ─────────────────────── */}
        <RevealSection>
          <section aria-labelledby="stats-heading" className="px-5 pb-24 sm:px-8 lg:pb-32">
            <div className="mx-auto max-w-6xl">
              <h2 id="stats-heading" className="sr-only">
                BidWise by the numbers
              </h2>
              <StatBand stats={STATS} />
            </div>
          </section>
        </RevealSection>

        {/* ── SHT 03 — PROCEDURE (01/02/03 + pinned deal card) ──────────────── */}
        <RevealSection>
          <section
            id="how-it-works"
            aria-labelledby="how-heading"
            className="relative overflow-hidden bg-[var(--bp-panel)] px-5 py-24 sm:px-8 lg:py-32"
          >
            <ParcelLines className="opacity-25" />
            <div className="relative mx-auto max-w-6xl">
              <SheetHeading
                sheet="SHT 02 · PROCEDURE"
                id="how-heading"
                title={
                  <>
                    Auction listings,
                    <br />
                    already analyzed.
                  </>
                }
              />

              <StepRule steps={STEPS} />

              {/* Delivered-artifact plate: pinned deal card + magnified parcel,
                  framed in a survey title-block so the two halves read as one
                  instrument sheet. */}
              <figure className="mt-20">
                <TitleBlock
                  label="FIG 04 · DEAL CARD AS DELIVERED"
                  index="OUTPUT SHEET"
                  bodyClassName="p-5 sm:p-8"
                >
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

              <div className="mt-14 flex flex-wrap items-center gap-5 border-t border-[var(--bp-hairline)] pt-8">
                <Link href="/how-it-works" className="bp-btn-ghost px-6 py-3 text-sm">
                  See the full workflow
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
                <p className="bp-label">FULL PROCEDURE · SHEETS 01–03</p>
              </div>
            </div>
          </section>
        </RevealSection>

        {/* ── SHT 04 — METHODOLOGY (the one paper-white chapter) ────────────── */}
        <RevealSection>
          <section
            aria-labelledby="trust-heading"
            className="bg-[var(--bp-paper)] px-5 py-24 sm:px-8 lg:py-32"
            style={PAPER_TOKENS}
          >
            <div className="mx-auto max-w-6xl">
              <SheetHeading
                sheet="SHT 03 · METHODOLOGY"
                id="trust-heading"
                title={
                  <>
                    Every number
                    <br />
                    shows its work.
                  </>
                }
                sub="A deal card never asks for trust — each figure arrives with the comps, tax records, and math that produced it."
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {PROOF_POINTS.map((p, i) => (
                  <TitleBlock
                    key={p.index}
                    label={`EXHIBIT ${String(i + 1).padStart(2, '0')}`}
                    index={p.index}
                    className="flex flex-col bg-white"
                    bodyClassName="flex flex-1 flex-col p-6"
                  >
                    <h3 className="text-lg font-bold tracking-tight text-[var(--bp-text-1)]">{p.title}</h3>
                    <p className="mt-3 flex-1 text-[15px] leading-relaxed text-[var(--bp-text-2)]">{p.body}</p>
                    <footer className="mt-6 border-t border-[var(--bp-hairline)] pt-4">
                      <div className="bp-label">{p.ref}</div>
                    </footer>
                  </TitleBlock>
                ))}
              </div>
            </div>
          </section>
        </RevealSection>

        {/* ── SHT 05 — RATE SCHEDULE (pricing) ──────────────────────────────── */}
        <RevealSection>
          <section id="pricing" aria-labelledby="pricing-heading" className="relative overflow-hidden px-5 py-24 sm:px-8 lg:py-32">
            <ParcelLines className="opacity-30" />
            <div className="relative mx-auto max-w-6xl">
              <SheetHeading
                sheet="SHT 04 · RATE SCHEDULE"
                id="pricing-heading"
                title={
                  <>
                    One membership.
                    <br />
                    Every edge.
                  </>
                }
                sub={`Every plan includes a full ${TRIAL_DAYS}-day free trial — no charge until day ${TRIAL_DAYS}.`}
                link={{ href: '/pricing', label: 'FULL COMPARISON' }}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {TIERS.map(tier => (
                  <TitleBlock
                    key={tier.key}
                    label={tier.name.toUpperCase()}
                    index={tier.badge ? tier.badge.toUpperCase() : undefined}
                    className={`flex flex-col ${tier.highlight ? 'border-[var(--bp-accent-line)]' : ''}`}
                    bodyClassName="flex h-full flex-col p-6"
                  >
                    {tier.highlight && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0"
                        style={{ boxShadow: '0 0 56px rgba(59,130,246,0.16), inset 0 0 32px rgba(59,130,246,0.05)' }}
                      />
                    )}
                    <p className="text-sm text-[var(--bp-text-2)]">{tier.tagline}</p>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-5xl font-bold text-[var(--bp-text-1)]">${tier.monthlyPrice}</span>
                      <span className="bp-label">/ MO</span>
                    </div>
                    <p className="bp-label mt-2 !text-[10px]">ANNUAL — ${tier.annualMonthly}/MO EQUIV</p>

                    <ul className="mt-6 flex-1 space-y-2.5 border-t border-[var(--bp-hairline)] pt-5">
                      {tier.highlights.map(f => (
                        <li key={f} className="flex items-start gap-2.5 text-sm text-[var(--bp-text-2)]">
                          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-[var(--bp-accent)]" />
                          {f}
                        </li>
                      ))}
                    </ul>

                    <Link
                      href={`/signup?plan=${tier.key}`}
                      className={`mt-7 w-full py-3 text-sm ${tier.highlight ? 'bp-btn-primary' : 'bp-btn-ghost'}`}
                    >
                      Start Free — {tier.name}
                    </Link>
                  </TitleBlock>
                ))}
              </div>
            </div>
          </section>
        </RevealSection>

        {/* ── SHT 06 — INQUIRIES (FAQ) ──────────────────────────────────────── */}
        <RevealSection>
          <section id="faq" aria-labelledby="faq-heading" className="px-5 pb-24 sm:px-8 lg:pb-32">
            <div className="mx-auto max-w-3xl">
              <p className="bp-label mb-5 !text-[var(--bp-accent)]">SHT 05 · INQUIRIES</p>
              <h2 id="faq-heading" className="mb-8 text-3xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-4xl">
                Common questions
              </h2>
              <div className="border-t border-[var(--bp-hairline)]">
                {FAQS.slice(0, 5).map(f => (
                  <FaqItem key={f.q} {...f} />
                ))}
              </div>
              <div className="mt-8">
                <Link
                  href="/faq"
                  className="bp-label inline-flex items-center gap-2 !text-[var(--bp-accent)] transition-colors hover:!text-[var(--bp-text-1)]"
                >
                  READ ALL {FAQS.length} QUESTIONS <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
        </RevealSection>

        {/* ── SHT 07 — ISSUE FOR BID (CTA band) ─────────────────────────────── */}
        <RevealSection>
          <section
            aria-labelledby="cta-heading"
            className="relative overflow-hidden border-t border-[var(--bp-hairline)] px-5 py-24 sm:px-8 lg:py-32"
          >
            <ParcelLines className="opacity-30" />
            <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-10 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-xl">
                <p className="bp-label mb-5 !text-[var(--bp-accent)]">SHT 06 · ISSUE FOR BID</p>
                <h2 id="cta-heading" className="text-4xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-6xl">
                  Know your number.
                  <br />
                  <span className="text-[var(--bp-text-3)]">Win the deal.</span>
                </h2>
                <p className="mt-5 max-w-lg text-lg leading-relaxed text-[var(--bp-text-2)]">
                  Join investors who walk into every auction prepared. {TRIAL_DAYS} days free — no commitment until you&apos;re ready.
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
      </main>

      <Footer />
    </div>
  )
}
