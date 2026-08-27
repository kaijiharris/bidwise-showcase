import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, ExternalLink } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import RevealSection from '@/components/RevealSection'
import ParcelLines from '@/components/blueprint/ParcelLines'
import TitleBlock from '@/components/blueprint/TitleBlock'
import { KNOWN_COUNTIES } from '@/lib/county-data'
import {
  COUNTY_PAGES,
  countyPageSlug,
  countyFromPageSlug,
  loadCountyLiveStats,
  type CountyLiveStats,
  type CountyPageConfig,
} from '@/lib/county-pages'
import { TRIAL_LABEL } from '@/lib/trial'

/* ── Programmatic county pages — /tax-sale/<county>-county-ga ──────────────────
   The SEO beachhead for "<county> tax sale list" intent (the query pattern the
   competitive scan showed is winnable: DeKalb + the state head term have no
   entrenched non-government ranker). Structure mirrors what ranks in this
   niche — sale schedule, how-it-works, FAQ, official-source link — and then
   goes one layer deeper than any list vendor can: live analyzed-list stats
   (parcel count, strong-deal count, next date) read from the published
   dataset at render time. Never hardcode dates here; loadCountyLiveStats is
   the only source of schedule truth.

   Georgia-law copy is deliberately general ("typically", "under Georgia law")
   and defers to the county's official notice + counsel — these pages must
   never over-claim (launch-audit lesson). Revalidated hourly so a data
   publish or date change flows through without a redeploy. */

export const revalidate = 3600

const SITE_URL = 'https://www.bidwiseinvest.com'

export function generateStaticParams() {
  return KNOWN_COUNTIES.map(county => ({ slug: countyPageSlug(county) }))
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const county = countyFromPageSlug(slug)
  if (!county) return {}
  const cfg = COUNTY_PAGES[county]
  const live = await loadCountyLiveStats(county)
  const dateBit = live.isUpcoming && live.auctionDateLabel
    ? `Next sale ${live.auctionDateLabel}.`
    : 'First-Tuesday sale months — next list pending.'
  const url = `${SITE_URL}/tax-sale/${slug}`
  const title = `${cfg.name} County GA Tax Sale — Dates, List & Analyzed Deals | BidWise`
  const description = `${cfg.name} County, Georgia tax deed sale guide: how the courthouse-steps auction works, where the official list is published, and every parcel analyzed with deal scores and max bids. ${dateBit}`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
  }
}

function statBox(label: string, value: string, sub?: string) {
  return (
    <div className="border border-[var(--bp-hairline)] p-5">
      <p className="bp-label mb-2">{label}</p>
      <p className="text-2xl font-bold tracking-tight text-[var(--bp-text-1)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--bp-text-3)]">{sub}</p>}
    </div>
  )
}

function buildFaqs(cfg: CountyPageConfig, live: CountyLiveStats) {
  const nextSale = live.isUpcoming && live.auctionDateLabel
    ? `The next ${cfg.name} County tax sale with a published list is ${live.auctionDateLabel}. Georgia counties sell on the first Tuesday of the month, and a county only holds a sale in months where it has parcels to offer — always confirm on the county's official page.`
    : `${cfg.name} County sells on the first Tuesday of the month in months where it has parcels to offer. The next list hasn't been published yet — BidWise monitors the county's official source daily and analyzes the list as soon as it drops.`
  return [
    { q: `When is the next ${cfg.name} County tax sale?`, a: nextSale },
    {
      q: `Where does the ${cfg.name} County tax sale happen?`,
      a: `Sales are held in person at the county courthouse steps in ${cfg.seat}, typically between 10 AM and 4 PM on sale day. Confirm the exact venue and time on the county's official sale notice before attending.`,
    },
    {
      q: 'What exactly am I buying at a Georgia tax sale?',
      a: 'A redeemable tax deed — not immediate clean ownership. The delinquent owner (or other interest holders) generally has at least 12 months to redeem the property by paying you back with a premium. You typically cannot occupy, rent, or improve the property during that window, and clearing title usually takes a barment process and often a quiet-title action afterward.',
    },
    {
      q: 'What premium do I earn if the owner redeems?',
      a: 'Under Georgia law the redemption amount is generally what you paid at the sale plus a 20% premium in the first year, with an additional 10% for each following year (plus certain allowable costs). Rules and edge cases matter here — verify the current statute and talk to a Georgia real-estate attorney before bidding.',
    },
    {
      q: `Where is the official ${cfg.name} County tax sale list?`,
      a: `The county publishes it on its own site (linked on this page) as sale day approaches. BidWise pulls that same list and runs full analysis on every parcel — deal score, comparable sales, recommended max bid, and back-tax depth — so the research is done before you open the PDF.`,
    },
  ]
}

export default async function CountyTaxSalePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const county = countyFromPageSlug(slug)
  if (!county) notFound()
  const cfg = COUNTY_PAGES[county]
  const live = await loadCountyLiveStats(county)
  const faqs = buildFaqs(cfg, live)

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'BidWise', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: `${cfg.name} County GA Tax Sale`, item: `${SITE_URL}/tax-sale/${slug}` },
    ],
  }

  const primaryCta = live.hasFreeList
    ? { href: `/free-list/${county}`, label: `Get the free ${cfg.name} list` }
    : { href: '/signup', label: 'Start Free Trial' }

  const steps = [
    {
      tag: '01 · THE LIST',
      title: 'The county publishes its sale list',
      body: `As the first-Tuesday sale approaches, ${cfg.name} County posts the parcels it intends to sell (typically weeks before sale day). BidWise watches the official source daily and ingests the list the day it drops.`,
    },
    {
      tag: '02 · RESEARCH',
      title: 'Every parcel gets analyzed',
      body: 'Comparable sales filtered by type, size, and proximity; an objective 0–100 deal score with a BID / NO-BID call; a recommended max bid; back-tax depth and opening bid — on every parcel, before auction day.',
    },
    {
      tag: '03 · AUCTION DAY',
      title: `Bid on the courthouse steps in ${cfg.seat}`,
      body: 'Georgia tax sales are live, in-person, first-Tuesday auctions. Bidding starts around the taxes owed and you must pay with certified funds the same day — know your walk-away number before you raise a hand.',
    },
    {
      tag: '04 · REDEMPTION',
      title: 'Hold through the redemption window',
      body: 'You receive a redeemable tax deed. For at least 12 months the owner can redeem by paying your bid plus a premium (generally 20% in year one). If nobody redeems, you can pursue barment and then quiet title to convert the deed into marketable ownership.',
    },
  ]

  const otherCounties = KNOWN_COUNTIES.filter(c => c !== county)

  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-[var(--bp-hairline)] px-5 pb-14 pt-32 sm:px-8 lg:pt-40">
        <ParcelLines className="opacity-25" />
        <div className="relative mx-auto max-w-4xl">
          <p className="bp-label mb-5 !text-[var(--bp-accent)]">GEORGIA TAX DEED SALES · {cfg.name.toUpperCase()} COUNTY</p>
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight text-[var(--bp-text-1)] sm:text-5xl">
            {cfg.name} County tax sale,
            <br />
            <span className="text-[var(--bp-text-3)]">already analyzed.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--bp-text-2)]">
            {live.isUpcoming && live.auctionDateLabel
              ? `The next ${cfg.name} County tax deed sale is ${live.auctionDateLabel}. BidWise scored all ${live.totalProperties} parcels${live.analysisDateLabel ? ` in our ${live.analysisDateLabel} analysis` : ''}${live.analysisStale ? ' — the county revises the list until sale day, so we re-check the official source daily and re-score when it changes.' : ', and re-checks the county source daily.'}`
              : `${cfg.name} County sells tax-delinquent properties on the first Tuesday of sale months. The next list is pending — BidWise checks the county's official source daily and analyzes every parcel the day it drops.`}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href={primaryCta.href} className="bp-btn-primary px-7 py-3.5 text-sm">
              {primaryCta.label}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <a
              href={cfg.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bp-label inline-flex items-center gap-2 !text-[var(--bp-accent)] transition-colors hover:!text-[var(--bp-text-1)]"
            >
              OFFICIAL COUNTY SOURCE <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* ── KEY FACTS ────────────────────────────────────────────────────────── */}
      <RevealSection>
        <section className="px-5 py-16 sm:px-8">
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-4 lg:grid-cols-4">
            {statBox(
              'NEXT SALE',
              live.isUpcoming && live.auctionDateLabel ? live.auctionDateLabel : 'List pending',
              'First-Tuesday sale months',
            )}
            {statBox(
              'PARCELS ANALYZED',
              live.isUpcoming && live.totalProperties > 0 ? String(live.totalProperties) : '—',
              live.isUpcoming
                ? (live.analysisDateLabel
                    ? `As of ${live.analysisDateLabel}${live.analysisStale ? ' · re-checked daily' : ''}`
                    : 'Analyzed by BidWise')
                : 'Publishes closer to sale day',
            )}
            {statBox(
              'STRONG DEALS FLAGGED',
              live.isUpcoming && live.totalProperties > 0 ? String(live.strongDeals) : '—',
              'Deal score ≥ 75',
            )}
            {statBox('REDEMPTION WINDOW', '12 months', 'Redeemable deed · premium applies')}
          </div>
        </section>
      </RevealSection>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────────── */}
      <RevealSection>
        <section className="border-t border-[var(--bp-hairline)] bg-[var(--bp-panel)] px-5 py-20 sm:px-8 lg:py-24">
          <div className="mx-auto max-w-4xl">
            <p className="bp-label mb-5 !text-[var(--bp-accent)]">PROCEDURE</p>
            <h2 className="mb-10 text-3xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-4xl">
              How {cfg.name} County tax sales work
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {steps.map(s => (
                <TitleBlock key={s.tag} label={s.tag} bodyClassName="p-6">
                  <h3 className="text-lg font-bold tracking-tight text-[var(--bp-text-1)]">{s.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--bp-text-2)]">{s.body}</p>
                </TitleBlock>
              ))}
            </div>
            <p className="mt-8 text-xs leading-relaxed text-[var(--bp-text-3)]">
              Georgia tax deed rules involve real legal risk — redemption mechanics, barment, and title
              clearing have statutory requirements and edge cases. This page is general research, not
              legal advice: verify details on the county&apos;s official notice and consult a Georgia
              real-estate attorney before bidding.
            </p>
          </div>
        </section>
      </RevealSection>

      {/* ── FAQ ──────────────────────────────────────────────────────────────── */}
      <RevealSection>
        <section className="px-5 py-20 sm:px-8 lg:py-24">
          <div className="mx-auto max-w-3xl">
            <p className="bp-label mb-5 !text-[var(--bp-accent)]">INQUIRIES · {cfg.name.toUpperCase()}</p>
            <h2 className="mb-8 text-3xl font-bold tracking-tight text-[var(--bp-text-1)]">
              {cfg.name} County tax sale FAQ
            </h2>
            <div className="border-t border-[var(--bp-hairline)]">
              {faqs.map(f => (
                <details key={f.q} className="group border-b border-[var(--bp-hairline)]">
                  <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-4 py-5 text-[15px] font-semibold text-[var(--bp-text-1)] transition-colors hover:text-[var(--bp-accent)]">
                    {f.q}
                  </summary>
                  <p className="pb-5 pr-8 text-sm leading-relaxed text-[var(--bp-text-2)]">{f.a}</p>
                </details>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/resources/title-search-tax-deed" className="bp-label !text-[var(--bp-accent)] hover:!text-[var(--bp-text-1)] transition-colors">
                GUIDE · TITLE SEARCH FOR TAX DEEDS
              </Link>
              <Link href="/resources/back-tax-depth-lien-stacking" className="bp-label !text-[var(--bp-accent)] hover:!text-[var(--bp-text-1)] transition-colors">
                GUIDE · READING BACK-TAX DEPTH
              </Link>
              <Link href="/resources/setting-your-max-bid" className="bp-label !text-[var(--bp-accent)] hover:!text-[var(--bp-text-1)] transition-colors">
                GUIDE · SETTING YOUR MAX BID
              </Link>
            </div>
          </div>
        </section>
      </RevealSection>

      {/* ── CTA + CROSS-LINKS ────────────────────────────────────────────────── */}
      <RevealSection>
        <section className="relative overflow-hidden border-t border-[var(--bp-hairline)] px-5 py-20 sm:px-8 lg:py-28">
          <ParcelLines className="opacity-30" />
          <div className="relative mx-auto flex max-w-4xl flex-col items-start gap-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <p className="bp-label mb-5 !text-[var(--bp-accent)]">ISSUE FOR BID</p>
              <h2 className="text-3xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-5xl">
                Know your number
                <br />
                <span className="text-[var(--bp-text-3)]">before the gavel.</span>
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-[var(--bp-text-2)]">
                Every parcel on the {cfg.name} list with a deal score, comps, and a recommended max bid.
                {' '}{TRIAL_LABEL} free trial — cancel anytime before it ends.
              </p>
              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
                {otherCounties.map(c => (
                  <Link
                    key={c}
                    href={`/tax-sale/${countyPageSlug(c)}`}
                    className="bp-label !text-[var(--bp-text-3)] transition-colors hover:!text-[var(--bp-accent)]"
                  >
                    {COUNTY_PAGES[c].name.toUpperCase()} COUNTY →
                  </Link>
                ))}
              </div>
            </div>
            <div className="w-full max-w-sm space-y-3">
              <Link href="/signup" className="bp-btn-primary w-full px-8 py-4 text-base">
                Start Free Trial
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              {live.hasFreeList && (
                <Link href={`/free-list/${county}`} className="bp-btn-ghost w-full px-8 py-4 text-base">
                  Get the free {cfg.name} list
                </Link>
              )}
            </div>
          </div>
        </section>
      </RevealSection>

      <Footer />
    </div>
  )
}
