/**
 * StepRule — 01/02/03 hairline how-it-works. A single rule draws across the
 * top (line-draw on scroll when wrapped in RevealSection), with numbered steps
 * hanging from accent tick marks.
 *
 * Data Instrument refinement (2026-07-08): oversized mono step numerals as
 * design objects, a mono procedure tag per step, and tightened vertical rhythm
 * so the three steps read as a sequenced survey procedure.
 */
export type Step = {
  title: string
  description: string
  /** Optional mono tag, e.g. "INPUT" / "ANALYSIS" / "OUTPUT". */
  tag?: string
}

type StepRuleProps = {
  steps: Step[]
  className?: string
}

export default function StepRule({ steps, className = '' }: StepRuleProps) {
  return (
    <div className={`relative ${className}`}>
      {/* the rule — draws left→right on reveal */}
      <svg
        aria-hidden="true"
        className="absolute left-0 top-0 h-px w-full overflow-visible"
        viewBox="0 0 100 1"
        preserveAspectRatio="none"
        fill="none"
      >
        <line
          x1="0"
          y1="0.5"
          x2="100"
          y2="0.5"
          pathLength={1}
          className="bp-draw"
          stroke="var(--bp-hairline-strong)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <ol className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
        {steps.map((step, i) => (
          <li key={step.title} className="relative pt-9 md:pr-8">
            {/* tick crossing the rule */}
            <span
              aria-hidden="true"
              className="absolute -top-2 left-0 h-4 w-px bg-[var(--bp-accent)]"
            />

            {/* step index row: oversized numeral + procedure tag */}
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <span className="font-display text-3xl font-bold leading-none tabular-nums text-[var(--bp-accent)]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="bp-label !text-[9.5px] !text-[var(--bp-text-3)]">
                {step.tag ?? `STEP ${i + 1} / ${steps.length}`}
              </span>
            </div>

            <h3 className="mb-2.5 text-lg font-bold leading-snug tracking-tight text-[var(--bp-text-1)]">
              {step.title}
            </h3>
            <p className="text-sm leading-relaxed text-[var(--bp-text-2)]">{step.description}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
