/**
 * LegendRow — map-legend style feature/list row: a linework symbol swatch,
 * a title, supporting copy, and an optional right-aligned mono meta value.
 */
export type LegendSymbol = 'dash' | 'solid' | 'dot' | 'hatch' | 'square'

type LegendRowProps = {
  symbol?: LegendSymbol
  title: string
  description?: string
  /** Right-aligned mono annotation, e.g. "ALL PLANS". */
  meta?: string
  className?: string
}

function SymbolSwatch({ symbol }: { symbol: LegendSymbol }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="h-7 w-7 shrink-0" fill="none">
      <rect x="0.5" y="0.5" width="27" height="27" stroke="var(--bp-hairline)" />
      {symbol === 'dash' && (
        <path d="M4 14 H24" stroke="var(--bp-accent)" strokeWidth="1.5" strokeDasharray="4 3" />
      )}
      {symbol === 'solid' && <path d="M4 14 H24" stroke="var(--bp-accent)" strokeWidth="1.5" />}
      {symbol === 'dot' && <circle cx="14" cy="14" r="3" fill="var(--bp-accent)" />}
      {symbol === 'hatch' && (
        <path
          d="M2 20 L20 2 M8 26 L26 8"
          stroke="var(--bp-accent)"
          strokeOpacity="0.7"
          strokeWidth="1.25"
        />
      )}
      {symbol === 'square' && (
        <rect x="8" y="8" width="12" height="12" stroke="var(--bp-accent)" strokeWidth="1.5" fill="var(--bp-accent-soft)" />
      )}
    </svg>
  )
}

export default function LegendRow({
  symbol = 'dash',
  title,
  description,
  meta,
  className = '',
}: LegendRowProps) {
  return (
    <div
      className={`group flex items-start gap-4 border-b border-[var(--bp-hairline)] py-4 transition-colors last:border-b-0 hover:bg-[var(--bp-accent-soft)] ${className}`}
    >
      <SymbolSwatch symbol={symbol} />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-[var(--bp-text-1)]">{title}</h3>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-[var(--bp-text-2)]">{description}</p>
        )}
      </div>
      {meta && <span className="bp-label mt-0.5 shrink-0">{meta}</span>}
    </div>
  )
}
