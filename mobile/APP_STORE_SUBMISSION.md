# BidWise Invest App Store Submission

This is the release runbook for the Expo app in `mobile/`.

> **Addendum — 2026-07-07 (supersedes the "iOS Subscription Strategy" section below).**
> The strategy section further down describes an *access-only* v1 (no in-app account
> creation, no iOS purchase path). **The shipped app no longer matches that plan** and
> the description below is kept only as historical context — do not follow it.
>
> What the code actually does today:
> - **In-app account creation exists** — `app/(auth)/login.tsx` has a create-account toggle.
> - **A RevenueCat IAP paywall exists** — `app/paywall.tsx` + `lib/purchases.ts`, gated on
>   the `pro` entitlement. Access is granted by admin allowlist **OR** an active Supabase
>   subscription row (web/Stripe) **OR** an active RevenueCat entitlement
>   (`lib/auth-context.tsx`).
> - **Account deletion exists** (Apple 5.1.1(v)) — Profile → delete account →
>   `delete-account` edge function.
>
> This is a *stronger* compliance posture than the old access-only plan (it uses Apple IAP
> rather than steering users off-platform), but it **obligates you to provision Apple IAP
> before public review**: create the App Store Connect app record, sign the paid-apps
> agreement, create the subscription products, wire them to the RevenueCat `pro` entitlement,
> and set `EXPO_PUBLIC_REVENUECAT_IOS_KEY` as an EAS env var. With that key empty the paywall
> renders a graceful "not configured" fallback — fine for a TestFlight preview to an existing
> subscriber, but a guaranteed rejection for public review because a new reviewer signing up
> would hit a dead-end paywall.
>
> **For a TestFlight-only build to the partner, none of the IAP/ASC-metadata work is needed**
> — see [`TESTFLIGHT_RUNBOOK.md`](./TESTFLIGHT_RUNBOOK.md).

## Current App Identity

- App name: `BidWise Invest`
- Expo slug: `bidwise-invest`
- iOS bundle identifier: `com.bidwiseinvest.mobile`
- Version: `1.0.0`
- iOS build number: managed by EAS remote auto-increment after build `1`

Recommended bundle identifier: `com.bidwiseinvest.mobile`.

Reasoning: it is short, owned by the product name, and already matches the Android package. Create the App Store Connect app record with this exact bundle identifier before submitting a build. If you want a different bundle id, change `ios.bundleIdentifier` in `app.json` before the first App Store Connect record is created.

Important: after you upload the first build to App Store Connect, the app's bundle ID cannot be changed for that app record.

## Apple / Expo Setup Needed Once

1. Install and authenticate EAS CLI:

   ```powershell
   npm install --global eas-cli
   eas login
   ```

2. Create an App Store Connect API key:

   - App Store Connect -> Users and Access -> Integrations -> App Store Connect API
   - Create a key with App Manager access
   - Save the Key ID, Issuer ID, and downloaded `.p8` key somewhere secure

3. Link the Expo project:

   ```powershell
   cd <repo-root>\mobile
   eas init
   ```

4. Configure credentials:

   ```powershell
   eas credentials --platform ios
   ```

   Let EAS manage the distribution certificate and provisioning profile unless you already have a signing setup you need to preserve.

5. When `eas submit` asks, choose the App Store Connect app for `com.bidwiseinvest.mobile`. You may need your Apple Team ID and the numeric App Store Connect app ID from the App Information page.

## iOS Subscription Strategy

> **STALE (2026-07-07) — see the dated addendum at the top of this file.** The shipped app
> has in-app signup + a RevenueCat IAP paywall; the access-only plan below was not the path
> taken. Kept for history.

For the first iOS submission, ship the app as access-only for existing paid users:

- No iOS pricing screen.
- No iOS checkout button.
- No iOS link or call to action that tells users to subscribe on the website.
- No iOS account creation flow.
- Full app access only when a user logs in with an account that already has an active subscription row.

This keeps the binary aligned with Apple's guidance that apps should not steer users to non-IAP purchase methods from inside the app. It is still not as strong as implementing Apple In-App Purchase, but it is the lowest-change path for first submission.

Recommended App Review account:

- Email: `appreview@bidwiseinvest.com`
- Role: normal `client`, not admin
- Plan: `pro`
- Status: `active`
- Billing cycle: `annual`
- Current period end: at least 12 months in the future

Use a normal paid-client account instead of an admin account so Apple Review sees the actual customer experience without admin-only testing tools.

Create or refresh that account with:

```powershell
cd <repo-root>
python execution\invite_user.py --email appreview@bidwiseinvest.com --plan pro --full-name "App Review" --password "REPLACE_WITH_STRONG_PASSWORD"
```

Store the final password somewhere private, then paste the email/password into App Store Connect's Review Information section.

## Build And Submit

From `<repo-root>\mobile`:

```powershell
npm run lint
npx expo-doctor
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

To build and submit in one step:

```powershell
eas build --platform ios --profile production --auto-submit
```

## App Store Connect Checklist

- App Information
  - Name: `BidWise Invest`
  - Bundle ID: `com.bidwiseinvest.mobile`
  - Category: Finance or Business
  - Content rights: confirm you have rights to the property/auction data shown in-app

- Pricing and Availability
  - Decide free download vs paid app
  - If subscription-gated digital features are sold in the iOS app, implement Apple In-App Purchase before review

- App Privacy
  - Account creation/login: email address and user ID
  - Product interaction: saved deals, watchlists, pipeline activity
  - Diagnostics: only if enabled through Expo/Sentry/analytics
  - Contact info: email if used for account/support
  - Financial info: only if payment data is collected directly in-app

- Review Information
  - Provide a demo account with an active subscription or admin access
  - Add notes explaining that BidWise provides real-estate analysis and does not provide investment, legal, or tax advice
  - Include support contact: `support@bidwiseinvest.com`

- URLs
  - Privacy Policy: `https://bidwiseinvest.com/privacy`
  - Terms: `https://bidwiseinvest.com/terms`
  - Support: `mailto:support@bidwiseinvest.com` or a public support page

## Current Blockers To Resolve Before Review

State as of 2026-07-20 (Cycle 19 audit). The ASC app record EXISTS — "BidWise
Invest" (6772646236), TestFlight build 3 live under team Voyant LLC — so the
older record-creation blockers above are DONE. What actually remains:

Operator (dashboards — the entire critical path):
1. **Provision IAP**: ASC paid-apps agreement → auto-renewable subscription
   products → wire products to the RevenueCat `pro` entitlement/offering.
   Without this, a fresh reviewer hits the "purchases unavailable" paywall =
   guaranteed rejection.
2. **EAS production env vars**: `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (empty today)
   plus confirm `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   are set (app throws at launch without them); optional Sentry/PostHog DSNs.
3. **Activate the reconciliation webhook** — follow the checklist in
   `directives/revenuecat_reconciliation_scope.md` (function + migration are
   built and merged; needs secret mint + deploy + RC dashboard webhook URL).
4. **App Review demo account** (`appreview@bidwiseinvest.com`, active sub).
5. **ASC metadata**: description, keywords, category (Finance), screenshots
   (6.7" + 6.1" minimum), privacy questionnaire (mirror the in-repo privacy
   manifest in app.json), review notes + support contact.
6. Verify `bidwiseinvest.com/privacy` + `/terms` live (they are — linked from
   login/paywall/profile) and consistent with the privacy questionnaire.
7. `eas build --profile production` → `eas submit` → answer IAP review prompt.

Code (repo) — **REFUTED 2026-07-25. This section used to read "none blocking";
that was wrong.** A 41-agent adversarially-verified audit found 47 confirmed
findings, including code defects that would fail review on their own. Full
report + dated timeline: [`../directives/mobile_submission_audit.md`](../directives/mobile_submission_audit.md).

The four that must ship in the submitted binary:
- **Entitlement masking** — `web/app/api/data/[county]/route.ts:150` unlocks only
  `admin`/`expert`, but the webhook maps every iOS product to `pro`. A paying
  subscriber AND the `--plan pro` demo account (item 4 above) see 171/171 masked
  cards with null ROI/ARV/profit. Guaranteed 2.1 rejection. (4–6 h)
- **Cobb 404 + wrong-property** — `DealCard.tsx:35` passes no `file`, so every
  Cobb tap errors and, on any non-default auction chip, card N opens a different
  parcel's financials and saves the wrong parcel to the pipeline. (1–2 h)
- **`.easignore`** — the ROOT one does not exclude `mobile/.env*`, so
  `mobile/.env.local` (LAN Supabase host) ships in the EAS archive. (1–2 h)
- **`supportsTablet: true`** with no tablet layout obligates iPad screenshots;
  set it false. (5 min)

Already shipped and verified: restore-purchases button, account deletion
(5.1.1(v)), push opt-in CTA in Profile, privacy manifest, encryption declaration,
RevenueCat→Supabase webhook (built + CI-tested, but NOT yet deployed).

Corrections to item 2 above: the production EAS env is already fully provisioned
(Supabase URL/key, APP_URL, admin emails, PostHog, Sentry) — only
`EXPO_PUBLIC_REVENUECAT_IOS_KEY` is missing. Migration 028 is ALREADY APPLIED in
prod. And note the `preview` environment has ZERO variables, so the
`--profile preview` instruction in TESTFLIGHT_RUNBOOK.md produces a binary that
crashes at launch — build `production`.
