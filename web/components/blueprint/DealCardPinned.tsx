/**
 * DealCardPinned — a deal card pinned to a magnified parcel outline with
 * dimension callouts. The "output artifact" visual: parcel drawing on the
 * left, TitleBlock-framed deal data on the right, joined by a leader line.
 *
 * Data Instrument refinement (2026-07-08): parcel drawing and readout share a
 * consistent survey grid; dimension callouts use proper extension + arrow-tick
 * linework; the deal-card readout reads as a precision instrument panel
 * (hero score numeral, mono-labelled stat cells, traceable comp ledger).
 */
import TitleBlock from './TitleBlock'

export type PinnedDealStat = {
  label: string
  value: string
  accent?: boolean
}

export type PinnedDeal = {
  address: string
  meta: string
  score: number
  verdict: string
  stats: PinnedDealStat[]
  /** Optional comp rows shown under the stats. */
  comps?: { label: string; value: string }[]
  /** Mono parcel reference rendered on the drawing + card header. */
  parcelId: string
}

const MONO = 'var(--font-mono), ui-monospace, monospace'

/** Arrow-tick dimension line: extension lines at each end + a delta label. */
function ParcelDrawing({ parcelId }: { parcelId: string }) {
  return (
    <svg
      aria-hidden="true"
      className="h-auto w-full"
      viewBox="0 0 440 400"
      fill="none"
    >
      <defs>
        {/* consistent 20px survey grid shared with the readout rhythm */}
        <pattern id="bp-parcel-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0 H0 V20" stroke="var(--bp-hairline)" strokeWidth="0.5" fill="none" />
        </pattern>
      </defs>

      {/* graticule */}
      <rect x="0" y="0" width="440" height="400" fill="url(#bp-parcel-grid)" opacity="0.6" />
      {/* emphasized section lines on the 100px multiples */}
      <g stroke="var(--bp-hairline)" strokeWidth="1">
        <path d="M0 100 H440 M0 300 H440 M120 0 V400 M320 0 V400" />
      </g>

      {/* magnified lot boundary — draws on reveal, dashed survey line */}
      <path
        d="M80 84 L344 100 L364 300 L112 320 Z"
        pathLength={1}
        className="bp-draw"
        stroke="var(--bp-accent)"
        strokeWidth="1.5"
        strokeDasharray="7 6"
        strokeLinejoin="round"
        fill="var(--bp-accent-soft)"
      />

      {/* building footprint — mono line, hip-roof ridge */}
      <g stroke="var(--bp-text-2)" strokeWidth="1" fill="none">
        <path d="M176 168 H288 V256 H176 Z" />
        <path d="M176 168 L232 138 L288 168" />
        <path d="M232 138 V138" />
      </g>

      {/* dimension callout — top edge (frontage) */}
      <g stroke="var(--bp-hairline-strong)" strokeWidth="1">
        {/* extension lines up from the two corners */}
        <path d="M80 84 V52 M344 100 V68" />
        {/* dimension line with arrow ticks */}
        <path d="M80 58 L344 74" />
        <path d="M86 53 L80 58 L86 63 M338 69 L344 74 L338 79" />
      </g>
      <rect x="180" y="46" width="66" height="16" fill="var(--bp-panel-deep)" />
      <text x="186" y="58" fill="var(--bp-text-1)" fontFamily={MONO} fontSize="11" letterSpacing="0.08em">
        132.40′
      </text>

      {/* dimension callout — right edge (depth) */}
      <g stroke="var(--bp-hairline-strong)" strokeWidth="1">
        <path d="M344 100 H392 M364 300 H408" />
        <path d="M396 100 L396 300" />
        <path d="M391 106 L396 100 L401 106 M391 294 L396 300 L401 294" />
      </g>
      <rect x="384" y="192" width="24" height="16" fill="var(--bp-panel-deep)" />
      <text
        x="396"
        y="204"
        fill="var(--bp-text-1)"
        fontFamily={MONO}
        fontSize="11"
        letterSpacing="0.08em"
        textAnchor="middle"
        transform="rotate(90 396 200)"
      >
        78.20′
      </text>

      {/* pin — crosshair + pulse at the structure centroid */}
      <circle cx="232" cy="212" r="16" stroke="var(--bp-accent)" strokeWidth="1.5" className="bp-pulse" fill="none" />
      <circle cx="232" cy="212" r="3.5" fill="var(--bp-accent)" />
      <path
        d="M232 188 V198 M232 226 V236 M208 212 H218 M246 212 H256"
        stroke="var(--bp-accent)"
        strokeWidth="1"
      />

      {/* leader line toward the card (visual join on wide layouts) */}
      <path d="M248 212 H440" stroke="var(--bp-accent-line)" strokeWidth="1" strokeDasharray="2 4" />

      {/* title-block footer strip — parcel ref + scale */}
      <g stroke="var(--bp-hairline)" strokeWidth="1">
        <path d="M40 356 H400" />
      </g>
      <text x="40" y="376" fill="var(--bp-text-3)" fontFamily={MONO} fontSize="10.5" letterSpacing="0.16em">
        PARCEL {parcelId}
      </text>
      <text x="400" y="376" fill="var(--bp-text-3)" fontFamily={MONO} fontSize="10.5" letterSpacing="0.16em" textAnchor="end">
        SCALE 1″=30′
      </text>
    </svg>
  )
}

export default function DealCardPinned({ deal, className = '' }: { deal: PinnedDeal; className?: string }) {
  return (
    <div className={`grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-0 ${className}`}>
      <ParcelDrawing parcelId={deal.parcelId} />

      <TitleBlock label={`DEAL CARD · ${deal.parcelId}`} index="OUT" bodyClassName="p-0">
        {/* header: address + hero score numeral */}
        <div className="flex items-stretch justify-between border-b border-[var(--bp-hairline)]">
          <div className="min-w-0 flex-1 px-5 py-4">
            <h3 className="truncate text-base font-bold text-[var(--bp-text-1)]">{deal.address}</h3>
            <p className="mt-1 font-mono text-[11px] tracking-[0.08em] text-[var(--bp-text-3)]">{deal.meta}</p>
          </div>
          {/* score cell — instrument readout, boxed off from the address */}
          <div className="flex shrink-0 flex-col items-center justify-center border-l border-[var(--bp-hairline)] px-5 py-3">
            <div className="bp-label mb-0.5 !text-[9px]">SCORE</div>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-[2.75rem] font-bold leading-none text-[var(--bp-accent)] tabular-nums">
                {deal.score}
              </span>
              <span className="font-mono text-xs text-[var(--bp-text-3)]">/100</span>
            </div>
            <div className="bp-label mt-1 !text-[9px] !text-[var(--bp-accent-bright)]">{deal.verdict}</div>
          </div>
        </div>

        {/* stats — instrument-panel cells, baseline-aligned numerals */}
        <div className="grid grid-cols-3 divide-x divide-[var(--bp-hairline)] border-b border-[var(--bp-hairline)]">
          {deal.stats.map(stat => (
            <div key={stat.label} className="px-3 py-4 text-center">
              <div className="bp-label mb-2 !text-[9.5px]">{stat.label}</div>
              <div
                className={`font-mono text-lg font-semibold leading-none tabular-nums ${
                  stat.accent ? 'text-[var(--bp-accent)]' : 'text-[var(--bp-text-1)]'
                }`}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* comps — traceable ledger, mono index + value columns */}
        {deal.comps && deal.comps.length > 0 && (
          <div className="px-5 py-3">
            <div className="bp-label mb-1 flex items-center justify-between !text-[9px]">
              <span>COMPARABLE SALES</span>
              <span className="!text-[var(--bp-text-3)]">USD</span>
            </div>
            <ul>
              {deal.comps.map((comp, i) => (
                <li
                  key={comp.label}
                  className="flex items-center justify-between gap-4 border-b border-[var(--bp-hairline)] py-2 last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[10px] tabular-nums text-[var(--bp-text-3)]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="truncate font-mono text-[11px] tracking-[0.05em] text-[var(--bp-text-3)]">
                      {comp.label}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-[var(--bp-text-2)]">
                    {comp.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TitleBlock>
    </div>
  )
}
