Every critique claim is verified. Now I'll produce the complete corrected report incorporating all corrections: fix LCH/OKLCH attribution, remove fabricated 67%/23% and the [3]-tabular citation and "4-step elevation [1]" attribution, escalate the emerald auth funnel to the #1 brand-consistency defect, add TYPE_TINT and TypeBadge to the file lists, scope/downgrade the odometer, and reframe the roadmap for the solo pre-revenue stage.

# BidWise Design Direction — Evolve or Rebrand?

A design-director's verdict, grounded in the code-level audit (A) and 2025-2026 fintech/dashboard best practice (B).

---

## 1. Verdict: EVOLVE. Do not rebrand.

**The foundation is sound. The execution is inconsistent. Those are different problems, and only one of them is a rebrand.**

A rebrand is warranted when the identity itself is wrong — generic, confusable with competitors, off-strategy, or actively repelling the target user. None of that is true here. BidWise already owns three things that are genuinely hard to acquire and expensive to throw away:

1. **A distinctive, ownable signature** — the 135° blue→cyan gradient, applied consistently across logo, CTA, score accents, and `gradient-text` (`globals.css:83-88`, `tailwind.config.ts:54-55`, mobile `palette.ts:19`). In the tax-deed / PropTech space — which is overwhelmingly municipal-blue, clip-art, and spreadsheet-grey — a clean electric-blue/cyan gradient on near-black reads as a *modern instrument*, not a county website. This is brand equity. Burning it would be a strategic error.
2. **A credible, non-default type pairing** — Space Grotesk (display) + Inter (body), used the same way on both platforms, with `tabular-nums` already on mobile financial figures. This is exactly the fintech-grade pairing the 2026 references converge on (Inter is the de-facto money-UI body face — Mercury, Linear, Ramp ecosystem) [1][3]. It already has character. You don't reach for this and then walk away from it.
3. **Domain-honest data design** — the deal-card anatomy (score badge → type tint → spec chips → ROI/ARV/Profit strip) and the real risk banners in `PropertyDetailPanel` (commercial-valuation warning, below-threshold, low-confidence) communicate "serious investing tool." That product-truthfulness is itself the 2026 trust pattern: explainability and transparent methodology over flourish [2][11].

What the audit actually documents is **not a broken brand — it's an unfinished design *system*.** The same core blue/cyan identity is executed several different ways (web-marketing dark-only, web-app dark-no-system, mobile system-aware) with forked tokens — *and one whole surface has quietly grown a second brand* (the emerald auth funnel, §1.1). Add two opposite status-color philosophies (web traffic-light vs. mobile all-blue), an all-blue property-type taxonomy, and bespoke charts, and every one of these is a *consistency-and-tokenization* fix. None requires a new logo, a new palette, or a new name.

The research is blunt on this point: in 2025-2026, **credibility in money tools comes from restraint, consistency, and instrument-grade clarity — not from visual reinvention** [1][2][5]. Category leaders (Linear, Mercury) didn't rebrand to look premium; they *disciplined* an existing identity — rationing one accent, generating surfaces in a perceptually-uniform color space, reserving green/red for meaning [1][2]. BidWise's gap to that bar is discipline, not identity.

### 1.1 The single biggest brand-consistency defect: the auth funnel is a second brand

This deserves top billing because it is worse than the report's prior framing ("a few off-brand auth CTAs") implied. **The entire first-touch conversion surface — `login/page.tsx` and `signup/page.tsx` — runs a parallel *emerald* identity, not the brand blue/cyan.** Verified in code, emerald owns:

- the **primary button** (`bg-emerald-500 hover:bg-emerald-400`, login:157, signup:246) and its shadow glow (`shadow-emerald-500/20`)
- **every focus ring and input focus border** (`focus:border-emerald-500/60 focus:ring-emerald-500/30`, login:88,107, signup:181,196)
- **every link** — forgot-password, "Start your free trial", "Sign in", "Sign in to your account" (`text-emerald-400`, login:95,176, signup:236,360)
- the **password-strength meter** "Strong" state (`bg-emerald-500`, signup:74) and strength label
- **success checkmarks and value-prop icons** (login:14-16,227, signup:19-21,119,162)
- **ambient background blur orbs** (`bg-emerald-500/8`, login:191, signup:292)
- supporting infrastructure: a `.glow-emerald` utility (`globals.css:102`) and a full `emerald` scale retained in Tailwind with the comment *"Keep emerald for deal score indicators"* (`tailwind.config.ts:30-31`).

So the claim "the brand is already consistent across platforms" is only true for the *app* surfaces. The page a brand-new user sees **first** — where trust is won or lost — presents an entirely different accent color from the product behind the login. That is a bigger consistency failure than the mobile all-blue status issue, and it is the one to fix first (P0-3). The fix is unambiguous: emerald is reserved **only** for *positive deal-score / profit data* (the `tailwind.config.ts` comment's actual intent); the auth funnel's chrome — buttons, links, focus rings, strength meter, orbs — moves to the brand `.btn-primary` blue/cyan and brand focus ring.

**One nuance worth surfacing to you (Karpathy principle 1):** the strongest single *deliberate* divergence — web's full red/amber/green vs. mobile's all-blue status palette — is a real *decision*, not just drift. Someone chose "danger is blue" on purpose (`palette.ts:27`, the `ScoreBadge` comment at `:9-19`). The evolve-path resolves it by ruling in favor of the web approach (semantic color for data) because it's correct for the category and color-blind safety — but that means **overriding an existing brand-guide rule** that says alerts stay blue. That's the one place where "evolve" requires you to consciously retire a prior brand decision. Flagging it so it's a choice, not a surprise.

**Verdict in one line:** Keep the brand. Build the system the brand always implied. Evolve toward Linear/Mercury-grade discipline on the *existing* blue/cyan dark identity — and collapse the emerald auth funnel back into it.

---

## 2. What to KEEP (protect this equity)

| Asset | Where it lives | Why it stays |
|---|---|---|
| Blue→cyan 135° gradient | `globals.css:83-88`, `tailwind.config.ts:54-55`, mobile `palette.ts` | The ownable signature. Distinctive in a dull category. |
| Brand core hexes — Blue `#10A7FF`, Cyan `#2DE2FF`, Deep `#0B5CFF` | shared | Consistent across the *app* surfaces. No reason to touch (just extend it to auth). |
| Space Grotesk + Inter pairing | both platforms | Credible fintech voice; not a system-stack default [1][3]. |
| `tabular-nums` on financial figures (mobile) | mobile components | Correct instinct — the single highest-leverage money-UI detail [4][9]. *Extend to web.* |
| Dense, domain-honest deal-card anatomy | `DealCard.tsx`, `PropertyDetailPanel.tsx` | Reads as an investing instrument, not generic SaaS. |
| Risk/confidence banners + methodology honesty | `PropertyDetailPanel.tsx` | This *is* the 2026 explainable-AI trust pattern [11]. Lean in. |
| Performance primitives — opacity-only skeleton pulse, `cache:'no-store'`, IntersectionObserver reveals | both | Good bones. Keep. |
| 16px card / 999px pill radius as the *base* | both | Fine as a default; just stop using it for *everything* (see §3). |
| Marketing composition instincts — asymmetric problem section, bento grid, hairline grids | `page.tsx` | Above the template bar; bento is a dominant 2026 dashboard pattern [6][7]. |

---

## 3. The REFINED design system (upgrade, not replace)

The goal: take the *existing* tokens and make them a single, perceptually-uniform, semantically-disciplined system shared across web and mobile. Every value below is a tweak to or formalization of something already in the code.

### 3.1 Color — ration the accent, regenerate the dark ramp, reserve semantics

**Principle (from [1][2]):** brand blue/cyan is for *brand and navigation*; green/amber/red is for *data meaning only*; everything structural is a cool-gray ramp. One filled accent CTA per view.

**Brand (unchanged — this is the equity):**
```
--brand-blue:  #10A7FF
--brand-cyan:  #2DE2FF
--brand-deep:  #0B5CFF
--brand-gradient: linear-gradient(135deg, #10A7FF 0%, #2DE2FF 100%)
```
Rule change: the gradient is now reserved for **the single primary action per screen** (Unlock / Analyze / Sign In / Start Trial) + logo + one hero accent. Demote every other decorative blue to the gray ramp below — and pull the **emerald auth funnel** onto this brand action color (see §1.1, P0-3).

**Dark surface ramp — regenerate in OKLCH, collapse to 4 steps.** The current navy ramp (`#04080F → #080D1A → #0E1628 → #141F35 → #1A2844`) is five hand-picked steps that go slightly muddy at the top. Linear documents its theming in **LCH** [1]; **OKLCH is BidWise's choice** here — it's the current CSS-native, perceptually-uniform equivalent and fits the existing CSS-custom-property convention. Replace with a 4-step OKLCH-derived stack (fixes blue-tinted high-elevation muddiness):

```
/* dark — canvas → card → popover → modal, perceptually even */
--surface-0: oklch(15% 0.02 250)   /* ≈ #070C16  canvas        */
--surface-1: oklch(19% 0.025 250)  /* ≈ #0E1626  card / row     */
--surface-2: oklch(24% 0.03 250)   /* ≈ #16223A  popover / sheet */
--surface-3: oklch(29% 0.035 250)  /* ≈ #1E2C48  modal / dialog  */
--border-subtle: oklch(100% 0 0 / 0.07)
--border-strong: oklch(100% 0 0 / 0.13)
```
Cards get **presence via 1px inset border + soft shadow, not a competing fill** [1] — so the elevation tier is shadow/border, not a wildly different background.

**Text ramp (keep, verify APCA on OLED):** `#F1F5F9 / #94A3B8`. **Retire `#475569` as body/meta text on dark** — it lands near sub-AA and fails the 2026 APCA bar [9][10]. Use it only for disabled/decorative.

**Semantic data palette — the critical fix. Adopt ONE reserved set, identical on web and mobile:**
```
--data-positive: #34D399  (good deal / profit / low risk)
--data-caution:  #F59E0B  (marginal / warning)
--data-negative: #F43F5E  (loss / high risk / error)   ← rose, not pure red, for OLED + CVD
--data-neutral:  #94A3B8  (structural / unscored)
```
- **Mobile must drop the all-blue status set** (`palette.ts:27` `danger:#386BFF`, `warning:#74C8FF`) and `ScoreBadge.bandFor` (`ScoreBadge.tsx:11-19`). A WEAK and a STRONG deal differing only by blue lightness is the single biggest *legibility* defect in the app, and it fails color-blind users outright [2][9].
- **The all-blue problem is not only in status — the property-type taxonomy is monochrome-blue too.** `DealCard.tsx:17-23` `TYPE_TINT` colors Commercial `#386BFF`, SFR `#74C8FF`, Multi-Family `#10A7FF` (only Vacant Land escapes to cyan). Every property type is a shade of blue, which kills at-a-glance type scanning in the feed. Give each type a *distinct hue* (it's a categorical, not semantic, axis — so a small qualitative set is fine, kept clear of the green/amber/rose semantic set), or pair the tint with its always-visible type label + icon. Recoloring status while leaving the type taxonomy blue only half-solves the legibility problem.
- **Web has its own divergent, ad-hoc color sources to consolidate**, not just the charts:
  - `roiBadgeCls` / `scoreColorCls` / `riskColorCls` (`DashboardClient.tsx:390-411`) hand-roll emerald/amber/orange/red ramps inline.
  - `TypeBadge` (`DashboardClient.tsx:439-463`) is a **third** color philosophy entirely — Commercial=**purple**, Multi-Family=**orange**, SFR=**blue**, Vacant Land=emerald. So web property types disagree with both the semantic set *and* mobile's blue taxonomy. Pick ONE categorical type palette and use it on both platforms.
  Consolidate all of these down to: the 4-token semantic set for *meaning*, plus one shared categorical type palette for *property type*.
- **Pair every color judgment with a label or icon**, never color alone — `STRONG`/`OK`/`WEAK` text on the badge, ▲/▼ glyphs on profit, a true minus sign on negatives [2][9]. This survives color-vision deficiency and is the explicit 2026 standard.

**Fix the emerald auth funnel (HIGH — see §1.1).** The whole funnel runs a parallel emerald identity. Move buttons, links, focus rings, the password-strength "Strong" state, and the ambient orbs to brand blue/cyan; remove `.glow-emerald` (`globals.css:102`) once unused; reserve the Tailwind `emerald` scale strictly for positive deal-score data, matching its own comment's intent.

**Fix error-is-blue (HIGH).** `TextField.tsx:14,51` uses `#386BFF` for the error border. Error = `--data-negative`. A blue error never reads as an error.

**Data-viz palette (make charts part of the system).** The inline SVG charts hardcode `#64748b` axes and `rgba(0,0,0,0.05)` gridlines that break in dark mode (`DashboardClient.tsx:494,499-580`). Tokenize:
```
--viz-axis:   var(--text-3)
--viz-grid:   var(--border-subtle)
--viz-bad:    #F43F5E   --viz-marginal: #F97316
--viz-ok:     #F59E0B   --viz-good:     #34D399   --viz-great: #2DE2FF
```
Establish one color *key* (good=cyan/green, bad=rose) and reuse it across **every** chart — if cyan means one thing here and another there, trust drops [10]. Use the 60-30-10 split (neutral dominant / structural chart color / one insight accent) [10].

### 3.2 Typography — add mid-weight, fix the numeral system

**Keep both families.** Two fixes:

**(a) Build a real numeral system NOW — highest leverage, lowest effort.** Apply to every money/metric/table value (ARV, max-bid, ROI, net profit, deal score) on web (mobile already has `tabular-nums`):
```css
.tnum { font-variant-numeric: lining-nums tabular-nums; font-feature-settings: 'lnum' 1, 'tnum' 1; }
```
Plus the craft details that separate "instrument" from "template" [4][9]: true minus sign **U+2212** (not hyphen), always render trailing zeros (`$54.00` not `$54`) to stop layout jitter, route all formatting through `Intl.NumberFormat`, real `$` glyph. This single change is what moves the screens that matter most from template to instrument-grade.

**(b) Break the `font-black` monotony (MEDIUM).** Nearly every heading and number is weight 800 + `tracking-tight`, so hierarchy comes only from size and the UI reads "shouty." Introduce a real type scale with mid-weights:

| Token | Size (web / mobile) | Weight | Use |
|---|---|---|---|
| `display` | 48–64 / 34 | 700 | hero only |
| `h1` | 32 / 26 | 700 | page title |
| `h2` | 24 / 20 | 600 | section |
| `h3` | 18 / 16 | 600 | card title |
| `metric-hero` | 40 / 32 | 700, tnum | the *one* lead number |
| `metric` | 20 / 17 | 600, tnum | supporting metrics |
| `body` | 15 / 15 | 400 | Inter |
| `label` | 11 / 11 | 600, +0.04em tracking | micro-labels |

Reserve 700+ for display/hero/the single lead number; everything secondary steps down to 600/500.

### 3.3 Spacing, radius, elevation — formalize and vary

**Spacing scale (mobile currently has *none* — raw 14/16/12 inline). Tokenize a 4px base on both platforms:**
```
--space-1:4  --space-2:8  --space-3:12  --space-4:16  --space-5:24  --space-6:32  --space-8:48  --space-10:64
```
Then *use rhythm intentionally* — the marketing `py-20`-everywhere uniformity is itself a template tell [B anti-patterns].

**Radius — vary by component weight (fixes the "everything is a 16px rectangle" flatness, MEDIUM):**
```
--radius-sm: 8   (chips, inputs, badges)
--radius-md: 12  (list rows, secondary cards)
--radius-lg: 16  (primary cards — current default)
--radius-xl: 24  (hero / modal / paywall sheet)
--radius-pill: 999
```

**Elevation — a 4-tier shadow system (BidWise's own decision; Linear documents surface *roles*, not a numbered scale [1]), and *give mobile a shadow system at all* (it currently has none — depth is border-only):**
```
--elev-0: none                                        /* flush row            */
--elev-1: 0 1px 2px rgba(0,0,0,.30)                   /* card                 */
--elev-2: 0 4px 16px rgba(0,0,0,.35)                  /* popover / sticky      */
--elev-3: 0 12px 40px rgba(0,0,0,.45)                 /* modal / sheet         */
--glow-brand: 0 0 48px rgba(16,167,255,.18)           /* reserve for ONE hero  */
```
Tie each elevation tier to a surface tier (surface-1↔elev-1, etc.) so depth is systematic, not ad-hoc-per-feature.

### 3.4 Glassmorphism — scope it to overlays only

Glass stays (it signals technical sophistication for fintech), but **only on overlays: paywall/unlock modal, bottom sheets, sticky headers** — never behind a financial table or a balance/score number, where blur drops contrast below WCAG/APCA [8]. Concretely: keep `.glass-card` for sheets; **delete the dead/conflicting `.liquid-glass`** (`globals.css:57-81`, dark-only `rgba(0,0,0,0.4)`, now broken under light-default web) and the legacy `.logo-wrap`.

### 3.5 Tables & data-viz guidance

**Treat the deals list as a proper data table** (model on Resend/Supabase: one headline number, then a log-style table) [5]:
- Right-align all numeric columns; apply `.tnum`.
- Minimal row chrome — rely on contrast + a single semantic score/status column, not heavy borders [5].
- Sortable headers; sticky header (glass OK here).
- Color *only* the score/risk column semantically; everything else neutral.

**Lead with one number, 3× scale** [5]: on the deal detail and each card, make **Deal Score** (or **Estimated Net Profit**) the hero metric at ~3× the supporting metrics, top-left, with ARV / max-bid / ROI / rehab as the supporting tier — replacing the current uniform-emphasis 3-metric strip.

**Split scan vs. deep-dive** [5][6]: a fast ranked-deals bento/table scan view (summary signal per deal) that drills into the single-deal analysis page (full comps, methodology, AI brief) — progressive disclosure (~5-9 elements default) instead of dumping all financials at once [6].

### 3.6 Motion — purposeful, compositor-only

Keep the current compositor-safe approach (transform/opacity reveals, button `translateY`). Add only comprehension-first motion [2][12]:
- 200ms ease transitions on drill-down (scan → detail) to clarify cause/effect.
- **Odometer count-up: scope it to load-in reveals only — and treat it as low priority.** The Robinhood precedent [12] is for *live* market data (bid/ask ticking in real time). BidWise's numbers are **static per monthly snapshot** ("monthly pre-scored deal batches") — deal score, ARV, ROI don't change in real time; they change on navigation/load. So a real-time odometer is largely cosmetic. If used at all, limit it to a one-time animate-in when a value first renders. Do not let it crowd out the higher-value fixes; consider cutting it.
- Mobile: replace the entire-tree `key={scheme}` remount on theme flip (`ThemeProvider.tsx:52-58`) with a render-tracked context (preserves scroll/state).
- Trim ambient `blur-3xl`/`blur-2xl` orbs on the marketing hero (`page.tsx:24-25,120,128`) on low-end mobile — GPU-costly. Never animate width/height/top/left.

### 3.7 One shared token source (kills future drift)

Today web uses CSS vars + Tailwind, mobile uses a JS `Palette` singleton, and literals like `rgba(107,119,138,0.2)` are hand-copied across files. Define **one canonical token file** (JSON or TS) → generate Tailwind theme (web) + `Palette` (mobile) from it. Any future palette change becomes one edit, not a find-replace. This is the structural fix that prevents the two-status-philosophy split, the emerald-funnel fork, and the three-way type-color disagreement from ever recurring.

---

## 4. Prioritized UI upgrades (P0 / P1 / P2)

> **Stage note (read first).** BidWise is solo-operated, AI-agent-run, and **pre-revenue — the actual launch blocker is that nobody can pay yet** (Stripe Customer Portal + Apple/RevenueCat IAP are not configured). So the priority isn't "do all of this in 12 weeks." It's: **ship the P0 credibility/legal fixes now** (they're cheap, small diffs, and one closes a legal risk), then **pause the multi-week P1/P2 system work until monetization is live and there's real user signal.** Polishing a funnel no one can convert through is the wrong order of operations for this stage.

### P0 — Credibility, legality & legibility (ship NOW; cheap, high-impact, do before monetization)

| # | Upgrade | Files / components |
|---|---|---|
| P0-1 | **Unify status color to the 4-token semantic set; kill mobile all-blue *and* the all-blue type taxonomy.** Rewrite `bandFor` to green/amber/rose; fix `palette.ts` status set; recolor `TYPE_TINT` so property types are visually distinct; consolidate web's ad-hoc `roiBadgeCls`/`scoreColorCls`/`riskColorCls` and the divergent `TypeBadge` (purple/orange/blue). Pair every band with a label/icon. | `mobile/theme/palette.ts:27`, `mobile/components/ScoreBadge.tsx:9-19`, `mobile/components/DealCard.tsx:17-23` (TYPE_TINT), `mobile/components/LeadCard.tsx:53-58`, `web/app/dashboard/DashboardClient.tsx:390-411` (badge fns) + `:439-463` (TypeBadge) |
| P0-2 | **Fix error-is-blue.** Error border → `--data-negative`. | `mobile/components/ui/TextField.tsx:14,51` |
| P0-3 | **Collapse the parallel emerald auth identity into the brand (biggest brand-consistency defect — §1.1).** Move primary buttons, **all links**, **all focus rings/borders**, the **password-strength "Strong" state**, success icons, and the **ambient orbs** from emerald to brand blue/cyan. Remove the `.glow-emerald` utility; reserve the Tailwind `emerald` scale for positive deal-score data only. | `web/app/login/page.tsx` (button :157; focus :88,107; links :95,176; orb :191; value-icons :14-16,227) · `web/app/signup/page.tsx` (button :246; focus :181,196; links :236,360; strength-meter :74; orb :292; icons :19-21,119,162) · `web/app/globals.css:102` (.glow-emerald) · `web/tailwind.config.ts:30-31` (emerald comment/scale) |
| P0-4 | **Replace fake social proof (also a legal risk).** Hardcoded testimonials ("Marcus T.", "Devon K.") + "50,000+ properties" on a pre-revenue product are a credibility *and* FTC-endorsement legal risk. Swap for honest "what you get" / methodology stats. | `web/app/page.tsx:161-171,449-471`, `web/app/signup/page.tsx:314-326` |
| P0-5 | **Web numeral system.** Add `.tnum`, U+2212, trailing zeros, `Intl.NumberFormat` to all money/metric values. | `web/app/dashboard/DashboardClient.tsx`, `PropertyDetailPanel.tsx` |
| P0-6 | **Self-host fonts via `next/font`;** drop the render-blocking `@import` + duplicate Inter `<link>`. (perf + craft — see §5) | `web/app/globals.css:1`, `web/app/layout.tsx:24-26` |

### P1 — System discipline & hierarchy (DEFER until monetization is live + there's user signal)

| # | Upgrade | Files / components |
|---|---|---|
| P1-1 | **Single shared token source** → generate Tailwind theme + mobile `Palette`. Eliminate `rgba(107,119,138,0.2)` literals. | new `tokens.ts`; `web/tailwind.config.ts`, `mobile/theme/palette.ts`, mobile components |
| P1-2 | **Regenerate dark ramp in OKLCH, 4 surface tiers + 4 elevation tiers;** give mobile a shadow system. | `globals.css:23-33`, `mobile/theme/palette.ts`, `mobile/tailwind.config.js` |
| P1-3 | **"Lead with one number" deal card** — hero metric at 3× scale; supporting tier below. | `mobile/components/DealCard.tsx:126-139`, web dashboard rows |
| P1-4 | **Charts onto the design system** — tokenized axes/grid, theme-aware, shared color key. | `DashboardClient.tsx:483-580` (ROIChart/ScatterChart) |
| P1-5 | **Type scale with mid-weights;** stop using `font-black` everywhere; reserve 700+ for display/hero/lead number. | `globals.css:145-147`, `page.tsx`, mobile components |
| P1-6 | **Vary radius by component weight** (8/12/16/24); add to token set. | both |
| P1-7 | **Ration the cyan accent** — one filled brand CTA per screen; demote other blues to gray ramp. | audit per screen, web + mobile |

### P2 — Structure & delight (DEFER; lowest urgency, post-monetization)

| # | Upgrade | Files / components |
|---|---|---|
| P2-1 | **Split scan vs. deep-dive** — fast ranked bento/table scan → single-deal analysis page (progressive disclosure). | `mobile/app/(app)/feed.tsx` + `property/[parcelId].tsx`; web dashboard list → detail |
| P2-2 | **Deals list as a real data table** — right-aligned tnum columns, sortable, semantic status column, minimal chrome. | `DashboardClient.tsx` table |
| P2-3 | **Scope glass to overlays;** delete `.liquid-glass` + `.logo-wrap`. | `globals.css:57-81,149-155` |
| P2-4 | **Odometer count-up — optional, load-reveal only.** Scope to a one-time animate-in (numbers are static per snapshot, not live [12]); cut if it competes with higher-value work. Keep 200ms drill transitions. | mobile + web |
| P2-5 | **Refactor `DashboardClient.tsx` (2,166 lines)** — extract normalization, formatters, chart components into modules (<800-line ceiling). | `DashboardClient.tsx` |
| P2-6 | **Decide web theme behavior deliberately** — either enable system on web app or document dark-only as intentional; reconcile dark-only marketing vs. light app mockup. | `layout.tsx:30`, `page.tsx` |
| P2-7 | **Mobile theme provider** — replace `key={scheme}` full remount with render-tracked context. | `mobile/theme/ThemeProvider.tsx:52-58`, `colors.ts` |
| P2-8 | **Explainable-AI surface** — make the AI brief visibly show *why* a deal scored as it did; plain-language paywall microcopy. | `PropertyDetailPanel.tsx`, paywall modal |

---

## 5. Quick performance / quality wins

1. **Fonts (P0-6):** move Space Grotesk + Inter to `next/font` (self-hosted, subset, `display:swap`); delete the `@import` (`globals.css:1`, render-blocking, serializes after CSS) and the duplicate manual Inter `<link>` (`layout.tsx:24-26`). Removes a third-party origin from the critical path and improves LCP/FCP — and aligns with the project's own perf guidance (preload only critical font).
2. **Theme-broken charts:** the inline SVGs hardcode `#64748b` / `rgba(0,0,0,0.05)` and look broken in dark mode (`DashboardClient.tsx:499-577`). Tokenize per §3.1 — quality + correctness win.
3. **Split `DashboardClient.tsx` (2,166 lines)** well over the 800 ceiling — extract `lib/normalize.ts`, `lib/format.ts`, `components/charts/*`. Maintainability + smaller client bundle.
4. **Trim GPU-heavy ambient effects** on the marketing hero (multiple `blur-3xl`/`blur-2xl` orbs + large `backdrop-filter`, `page.tsx:24-25,120,128`) for low-end mobile browsers.
5. **Delete dead CSS** — `.liquid-glass` (`globals.css:57-81`), `.logo-wrap`, and `.glow-emerald` (`globals.css:102`, once P0-3 lands) — removes now-broken/orphaned utilities and reduces confusion.
6. **APCA pass on OLED** — audit `#475569`/`#94A3B8` meta text against the 2026 APCA bar [9][10]; retire `#475569` as body/meta on dark.
7. **44×44px tap-target audit** on mobile controls (badges, chips, icon buttons) — the fintech minimum [2].

---

## Do this next

### Now (this stage, pre-monetization) — ship the P0s, then stop and unblock payments

These are all small diffs with the highest trust-per-line return, and they're the only design work worth doing *before* anyone can pay:

- **Collapse the emerald auth funnel into the brand (P0-3)** — the single biggest brand-consistency defect; the first thing a new user sees should be the actual brand.
- **Unify the semantic 4-token color set, kill mobile all-blue status *and* the all-blue/divergent type taxonomies (P0-1)**; fix error-is-blue (P0-2).
- **Replace the fake testimonials / "50,000+" stat (P0-4)** — closes a pre-revenue legal/FTC risk.
- **Ship the web numeral system (P0-5)** and **self-host fonts (P0-6)**.

Then **redirect effort to the real launch blocker**: configure Stripe Customer Portal and Apple/RevenueCat IAP so the funnel can actually convert. Design polish on an unmonetizable funnel is premature.

### Later (only once monetization is live and you have user signal)

Resume the system spine — and let real usage prioritize it:

- **System spine (P1-1, P1-2, P1-4, P1-5):** stand up the single shared token source and generate both platforms from it (the structural fix that prevents the status-split, the emerald fork, and the three-way type-color disagreement from recurring); regenerate the dark ramp in OKLCH with 4 surface + 4 elevation tiers (give mobile real shadows); put charts on the token system; introduce the mid-weight type scale.
- **Hierarchy & structure (P1-3, P1-6, P1-7, P2-1, P2-2):** "lead with one number" deal cards; vary radius by weight; ration cyan to one CTA per view; split scan from deep-dive; turn the deals list into a sortable, tabular-numeral data table.
- **Polish & prove it (P2-3, P2-5..P2-8 + §5; P2-4 optional):** scope glass to overlays and delete dead CSS; refactor `DashboardClient.tsx`; decide web theme behavior deliberately; surface explainable-AI in the brief; add an optional load-reveal count-up only if it earns its place. Then verify against the bar that matters: primary view loads **under 2s** [5], APCA contrast passes on OLED [9][10], and a colorblind-simulation pass on every deal-score surface.

**The through-line:** you are not changing what BidWise *is*. You are finishing it — and finishing it in the right order for a solo, pre-revenue product. Same blue/cyan, same Space Grotesk + Inter, same dense investing-instrument DNA — executed with Linear/Mercury-grade discipline (and one consistent accent, including the login page) so it finally *looks* as trustworthy as the analysis underneath it.

---

### Footnotes
[1] Linear — *How we redesigned the Linear UI (part II)* (LCH theming, 3-variable themes, accent rationing, surface roles): https://linear.app/now/how-we-redesigned-the-linear-ui
[2] Eleken — *Fintech design guide / patterns that build trust [2026]* (semantic red/green, 44×44 targets, motion-with-purpose, trust microcopy): https://www.eleken.co/blog-posts/modern-fintech-design-guide
[3] Mercury Design System for React (18 color tokens, 14 type levels, one CTA per band): https://www.shadcn.io/design/mercury
[4] *The elements of fintech typography — part 1: readable money* (lining tabular figures, U+2212, trailing zeros, Intl.NumberFormat): https://medium.com/design-bootcamp/the-elements-of-fintech-typography-part-1-readable-money-b6c1226acbde
[5] 925 Studios — *35 SaaS Dashboard Design Examples & Trends (2026)* (lead-with-one-number 3×, table-after-headline, <2s load, restraint=trust): https://www.925studios.co/blog/saas-dashboard-design-examples-2026
[6] SaaSFrame — *Designing Bento Grids That Actually Work (2026)* (cognitive chunking, progressive disclosure per tile): https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide
[7] Orbix Studio — *Bento Grid Dashboard Design (2026)* (bento as a dominant 2026 SaaS dashboard pattern, faster scanning): https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics
[8] EverydayUX — *Glassmorphism in 2025 / Apple Liquid Glass* (glass for overlays; contrast risk behind text/numbers): https://www.everydayux.net/glassmorphism-apple-liquid-glass-interface-design/
[9] *Tabular Numbers in CSS: font-variant-numeric vs Monospace Hacks* (lining-nums + tabular-nums is the gold standard): https://dev.to/alanwest/tabular-numbers-in-css-font-variant-numeric-vs-monospace-hacks-25cn
[10] LetDataSpeak — *Data Visualization Colors: Best Practices & Palettes (2025)* (reuse color key, ~8-hue palette, 60-30-10, APCA + OLED): https://letdataspeak.com/mastering-color-in-data-visualizations/
[11] GitNexa — *Modern Fintech UI/UX Trends: Complete 2026 Guide* (explainable AI, invisible security, accessibility-first): https://www.gitnexa.com/blogs/modern-fintech-ui-ux-trends
[12] IXD@Pratt — *Design Critique: Robinhood (iOS App), 2025* (dynamic-color CTA, odometer count-up on **live** market data, time-range mental model): https://ixd.prattsi.org/2025/02/design-critique-robinhood-ios-app/