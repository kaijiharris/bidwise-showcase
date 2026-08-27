import { ImageResponse } from 'next/og'

// Social share card (og:image) generated at build time via next/og — 1200x630,
// zero runtime deps. Renders the BidWise wordmark, the roofline mark, and the
// one-line value prop on the brand's midnight canvas with the blue→cyan accent.
// Next.js metadata-file convention wires this into <meta property="og:image">.
//
// The Twitter card (app/twitter-image.tsx) re-exports this same renderer.

export const runtime = 'edge'
export const alt = 'BidWise — Auction & tax-deed deal intelligence'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Brand tokens (web/DESIGN.md §2).
const MIDNIGHT = '#08111F'
const NAVY = '#111B2B'
const BLUE = '#10A7FF'
const CYAN = '#2DE2FF'
const SOFT_WHITE = '#F8FAFC'
const SLATE = '#6B778A'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: MIDNIGHT,
          padding: '96px',
          position: 'relative',
        }}
      >
        {/* Atmosphere bloom (DESIGN.md atmosphere gradient), top-left. */}
        <div
          style={{
            position: 'absolute',
            top: -160,
            left: -120,
            width: 620,
            height: 620,
            borderRadius: '50%',
            background: `radial-gradient(circle, rgba(16,167,255,0.22), rgba(16,167,255,0) 60%)`,
            display: 'flex',
          }}
        />

        {/* Wordmark row: roof mark + "BidWise". */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 44 }}>
          <svg width="92" height="92" viewBox="0 0 32 32" fill="none" style={{ marginRight: 26 }}>
            <defs>
              <linearGradient id="ogmark" x1="0" y1="0" x2="32" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor={BLUE} />
                <stop offset="1" stopColor={CYAN} />
              </linearGradient>
            </defs>
            <path d="M4 22 L16 8 L26 20" stroke="url(#ogmark)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M26 20 L26 26 M26 26 L21 24" stroke="url(#ogmark)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: 'flex', fontSize: 88, fontWeight: 800, letterSpacing: '-0.02em' }}>
            <span style={{ color: SOFT_WHITE }}>Bid</span>
            <span style={{ color: CYAN }}>Wise</span>
          </div>
        </div>

        {/* Value prop — the audited one-liner. */}
        <div
          style={{
            display: 'flex',
            fontSize: 52,
            fontWeight: 700,
            color: SOFT_WHITE,
            letterSpacing: '-0.01em',
            lineHeight: 1.15,
            maxWidth: 900,
          }}
        >
          Auction &amp; tax-deed deal intelligence
        </div>

        {/* Supporting line. */}
        <div style={{ display: 'flex', fontSize: 30, color: SLATE, marginTop: 22 }}>
          Comps, deal scoring, and your max bid — in under 5 minutes.
        </div>

        {/* Bottom accent bar (brand gradient). */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            width: '100%',
            height: 12,
            background: `linear-gradient(90deg, ${BLUE} 0%, ${CYAN} 100%)`,
            display: 'flex',
          }}
        />

        {/* Host label, bottom-right. */}
        <div style={{ position: 'absolute', right: 96, bottom: 52, display: 'flex', fontSize: 26, color: SLATE }}>
          bidwiseinvest.com
        </div>

        {/* Subtle framed backdrop edge for depth. */}
        <div
          style={{
            position: 'absolute',
            inset: 24,
            border: `1px solid ${NAVY}`,
            borderRadius: 24,
            display: 'flex',
          }}
        />
      </div>
    ),
    { ...size },
  )
}
