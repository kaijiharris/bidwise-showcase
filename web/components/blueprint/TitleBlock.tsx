/**
 * TitleBlock — survey title-block frame for stats, cards, and modules.
 * Hairline border + corner ticks + a mono header strip (label left, sheet
 * reference right). Adapts to the paper-white chapter via bp CSS variables.
 */
type TitleBlockProps = {
  /** Mono header label, e.g. "MOD 02 · DEAL SCORE". */
  label: string
  /** Optional right-aligned mono reference, e.g. "SHT 01". */
  index?: string
  className?: string
  /** Extra classes on the content area (defaults to p-6). */
  bodyClassName?: string
  children: React.ReactNode
}

export default function TitleBlock({
  label,
  index,
  className = '',
  bodyClassName = 'p-6',
  children,
}: TitleBlockProps) {
  return (
    <div className={`bp-frame ${className}`}>
      <span aria-hidden="true" className="bp-tick bp-tick-tl" />
      <span aria-hidden="true" className="bp-tick bp-tick-tr" />
      <span aria-hidden="true" className="bp-tick bp-tick-bl" />
      <span aria-hidden="true" className="bp-tick bp-tick-br" />

      <div className="flex items-center justify-between gap-4 border-b border-[var(--bp-hairline)] px-5 py-3">
        <span className="bp-label truncate">{label}</span>
        {index && <span className="bp-label shrink-0 !text-[var(--bp-accent)]">{index}</span>}
      </div>

      <div className={bodyClassName}>{children}</div>
    </div>
  )
}
