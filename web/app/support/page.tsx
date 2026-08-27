import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

/* ── /support ──────────────────────────────────────────────────────────────────
   App Store Connect requires a Support URL that RESOLVES for an anonymous
   visitor. Before this page existed, /support 307'd to /login (default-deny
   middleware), which would have failed the listing form. This route must stay in
   middleware's PUBLIC_ROUTES — an Apple reviewer is never signed in.
   Styling follows the /terms Blueprint conventions: single reading column,
   hairline rules, accent labels. */

const SUPPORT_EMAIL = 'support@bidwiseinvest.com'
const RESPONSE_WINDOW = '1 business day'

export const metadata: Metadata = {
  title: 'Support — BidWise',
  description:
    'Get help with BidWise Invest: contact support, manage your subscription, delete your account, and find answers to common questions.',
  alternates: { canonical: `${SITE_URL}/support` },
  robots: { index: true, follow: true },
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--bp-hairline)] py-8">
      <h2 className="mb-3 text-xl font-semibold text-[var(--bp-text-1)]">{title}</h2>
      <div className="space-y-3 text-[var(--bp-text-2)]">{children}</div>
    </section>
  )
}

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      <Navbar />

      <section className="border-b border-[var(--bp-hairline)] px-5 pb-12 pt-32 sm:px-8 lg:pt-40">
        <div className="mx-auto max-w-3xl">
          <p className="bp-label mb-5 !text-[var(--bp-accent)]">Help · Support</p>
          <h1 className="text-4xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-5xl">
            Support
          </h1>
          <p className="mt-5 text-lg text-[var(--bp-text-2)]">
            Questions about your account, your subscription, or the data? Email us and a human
            replies within {RESPONSE_WINDOW}.
          </p>
        </div>
      </section>

      <section className="px-5 py-12 sm:px-8">
        <article className="mx-auto max-w-3xl">
          <div className="rounded-lg border border-[var(--bp-hairline)] p-6">
            <p className="bp-label mb-2">Contact</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-2xl font-semibold text-[var(--bp-accent)] hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
            <p className="mt-3 text-sm text-[var(--bp-text-2)]">
              Include your account email and, if you are reporting a data issue, the county and
              parcel number. That is usually enough for us to reproduce it on the first reply.
            </p>
          </div>

          <Section title="Managing your subscription">
            <p>
              If you subscribed on the <strong>web</strong>, manage or cancel your plan from your
              account billing settings; changes take effect at the end of the current billing
              period.
            </p>
            <p>
              If you subscribed <strong>inside the iOS app</strong>, Apple handles billing. Manage
              or cancel it in the Settings app under your Apple Account &rarr; Subscriptions. We
              cannot cancel or refund an Apple subscription on your behalf — Apple does not give
              developers that ability.
            </p>
          </Section>

          <Section title="Deleting your account">
            <p>
              You can delete your account and its data from the Profile tab in the mobile app, or by
              emailing {SUPPORT_EMAIL} from your account address. Deletion removes your profile,
              saved pipeline, and watchlist. It does not cancel an Apple subscription — cancel that
              in Settings first, or you will continue to be billed.
            </p>
          </Section>

          <Section title="About the data">
            <p>
              BidWise analyzes publicly published county tax-deed auction lists. Valuations,
              after-repair values, and recommended maximum bids are <strong>estimates</strong>{' '}
              generated from comparable sales and public records. They are not appraisals, and they
              are not investment, legal, or tax advice. Always verify a parcel independently before
              bidding.
            </p>
            <p>
              County sources publish and revise lists on their own schedules. Parcels are frequently
              redeemed and removed before sale day.
            </p>
          </Section>

          <Section title="More">
            <p className="flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/faq" className="text-[var(--bp-accent)] hover:underline">
                Frequently asked questions
              </Link>
              <Link href="/how-it-works" className="text-[var(--bp-accent)] hover:underline">
                How it works
              </Link>
              <Link href="/terms" className="text-[var(--bp-accent)] hover:underline">
                Terms of Service
              </Link>
              <Link href="/privacy" className="text-[var(--bp-accent)] hover:underline">
                Privacy Policy
              </Link>
            </p>
          </Section>
        </article>
      </section>

      <Footer />
    </div>
  )
}
