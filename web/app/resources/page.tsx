import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import RevealSection from '@/components/RevealSection'
import ParcelLines from '@/components/blueprint/ParcelLines'
import TitleBlock from '@/components/blueprint/TitleBlock'
import type { LegendSymbol } from '@/components/blueprint/LegendRow'
import { ArrowRight } from 'lucide-react'
import { getAllGuides } from '@/lib/guides'

/* ── Blueprint Instrument rollout (2026-07-08) — /resources ────────────────────
   Direction: internal-notes/business/bidwise-design-direction-2026-07-06.md.
   The guide grid becomes a framed survey ledger: each guide is a map-legend row
   (linework symbol keyed to its category, mono meta = category + read time) that
   links to the guide. Category chips become mono survey stamps. Every guide,
   link, and the CollectionPage JSON-LD are unchanged — restyle only. */

export const metadata: Metadata = {
  title: 'Resources — BidWise | Auction Investing Guides',
  description:
    'Practical investor guides for tax deed sales, foreclosure auctions, and bid preparation. Step-by-step resources from the BidWise team — not generic real estate advice.',
  alternates: { canonical: `${SITE_URL}/resources` },
  openGraph: {
    title: 'BidWise Resources — Auction Investing Guides',
    description:
      'Step-by-step guides for researching, scoring, and bidding on auction properties with confidence.',
    url: `${SITE_URL}/resources`,
    type: 'website',
  },
}

// Maps a guide's category to a map-legend symbol so the ledger reads like a
// survey key. Any unmapped category falls back to the boundary dash.
const CATEGORY_SYMBOL: Record<string, LegendSymbol> = {
  'Getting Started': 'dot',
  Underwriting: 'square',
  Research: 'hatch',
  Risk: 'dash',
  'Auction Day': 'solid',
}

// Linework swatch — mirrors LegendRow's SymbolSwatch so guide rows share the
// exact map-legend vocabulary used across the site.
function SymbolSwatch({ symbol }: { symbol: LegendSymbol }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="h-7 w-7 shrink-0" fill="none">
      <rect x="0.5" y="0.5" width="27" height="27" stroke="var(--bp-hairline)" />
      {symbol === 'dash' && (
        <path d="M4 14 H24" stroke="var(--bp-accent)" strokeWidth="1.5" strokeDasharray="4 3" />
      )}
      {symbol === 'solid' && <path d="M4 14 H24" stroke="var(--bp-accent)" strokeWidth="1.5" />}
      {symbol === 'dot' && <circle cx="14" cy="14" r="3" fill="var(--bp-accent)" />}
      {symbol === 'hatch' && (
        <path d="M2 20 L20 2 M8 26 L26 8" stroke="var(--bp-accent)" strokeOpacity="0.7" strokeWidth="1.25" />
      )}
      {symbol === 'square' && (
        <rect x="8" y="8" width="12" height="12" stroke="var(--bp-accent)" strokeWidth="1.5" fill="var(--bp-accent-soft)" />
      )}
    </svg>
  )
}

type GuideRowProps = {
  href: string
  symbol: LegendSymbol
  title: string
  description: string
  category: string
  minutes: number
}

// Survey-ledger guide entry: swatch + title/description + mono meta, wrapped as
// a full-row link with an accent title-hover and a travelling arrow.
function GuideRow({ href, symbol, title, description, category, minutes }: GuideRowProps) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 border-b border-[var(--bp-hairline)] px-5 py-5 transition-colors last:border-b-0 hover:bg-[var(--bp-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--bp-accent-bright)] sm:gap-5"
    >
      <SymbolSwatch symbol={symbol} />
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold text-[var(--bp-text-1)] transition-colors group-hover:text-[var(--bp-accent)]">
          {title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--bp-text-2)]">{description}</p>
        {/* Mobile: meta stacks under the copy so the title keeps a full-width
            measure instead of wrapping against a fixed right column. */}
        <span className="bp-label mt-3 inline-flex items-center gap-1.5 sm:hidden">
          {category} · {minutes} MIN
          <ArrowRight
            size={13}
            aria-hidden="true"
            className="text-[var(--bp-accent)] transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </div>
      {/* sm+: right-aligned survey-ledger meta + travelling arrow. */}
      <div className="ml-1 hidden shrink-0 flex-col items-end gap-2 text-right sm:flex">
        <span className="bp-label whitespace-nowrap">{category} · {minutes} MIN</span>
        <ArrowRight
          size={15}
          aria-hidden="true"
          className="text-[var(--bp-text-3)] transition-all group-hover:translate-x-0.5 group-hover:text-[var(--bp-accent)]"
        />
      </div>
    </Link>
  )
}

export default function ResourcesPage() {
  const guides = getAllGuides()

  // Category chips with live counts derived from published guides.
  const categoryCounts = guides.reduce<Record<string, number>>((acc, g) => {
    acc[g.category] = (acc[g.category] ?? 0) + 1
    return acc
  }, {})
  const categories = Object.entries(categoryCounts).map(([name, count]) => ({ name, count }))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'BidWise Investor Resources',
    description:
      'Practical guides for researching, scoring, and bidding on auction properties.',
    hasPart: guides.map(g => ({
      '@type': 'Article',
      headline: g.title,
      description: g.description,
      articleSection: g.category,
      url: `${SITE_URL}/resources/${g.slug}`,
    })),
  }

  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />

      {/* ── HERO — field-guide sheet header ─────────────────────────────────── */}
      <section
        aria-labelledby="resources-hero-heading"
        className="relative overflow-hidden border-b border-[var(--bp-hairline)] px-5 pb-14 pt-32 sm:px-8 lg:pt-40"
      >
        <ParcelLines className="opacity-25" />
        <div className="relative mx-auto max-w-3xl">
          <p className="bp-label mb-5 !text-[var(--bp-accent)]">FIELD GUIDES · INDEX</p>
          <h1
            id="resources-hero-heading"
            className="text-4xl font-bold leading-[1.05] tracking-tight text-[var(--bp-text-1)] sm:text-5xl md:text-6xl"
          >
            Investor guides,
            <br />
            <span className="text-[var(--bp-text-3)]">not generic advice.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--bp-text-2)]">
            Step-by-step resources from the BidWise team for researching, scoring, and bidding on auction properties with confidence.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/signup" className="bp-btn-primary px-7 py-3 text-sm">
              Start Free Trial
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {categories.map(c => (
                  <span
                    key={c.name}
                    className="inline-flex items-center gap-2 border border-[var(--bp-hairline-strong)] px-3 py-1.5"
                  >
                    <span className="bp-label !text-[var(--bp-text-2)]">{c.name}</span>
                    <span className="bp-label !text-[var(--bp-accent)]">
                      {String(c.count).padStart(2, '0')}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── LEDGER — framed guide index ─────────────────────────────────────── */}
      <RevealSection>
        <section aria-labelledby="guides-heading" className="px-5 py-20 sm:px-8 lg:py-24">
          <div className="mx-auto max-w-4xl">
            <h2 id="guides-heading" className="sr-only">
              Investor guides
            </h2>
            <TitleBlock label="FIELD GUIDES" index={`${guides.length} ENTRIES`} bodyClassName="p-0">
              {guides.map(g => (
                <GuideRow
                  key={g.slug}
                  href={`/resources/${g.slug}`}
                  symbol={CATEGORY_SYMBOL[g.category] ?? 'dash'}
                  title={g.title}
                  description={g.description}
                  category={g.category}
                  minutes={g.minutes}
                />
              ))}
            </TitleBlock>
          </div>
        </section>
      </RevealSection>

      {/* ── SUBSCRIBE — issue-for-bid CTA band ──────────────────────────────── */}
      <RevealSection>
        <section
          aria-labelledby="resources-cta-heading"
          className="relative overflow-hidden border-t border-[var(--bp-hairline)] px-5 py-24 sm:px-8 lg:py-32"
        >
          <ParcelLines className="opacity-30" />
          <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <p className="bp-label mb-5 !text-[var(--bp-accent)]">FIELD NOTES · UPDATES</p>
              <h2
                id="resources-cta-heading"
                className="text-4xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-5xl"
              >
                Get the guides in your inbox.
              </h2>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-[var(--bp-text-2)]">
                New guides added regularly. Members get them first, with worked examples from real BidWise deal analyses. No spam, unsubscribe anytime.
              </p>
            </div>

            <div className="w-full max-w-sm space-y-3">
              <Link href="/signup" className="bp-btn-primary w-full px-8 py-4 text-base">
                Start Free Trial
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/how-it-works" className="bp-btn-ghost w-full px-8 py-4 text-base">
                See How It Works
              </Link>
              <p className="bp-label pt-2 text-center">NEW GUIDES ADDED REGULARLY · NO SPAM</p>
            </div>
          </div>
        </section>
      </RevealSection>

      <Footer />
    </div>
  )
}
