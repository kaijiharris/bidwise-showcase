'use client'

import { useMemo, useState } from 'react'
import { Calculator, RotateCcw } from 'lucide-react'

// Zillow-style interactive net-proceeds calculator (user request 2026-07-04).
// Seeded entirely from pipeline numbers already shipped on the property —
// no fetches, no new data exposure. Parents MUST gate rendering on plan tier
// and server unlock state (locked rows arrive with null financials anyway).

const fmt$ = (v: number) =>
  '$' + Math.round(v).toLocaleString()

function roiColor(roi: number) {
  if (roi >= 100) return '#10b981'
  if (roi >= 50) return '#f59e0b'
  if (roi >= 0) return '#f97316'
  return '#ef4444'
}

interface NetProceedsCalculatorProps {
  /** Model resale price seed — the pipeline ARV. */
  seedPrice: number
  /** Model rehab estimate (estimated_rehab_cost). */
  seedRehab: number
  /** Opening bid (tax due) — fixed acquisition floor. */
  taxDue: number
  /** Non-rehab, non-bid costs: legal/closing/carrying/inspection/quiet title. */
  fixedCosts: number
  /** Selling cost fraction of resale price (pipeline uses 0.07 = 6% agent + 1% closing). */
  sellingPct?: number
  /** One-line explanation of the model rehab rate (rehab_basis), shown as context. */
  rehabBasis?: string
}

const PRICE_STEP = 1_000
const REHAB_STEP = 500

export default function NetProceedsCalculator({
  seedPrice,
  seedRehab,
  taxDue,
  fixedCosts,
  sellingPct = 0.07,
  rehabBasis,
}: NetProceedsCalculatorProps) {
  const priceMin = Math.max(PRICE_STEP, Math.round((seedPrice * 0.5) / PRICE_STEP) * PRICE_STEP)
  const priceMax = Math.round((seedPrice * 1.5) / PRICE_STEP) * PRICE_STEP
  const rehabMax = Math.max(Math.round((seedRehab * 2) / REHAB_STEP) * REHAB_STEP, 50_000)

  const [price, setPrice] = useState(Math.round(seedPrice / PRICE_STEP) * PRICE_STEP)
  const [rehab, setRehab] = useState(Math.round(seedRehab / REHAB_STEP) * REHAB_STEP)

  const derived = useMemo(() => {
    const sellingCosts = price * sellingPct
    const netProceeds = price - sellingCosts
    const allIn = taxDue + rehab + fixedCosts
    const netProfit = netProceeds - allIn
    const roi = allIn > 0 ? (netProfit / allIn) * 100 : null
    return { sellingCosts, netProceeds, allIn, netProfit, roi }
  }, [price, rehab, taxDue, fixedCosts, sellingPct])

  const isAdjusted =
    price !== Math.round(seedPrice / PRICE_STEP) * PRICE_STEP ||
    rehab !== Math.round(seedRehab / REHAB_STEP) * REHAB_STEP

  function reset() {
    setPrice(Math.round(seedPrice / PRICE_STEP) * PRICE_STEP)
    setRehab(Math.round(seedRehab / REHAB_STEP) * REHAB_STEP)
  }

  const profitColor = derived.netProfit >= 0 ? '#059669' : '#ef4444'

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-navy-800 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5">
        <Calculator size={13} className="text-blue-500" />
        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
          What-If Calculator
        </span>
        {isAdjusted && (
          <button
            onClick={reset}
            className="ml-auto flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          >
            <RotateCcw size={10} /> Reset to model
          </button>
        )}
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* Headline — estimated net profit */}
        <div className="text-center">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Estimated Net Profit
          </div>
          <div className="text-2xl font-black mt-0.5" style={{ color: profitColor }}>
            {fmt$(derived.netProfit)}
          </div>
          {derived.roi != null && (
            <span
              className="inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-bold border"
              style={{
                color: roiColor(derived.roi),
                borderColor: roiColor(derived.roi) + '55',
                background: roiColor(derived.roi) + '14',
              }}
            >
              {derived.roi.toFixed(1)}% ROI
            </span>
          )}
        </div>

        {/* Sliders */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <label htmlFor="np-price" className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Est. resale price
              </label>
              <span className="text-xs font-black text-slate-800 dark:text-white">{fmt$(price)}</span>
            </div>
            <input
              id="np-price"
              type="range"
              min={priceMin}
              max={priceMax}
              step={PRICE_STEP}
              value={price}
              onChange={e => setPrice(Number(e.target.value))}
              className="w-full h-1.5 cursor-pointer accent-blue-600 dark:accent-blue-500"
            />
            <div className="flex justify-between text-[9px] text-slate-400 dark:text-slate-500 font-medium">
              <span>{fmt$(priceMin)}</span>
              <span>model: {fmt$(seedPrice)}</span>
              <span>{fmt$(priceMax)}</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-baseline mb-1">
              <label htmlFor="np-rehab" className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Est. prep &amp; repair costs
              </label>
              <span className="text-xs font-black text-slate-800 dark:text-white">{fmt$(rehab)}</span>
            </div>
            <input
              id="np-rehab"
              type="range"
              min={0}
              max={rehabMax}
              step={REHAB_STEP}
              value={rehab}
              onChange={e => setRehab(Number(e.target.value))}
              className="w-full h-1.5 cursor-pointer accent-amber-500"
            />
            {rehabBasis && (
              <div className="text-[9px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">
                model: {rehabBasis}
              </div>
            )}
          </div>
        </div>

        {/* Breakdown */}
        <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-white/10">
          {[
            { label: 'Opening bid (tax due)', val: fmt$(taxDue) },
            { label: 'Legal, closing & carrying', val: fmt$(fixedCosts) },
            { label: `Selling costs (${Math.round(sellingPct * 100)}%)`, val: fmt$(derived.sellingCosts) },
            { label: 'All-in cost', val: fmt$(derived.allIn), bold: true },
            { label: 'Net proceeds (price − selling costs)', val: fmt$(derived.netProceeds), bold: true },
          ].map(row => (
            <div key={row.label} className="flex justify-between gap-2">
              <span className={`text-xs font-medium ${row.bold ? 'text-slate-600 dark:text-slate-300 font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
                {row.label}
              </span>
              <span className={`text-xs ${row.bold ? 'font-black text-slate-800 dark:text-white' : 'font-bold text-slate-700 dark:text-slate-300'}`}>
                {row.val}
              </span>
            </div>
          ))}
        </div>

        <div className="text-[9px] text-slate-400 dark:text-slate-500 leading-relaxed">
          All calculations are estimates for informational purposes only. Actual amounts vary
          with market conditions, condition findings, and closing terms.
        </div>
      </div>
    </div>
  )
}
