import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import RevealSection from '@/components/RevealSection'
import ParcelLines from '@/components/blueprint/ParcelLines'
import { KNOWN_COUNTIES } from '@/lib/county-data'
import { COUNTY_PAGES, countyPageSlug, loadCountyLiveStats } from '@/lib/county-pages'
import { TRIAL_LABEL } from '@/lib/trial'

/* ── /tax-sale — the Georgia hub ───────────────────────────────────────────────
   Targets the "georgia tax sale list" head term (competitive scan: no
   non-government site holds it). One live, honest table: every covered county
   with its next sale date and analyzed-parcel count read from the published
   datasets at render time, linking down to the per-county pages. Same
   hourly ISR as the county pages so a data publish flows through. */

export const revalidate = 3600

const SITE_URL = 'https://www.bidwiseinvest.com'
const PAGE_URL = `${SITE_URL}/tax-sale`

export const metadata: Metadata = {
  title: 'Georgia Tax Sale List — Upcoming County Auctions, Analyzed | BidWise',
  description:
    'Upcoming Georgia tax deed sales in one place: DeKalb, Gwinnett, Clayton, and Cobb county auction dates, list sizes, and every parcel analyzed with deal scores and recommended max bids.',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: 'Georgia Tax Sale List — Upcoming County Auctions, Analyzed',
    description:
      'First-Tuesday Georgia tax deed sales: dates, lists, and full per-parcel analysis for metro-Atlanta counties.',
    url: PAGE_URL,
    type: 'website',
  },
}

export default async function GeorgiaTaxSaleHub() {
  const counties = await Promise.all(
    KNOWN_COUNTIES.map(async county => ({
      county,
      cfg: COUNTY_PAGES[county],
      live: await loadCountyLiveStats(county),
    })),
  )

  // Upcoming sales first (soonest date), pending-list counties after.
  const sorted = [...counties].sort((a, b) => {
    const ad = a.live.isUpcoming ? a.live.auctionDateISO ?? '9999' : '9999'
    const bd = b.live.isUpcoming ? b.live.auctionDateISO ?? '9999' : '9999'
    return ad.localeCompare(bd)
  })

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'BidWise', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Georgia Tax Sales', item: PAGE_URL },
    ],
  }
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Georgia county tax sale pages',
    itemListElement: sorted.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: `${c.cfg.name} County GA Tax Sale`,
      url: `${SITE_URL}/tax-sale/${countyPageSlug(c.county)}`,
    })),
  }

  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-[var(--bp-hairline)] px-5 pb-14 pt-32 sm:px-8 lg:pt-40">
        <ParcelLines className="opacity-25" />
        <div className="relative mx-auto max-w-4xl">
          <p className="bp-label mb-5 !text-[var(--bp-accent)]">GEORGIA TAX DEED SALES · METRO ATLANTA</p>
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight text-[var(--bp-text-1)] sm:text-5xl">
            Georgia tax sale lists,
            <br />
            <span className="text-[var(--bp-text-3)]">already analyzed.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--bp-text-2)]">
            Georgia counties sell tax-delinquent property on the first Tuesday of the month.
            BidWise tracks the official lists for the metro-Atlanta counties below and analyzes
            every parcel — deal score, comps, recommended max bid — before auction day.
          </p>
        </div>
      </section>

      {/* ── LIVE COUNTY TABLE ────────────────────────────────────────────────── */}
      <RevealSection>
        <section className="px-5 py-16 sm:px-8">
          <div className="mx-auto max-w-4xl">
            <p className="bp-label mb-4">UPCOMING SALES · LIVE FROM COUNTY LISTS</p>
            <div className="border-t border-[var(--bp-hairline)]">
              {sorted.map(({ county, cfg, live }) => (
                <Link
                  key={county}
                  href={`/tax-sale/${countyPageSlug(county)}`}
                  className="group flex flex-col gap-1.5 border-b border-[var(--bp-hairline)] py-5 transition-colors hover:bg-[var(--bp-accent-soft)] sm:flex-row sm:items-baseline sm:justify-between"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="text-lg font-bold tracking-tight text-[var(--bp-text-1)] group-hover:text-[var(--bp-accent)]">
                      {cfg.name} County
                    </span>
                    <span className="bp-label !text-[var(--bp-text-3)]">{cfg.seat}</span>
                  </div>
                  <div className="flex items-baseline gap-4">
                    <span className="bp-label !text-[var(--bp-text-2)]">
                      {live.isUpcoming && live.auctionDateLabel
                        ? `NEXT SALE · ${live.auctionDateLabel.toUpperCase()}`
                        : 'NEXT LIST PENDING'}
                    </span>
                    {live.isUpcoming && live.totalProperties > 0 && (
                      <span className="bp-label !text-[var(--bp-accent)]">
                        {live.totalProperties} PARCELS ANALYZED
                      </span>
                    )}
                    <ArrowRight size={14} aria-hidden="true" className="text-[var(--bp-text-3)] transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[var(--bp-text-3)]">
              Dates and counts come from each county&apos;s published list — a county without a
              posted list shows as pending. Always confirm sale details on the county&apos;s
              official notice.
            </p>
          </div>
        </section>
      </RevealSection>

      {/* ── HOW IT WORKS (brief) + TOOL ──────────────────────────────────────── */}
      <RevealSection>
        <section className="border-t border-[var(--bp-hairline)] bg-[var(--bp-panel)] px-5 py-16 sm:px-8">
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-8 md:grid-cols-3">
            <div>
              <p className="bp-label mb-3 !text-[var(--bp-accent)]">01 · REDEEMABLE DEEDS</p>
              <p className="text-sm leading-relaxed text-[var(--bp-text-2)]">
                A Georgia tax sale buys a redeemable deed, not instant ownership — the owner
                generally has 12 months to redeem at a 20% first-year premium.
              </p>
            </div>
            <div>
              <p className="bp-label mb-3 !text-[var(--bp-accent)]">02 · FIRST TUESDAY</p>
              <p className="text-sm leading-relaxed text-[var(--bp-text-2)]">
                Sales run live on the courthouse steps, typically 10 AM–4 PM, certified funds due
                same day. Lists publish on county sites as sale day approaches.
              </p>
            </div>
            <div>
              <p className="bp-label mb-3 !text-[var(--bp-accent)]">03 · KNOW YOUR NUMBER</p>
              <p className="text-sm leading-relaxed text-[var(--bp-text-2)]">
                Run the payoff math with the free{' '}
                <Link href="/tools/redemption-calculator" className="font-semibold text-[var(--bp-accent)] hover:underline">
                  redemption calculator
                </Link>
                , then see every parcel scored with comps and a max bid.
              </p>
            </div>
          </div>
        </section>
      </RevealSection>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <RevealSection>
        <section className="relative overflow-hidden border-t border-[var(--bp-hairline)] px-5 py-20 sm:px-8 lg:py-24">
          <ParcelLines className="opacity-30" />
          <div className="relative mx-auto flex max-w-4xl flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <p className="bp-label mb-5 !text-[var(--bp-accent)]">ISSUE FOR BID</p>
              <h2 className="text-3xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-4xl">
                Every list, every parcel, scored.
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-[var(--bp-text-2)]">
                {TRIAL_LABEL} free trial — the research is done before you open the county PDF.
              </p>
            </div>
            <Link href="/signup" className="bp-btn-primary w-full max-w-sm px-8 py-4 text-base lg:w-auto">
              Start Free Trial
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </RevealSection>

      <Footer />
    </div>
  )
}
