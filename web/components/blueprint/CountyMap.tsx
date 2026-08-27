/**
 * CountyMap — glowing Georgia-metro county chart with parcel detail.
 * The Blueprint Instrument centerpiece.
 *
 * County outlines are AUTHENTIC US Census cartographic boundaries (us-atlas
 * counties-10m TopoJSON), decoded + projected + simplified to this viewBox —
 * see web/lib/county-geometry.ts. Covered counties get dashed parcel infill,
 * a hairline boundary that line-draws on reveal, and a restrained blue glow;
 * neighboring counties render as faint dashed context. Survey furniture (north
 * arrow, scale bar, coordinate ticks) frames it as a real plat/survey sheet.
 *
 * Counties are prop-driven so the coverage page can reuse this with more (or
 * fewer) counties lit. Geometry is keyed by county id.
 */
import {
  COVERED_GEOMETRY,
  CONTEXT_OUTLINES,
  MAP_VIEWBOX,
  parcelHatch,
} from '@/lib/county-geometry'

export type County = {
  id: 'dekalb' | 'gwinnett' | 'cobb' | 'clayton'
  name: string
  /** Mono annotation under the name, e.g. "TAX DEED · LIVE". */
  status?: string
}

type CountyMapProps = {
  counties: County[]
  /** Accessible description of the chart. */
  label?: string
  className?: string
}

const MONO = 'var(--font-mono), ui-monospace, monospace'

function CountyShape({ county, revealIndex }: { county: County; revealIndex: number }) {
  const geo = COVERED_GEOMETRY[county.id]
  const clipId = `bp-county-${county.id}`
  return (
    <g>
      {/* glow pulse layer (opacity-only animation, staggered per county) */}
      <path
        d={geo.outline}
        stroke="var(--bp-accent)"
        strokeWidth="5"
        strokeLinejoin="round"
        fill="none"
        filter="url(#bp-map-blur)"
        className="bp-pulse"
        style={{ animationDelay: `${revealIndex * 0.4}s` }}
      />

      {/* parcel infill, clipped to the real county boundary */}
      <clipPath id={clipId}>
        <path d={geo.outline} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {/* subtle fill wash */}
        <path d={geo.outline} fill="var(--bp-accent-soft)" />
        {/* dashed lot subdivision */}
        <path
          d={parcelHatch(geo.bbox)}
          stroke="var(--bp-accent-line)"
          strokeWidth="0.75"
          strokeDasharray="2.5 4.5"
          opacity="0.5"
        />
      </g>

      {/* boundary — hairline that draws on reveal */}
      <path
        d={geo.outline}
        pathLength={1}
        className="bp-draw"
        fill="none"
        stroke="var(--bp-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        style={{ transitionDelay: `${0.15 + revealIndex * 0.12}s` }}
      />

      {/* label — leader dot + county name + status */}
      <circle cx={geo.labelX - 6} cy={geo.labelY - 4} r="1.6" fill="var(--bp-accent-bright)" />
      <text
        x={geo.labelX}
        y={geo.labelY}
        fill="var(--bp-text-1)"
        fontFamily={MONO}
        fontSize="12"
        fontWeight="600"
        letterSpacing="0.16em"
      >
        {county.name.toUpperCase()}
      </text>
      {county.status && (
        <text
          x={geo.labelX}
          y={geo.labelY + 15}
          fill="var(--bp-accent-bright)"
          fontFamily={MONO}
          fontSize="8.5"
          letterSpacing="0.12em"
        >
          {county.status}
        </text>
      )}
    </g>
  )
}

export default function CountyMap({
  counties,
  label = 'Survey map of covered Georgia counties: DeKalb, Gwinnett, Cobb, and Clayton',
  className = '',
}: CountyMapProps) {
  return (
    <svg
      role="img"
      aria-label={label}
      className={`h-auto w-full ${className}`}
      viewBox={MAP_VIEWBOX}
      fill="none"
    >
      <defs>
        <filter id="bp-map-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* survey grid — fine graticule behind everything */}
      <g stroke="var(--bp-hairline)" strokeWidth="1">
        <path d="M0 140 H620 M0 280 H620 M0 420 H620" />
        <path d="M155 0 V560 M310 0 V560 M465 0 V560" />
      </g>

      {/* context counties (not covered) — faint dashed neighbors */}
      <g
        stroke="var(--bp-hairline-strong)"
        strokeWidth="1"
        strokeDasharray="3 5"
        fill="none"
        opacity="0.7"
      >
        {CONTEXT_OUTLINES.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* covered counties */}
      {counties.map((c, i) => (
        <CountyShape key={c.id} county={c} revealIndex={i} />
      ))}

      {/* north arrow */}
      <g stroke="var(--bp-text-3)" strokeWidth="1" fill="none">
        <circle cx="570" cy="52" r="16" />
        <path d="M570 62 V42 M565 48 L570 42 L575 48" />
      </g>
      <text x="566" y="92" fill="var(--bp-text-3)" fontFamily={MONO} fontSize="10" letterSpacing="0.12em">
        N
      </text>

      {/* scale bar — raised into the clear west margin, above the SW coordinate
          so the bottom-left labels never overprint each other */}
      <g stroke="var(--bp-text-3)" strokeWidth="1">
        <path d="M40 490 H160 M40 485 V495 M100 487 V493 M160 485 V495" />
      </g>
      <text x="40" y="510" fill="var(--bp-text-3)" fontFamily={MONO} fontSize="10" letterSpacing="0.12em">
        0        10 MI
      </text>

      {/* corner coordinates — metro-Atlanta extent */}
      <text x="16" y="28" fill="var(--bp-text-3)" fontFamily={MONO} fontSize="10" letterSpacing="0.12em">
        34°10′N
      </text>
      <text x="512" y="546" fill="var(--bp-text-3)" fontFamily={MONO} fontSize="10" letterSpacing="0.12em">
        84°45′W
      </text>
      <text x="16" y="546" fill="var(--bp-text-3)" fontFamily={MONO} fontSize="10" letterSpacing="0.12em">
        33°25′N
      </text>
    </svg>
  )
}
