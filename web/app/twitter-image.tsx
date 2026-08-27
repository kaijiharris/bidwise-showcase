// Twitter/X share card (twitter:image). Same 1200x630 art as the Open Graph
// image — the renderer is shared from opengraph-image so the two never drift.
// Config fields (size/alt/contentType/runtime) are declared statically here
// because Next.js only recognizes route-segment config as direct exports, not
// re-exports. Next's metadata convention wires this into twitter:image.

export { default } from './opengraph-image'

export const runtime = 'edge'
export const alt = 'BidWise — Auction & tax-deed deal intelligence'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
