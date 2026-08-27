import Link from 'next/link'
import Image from 'next/image'
import ParcelLines from '@/components/blueprint/ParcelLines'
import { FREE_LIST_COUNTIES, COUNTY_LABELS } from '@/lib/free-list'

// Blueprint Instrument chrome (2026-07-08): base #0B0E14 so the footer reads as
// the closing sheet of the page above it; column headers become mono survey
// stamps (.bp-label); link hovers unify on --bp-accent (#3B82F6), killing the
// legacy #10A7FF. Wordmark, all links/routes, and disclaimer copy untouched.
const PRODUCT_LINKS = [
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'Pricing', href: '/pricing' },
  // Free county lists — auto-extends as counties join FREE_LIST_COUNTIES.
  ...FREE_LIST_COUNTIES.map(c => ({
    label: `Free ${COUNTY_LABELS[c]} List`,
    href: `/free-list/${c}`,
  })),
  { label: 'Start Free Trial', href: '/signup' },
  { label: 'Sign In', href: '/login' },
]

const RESOURCE_LINKS = [
  { label: 'Resources', href: '/resources' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Contact', href: 'mailto:support@bidwiseinvest.com' },
]

const linkClass =
  'text-sm text-[var(--bp-text-2)] transition-colors hover:text-[var(--bp-accent)] rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--bp-accent-bright)]'

export default function Footer() {
  return (
    <footer className="relative overflow-hidden bg-[var(--bp-base)] border-t border-[var(--bp-hairline)]">
      <ParcelLines className="opacity-[0.14]" />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">

          {/* Brand */}
          <div className="md:col-span-2">
            <Image
              src="/logo-wordmark.png"
              alt="BidWise"
              width={1536}
              height={1024}
              className="h-14 w-auto object-contain -ml-2"
            />
            <p className="mt-3 text-sm text-[var(--bp-text-2)] leading-relaxed max-w-sm">
              Investor-grade auction property analysis. Find better deals faster with comparable sales, deal scoring, and risk checks — built for real estate investors who want data on their side.
            </p>
            <p className="bp-label mt-5">
              © {new Date().getFullYear()} BidWise Ai LLC · All rights reserved
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="bp-label mb-4">Product</h4>
            <ul className="space-y-3">
              {PRODUCT_LINKS.map(l => (
                <li key={l.href}>
                  <Link href={l.href} className={linkClass}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="bp-label mb-4">Resources</h4>
            <ul className="space-y-3">
              {RESOURCE_LINKS.map(l => (
                <li key={l.href}>
                  <Link href={l.href} className={linkClass}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Survey-notice disclaimer */}
        <div className="mt-12 pt-6 border-t border-[var(--bp-hairline)]">
          <p className="bp-label mb-2 !text-[var(--bp-accent)]">Disclaimer · Research Tool</p>
          <p className="text-xs leading-relaxed text-[var(--bp-text-3)]">
            BidWise is a research and analysis tool. Analysis is based on public records and third-party data sources. Nothing on this platform constitutes investment advice or a guarantee of returns. Real estate investing involves risk. Always perform your own due diligence before bidding on any property.
          </p>
        </div>
      </div>
    </footer>
  )
}
