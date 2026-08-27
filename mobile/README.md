# BidWise Invest — Mobile

The iOS/Android client for [BidWise Invest](https://bidwiseinvest.com) — tax-deed
and auction deal-intelligence for real-estate investors. Built with Expo (expo-router,
React Native, New Architecture) and mirrors the web dashboard: county auction data,
per-property deal scores, off-market leads, watchlists, and a bidding pipeline.

Auth, session storage (device keychain), and paywall entitlements are shared with the
web app via Supabase; data is served from the authenticated `bidwiseinvest.com/api`
endpoints with the same tier-masking as the web dashboard.

## Prerequisites

- Node 20+ and npm
- An `.env.local` (copy from `.env.example`) with at least `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_APP_URL`. The app throws at startup
  if the Supabase vars are missing (`lib/supabase.ts`).
- EAS CLI (`npm i -g eas-cli`) for device/preview/production builds.

## Run locally

```bash
npm install
npx expo start
```

Open on a device (Expo Go for JS-only work, or a development build for native modules
like secure-store / notifications), the iOS simulator, or the Android emulator.

## Project layout

- `app/` — expo-router screens (auth, paywall, feed, property detail, leads, pipeline,
  watchlists, profile).
- `lib/` — Supabase client, auction/leads/pipeline APIs, auth context, push, RevenueCat
  purchases, Sentry, secure storage, types.
- `theme/` — light/dark palette singleton (`palette.ts`) + `ThemeProvider`.
- `components/` — shared UI (DealCard, ScoreBadge, FilterSheet, etc.).
- `assets/images/` — branded app icon, Android adaptive layers, splash mark, web favicon.
- `scripts/asset-gen/` — deterministic brand-asset generator (Playwright → PNG). See below.

## Branded assets

App icon, Android adaptive icon (foreground / background / monochrome), splash mark,
and web favicon are generated deterministically from `scripts/asset-gen/template.html`
(a BidWise "B" monogram in the brand blue→cyan gradient on the `#08111F` navy blueprint
field, on an amber auction baseline). To regenerate after a design tweak:

```bash
# Playwright + sharp are resolved from the sibling web/ project's node_modules.
PLAYWRIGHT_REQUIRE_BASE="../web/package.json" node scripts/asset-gen/generate.mjs
SHARP_REQUIRE_BASE="../web/package.json"       node scripts/asset-gen/probe.mjs
```

`generate.mjs` writes the six PNGs referenced by `app.json`; `probe.mjs` reports each
file's dimensions and pixel makeup so you can verify without opening them.

## Build & ship

See [`TESTFLIGHT_RUNBOOK.md`](./TESTFLIGHT_RUNBOOK.md) for the near-term TestFlight path
(the fastest way to get the app on a tester's phone) and
[`APP_STORE_SUBMISSION.md`](./APP_STORE_SUBMISSION.md) for the full public App Store
submission runbook.
