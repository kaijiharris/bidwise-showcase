'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import RevealSection from '@/components/RevealSection'
import ParcelLines from '@/components/blueprint/ParcelLines'
import TitleBlock from '@/components/blueprint/TitleBlock'
import { AlertCircle, CheckCircle, Minus, ArrowRight } from 'lucide-react'
import { TIERS, FEATURE_GROUPS, DEFAULT_BILLING_CYCLE, type BillingCycle } from '@/lib/pricing-data'
import { TRIAL_LABEL } from '@/lib/trial'
import { createClient } from '@/lib/supabase/client'
import { trackEvent } from '@/lib/observability'

/* ── Blueprint Instrument rollout (2026-07-08) — /pricing ──────────────────────
   Direction: internal-notes/business/bidwise-design-direction-2026-07-06.md.
   Plan cards become survey title-block frames (middle plan elevated with a blue
   edge-glow); the comparison matrix becomes a survey ledger. Prices, billing
   toggle, Stripe/Supabase wiring, and every CTA branch are unchanged — restyle
   only. Prices come from lib/pricing-data (same source as the homepage). */

type Cycle = BillingCycle
type PlanKey = 'starter' | 'pro' | 'expert'

const PLAN_RANK: Record<PlanKey, number> = { starter: 0, pro: 1, expert: 2 }

function normalizePlan(plan: string | null | undefined): PlanKey {
  return plan === 'pro' || plan === 'expert' ? plan : 'starter'
}

// Surfaces any `?error=...` flag set by upstream redirects (checkout
// cancellation, rate-limit, etc.). Wrapped in Suspense per Next 15 rules
// for useSearchParams in client components.
function PricingNotice() {
  const params = useSearchParams()
  const error = params.get('error')
  const checkout = params.get('checkout')

  let message: string | null = null
  if (error === 'rate_limit') {
    message = "You're starting checkout a bit too often. Wait a minute and try again."
  } else if (checkout === 'cancelled') {
    message = 'Checkout was cancelled. Pick a plan when you’re ready.'
  }
  if (!message) return null

  return (
    <div className="mt-8 flex max-w-xl items-start gap-2.5 border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function FeatureCell({ val }: { val: string | boolean | undefined }) {
  if (val === false || val === undefined) return <Minus size={14} className="mx-auto text-[var(--bp-text-3)]" />
  if (val === true) return <CheckCircle size={16} className="mx-auto text-[var(--bp-accent)]" />
  return <span className="text-xs font-medium text-[var(--bp-text-2)]">{val}</span>
}

export default function PricingPage() {
  const [cycle, setCycle] = useState<Cycle>(DEFAULT_BILLING_CYCLE)
  const [signedIn, setSignedIn] = useState(false)
  const [hasSubscription, setHasSubscription] = useState(false)
  const [currentPlan, setCurrentPlan] = useState<PlanKey>('starter')

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        setSignedIn(false)
        return
      }
      setSignedIn(true)
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing'])
        .order('current_period_end', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      setHasSubscription(!!sub)
      setCurrentPlan(normalizePlan(sub?.plan))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-[var(--bp-base)]">
      <Navbar />

      {/* ── HERO — rate schedule header + billing toggle ────────────────────── */}
      <section
        aria-labelledby="pricing-hero-heading"
        className="relative overflow-hidden border-b border-[var(--bp-hairline)] px-5 pb-14 pt-32 sm:px-8 lg:pt-40"
      >
        <ParcelLines className="opacity-25" />
        <div className="relative mx-auto max-w-6xl">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="bp-label mb-5 !text-[var(--bp-accent)]">RATE SCHEDULE · MEMBERSHIP</p>
              <h1
                id="pricing-hero-heading"
                className="text-4xl font-bold leading-[1.05] tracking-tight text-[var(--bp-text-1)] sm:text-5xl md:text-6xl"
              >
                Simple, transparent pricing.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--bp-text-2)]">
                Every plan includes a {TRIAL_LABEL} free trial. Pick the tier that matches where you are as an investor.
              </p>
            </div>

            {/* Billing toggle */}
            <div
              role="group"
              aria-label="Billing cycle"
              className="inline-flex shrink-0 items-center gap-1 self-start border border-[var(--bp-hairline-strong)] p-1 lg:self-auto"
            >
              {(['monthly', 'annual'] as Cycle[]).map(c => {
                const active = cycle === c
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCycle(c)}
                    aria-pressed={active}
                    className={`bp-label rounded-[3px] px-4 py-2 !tracking-[0.14em] transition-colors ${
                      active ? '!text-white' : '!text-[var(--bp-text-2)] hover:!text-[var(--bp-text-1)]'
                    }`}
                    style={active ? { background: 'var(--bp-accent)' } : undefined}
                  >
                    {c === 'monthly' ? 'MONTHLY' : 'ANNUAL'}
                    {c === 'annual' && (
                      <span
                        className="ml-2 rounded-[2px] px-1.5 py-0.5 !text-[9px]"
                        style={{ background: 'var(--bp-accent-soft)', color: 'var(--bp-accent-bright)' }}
                      >
                        SAVE 30%
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <Suspense fallback={null}>
            <PricingNotice />
          </Suspense>
        </div>
      </section>

      {/* ── PLAN CARDS — survey title-block frames ──────────────────────────── */}
      <RevealSection>
        <section aria-labelledby="plans-heading" className="relative overflow-hidden px-5 py-20 sm:px-8 lg:py-24">
          <ParcelLines className="opacity-15" />
          <div className="relative mx-auto max-w-6xl">
            <h2 id="plans-heading" className="sr-only">Membership plans</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {TIERS.map(tier => {
                const price = cycle === 'monthly' ? tier.monthlyPrice : tier.annualMonthly
                const billingNote =
                  cycle === 'annual' ? `$${tier.annualPrice}/yr billed annually` : 'billed monthly'
                const tierRank = PLAN_RANK[tier.key]
                const currentRank = PLAN_RANK[currentPlan]
                // "Current"/"lower" only mean something when the user has a real
                // active subscription — otherwise every tier is selectable.
                const isCurrent = signedIn && hasSubscription && tierRank === currentRank
                const isLower = signedIn && hasSubscription && tierRank < currentRank
                const ctaClass = `mt-7 w-full px-6 py-3 text-sm ${tier.highlight ? 'bp-btn-primary' : 'bp-btn-ghost'}`

                return (
                  <TitleBlock
                    key={tier.key}
                    label={tier.name.toUpperCase()}
                    index={tier.badge ? tier.badge.toUpperCase() : undefined}
                    className={`flex flex-col ${tier.highlight ? 'border-[var(--bp-accent-line)]' : ''}`}
                    bodyClassName="relative flex h-full flex-col p-6"
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
                      <span className="font-display text-5xl font-bold tabular-nums text-[var(--bp-text-1)]">
                        ${price}
                      </span>
                      <span className="bp-label">/ MO</span>
                    </div>
                    <p className="bp-label mt-2 !text-[10px]">{billingNote.toUpperCase()}</p>
                    {cycle === 'annual' && (
                      <p className="mt-2 font-mono text-xs font-medium text-[var(--bp-accent)]">
                        ~${Math.round((tier.monthlyPrice - tier.annualMonthly) * 12)}/yr saved
                      </p>
                    )}

                    {(() => {
                      if (!signedIn) {
                        return (
                          <Link href={`/signup?plan=${tier.key}&cycle=${cycle}`} className={ctaClass}>
                            Start Free — {tier.name}
                          </Link>
                        )
                      }
                      if (isCurrent) {
                        return (
                          <span className="mt-7 flex w-full cursor-default items-center justify-center border border-[var(--bp-accent-line)] bg-[var(--bp-accent-soft)] px-6 py-3">
                            <span className="bp-label !text-[var(--bp-accent-bright)]">Current plan</span>
                          </span>
                        )
                      }
                      if (isLower) {
                        return (
                          <a href="mailto:support@bidwiseinvest.com" className={`${ctaClass} !font-normal`}>
                            Switch tiers — contact support
                          </a>
                        )
                      }
                      // Signed in: upgrading from a lower paid tier, or a
                      // signed-in user with no subscription starting their plan.
                      return (
                        <a
                          href={`/api/stripe/checkout?plan=${tier.key}&cycle=${cycle}`}
                          className={ctaClass}
                          onClick={() => trackEvent('checkout_started', { plan: tier.key, cycle })}
                        >
                          {hasSubscription ? `Upgrade to ${tier.name}` : `Start Free — ${tier.name}`}
                        </a>
                      )
                    })()}

                    <ul className="mt-7 space-y-2.5 border-t border-[var(--bp-hairline)] pt-6">
                      {Object.entries(tier.features)
                        .filter(([, v]) => v !== false)
                        .map(([feature, val]) => (
                          <li key={feature} className="flex items-start gap-2.5 text-sm text-[var(--bp-text-2)]">
                            <span aria-hidden="true" className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 bg-[var(--bp-accent)]" />
                            <span>
                              {feature}
                              {typeof val === 'string' ? `: ${val}` : ''}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </TitleBlock>
                )
              })}
            </div>
          </div>
        </section>
      </RevealSection>

      {/* ── FULL COMPARISON — survey ledger ─────────────────────────────────── */}
      <RevealSection>
        <section aria-labelledby="compare-heading" className="px-5 pb-24 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <TitleBlock label="FULL FEATURE COMPARISON" index="ALL PLANS" bodyClassName="p-0">
              <div className="overflow-x-auto">
                <div className="w-full min-w-[680px]">
                  {/* header */}
                  <div className="grid grid-cols-4 border-b border-[var(--bp-hairline)]">
                    <div className="bp-label px-5 py-4">Feature</div>
                    {TIERS.map(t => (
                      <div
                        key={t.key}
                        className={`px-5 py-4 text-center ${t.highlight ? 'bg-[var(--bp-accent-soft)]' : ''}`}
                      >
                        <div className="text-sm font-bold text-[var(--bp-text-1)]">{t.name}</div>
                        <div className="bp-label mt-0.5 !text-[10px]">
                          ${cycle === 'monthly' ? t.monthlyPrice : t.annualMonthly}/MO
                        </div>
                      </div>
                    ))}
                  </div>

                  {Object.entries(FEATURE_GROUPS).map(([group, features]) => (
                    <div key={group}>
                      <div className="grid grid-cols-4 border-b border-[var(--bp-hairline)] bg-[var(--bp-panel)]">
                        <div className="bp-label col-span-4 px-5 py-3 !text-[var(--bp-accent)]">{group}</div>
                      </div>
                      {features.map(feature => (
                        <div
                          key={feature}
                          className="grid grid-cols-4 border-b border-[var(--bp-hairline)] transition-colors last:border-b-0 hover:bg-[var(--bp-accent-soft)]"
                        >
                          <div className="px-5 py-3.5 text-sm text-[var(--bp-text-2)]">{feature}</div>
                          {TIERS.map(t => (
                            <div
                              key={t.key}
                              className={`flex items-center justify-center px-5 py-3.5 text-center ${
                                t.highlight ? 'bg-[var(--bp-accent-soft)]' : ''
                              }`}
                            >
                              <FeatureCell val={t.features[feature as keyof typeof t.features]} />
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </TitleBlock>

            {/* closing CTA */}
            <div className="mt-14 flex flex-col items-start gap-6 border-t border-[var(--bp-hairline)] pt-10 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-md">
                <p className="bp-label mb-3 !text-[var(--bp-accent)]">ISSUE FOR BID</p>
                <p className="text-lg leading-relaxed text-[var(--bp-text-2)]">
                  All plans include a {TRIAL_LABEL} free trial. No commitment until you&apos;re ready.
                </p>
              </div>
              <div className="w-full max-w-xs">
                <Link href="/signup" className="bp-btn-primary w-full px-8 py-4 text-base">
                  Start My Free Trial
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <p className="bp-label mt-3 text-center">CREDIT CARD REQUIRED · CANCEL BEFORE TRIAL ENDS</p>
              </div>
            </div>
          </div>
        </section>
      </RevealSection>

      <Footer />
    </div>
  )
}
