'use client'

import { useState } from 'react'
import { CheckCircle, X, Zap } from 'lucide-react'
import { TIERS, type Tier } from '@/lib/pricing-data'
import type { PlanKey } from '@/lib/access'
import { trackEvent } from '@/lib/observability'

type Cycle = 'monthly' | 'annual'

const PLAN_ORDER: Record<PlanKey, number> = { starter: 0, pro: 1, expert: 2 }

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
  currentPlan: PlanKey
  isAdmin: boolean
}

export default function UpgradeModal({ open, onClose, currentPlan, isAdmin }: UpgradeModalProps) {
  const [cycle, setCycle] = useState<Cycle>('annual')
  const [pendingTier, setPendingTier] = useState<PlanKey | null>(null)

  if (!open) return null

  const currentRank = PLAN_ORDER[currentPlan]

  function goToCheckout(tier: PlanKey) {
    setPendingTier(tier)
    // Mirrors the pricing-page CTA event so upgrade-path checkouts are visible
    // in the same funnel (maps to GA4 begin_checkout).
    trackEvent('checkout_started', { plan: tier, cycle, source: 'upgrade_modal' })
    // Top-level navigation so the /api/stripe/checkout route can 302 to Stripe.
    window.location.href = `/api/stripe/checkout?plan=${tier}&cycle=${cycle}`
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
      style={{ zIndex: 90 }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-navy-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-[920px] max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 md:p-8">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="text-[18px] font-black text-slate-900 dark:text-white">
                {isAdmin ? 'Manage plan' : 'Upgrade your plan'}
              </h2>
              <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                {isAdmin
                  ? 'You have admin access. Customers see the picker below.'
                  : 'Pick a tier and continue to secure Stripe checkout.'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-5 mb-6 flex justify-center">
            <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-1">
              {(['monthly', 'annual'] as Cycle[]).map(c => {
                const isActive = cycle === c
                return (
                  <button
                    key={c}
                    onClick={() => setCycle(c)}
                    className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                      isActive
                        ? 'bg-white dark:bg-navy-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                    }`}
                  >
                    {c === 'monthly' ? 'Monthly' : 'Annual'}
                    {c === 'annual' && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                        Save 30%
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TIERS.map(tier => (
              <TierCard
                key={tier.key}
                tier={tier}
                cycle={cycle}
                currentRank={currentRank}
                isAdmin={isAdmin}
                pending={pendingTier === tier.key}
                onSelect={() => goToCheckout(tier.key)}
              />
            ))}
          </div>

          <p className="mt-5 text-center text-[11px] text-slate-400 dark:text-slate-500">
            To switch to a lower tier or cancel, email{' '}
            <a href="mailto:support@bidwiseinvest.com" className="underline hover:text-slate-600 dark:hover:text-slate-300">
              support@bidwiseinvest.com
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

interface TierCardProps {
  tier: Tier
  cycle: Cycle
  currentRank: number
  isAdmin: boolean
  pending: boolean
  onSelect: () => void
}

function TierCard({ tier, cycle, currentRank, isAdmin, pending, onSelect }: TierCardProps) {
  const tierRank = PLAN_ORDER[tier.key]
  const price = cycle === 'monthly' ? tier.monthlyPrice : tier.annualMonthly
  const billingNote = cycle === 'annual' ? `$${tier.annualPrice}/yr billed annually` : 'billed monthly'
  const yearSaved = Math.round((tier.monthlyPrice - tier.annualMonthly) * 12)

  const isCurrent = !isAdmin && tierRank === currentRank
  const isLower = !isAdmin && tierRank < currentRank
  const canUpgrade = !isCurrent && !isLower

  let buttonLabel = `Upgrade to ${tier.name}`
  if (isCurrent) buttonLabel = 'Current plan'
  else if (isLower) buttonLabel = 'Lower tier — contact support'
  else if (isAdmin) buttonLabel = `Preview ${tier.name} checkout`
  if (pending) buttonLabel = 'Redirecting…'

  const buttonEnabled = (canUpgrade || isAdmin) && !pending

  return (
    <div
      className={`relative rounded-xl border p-5 flex flex-col text-left transition-all ${
        tier.highlight
          ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50/50 dark:bg-blue-500/5 shadow-sm'
          : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/3'
      } ${isCurrent ? 'ring-2 ring-emerald-400 dark:ring-emerald-500/60' : ''}`}
    >
      {tier.badge && !isCurrent && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 text-white text-[10px] font-bold rounded-full bg-blue-500 whitespace-nowrap">
          {tier.badge}
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 text-white text-[10px] font-bold rounded-full bg-emerald-500 whitespace-nowrap">
          Current plan
        </div>
      )}

      <h3 className="text-[14px] font-black text-slate-900 dark:text-white mb-0.5">{tier.name}</h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">{tier.tagline}</p>

      <div className="flex items-baseline gap-1 mb-0.5">
        <span className="text-[26px] font-black text-slate-900 dark:text-white">${price}</span>
        <span className="text-[12px] text-slate-500 dark:text-slate-400">/mo</span>
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{billingNote}</p>
      {cycle === 'annual' && (
        <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 mt-0.5">
          ~${yearSaved}/yr saved
        </p>
      )}

      <button
        onClick={onSelect}
        disabled={!buttonEnabled}
        className={`mt-4 mb-4 w-full py-2 rounded-lg text-[12px] font-bold transition-all ${
          buttonEnabled
            ? tier.highlight
              ? 'bg-blue-500 hover:bg-blue-600 text-white'
              : 'bg-slate-900 dark:bg-white hover:bg-slate-700 dark:hover:bg-slate-100 text-white dark:text-slate-900'
            : 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500 cursor-not-allowed'
        }`}
      >
        {!pending && canUpgrade && <Zap size={11} className="inline mr-1 -mt-0.5" />}
        {buttonLabel}
      </button>

      <ul className="space-y-1.5">
        {tier.highlights.map(h => (
          <li key={h} className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-400">
            <CheckCircle size={12} className="shrink-0 mt-0.5 text-blue-500 dark:text-blue-400" />
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
