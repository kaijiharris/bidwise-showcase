/**
 * ProcedureStep — a full-width survey-procedure entry: an oversized accent
 * numeral hanging from a tick on the section rule, a mono procedure tag, a
 * title, body copy, and a bulleted spec list. The detailed cousin of StepRule
 * (which is the compact 01/02/03 rule) for pages that need long copy per step.
 * Prop-driven + bp-token themed so it adapts to the paper-white chapter.
 */
import type { LucideIcon } from 'lucide-react'

export type Procedure = {
  /** Zero-padded index, e.g. "01". */
  index: string
  /** Mono procedure tag, e.g. "INGEST". */
  tag: string
  title: string
  /** Optional mono spec caption under the title. */
  spec?: string
  body: string
  bullets: string[]
  /** Optional accent glyph in the content column. */
  icon?: LucideIcon
}

export default function ProcedureStep({ step }: { step: Procedure }) {
  const Icon = step.icon
  return (
    <li className="relative grid grid-cols-1 gap-6 border-t border-[var(--bp-hairline)] pt-9 md:grid-cols-[minmax(0,8rem)_1fr] md:gap-12">
      {/* accent tick crossing the rule */}
      <span aria-hidden="true" className="absolute -top-2 left-0 h-4 w-px bg-[var(--bp-accent)]" />

      <div className="flex items-baseline justify-between gap-3 md:flex-col md:items-start md:gap-3">
        <span className="font-display text-6xl font-bold leading-none tabular-nums text-[var(--bp-accent)] sm:text-7xl">
          {step.index}
        </span>
        <span className="bp-label">{step.tag}</span>
      </div>

      <div className="min-w-0">
        {Icon && (
          <span className="mb-5 inline-flex h-10 w-10 items-center justify-center border border-[var(--bp-hairline)] bg-[var(--bp-accent-soft)]">
            <Icon size={18} strokeWidth={1.75} className="text-[var(--bp-accent)]" aria-hidden="true" />
          </span>
        )}
        <h3 className="text-2xl font-bold tracking-tight text-[var(--bp-text-1)]">{step.title}</h3>
        {step.spec && <p className="bp-label mt-2">{step.spec}</p>}
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--bp-text-2)]">{step.body}</p>
        <ul className="mt-6 space-y-2.5">
          {step.bullets.map(b => (
            <li key={b} className="flex items-start gap-3 text-sm leading-relaxed text-[var(--bp-text-2)]">
              <span aria-hidden="true" className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 bg-[var(--bp-accent)]" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  )
}
