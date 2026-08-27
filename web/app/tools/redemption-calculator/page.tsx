import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import ParcelLines from '@/components/blueprint/ParcelLines'
import { KNOWN_COUNTIES } from '@/lib/county-data'
import { COUNTY_PAGES, countyPageSlug } from '@/lib/county-pages'
import CalculatorClient from './CalculatorClient'

/* ── /tools/redemption-calculator ──────────────────────────────────────────────
   Free interactive lead magnet targeting "georgia tax sale redemption
   calculator / 20% premium" intent. Strategic point from the competitive
   teardown: list vendors have NO bid/return math — a calculator is a
   defensible content asset that also demonstrates the product's core skill.
   Math lives in lib/redemption (unit-tested); page is public + indexed. */

const SITE_URL = 'https://www.bidwiseinvest.com'
const PAGE_URL = `${SITE_URL}/tools/redemption-calculator`

export const metadata: Metadata = {
  title: 'Georgia Tax Sale Redemption Calculator — 20% Premium & Returns | BidWise',
  description:
    'Free calculator for Georgia tax-deed investors: what the owner pays to redeem (20% first-year premium, +10% per additional year), your profit, and your annualized return — plus the minimum bid for a target profit.',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: 'Georgia Tax Sale Redemption Calculator',
    description:
      'What the owner pays to redeem, your premium profit, and your annualized return — the Georgia tax-deed math, instantly.',
    url: PAGE_URL,
    type: 'website',
  },
}

export default function RedemptionCalculatorPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Georgia Tax Sale Redemption Calculator',
    url: PAGE_URL,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }

  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Navbar />

      <section className="relative overflow-hidden border-b border-[var(--bp-hairline)] px-5 pb-14 pt-32 sm:px-8 lg:pt-40">
        <ParcelLines className="opacity-25" />
        <div className="relative mx-auto max-w-4xl">
          <p className="bp-label mb-5 !text-[var(--bp-accent)]">FREE TOOL · GEORGIA REDEMPTION MATH</p>
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight text-[var(--bp-text-1)] sm:text-5xl">
            Redemption calculator,
            <br />
            <span className="text-[var(--bp-text-3)]">for Georgia tax deeds.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--bp-text-2)]">
            If the owner redeems, Georgia&apos;s premium is generally 20% of your bid in the first
            year (or any fraction of it) plus 10% for each additional year. Put in your numbers —
            see the payoff, the return on cash, and what it annualizes to.
          </p>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <CalculatorClient />
          <p className="mt-8 text-xs leading-relaxed text-[var(--bp-text-3)]">
            Simplified model for research: actual redemption amounts can include statutory extras
            and case-specific costs, and the rules have edge cases. Not legal, tax, or investment
            advice — verify the current statute and consult a Georgia real-estate attorney before
            bidding.
          </p>

          <div className="mt-12 border-t border-[var(--bp-hairline)] pt-8">
            <p className="bp-label mb-4">UPCOMING GEORGIA TAX SALES</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {KNOWN_COUNTIES.map(c => (
                <Link
                  key={c}
                  href={`/tax-sale/${countyPageSlug(c)}`}
                  className="bp-label !text-[var(--bp-accent)] transition-colors hover:!text-[var(--bp-text-1)]"
                >
                  {COUNTY_PAGES[c].name.toUpperCase()} COUNTY →
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
