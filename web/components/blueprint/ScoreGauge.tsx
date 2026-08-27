/**
 * ScoreGauge — instrument-style semicircular deal-score gauge. Hairline
 * track, accent value arc, mono tick ring, oversized numeral in the well.
 */
export type ScoreGaugeProps = {
  /** 0–100. */
  score: number
  /** Mono verdict under the numeral, e.g. "BID". */
  verdict?: string
  /** Accessible label. */
  label?: string
  className?: string
}

const CX = 100
const CY = 108
const R = 78
const TICK_COUNT = 10

function tickCoords(index: number) {
  const angle = Math.PI - (index / TICK_COUNT) * Math.PI
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x1: CX + cos * (R + 8),
    y1: CY - sin * (R + 8),
    x2: CX + cos * (R + 15),
    y2: CY - sin * (R + 15),
  }
}

export default function ScoreGauge({
  score,
  verdict,
  label = 'Deal score',
  className = '',
}: ScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score))
  const arc = `M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY}`

  return (
    <div className={`relative ${className}`} role="img" aria-label={`${label}: ${clamped} out of 100`}>
      <svg aria-hidden="true" className="h-auto w-full" viewBox="0 0 200 128" fill="none">
        {/* tick ring */}
        <g stroke="var(--bp-hairline-strong)" strokeWidth="1">
          {Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
            const t = tickCoords(i)
            return <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
          })}
        </g>

        {/* track */}
        <path d={arc} stroke="var(--bp-hairline)" strokeWidth="6" strokeLinecap="round" />

        {/* value arc */}
        <path
          d={arc}
          pathLength={100}
          stroke="var(--bp-accent)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${clamped} 100`}
        />

        {/* end caps annotations */}
        <text x="14" y="126" fill="var(--bp-text-3)" fontFamily="var(--font-mono), monospace" fontSize="9" letterSpacing="0.12em">
          0
        </text>
        <text x="176" y="126" fill="var(--bp-text-3)" fontFamily="var(--font-mono), monospace" fontSize="9" letterSpacing="0.12em">
          100
        </text>
      </svg>

      {/* numeral well */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="font-display text-5xl font-bold leading-none tracking-tight text-[var(--bp-text-1)]">
          {clamped}
        </span>
        {verdict && <span className="bp-label mt-2 !text-[var(--bp-accent)]">{verdict}</span>}
      </div>
    </div>
  )
}
