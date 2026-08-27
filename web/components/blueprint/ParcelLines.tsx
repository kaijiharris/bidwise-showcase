/**
 * ParcelLines — decorative plat-map background: dashed parcel boundaries,
 * lot splits, survey crosses, coordinates, and a dimension callout.
 * Blueprint Instrument signature linework (design direction 2026-07-06).
 * Purely decorative: aria-hidden, pointer-events-none, colors from bp tokens.
 */
type ParcelLinesProps = {
  /** Extra classes on the absolutely-positioned SVG (e.g. opacity-40). */
  className?: string
}

const MONO = 'var(--font-mono), ui-monospace, monospace'

function SurveyCross({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M${x - 7} ${y} H${x + 7} M${x} ${y - 7} V${y + 7}`}
      stroke="var(--bp-hairline-strong)"
      strokeWidth="1"
    />
  )
}

export default function ParcelLines({ className = '' }: ParcelLinesProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`pointer-events-none absolute inset-0 h-full w-full select-none ${className}`}
      viewBox="0 0 1200 800"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
    >
      {/* sparse survey grid */}
      <g stroke="var(--bp-hairline)" strokeWidth="1">
        <path d="M150 0 V800 M450 0 V800 M750 0 V800 M1050 0 V800" />
        <path d="M0 160 H1200 M0 400 H1200 M0 640 H1200" />
      </g>

      {/* dashed parcel boundaries */}
      <g stroke="var(--bp-accent-line)" strokeOpacity="0.35" strokeWidth="1.25" strokeDasharray="5 7">
        <path d="M120 118 L342 94 L394 240 L182 302 Z" />
        <path d="M700 78 L982 120 L942 302 L678 262 Z" />
        <path d="M182 478 L422 440 L472 642 L242 700 Z" />
        <path d="M762 458 L1062 430 L1122 622 L822 682 Z" />
      </g>

      {/* interior lot splits */}
      <g stroke="var(--bp-hairline)" strokeWidth="1">
        <path d="M231 106 L282 272 M700 190 L942 224 M302 456 L347 672 M938 442 L988 652" />
      </g>

      {/* survey crosses at grid stations */}
      <SurveyCross x={450} y={160} />
      <SurveyCross x={750} y={400} />
      <SurveyCross x={150} y={640} />
      <SurveyCross x={1050} y={160} />

      {/* dimension callout on parcel 1 */}
      <g stroke="var(--bp-hairline-strong)" strokeWidth="1">
        <path d="M120 88 L342 64" />
        <path d="M120 80 V96 M342 56 V72" />
      </g>

      {/* coordinates + lot labels */}
      <g fill="var(--bp-text-3)" fontFamily={MONO} fontSize="10" letterSpacing="0.12em" opacity="0.75">
        <text x="466" y="150">N 33°47′12″</text>
        <text x="766" y="390">W 84°16′48″</text>
        <text x="196" y="72">212.40′</text>
        <text x="214" y="196">LOT 14</text>
        <text x="788" y="188">LOT 07</text>
        <text x="286" y="566">LOT 22</text>
        <text x="906" y="552">LOT 03</text>
      </g>
    </svg>
  )
}
