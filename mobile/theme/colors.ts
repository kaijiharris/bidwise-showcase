// Mutable color singleton. ThemeProvider swaps in light/dark values on scheme
// change via applyPalette(), so the hundreds of existing `colors.xxx` call
// sites pick up the new values on the next render — no per-file refactor needed.
//
// IMPORTANT: read color properties at render time (e.g. `style={{ color: colors.soft }}`).
// Do NOT capture into module-level constants (`const c = colors.soft`) — those
// snapshots won't update when the theme changes.

import { darkPalette, type Palette } from './palette'

// Start with dark — matches what the app shipped with before themes existed.
export const colors: Palette = {
  brand: { ...darkPalette.brand },
  midnight: darkPalette.midnight,
  navy: darkPalette.navy,
  graphite: darkPalette.graphite,
  slate: darkPalette.slate,
  soft: darkPalette.soft,
  muted: darkPalette.muted,
  dim: darkPalette.dim,
  status: { ...darkPalette.status },
  band: { ...darkPalette.band },
}

// Composite a palette color at partial opacity.
//
// ALWAYS pass a live palette read — `withAlpha(colors.slate, 0.2)` — so the tint
// tracks the active theme. Writing the equivalent `rgba(107,119,138,0.2)` by hand
// freezes the color at whichever palette was active when it was typed; that is
// exactly how light mode ended up painting dark-palette tints under light-palette
// text. An unparseable hex returns unchanged (opaque and obviously wrong) rather
// than silently collapsing to a transparent `rgba(NaN, ...)`.
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function applyPalette(next: Palette): void {
  colors.midnight = next.midnight
  colors.navy = next.navy
  colors.graphite = next.graphite
  colors.slate = next.slate
  colors.soft = next.soft
  colors.muted = next.muted
  colors.dim = next.dim
  Object.assign(colors.brand, next.brand)
  Object.assign(colors.status, next.status)
  Object.assign(colors.band, next.band)
}

// The brand gradient: BidWise Blue → Electric Cyan. Getter so consumers always
// pick up the current palette's brand colors.
export const brandGradient = {
  get colors(): [string, string] {
    return [colors.brand.primary, colors.brand.cyan]
  },
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
}
