import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

/* ── Blueprint Instrument rollout (2026-07-08) — /terms ────────────────────────
   Direction: internal-notes/business/bidwise-design-direction-2026-07-06.md.
   Legal surface = restraint. Tokens only: dark bp theme, a calm single reading
   column, a mono sheet header, hairline rules between sections, accent links,
   and the risk disclaimer as an accent-framed callout. No plat-map motifs over
   legal copy. The legal COPY is unchanged — only the chrome and the typographic
   sub-components are restyled. */

export const metadata: Metadata = {
  title: 'Terms of Service — BidWise',
  description:
    'The terms and conditions that govern your use of BidWise Invest, including subscription terms, disclaimers, and limitation of liability.',
  alternates: { canonical: `${SITE_URL}/terms` },
  robots: { index: true, follow: true },
}

const LAST_UPDATED = 'May 22, 2026'

/**
 * `?app=ios` hides the site chrome. This page opens inside the iOS app via
 * WebBrowser, two taps from the IAP purchase button, and Navbar carries a
 * "Start Free Trial" CTA into Stripe checkout — steering an in-app buyer to an
 * external purchase (Guideline 3.1.1). The legal text is identical either way.
 */
export default async function TermsPage({
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
          <p className="bp-label mb-5 !text-[var(--bp-accent)]">Legal · Terms</p>
          <h1 className="text-4xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-5xl">
            Terms of Service
          </h1>
          <p className="bp-label mt-5">Last updated · {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8">
        <article className="mx-auto max-w-3xl">
          <P>
            These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you and BidWise
            Ai LLC (&ldquo;BidWise,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). They govern your access
            to and use of bidwiseinvest.com, our mobile application, and any related services
            (collectively, the &ldquo;Service&rdquo;).
          </P>
          <P>
            <B>By creating an account or using the Service, you agree to these Terms and to our
            </B> <A href="/privacy">Privacy Policy</A>. If you do not agree, do not use the
            Service.
          </P>

          <Callout>
            BidWise is an informational research tool. It is not financial, legal, tax, or
            investment advice. Real estate investing — and tax-deed and tax-lien investing in
            particular — carries substantial risk of loss. You are solely responsible for
            verifying every figure and conducting your own due diligence before placing a bid or
            making any purchase decision.
          </Callout>

          <H2>1. Eligibility and account</H2>
          <P>
            You must be at least 18 years old and have the legal capacity to enter into a binding
            contract to use the Service. You agree to provide accurate registration information,
            to keep it current, and to keep your password confidential. You are responsible for
            all activity that occurs under your account.
          </P>

          <H2>2. Subscriptions and billing</H2>
          <UL>
            <LI><B>Plans.</B> Access to paid features requires an active subscription. Plan tiers, prices, and included features are described on our pricing page and may change with notice.</LI>
            <LI><B>Billing.</B> Subscriptions are billed in advance on a recurring basis (monthly or annually, as selected). Subscriptions purchased on our website are processed by Stripe; subscriptions purchased in the iOS app are processed by Apple (see below).</LI>
            <LI><B>Apple In-App Purchase.</B> Subscriptions purchased in the BidWise iOS app are sold by Apple through In-App Purchase and billed to your Apple Account, not by Stripe. They renew automatically unless auto-renew is turned off at least 24 hours before the end of the current period, and are managed or cancelled in your device&rsquo;s App Store subscription settings — not from your BidWise account settings. Refund requests for App Store purchases are handled by Apple under Apple&rsquo;s policies. The Stripe terms in this section apply to subscriptions purchased on our website.</LI>
            <LI><B>Renewal.</B> Subscriptions automatically renew at the end of each billing cycle until cancelled.</LI>
            <LI><B>Cancellation.</B> You may cancel at any time from your account settings or by contacting support. Cancellation takes effect at the end of the current billing cycle; you retain access until then.</LI>
            <LI><B>Refunds.</B> Except where required by law, payments are non-refundable, including for partial billing periods.</LI>
            <LI><B>Free trials.</B> If we offer a free trial, you will not be charged during the trial period. Unless you cancel before the trial ends, your subscription begins automatically and the applicable plan price is charged.</LI>
            <LI><B>Price changes.</B> We may change prices on renewal. We will notify you in advance of any price change affecting your subscription, and you may cancel before the change takes effect.</LI>
          </UL>

          <H2>3. Permitted use</H2>
          <P>You may use the Service for your own lawful research and investment evaluation. You may not:</P>
          <UL>
            <LI>Resell, redistribute, or syndicate the Service or any data obtained through it without our prior written consent.</LI>
            <LI>Scrape, crawl, or use automated means to access the Service except via interfaces we expressly provide.</LI>
            <LI>Reverse-engineer, decompile, or attempt to extract source code, except where this restriction is prohibited by law.</LI>
            <LI>Interfere with, disrupt, or attempt to circumvent any security or access controls of the Service.</LI>
            <LI>Use the Service to harass, defame, or harm property owners or other individuals identified in any data.</LI>
            <LI>Use the Service in violation of any applicable law, including fair housing, anti-solicitation, do-not-call, or anti-discrimination laws.</LI>
            <LI>Share your account credentials with anyone else, or use the Service on behalf of another business without a separate license from us.</LI>
          </UL>

          <H2>4. Property data and accuracy</H2>
          <P>
            The Service aggregates publicly available auction notices, tax records, county
            documents, and comparable sales data from third-party sources. We do not guarantee
            the accuracy, completeness, timeliness, or fitness for any particular purpose of any
            data presented. Property records change frequently; auctions may be postponed,
            withdrawn, or contested.
          </P>
          <P>
            Deal scores, ROI estimates, ARV estimates, rehab estimates, and similar calculations
            are model outputs generated by our software for informational purposes. They are not
            appraisals, valuations, or professional opinions and must not be relied on as such.
            You agree to independently verify every figure before bidding.
          </P>

          <H2>5. No investment, legal, or tax advice</H2>
          <P>
            Nothing in the Service constitutes investment advice, legal advice, tax advice, or a
            recommendation to buy, sell, or hold any property or financial instrument. We are not
            a broker, dealer, investment advisor, attorney, accountant, or fiduciary. You should
            consult qualified licensed professionals before making any investment, legal, or tax
            decision.
          </P>

          <H2>6. Risk acknowledgement</H2>
          <P>
            Real estate investing, including tax-deed and tax-lien purchases, carries substantial
            risks including but not limited to: title defects and clouds; redemption by the prior
            owner; superior liens that survive sale; environmental contamination; physical damage;
            occupancy and eviction costs; quiet-title litigation expense and duration; legal and
            regulatory changes; and total loss of capital. You acknowledge these risks and accept
            sole responsibility for your decisions and outcomes.
          </P>

          <H2>7. Intellectual property</H2>
          <P>
            The Service — including software, design, text, graphics, model outputs, and
            aggregated data — is owned by BidWise Ai LLC and its licensors and is protected
            by intellectual property laws. We grant you a limited, non-exclusive, non-transferable,
            revocable license to use the Service for your personal or internal business research
            purposes during your active subscription, subject to these Terms.
          </P>

          <H2>8. Feedback</H2>
          <P>
            If you submit feedback, suggestions, or ideas about the Service, you grant us a
            perpetual, irrevocable, royalty-free license to use them without restriction or
            compensation to you.
          </P>

          <H2>9. Disclaimers</H2>
          <P>
            <B>THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND,
            EXPRESS OR IMPLIED.</B> To the maximum extent permitted by law, we disclaim all
            warranties, including implied warranties of merchantability, fitness for a particular
            purpose, non-infringement, accuracy of data, uninterrupted operation, and freedom from
            errors or harmful components. We do not warrant that the Service will meet your
            requirements, that calculations or scores will be accurate, or that property
            information will be current.
          </P>

          <H2>10. Limitation of liability</H2>
          <P>
            <B>TO THE MAXIMUM EXTENT PERMITTED BY LAW, BIDWISE AI LLC WILL NOT
            BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE
            DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR INVESTMENT LOSSES,
            ARISING OUT OF OR RELATED TO YOUR USE OF OR INABILITY TO USE THE SERVICE</B>, even if
            we have been advised of the possibility of such damages.
          </P>
          <P>
            <B>OUR TOTAL CUMULATIVE LIABILITY FOR ANY CLAIMS ARISING OUT OF OR RELATED TO THESE
            TERMS OR THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US FOR THE
            SERVICE DURING THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR
            (B) ONE HUNDRED U.S. DOLLARS (US$100).</B>
          </P>

          <H2>11. Indemnification</H2>
          <P>
            You agree to indemnify and hold harmless BidWise Ai LLC and its officers,
            members, employees, and agents from any claim, demand, loss, liability, or expense
            (including reasonable attorneys&rsquo; fees) arising out of (a) your use of the Service, (b)
            your violation of these Terms, (c) your violation of any law or third-party right, or
            (d) any property purchase or bid you make based on information obtained through the
            Service.
          </P>

          <H2>12. Termination</H2>
          <P>
            You may stop using the Service and close your account at any time. We may suspend or
            terminate your access at any time, with or without cause and with or without notice,
            for any reason including breach of these Terms. Upon termination, your right to use
            the Service ceases immediately. Sections that by their nature should survive
            termination — including disclaimers, limitations of liability, indemnification, and
            governing law — will survive.
          </P>

          <H2>13. Governing law and dispute resolution</H2>
          <P>
            These Terms are governed by the laws of the State of Georgia, without
            regard to its conflict-of-laws principles. Any dispute arising out of or related to
            these Terms or the Service will be resolved exclusively in the state or federal courts
            located in Fulton County, Georgia, and you consent to the personal jurisdiction of those
            courts.
          </P>

          <H2>14. Changes to these Terms</H2>
          <P>
            We may revise these Terms from time to time. When we do, we will update the &ldquo;Last
            updated&rdquo; date at the top and, for material changes, give you reasonable notice
            through the Service or by email. Continued use after the effective date constitutes
            acceptance. If you do not agree to the revised Terms, your sole remedy is to stop
            using the Service.
          </P>

          <H2>15. Miscellaneous</H2>
          <UL>
            <LI><B>Entire agreement.</B> These Terms and our Privacy Policy are the entire agreement between you and us regarding the Service and supersede any prior agreements.</LI>
            <LI><B>Severability.</B> If any provision is held unenforceable, the remaining provisions remain in full force.</LI>
            <LI><B>No waiver.</B> Our failure to enforce a provision is not a waiver of our right to enforce it later.</LI>
            <LI><B>Assignment.</B> You may not assign or transfer these Terms. We may assign them to an affiliate or in connection with a merger, acquisition, or sale of assets.</LI>
            <LI><B>Force majeure.</B> We are not liable for delays or failures caused by events beyond our reasonable control.</LI>
          </UL>

          <H2>16. App Store distribution</H2>
          <P>
            The BidWise iOS app is currently distributed through an Apple Developer Program
            account registered to Voyant LLC. The App Store may display Voyant LLC as the
            seller of record on the app&rsquo;s listing during this transition period. This is an
            administrative arrangement; BidWise Ai LLC remains the sole operator of the Service
            and the contracting party under these Terms. Voyant LLC is not a party to these
            Terms and assumes no liability for the Service. When the developer account is
            transferred to BidWise Ai LLC, this section will be updated.
          </P>

          <H2>17. Contact us</H2>
          <P>
            BidWise Ai LLC<br />
            Attn: Legal<br />
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

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-8 border border-[var(--bp-accent-line)] bg-[var(--bp-accent-soft)] p-5">
      <p className="bp-label mb-2.5 !text-[var(--bp-accent-bright)]">Important</p>
      <p className="text-sm leading-relaxed text-[var(--bp-text-2)]">
        {children}
      </p>
    </div>
  )
}
