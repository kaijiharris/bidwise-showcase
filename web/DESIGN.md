# BidWise Design System

> **Status:** Source of truth for every visual decision in `BidWise/web/`.
> **Posture:** The brand kit is the floor. Push higher where it serves the product.

---

## 1. Brand Identity

### Who we serve
Real estate investors who bid on tax-deed and foreclosure auctions. They are sophisticated, time-pressured, money-on-the-line. They do **not** want generic real-estate-brochure aesthetics.

### Tone
**Intelligent, Trustworthy, Data-Driven, Confident, Modern, Investor-First.**

Translates to:
- Numbers, not adjectives. ("89% score accuracy", not "incredibly accurate")
- Hierarchies, not flat lists. The eye should always know where to land first.
- Restraint in motion. Investors don't want product theater; they want signal.

### Anti-pattern radar (do not ship)
- Stock real-estate photography of a generic neighborhood
- Gradient blob hero + centered headline + one CTA
- Card grids with identical padding and no hierarchy
- Emoji-led "How It Works" steps
- Default Tailwind/shadcn templates passed off as brand

---

## 2. Color System

### Primary (the floor)
| Token | Hex | Usage |
|---|---|---|
| `--bw-blue` | `#10A7FF` | Primary brand accent. CTAs, score rings, key icons. **60%** of brand use. |
| `--bw-cyan` | `#2DE2FF` | Bright accent. Hover transitions, eyebrow labels, gradient endpoint. **20%**. |
| `--bw-deep` | `#0B5CFF` | Depth. Button gradient start, hover-darker states. **10% Accents**. |

### Neutrals (the canvas)
| Token | Hex | Role |
|---|---|---|
| `--bw-midnight` | `#08111F` | Page background |
| `--bw-navy` | `#111B2B` | Cards, elevated surfaces |
| `--bw-graphite` | `#1A2433` | Borders, dividers on dark |
| `--bw-slate` | `#6B778A` | Secondary text, metadata |
| `--bw-soft-white` | `#F8FAFC` | High-contrast text on dark |

### Alert (tints of blue — semantic, not decorative)
| Hex | Meaning |
|---|---|
| `#10A7FF` | Info — primary state |
| `#74C8FF` | Success / Positive (use sparingly; the brand uses cyan here too) |
| `#A8C5FF` | Warning |
| `#386BFF` | Error |

Deal scoring keeps its **green** (emerald) intentionally — that's investor UX where green = good deal. Do not "rebrand" the green checkmarks for property scoring; it's signal, not chrome.

### Gradient
**Primary gradient — use everywhere you want energy:**
```css
linear-gradient(90deg, #10A7FF 0%, #2DE2FF 100%)
```

**Depth gradient — buttons, glow surfaces:**
```css
linear-gradient(135deg, #0B5CFF, #10A7FF)
```

**Atmosphere gradient — section backgrounds with bloom:**
```css
radial-gradient(ellipse at 30% 40%, rgba(16,167,255,0.10), transparent 60%)
```

### Color usage ratio (calibrated)
- Neutrals **60%** — the canvas does most of the work
- Blue primary **20%** — accents that matter
- Cyan secondary **10%** — gradient endpoints, hover states
- Alerts **10%** — only on stateful elements

### Rules
- Never use raw `#ffffff` on `#000000` backgrounds. Use `--bw-soft-white` on `--bw-midnight`.
- Never use the gradient as a fill on more than one element per viewport. It should feel rare.
- Selection color: `rgba(16, 167, 255, 0.30)`.

---

## 3. Typography

### Type pair
| Family | Role | Why |
|---|---|---|
| **Space Grotesk** | Headlines, KPIs, numeric data | Geometric, modern, confident. Reads as "fintech-grade." |
| **Inter** | Body, UI labels, descriptions | Neutral, dense, optimized for screen. Reads as "trustworthy." |

### Scale
| Token | Size | Usage |
|---|---|---|
| `text-display` | `clamp(3rem, 1rem + 7vw, 6.5rem)` | Hero headline only |
| `text-h1` | `clamp(2.5rem, 1.5rem + 3vw, 4rem)` | Page headlines |
| `text-h2` | `clamp(1.875rem, 1.5rem + 1.5vw, 3rem)` | Section headlines |
| `text-h3` | `1.25rem` (`text-xl`) | Card titles |
| `text-body-lg` | `1.125rem` | Lead paragraphs |
| `text-body` | `0.875rem` (`text-sm`) | Default body |
| `text-eyebrow` | `0.75rem` (`text-xs`), uppercase, tracking-widest, font-bold | Section labels |
| `text-meta` | `0.6875rem` (`text-[11px]`), font-bold, uppercase | Numbers prefixes, tags |

### Weights
- Display & H1: `font-black` (900)
- H2 & H3: `font-bold` (700)
- Body: `font-normal` (400) or `font-medium` (500) for emphasis
- Eyebrow: `font-bold` (700)

### Rules
- **Never** mix more than two font families. Space Grotesk + Inter only.
- KPIs and money figures **must** use Space Grotesk (numeric character feels intentional).
- Body copy must stay Inter (reading endurance).
- Line height: `leading-tight` (1.1) for display/h1; `leading-relaxed` (1.625) for body.
- Letter spacing: `-0.02em` on display/h1; default on body; `0.08em` on eyebrows.

### Editorial push (above the floor)
- One word per hero line, broken intentionally. "Pre-scored / auction deals, / **every month.**"
- Use the gradient on the final word only, never the full headline.
- Numbers stand alone when they're the point: `<div class="text-7xl font-black font-display">89<span class="text-2xl font-bold ml-1 text-slate-500">%</span></div>`

---

## 4. Spacing & Layout

### Section padding
- Outer sections: `py-20` (5rem each side). **Never** exceed `py-24` — it reads as filler.
- Inner blocks: `mb-12` between header and content. `gap-6` typical for inline groups.
- Max widths: `max-w-6xl` for full sections, `max-w-3xl` for prose-led pages (FAQ, articles).

### Grid system
- Default: 12-column on `max-w-6xl` with `gap-6`.
- Bento grids: `auto-rows-[200px]` with `lg:col-span-2` for hero tiles. Always asymmetric — never a uniform 3×3.
- Two-column splits: `lg:grid-cols-[1fr_1.2fr]` (off-center). Symmetric 1fr_1fr reads as a template.

### Asymmetry rules (push higher)
- Headlines left-aligned to a `max-w-xl`; eye line never centered on full-page text-heavy sections.
- Pair a paragraph block with a visual block at 60/40 ratio, not 50/50.
- Every section header that has a CTA should put the CTA in the **same row as the H2**, right-aligned, with `lg:flex-row lg:items-end lg:justify-between`. Not below the H2.

### Whitespace philosophy
- Whitespace is *intentional rhythm*, not "let it breathe." If a section feels empty, **add density**, don't pad it.
- A section with one centered headline and one CTA should be **short** (`py-14`), not tall (`py-32`).

---

## 5. Components

### Buttons
- **Primary CTA** — `.btn-primary` — gradient `135deg #0B5CFF → #10A7FF`, white text, `font-bold`, `rounded-xl`, `px-7 py-3`, glow `0 4px 24px rgba(16,167,255,0.25)`. Hover lifts `-translate-y-0.5`.
- **Secondary** — `.btn-secondary` — transparent with `border-white/10`, text `slate-200`, hover `bg-white/4`.
- **Tertiary link** — text-only with `ArrowUpRight` icon, `text-[#10A7FF] hover:text-[#2DE2FF]`. Use in section headers where a CTA would crowd.

### Badges
- Capsule: `rounded-full px-3 py-1 text-[11px] font-bold tracking-widest uppercase`.
- "New" / "Active": `bg-[rgba(16,167,255,0.15)] text-[#2DE2FF]`.
- "Coming soon": `border-slate-500/30 bg-slate-500/8 text-slate-400`.
- "Most Popular" (pricing): solid `bg-[#10A7FF] text-white` with `glow-brand` shadow.

### Cards
- **Glass card** — `.glass-card` — `bg-white/3 border border-white/8 backdrop-blur-md rounded-2xl`. Default for feature grids.
- **Pro/highlight card** — additionally: `border-[#10A7FF]/35 bg-[#10A7FF]/4 shadow-[0_0_60px_rgba(16,167,255,0.18)]`.
- **Score ring** (deal score) — `conic-gradient(#10A7FF 0% N%, rgba(16,167,255,0.15) N% 100%)` where N = score. Inner disc `bg-[#0d1929]` with the number in Space Grotesk.

### Data visualization
- Charts and KPI rings always use the primary gradient or `#10A7FF` solid. Background ticks at `rgba(255,255,255,0.06)`.
- Status colors: green `#10b981` for "good deal" (do not change), amber `#f59e0b` for "review", red `#f87171` for "flag".

---

## 6. Motion

### Allowed properties
Animate only: `transform`, `opacity`, `clip-path`, `filter`.
**Never** animate `width`, `height`, `top`, `left`, `margin`, `padding`, `font-size`, `border-width`.

### Tokens
| Token | Value | When |
|---|---|---|
| `--dur-fast` | `150ms` | Color/opacity hovers |
| `--dur-normal` | `300ms` | Transform hovers, button lifts |
| `--dur-slow` | `600ms` | Reveal on scroll |
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Default for reveal motion |
| `--ease-snappy` | `cubic-bezier(0.32, 0.72, 0, 1)` | Snappy hover lifts |

### Rules
- All motion respects `prefers-reduced-motion: reduce` — disable transforms and parallax, keep opacity transitions.
- Reveal-on-scroll lives in `RevealSection` — use it, don't reinvent.
- One "hero moment" per page maximum. Hero video is the moment on `/`. Don't compete with it.

### Push-higher motion (use sparingly)
- Score number count-up on viewport entry (Space Grotesk, 600ms, ease-out-expo).
- Property card hover: 1px translateY + cyan border glow ramp 200ms.
- Eyebrow label fade-in 150ms ahead of headline on each section reveal.

---

## 7. Iconography

- **Library:** `lucide-react` exclusively. Never mix with another set.
- **Default size:** 18px in feature cards, 14px in inline lists, 32px in section "hero" icons.
- **Default color:** `#10A7FF` for primary actions, `#2DE2FF` for hover states, `slate-400` for inactive.
- Wrap icons in a `40×40` rounded surface `bg-white/4 border border-white/6 rounded-xl` when they anchor a feature card. Loose icons feel templated.

---

## 8. Imagery

### Photography direction
- **Atmosphere, not real estate cliché.** City skylines at night, light bouncing off water, abstract architectural detail — these match brand tone.
- **Never** stock photos of agents shaking hands, suburban homes with red SOLD signs, or families in front of houses.
- All hero / above-fold images must be at least 1920px wide and AVIF/WebP encoded.
- Treat the hero video as the brand's primary image — every other image should defer to it tonally.

### Product UI screenshots
- Always shown inside a device frame (phone bezel, browser chrome) — never bare.
- Frame `border: 5px solid #1c2740`, shadow `0 48px 96px rgba(0,0,0,0.7)`.
- The interior screen is always real product UI, never a marketing mock.

---

## 9. Voice & Copy

### Sentence patterns
- Lead with the verb of value: "Know your number. Win the deal." not "Help you decide on a number."
- Numbers in headline copy beat adjectives: "30 days free" beats "Generous trial."
- Two-line headlines with a gradient on the second line are the canonical pattern.

### Bans
- "Empower," "leverage," "robust," "seamless" — banned. They read as template.
- No exclamation points anywhere on marketing pages.
- No "Discover," "Welcome to," or "Introducing" page openers.

### Editorial push
- Use sentence-case for ALL headlines except the wordmark. Title Case reads as 2014.
- One contraction per page maximum — they signal a marketing tone we want to keep below the threshold.
- Eyebrow labels are imperative or descriptive ("How it works," "Why investors switch") — never branded slogans.

---

## 10. Page Patterns

### Marketing pages
- **Hero** → video background, eyebrow + display headline + lead paragraph + dual CTA (primary + secondary).
- **Problem** → eyebrow + two-line headline with gradient terminal word + 1 paragraph + optional inline stats.
- **3-step explainer** → eyebrow + headline + 3 cards in `gap-px` (hairline divider) on a `bg-white/5` parent.
- **Bento feature grid** → asymmetric tiles with one or two `col-span-2` heroes.
- **Pricing** → 3 cards, middle highlighted with `glow-brand` and `Most Popular` capsule.
- **Comparison table** — only below the cards, never replace them.
- **FAQ teaser on home** → 5 questions with "View all questions →" link to `/faq`.
- **Final CTA** → logo + 2-line gradient headline + 1 paragraph + Primary CTA + secondary CTA + trial reassurance.

### SEO requirements per page
- Every standalone page has `metadata` export: title (<60 char), description (<160 char), `alternates.canonical`, `openGraph`.
- FAQ pages emit `<script type="application/ld+json">` with `FAQPage` schema.
- How-It-Works pages emit `HowTo` schema.
- Resources/collection pages emit `CollectionPage` schema with `hasPart` Articles.
- Pricing pages emit `Product` + `Offer` schema when fields are stable.

---

## 11. Accessibility (non-negotiable)

- Color contrast: WCAG AA on all text. `--bw-slate` (#6B778A) is the floor for non-essential text on `--bw-midnight`.
- Every interactive element has a visible focus ring (custom: 2px `#10A7FF` outline, 2px offset).
- All decorative gradients have a text fallback for non-supporting browsers.
- `aria-label` on icon-only buttons. `aria-expanded` on collapsibles.
- Respect `prefers-reduced-motion`.

---

## 12. Anti-Generic Test (run before shipping any new section)

Score the section against these. **At least 5 must be true.**

1. Hierarchy is clear within 2 seconds of scanning.
2. Spacing rhythm is intentional (not uniform).
3. There is depth — layering, overlap, shadow, or motion.
4. Typography demonstrates the brand pair (Space Grotesk + Inter).
5. Color is used semantically, not decoratively.
6. Hover/focus/active states feel designed, not default.
7. Layout breaks a grid line on purpose (asymmetric block, off-center anchor).
8. Data visualization fits the design system (no random library defaults).
9. Motion clarifies — it doesn't decorate.
10. Could plausibly appear in a real investor product screenshot.

If a section scores 4 or below, **redesign**, do not ship.

---

## 13. Tokens (drop-in CSS)

```css
:root {
  /* Color — Primary */
  --bw-blue: #10A7FF;
  --bw-cyan: #2DE2FF;
  --bw-deep: #0B5CFF;

  /* Color — Neutrals */
  --bw-midnight: #08111F;
  --bw-navy: #111B2B;
  --bw-graphite: #1A2433;
  --bw-slate: #6B778A;
  --bw-soft-white: #F8FAFC;

  /* Color — Alerts */
  --bw-info: #10A7FF;
  --bw-success: #74C8FF;
  --bw-warn: #A8C5FF;
  --bw-error: #386BFF;

  /* Gradient */
  --gradient-primary: linear-gradient(90deg, #10A7FF 0%, #2DE2FF 100%);
  --gradient-button: linear-gradient(135deg, #0B5CFF, #10A7FF);

  /* Type scale */
  --text-display: clamp(3rem, 1rem + 7vw, 6.5rem);
  --text-h1: clamp(2.5rem, 1.5rem + 3vw, 4rem);
  --text-h2: clamp(1.875rem, 1.5rem + 1.5vw, 3rem);

  /* Motion */
  --dur-fast: 150ms;
  --dur-normal: 300ms;
  --dur-slow: 600ms;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-snappy: cubic-bezier(0.32, 0.72, 0, 1);

  /* Elevation */
  --shadow-brand: 0 4px 24px rgba(16,167,255,0.25);
  --shadow-brand-lg: 0 8px 40px rgba(16,167,255,0.35);
}
```

---

**This document is the spec. Any visual decision that contradicts it is wrong unless it explicitly improves the brand — and if it does, this document updates first.**
