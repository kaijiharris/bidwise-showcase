import { ImageResponse } from 'next/og'

// Favicon generated at build time via next/og (zero runtime deps). Renders the
// BidWise brand mark — the roofline chevron ending in a downward arrow (house +
// falling auction price) from /public/logo-wordmark.png — in the brand gradient
// on the midnight canvas. Replaces the default-globe tab icon (/favicon.ico 404).
//
// Next.js metadata-file convention: this module makes /icon the app icon and is
// referenced automatically in <head>; no manual <link rel="icon"> needed.

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

// Brand tokens (web/DESIGN.md §2).
const MIDNIGHT = '#08111F'
const BLUE = '#10A7FF'
const CYAN = '#2DE2FF'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: MIDNIGHT,
          borderRadius: 7,
        }}
      >
        {/* Roofline + downward arrow mark. Thick strokes stay crisp at 32px. */}
        <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
          <defs>
            <linearGradient id="bwmark" x1="0" y1="0" x2="32" y2="0" gradientUnits="userSpaceOnUse">
              <stop stopColor={BLUE} />
              <stop offset="1" stopColor={CYAN} />
            </linearGradient>
          </defs>
          {/* left rafter up to the peak, down the right side, then the arrowhead */}
          <path
            d="M4 22 L16 8 L26 20"
            stroke="url(#bwmark)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M26 20 L26 26 M26 26 L21 24"
            stroke="url(#bwmark)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  )
}
