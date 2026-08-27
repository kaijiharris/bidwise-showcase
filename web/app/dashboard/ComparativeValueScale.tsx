'use client'

import type { CompItem } from './PropertyDetailPanel'

// Zillow-style "Comparative value" strip (user request 2026-07-04): numbered
// dots for each comp positioned on a $ scale, with the subject property's
// value marked. Dot numbers match the comp cards listed below the strip.
// Pure presentation — parents gate on plan tier / unlock state.

const fmtK = (v: number) =>
  v >= 1_000_000 ? '$' + (v / 1_000_000).toFixed(1) + 'M' : '$' + Math.round(v / 1_000) + 'K'

interface ComparativeValueScaleProps {
  comps: CompItem[]
  /** Subject property's model value (ARV for residential, land value for lots). */
  subjectValue: number
  subjectLabel: string
}

export default function ComparativeValueScale({
  comps,
  subjectValue,
  subjectLabel,
}: ComparativeValueScaleProps) {
  const priced = comps
    .map((c, i) => ({ n: i + 1, price: c.p, addr: c.a, top5: !!c.top5 }))
    .filter(c => c.price > 0)

  if (priced.length < 2 || subjectValue <= 0) return null

  const values = [...priced.map(c => c.price), subjectValue]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = Math.max((hi - lo) * 0.08, hi * 0.02)
  const min = lo - pad
  const max = hi + pad
  const span = max - min

  const pos = (v: number) => ((v - min) / span) * 100

  return (
    <div className="px-3 pt-3 pb-2 bg-white dark:bg-navy-700 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm mb-2">
      <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
        Comparative Value
      </div>
      <div className="text-[10px] text-slate-400 dark:text-slate-500 mb-3 leading-relaxed">
        Where the model {subjectLabel} of <strong className="text-slate-600 dark:text-slate-300">{fmtK(subjectValue)}</strong> sits
        among the {priced.length} comps used (numbers match the list below).
      </div>

      <div className="relative h-14" role="img"
           aria-label={`Comparative value scale: ${subjectLabel} ${fmtK(subjectValue)} among comps from ${fmtK(lo)} to ${fmtK(hi)}`}>
        {/* Axis */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-200 dark:bg-white/15" />

        {/* Subject marker — diamond above the axis with a stem */}
        <div
          className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
          style={{ left: `${pos(subjectValue)}%` }}
          title={`${subjectLabel}: ${fmtK(subjectValue)}`}
        >
          <div className="w-2.5 h-2.5 rotate-45 bg-blue-600 dark:bg-blue-500 rounded-[2px] shadow-sm ring-2 ring-blue-200 dark:ring-blue-900/60" />
          <div className="w-px h-3.5 bg-blue-400/70 dark:bg-blue-500/70" />
        </div>

        {/* Comp dots — alternate above/below the axis to reduce overlap */}
        {priced.map((c, i) => (
          <div
            key={c.n}
            className={`absolute -translate-x-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full flex items-center justify-center
              text-[9px] font-black text-white shadow-sm cursor-default select-none ${
                c.top5 ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-slate-400 dark:bg-slate-500'
              }`}
            style={{
              left: `${pos(c.price)}%`,
              top: i % 2 === 0 ? '62%' : '84%',
            }}
            title={`#${c.n} ${c.addr} — ${fmtK(c.price)}${c.top5 ? ' (top 5, 2× weight)' : ''}`}
          >
            {c.n}
          </div>
        ))}
      </div>

      {/* Axis labels */}
      <div className="flex justify-between mt-1 text-[9px] font-bold text-slate-400 dark:text-slate-500">
        <span>{fmtK(min)}</span>
        <span>{fmtK(min + span / 2)}</span>
        <span>{fmtK(max)}</span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2">
        <span className="flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500 font-medium">
          <span className="w-2 h-2 rotate-45 bg-blue-600 dark:bg-blue-500 rounded-[1px] inline-block" /> {subjectLabel}
        </span>
        <span className="flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Top-5 comp
        </span>
        <span className="flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-500 inline-block" /> Other comp
        </span>
      </div>
    </div>
  )
}
