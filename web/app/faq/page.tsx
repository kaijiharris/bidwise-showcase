import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import RevealSection from '@/components/RevealSection'
import ParcelLines from '@/components/blueprint/ParcelLines'
import TitleBlock from '@/components/blueprint/TitleBlock'
import { FAQS } from '@/lib/faq-data'
import { TRIAL_DAYS } from '@/lib/trial'
import { ChevronDown, ArrowRight } from 'lucide-react'

/* ── Blueprint Instrument rollout (2026-07-08) — /faq ──────────────────────────
   Direction: internal-notes/business/bidwise-design-direction-2026-07-06.md.
   The inquiry list becomes a framed survey index; each question is a hairline
   accordion row mirroring the homepage FAQ voice (SHT 05 · INQUIRIES). The
   FAQPage JSON-LD schema and every Q&A in lib/faq-data are unchanged — restyle
   only. Accordion is CSS-only (details/summary), so the page stays a Server
   Component with no client JS. */

export const metadata: Metadata = {
  title: 'FAQ — BidWise | Auction Property Analysis Questions Answered',
  description:
    'Answers to common questions about BidWise: how deal scoring works, what counties we cover, data sources, pricing, and how to start your free trial.',
  alternates: { canonical: `${SITE_URL}/faq` },
  openGraph: {
    title: 'BidWise FAQ — Auction Property Analysis',
    description:
      'Common questions about BidWise auction analysis: deal scoring, county coverage, data sources, and pricing.',
    url: `${SITE_URL}/faq`,
    type: 'website',
  },
}

// Hairline accordion row — mirrors the homepage FaqItem: accent chevron that
// rotates open, mono-quiet body copy. Pure CSS disclosure, no client runtime.
function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-[var(--bp-hairline)] last:border-b-0">
      <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-4 py-5 text-[15px] font-semibold text-[var(--bp-text-1)] transition-colors hover:text-[var(--bp-accent)]">
        {q}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="shrink-0 text-[var(--bp-text-3)] transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <p className="pb-5 pr-8 text-sm leading-relaxed text-[var(--bp-text-2)]">{a}</p>
    </details>
  )
}

export default function FAQPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />

      {/* ── HERO — inquiry sheet header ─────────────────────────────────────── */}
      <section
        aria-labelledby="faq-hero-heading"
        className="relative overflow-hidden border-b border-[var(--bp-hairline)] px-5 pb-14 pt-32 sm:px-8 lg:pt-40"
      >
        <ParcelLines className="opacity-25" />
        <div className="relative mx-auto max-w-3xl">
          <p className="bp-label mb-5 !text-[var(--bp-accent)]">INQUIRIES · FULL INDEX</p>
          <h1
            id="faq-hero-heading"
            className="text-4xl font-bold leading-[1.05] tracking-tight text-[var(--bp-text-1)] sm:text-5xl"
          >
            Everything you need to know,
            <br />
            <span className="text-[var(--bp-text-3)]">before you bid.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--bp-text-2)]">
            Honest answers about how BidWise works, what data we use, and how investors get value.
          </p>
          <div className="mt-8">
            <Link href="/signup" className="bp-btn-primary px-7 py-3 text-sm">
              Start Free Trial
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── INDEX — framed survey accordion ─────────────────────────────────── */}
      <RevealSection>
        <section aria-labelledby="faq-index-heading" className="px-5 py-20 sm:px-8 lg:py-24">
          <div className="mx-auto max-w-3xl">
            <h2 id="faq-index-heading" className="sr-only">
              Frequently asked questions
            </h2>
            <TitleBlock
              label="INQUIRIES"
              index={`${FAQS.length} ENTRIES`}
              bodyClassName="px-5 sm:px-7"
            >
              {FAQS.map(f => (
                <FaqItem key={f.q} {...f} />
              ))}
            </TitleBlock>
          </div>
        </section>
      </RevealSection>

      {/* ── STILL HAVE A QUESTION — issue-for-bid CTA band ──────────────────── */}
      <RevealSection>
        <section
          aria-labelledby="faq-cta-heading"
          className="relative overflow-hidden border-t border-[var(--bp-hairline)] px-5 py-24 sm:px-8 lg:py-32"
        >
          <ParcelLines className="opacity-30" />
          <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <p className="bp-label mb-5 !text-[var(--bp-accent)]">SUPPORT · DIRECT LINE</p>
              <h2
                id="faq-cta-heading"
                className="text-4xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-5xl"
              >
                Still have a question?
              </h2>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-[var(--bp-text-2)]">
                The fastest way to get a clear answer is to start the free trial and explore. No charge for {TRIAL_DAYS} days.
              </p>
              <p className="mt-4 text-sm text-[var(--bp-text-3)]">
                Prefer a human? Email{' '}
                <a
                  href="mailto:support@bidwiseinvest.com"
                  className="font-medium text-[var(--bp-accent)] underline-offset-4 transition-colors hover:text-[var(--bp-accent-bright)] hover:underline"
                >
                  support@bidwiseinvest.com
                </a>
              </p>
            </div>

            <div className="w-full max-w-sm space-y-3">
              <Link href="/signup" className="bp-btn-primary w-full px-8 py-4 text-base">
                Start Free Trial
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/pricing" className="bp-btn-ghost w-full px-8 py-4 text-base">
                See Pricing
              </Link>
              <p className="bp-label pt-2 text-center">{`${TRIAL_DAYS}-DAY TRIAL · NO CHARGE UNTIL DAY ${TRIAL_DAYS}`}</p>
            </div>
          </div>
        </section>
      </RevealSection>

      <Footer />
    </div>
  )
}
