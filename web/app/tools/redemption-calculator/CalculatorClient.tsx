'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { computeRedemption, minBidForTargetProfit, fmtUsd, fmtPct } from '@/lib/redemption'
import { trackEvent } from '@/lib/observability'

// Interactive core of /tools/redemption-calculator. All math lives in
// lib/redemption (unit-tested); this component is a controlled form + live
// results — no fetches, no state beyond the inputs.

const INPUT_CLASS =
  'w-full rounded-md border border-[var(--bp-hairline-strong)] bg-[var(--bp-base)] px-4 py-3 text-sm text-[var(--bp-text-1)] placeholder:text-[var(--bp-text-3)] transition-colors focus:border-[var(--bp-accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.35)]'

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replaceAll(',', ''))
  return Number.isFinite(n) ? n : null
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div>
      <label className="bp-label mb-2 block !text-[var(--bp-text-2)]">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT_CLASS}
      />
      {hint && <p className="mt-1.5 text-xs text-[var(--bp-text-3)]">{hint}</p>}
    </div>
  )
}

function ResultRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--bp-hairline)] py-3 last:border-b-0">
      <span className="bp-label !text-[var(--bp-text-2)]">{label}</span>
      <span className={`text-lg font-bold tracking-tight ${accent ? 'text-[var(--bp-accent)]' : 'text-[var(--bp-text-1)]'}`}>
        {value}
      </span>
    </div>
  )
}

export default function CalculatorClient() {
  const [price, setPrice] = useState('35,000')
  const [months, setMonths] = useState('12')
  const [extras, setExtras] = useState('')
  const [targetProfit, setTargetProfit] = useState('')

  // Engagement signal for ads remarketing: fires once per visit, on the FIRST
  // user edit — not on mount, since the pre-filled defaults render a result
  // for every visitor whether or not they touch the tool.
  const usedRef = useRef(false)
  function markUsed() {
    if (usedRef.current) return
    usedRef.current = true
    trackEvent('calculator_used')
  }
  const withUsage = (set: (v: string) => void) => (v: string) => {
    markUsed()
    set(v)
  }

  const result = useMemo(() => {
    const p = numOrNull(price)
    const m = numOrNull(months)
    const x = numOrNull(extras)
    if (p === null || m === null) return null
    return computeRedemption({ purchasePrice: p, monthsHeld: m, additionalCosts: x ?? 0 })
  }, [price, months, extras])

  const minBid = useMemo(() => {
    const t = numOrNull(targetProfit)
    const m = numOrNull(months)
    if (t === null || m === null) return null
    return minBidForTargetProfit({ targetProfit: t, monthsHeld: m })
  }, [targetProfit, months])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* inputs */}
      <div className="bp-frame space-y-5 p-6 sm:p-7">
        <p className="bp-label !text-[var(--bp-accent)]">INPUTS</p>
        <Field
          label="Winning bid (purchase price)"
          hint="What you pay on the courthouse steps, in dollars."
          value={price}
          onChange={withUsage(setPrice)}
          placeholder="35,000"
        />
        <Field
          label="Months until redemption"
          hint="Any fraction of a year counts as a full year for the premium."
          value={months}
          onChange={withUsage(setMonths)}
          placeholder="12"
        />
        <Field
          label="Additional recoverable costs (optional)"
          hint="Post-sale taxes you paid, allowable notice costs — reimbursed, not profit."
          value={extras}
          onChange={withUsage(setExtras)}
          placeholder="0"
        />
        <div className="border-t border-[var(--bp-hairline)] pt-5">
          <Field
            label="Inverse: target premium profit"
            hint="Enter a profit goal to see the minimum winning bid that yields it."
            value={targetProfit}
            onChange={withUsage(setTargetProfit)}
            placeholder="10,000"
          />
        </div>
      </div>

      {/* results */}
      <div className="bp-frame p-6 sm:p-7">
        <p className="bp-label mb-4 !text-[var(--bp-accent)]">IF THE OWNER REDEEMS</p>
        {result ? (
          <>
            <ResultRow label="PREMIUM RATE" value={`${fmtPct(result.premiumRate)} (${result.premiumYears} yr)`} />
            <ResultRow label="PREMIUM EARNED" value={fmtUsd(result.premium)} accent />
            <ResultRow label="OWNER PAYS TO REDEEM" value={fmtUsd(result.redemptionAmount)} />
            <ResultRow label="RETURN ON CASH" value={fmtPct(result.returnOnCash)} />
            <ResultRow label="ANNUALIZED" value={fmtPct(result.annualizedReturn)} accent />
            <p className="mt-4 text-xs leading-relaxed text-[var(--bp-text-3)]">
              Faster redemptions raise your annualized return — the 20% first-year premium is
              earned whether redemption takes one month or twelve.
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--bp-text-3)]">
            Enter a purchase price and months held to see the redemption math.
          </p>
        )}

        {minBid !== null && (
          <div className="mt-6 border-t border-[var(--bp-hairline)] pt-5">
            <p className="bp-label mb-2 !text-[var(--bp-text-2)]">MINIMUM BID FOR YOUR TARGET</p>
            <p className="text-2xl font-bold tracking-tight text-[var(--bp-text-1)]">{fmtUsd(minBid)}</p>
            <p className="mt-1 text-xs text-[var(--bp-text-3)]">
              Bid at least this much for the premium alone to hit your profit goal.
            </p>
          </div>
        )}

        <div className="mt-8 border-t border-[var(--bp-hairline)] pt-6">
          <p className="text-sm leading-relaxed text-[var(--bp-text-2)]">
            This is the <em>redemption</em> math. The harder question — what the property is
            actually worth if nobody redeems — is what BidWise answers: comps, ARV, rehab, and a
            recommended max bid on every parcel of the county list.
          </p>
          <Link href="/signup" className="bp-btn-primary mt-4 inline-flex px-6 py-3 text-sm">
            Analyze the whole list
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  )
}
