# App Store screenshots — capture on device, frame here

App Store screenshots must depict the **actual app** (Guideline 2.3.3). This pipeline
deliberately does not generate mockups: you capture the real screens on an iPhone and it only
reframes them to Apple's exact pixel sizes and adds a caption band.

It also removes the Mac dependency. Apple requires precise dimensions that a raw iPhone capture
will not match, and there is no Mac in this setup — Playwright does the compositing on Windows.

## 1. Capture on your iPhone

Install the current TestFlight build, sign in with an account that has **unmasked** access
(otherwise every card reads "Unlock to view address" and the screenshots are worthless), then
capture with **side button + volume up**:

> **It must not be an admin account.** Unmasked is necessary but not sufficient. An account on
> `EXPO_PUBLIC_ADMIN_EMAILS` sees things no customer ever will, and two of them land straight in
> these slots: `off_market_leads` is RLS-scoped to a single `user_id`, so the Leads tab shows
> hundreds of rows for the owning account and **empty for every paying subscriber**; and Profile
> renders an internal "Admin · Email Alerts" card with a live Send Test Alert button. A store
> screenshot has to depict what a customer gets (2.3.3) — an admin capture depicts something no
> one can buy. Use the reviewer/demo account instead, and note that Pipeline starts empty on it,
> so save two or three parcels before capturing slot `05`.

| File | Screen | Caption applied |
|---|---|---|
| `01` | Deals feed, DeKalb, scrolled so several scored cards show | Every parcel on the list, scored |
| `02` | A property detail with ARV, comps and recommended max bid visible | Comps, ARV, and a recommended max bid |
| `03` | Property detail scrolled to the calculation notes | See the math behind every number |
| `04` | Feed with the filter/sort sheet open | Sort by ROI, profit, or deal score |
| `05` | Pipeline tab with a few saved parcels | Track parcels to auction day |
| `06` | County picker showing all four counties | DeKalb, Gwinnett, Cobb, Clayton |

Avoid capturing: a masked/locked feed, an empty Leads tab, the Cobb past-date auction, or the
"In-app purchases unavailable" paywall.

## 2. Transfer and name

AirDrop or email them to the PC and drop them in `input/`, named by their slot — `01.png`,
`02.png`, and so on. Any iPhone resolution works. Suffixes are fine (`01-feed.png` matches slot 1).

## 3. Build

From `mobile/`:

```bash
PLAYWRIGHT_REQUIRE_BASE=../web/package.json node scripts/store-screenshots/build.mjs
```

Playwright resolves out of `web/node_modules` — it is intentionally not a `mobile/` dependency.
Missing slots are skipped with a warning rather than failing the run, so you can iterate.

## 4. Upload

`output/6.9/*.png` → App Store Connect. Apple needs **one** set — 6.9" (1320×2868) or
6.5" (1242×2688) — and scales the rest. Both are emitted, so either is accepted.

## Editing captions

`SHOTS` in `build.mjs`. Keep them short; Apple crops long lines on the store card. Every caption
must be true of the shipped build — an over-claiming caption carries the same 2.3.3 risk as an
over-claiming screenshot, and this project has already paid for that once.

## Notes

- `input/` and `output/` are gitignored. Screenshots are build artifacts, and captures may show a
  real account's data.
- Captures are scaled to fill the plate from the top, never stretched — distorting a real
  screenshot would misrepresent the app.
- If a slot renders blank, the input failed to decode; re-export it as PNG.
