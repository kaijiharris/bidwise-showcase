// Two-palette source of truth for the BidWise mobile app.
// `theme/colors.ts` exports a mutable singleton that ThemeProvider keeps in sync
// with the active palette, so the existing `colors.xxx` call sites pick up
// the new values on the next render.

export interface Palette {
  brand: { primary: string; cyan: string; deep: string }
  midnight: string
  navy: string
  graphite: string
  slate: string
  soft: string
  muted: string
  dim: string
  status: { info: string; positive: string; warning: string; danger: string }
  // Deal-score bands. Deliberately its own role rather than borrowing `status`
  // or `brand`: score semantics need per-theme contrast tuning, and reusing
  // those would drag 90+ unrelated call sites along with every adjustment.
  band: { strong: string; ok: string; weak: string }
}

export const darkPalette: Palette = {
  brand: { primary: '#10A7FF', cyan: '#2DE2FF', deep: '#0B5CFF' },
  midnight: '#08111F',
  navy: '#111B2B',
  graphite: '#1A2433',
  slate: '#6B778A',
  soft: '#F8FAFC',
  muted: '#94A3B8',
  dim: '#475569',
  status: { info: '#10A7FF', positive: '#2DE2FF', warning: '#74C8FF', danger: '#386BFF' },
  // Unchanged from what ScoreBadge hardcoded before bands became a role, so the
  // dark theme renders identically. Contrast on their own 16% tint over `navy`:
  // strong 7.61, ok 6.66, weak 3.26 — weak clears 3:1 (large text) but not 4.5:1.
  band: { strong: '#2DE2FF', ok: '#74C8FF', weak: '#386BFF' },
}

// Light tokens chosen so the role of each name is preserved:
//   midnight = main background, soft = primary text, muted = secondary text, etc.
// Brand blues stay constant — they read well on both backgrounds.
export const lightPalette: Palette = {
  brand: { primary: '#0B5CFF', cyan: '#10A7FF', deep: '#0B5CFF' },
  midnight: '#FFFFFF',
  navy: '#F8FAFC',
  graphite: '#F1F5F9',
  slate: '#E2E8F0',
  soft: '#0F172A',
  muted: '#475569',
  dim: '#94A3B8',
  status: { info: '#0B5CFF', positive: '#0B5CFF', warning: '#D97706', danger: '#DC2626' },
  // Three distinct hues so a band is readable without relying on the label, and
  // deep enough to contrast on a near-white card — the light-mode blues they
  // replace measured 2.16 (strong) and 2.58 (ok), under even the 3:1 floor.
  // Contrast on their own 16% tint over `navy`: strong 4.13, ok 3.85, weak 4.70.
  band: { strong: '#0E7490', ok: '#B45309', weak: '#B91C1C' },
}
