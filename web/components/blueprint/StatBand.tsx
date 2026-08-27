/**
 * StatBand — oversized stat numerals as design objects (Relats pattern):
 * huge display-face figures, mono survey labels, hairline column rules,
 * count-up on scroll (reduced-motion safe via CountUp).
 */
import CountUp from './CountUp'

export type Stat = {
  /** Numeric value the numeral counts up to. */
  value: number
  /** Zero-pad width for the survey-stamp look ("03"). */
  pad?: number
  prefix?: string
  suffix?: string
  /** Mono label under the numeral. */
  label: string
  /** Optional plain-text second line. */
  sublabel?: string
}

type StatBandProps = {
  stats: Stat[]
  className?: string
}

export default function StatBand({ stats, className = '' }: StatBandProps) {
  return (
    <ul
      className={`grid list-none grid-cols-1 divide-y divide-[var(--bp-hairline)] border-y border-[var(--bp-hairline)] md:grid-cols-3 md:divide-x md:divide-y-0 ${className}`}
    >
      {stats.map((stat, i) => (
        <li key={stat.label} className="flex flex-col px-2 py-10 md:px-10 md:py-12">
          {/* DOM order reads label-before-numeral for screen readers; order-*
              restores the numeral-first visual hierarchy. */}
          <div className="order-1 mb-6 bp-label">FIG {String(i + 1).padStart(2, '0')}</div>
          <div className="order-3 mt-5 bp-label !text-[var(--bp-accent)]">{stat.label}</div>
          <div className="order-2 font-display text-[clamp(3.75rem,9vw,7rem)] font-bold leading-none tracking-[-0.04em] text-[var(--bp-text-1)]">
            <CountUp
              end={stat.value}
              pad={stat.pad}
              prefix={stat.prefix}
              suffix={stat.suffix}
              className="tabular-nums"
            />
          </div>
          {stat.sublabel && (
            <p className="order-4 mt-2 text-sm text-[var(--bp-text-2)]">{stat.sublabel}</p>
          )}
        </li>
      ))}
    </ul>
  )
}
