import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

/* ── Blueprint Instrument rollout (2026-07-08) — /privacy ──────────────────────
   Direction: internal-notes/business/bidwise-design-direction-2026-07-06.md.
   Legal surface = restraint. Tokens only: dark bp theme, a calm single reading
   column, a mono sheet header, hairline rules between sections, accent links.
   No plat-map motifs over legal copy. The legal COPY is unchanged — only the
   header chrome and the typographic sub-components are restyled. */

export const metadata: Metadata = {
  title: 'Privacy Policy — BidWise',
  description:
    'How BidWise Invest collects, uses, and protects your information. Includes CCPA rights for California residents.',
  alternates: { canonical: `${SITE_URL}/privacy` },
  robots: { index: true, follow: true },
}

const LAST_UPDATED = 'May 22, 2026'

/**
 * `?app=ios` hides the site chrome — see the matching note in /terms. This page
 * opens inside the iOS app from the paywall, and Navbar's "Start Free Trial"
 * CTA into Stripe checkout would steer an in-app buyer to an external purchase
 * (Guideline 3.1.1). The policy text is identical either way.
 */
export default async function PrivacyPage({
  searchParams,
}: {
  searchParams?: Promise<{ app?: string }>
}) {
  const inApp = (await searchParams)?.app === 'ios'
  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      {inApp ? null : <Navbar />}

      <section className="border-b border-[var(--bp-hairline)] px-5 pb-12 pt-32 sm:px-8 lg:pt-40">
        <div className="mx-auto max-w-3xl">
          <p className="bp-label mb-5 !text-[var(--bp-accent)]">Legal · Privacy</p>
          <h1 className="text-4xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="bp-label mt-5">Last updated · {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8">
        <article className="mx-auto max-w-3xl">
          <P>
            BidWise Ai LLC (&ldquo;BidWise,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the
            BidWise app, website, and related services. This Privacy Policy explains what
            information we collect about you, how we use it, who we share it with, and the
            rights you have. It applies to our website at bidwiseinvest.com, our mobile app, and
            any related services (collectively, the &ldquo;Service&rdquo;).
          </P>
          <P>
            By using the Service you agree to the practices described here. If you do not agree,
            do not use the Service.
          </P>

          <H2>1. Information we collect</H2>

          <H3>1.1 Information you provide</H3>
          <UL>
            <LI><B>Account information.</B> Email address and password when you create an account. Optional profile fields like your name and county preference.</LI>
            <LI><B>Subscription information.</B> When you subscribe, our payment processor (Stripe) collects your billing details directly. We receive a subscription status, plan tier, and customer identifier — we do not store full card numbers.</LI>
            <LI><B>Watchlist and pipeline data.</B> Criteria you set on watchlists (county, minimum equity, minimum deal score), properties you save, and properties you add to your pipeline.</LI>
            <LI><B>Communications.</B> If you contact support, we keep a record of the conversation and the email address you used.</LI>
          </UL>

          <H3>1.2 Information we collect automatically</H3>
          <UL>
            <LI><B>Usage data.</B> Pages or screens you view, features you use, and the time and date of those actions.</LI>
            <LI><B>Device data.</B> Device type, operating system, mobile push notification token (if you grant permission), app version, and a session identifier.</LI>
            <LI><B>Log data.</B> IP address, browser or app user-agent string, and approximate location derived from IP for security and analytics purposes.</LI>
            <LI><B>Cookies and similar technologies.</B> The website uses essential session cookies for sign-in. We do not use third-party advertising or cross-site tracking cookies.</LI>
          </UL>

          <H3>1.3 Information we do not collect</H3>
          <P>
            We do not collect government-issued identifiers, precise GPS location, contact lists,
            health data, biometric identifiers, or photos and videos from your device. We do not
            use third-party advertising SDKs.
          </P>

          <H2>2. How we use information</H2>
          <UL>
            <LI>Operate, maintain, and improve the Service.</LI>
            <LI>Authenticate you and keep your account secure.</LI>
            <LI>Process subscription payments and send billing notices.</LI>
            <LI>Send watchlist match alerts you have opted into (email and push).</LI>
            <LI>Respond to support requests and provide customer service.</LI>
            <LI>Detect, prevent, and respond to fraud, abuse, and security incidents.</LI>
            <LI>Comply with legal obligations and enforce our Terms of Service.</LI>
          </UL>

          <H2>3. How we share information</H2>
          <P>
            We do not sell your personal information. We share limited information with the
            following categories of service providers strictly to operate the Service:
          </P>
          <UL>
            <LI><B>Hosting and database (Supabase).</B> Stores your account, watchlists, pipeline data, and notification preferences. Located in the United States.</LI>
            <LI><B>Payments (Stripe).</B> Processes subscription payments. Stripe is the controller of payment card data; we receive only the subscription state.</LI>
            <LI><B>Email delivery (Resend).</B> Sends transactional and watchlist alert emails on our behalf.</LI>
            <LI><B>Push notifications (Expo, APNs, FCM).</B> Delivers push notifications to your device. The push token itself is opaque and tied only to your account.</LI>
            <LI><B>Diagnostics and product analytics (Sentry, PostHog).</B> Crash reports, performance data, and in-app product-interaction events, associated with your account identifier so we can reproduce and fix faults. Not linked to advertising and not used for tracking across other companies&rsquo; apps or websites.</LI>
            <LI><B>In-app purchases (Apple, RevenueCat).</B> If you subscribe inside the iOS app, Apple processes the payment and is the merchant of record, and RevenueCat relays your subscription entitlement status to us. We never receive your card details.</LI>
            <LI><B>Property data providers.</B> We obtain public auction and county property records from third-party data sources. These transfers are outbound (provider to us) and do not involve your personal information.</LI>
          </UL>
          <P>
            We may also disclose information when required by law, in response to a valid legal
            process, to protect the safety of users or the public, or in connection with a merger,
            acquisition, or sale of assets (subject to confidentiality protections).
          </P>

          <H2>4. Data retention</H2>
          <P>
            We retain account information for as long as your account is active and for a
            reasonable period afterward to comply with legal obligations, resolve disputes, and
            enforce our agreements. You may request deletion at any time using the contact
            information below; we will delete or anonymize your data within 30 days unless we are
            required to retain it.
          </P>

          <H2>5. Security</H2>
          <P>
            We use industry-standard safeguards including TLS encryption in transit, encryption
            at rest for our database, role-based access controls, and row-level security policies
            on user data. No system is perfectly secure; we cannot guarantee absolute protection
            of your information.
          </P>

          <H2>6. Your California privacy rights (CCPA / CPRA)</H2>
          <P>
            If you are a California resident, you have the following rights regarding your
            personal information:
          </P>
          <UL>
            <LI><B>Right to know</B> what categories of personal information we collect, the sources, the purposes, and the categories of third parties we share it with.</LI>
            <LI><B>Right to access</B> the specific pieces of personal information we hold about you.</LI>
            <LI><B>Right to delete</B> personal information we have collected from you, subject to legal exceptions.</LI>
            <LI><B>Right to correct</B> inaccurate personal information.</LI>
            <LI><B>Right to opt out</B> of the sale or sharing of personal information. We do not sell or share personal information for cross-context behavioral advertising.</LI>
            <LI><B>Right to non-discrimination</B> for exercising any of the above rights.</LI>
          </UL>
          <P>
            To exercise these rights, email <A href="mailto:privacy@bidwiseinvest.com">privacy@bidwiseinvest.com</A> from the email
            address on your account, or send a written request to the mailing address below.
            We will verify the request and respond within 45 days as required by law.
          </P>

          <H2>7. Children</H2>
          <P>
            The Service is not directed to children under 18. We do not knowingly collect personal
            information from children under 18. If you believe a child has provided us with personal
            information, contact us and we will delete it.
          </P>

          <H2>8. International users</H2>
          <P>
            BidWise is operated from the United States. If you access the Service from outside the
            United States, you understand that your information will be transferred to and processed
            in the United States, which may have different data protection rules than your country.
          </P>

          <H2>9. Changes to this policy</H2>
          <P>
            We may update this Privacy Policy from time to time. When we do, we will update the
            &ldquo;Last updated&rdquo; date at the top and, for material changes, give you notice through the
            Service or by email. Continued use of the Service after a change constitutes acceptance.
          </P>

          <H2>10. App Store distribution</H2>
          <P>
            The BidWise iOS app is currently distributed through an Apple Developer Program
            account registered to Voyant LLC. The App Store may display Voyant LLC as the
            seller of record on the app&rsquo;s listing during this transition period. BidWise Ai LLC
            remains the operator of the Service and the controller of all personal information
            described in this Privacy Policy. We expect to transition the developer account to
            BidWise Ai LLC and will update this section when the transfer is complete.
          </P>

          <H2>11. Contact us</H2>
          <P>
            BidWise Ai LLC<br />
            Attn: Privacy<br />
            8735 Dunwoody Place, #STE R<br />
            Atlanta, GA 30350<br />
            United States<br />
            Email: <A href="mailto:privacy@bidwiseinvest.com">privacy@bidwiseinvest.com</A>
          </P>
        </article>
      </section>

      {inApp ? null : <Footer />}
    </div>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-5 mt-14 border-t border-[var(--bp-hairline)] pt-8 font-display text-xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-2xl">
      {children}
    </h2>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 mt-8 font-display text-base font-semibold text-[var(--bp-text-1)]">
      {children}
    </h3>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-[15px] leading-relaxed text-[var(--bp-text-2)]">
      {children}
    </p>
  )
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mb-4 ml-5 list-disc space-y-2 marker:text-[var(--bp-text-3)]">
      {children}
    </ul>
  )
}

function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="pl-1 text-[15px] leading-relaxed text-[var(--bp-text-2)]">
      {children}
    </li>
  )
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-[var(--bp-text-1)]">{children}</strong>
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-[var(--bp-accent)] underline-offset-4 transition-colors hover:text-[var(--bp-accent-bright)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bp-accent-bright)]"
    >
      {children}
    </a>
  )
}
