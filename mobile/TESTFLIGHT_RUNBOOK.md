# BidWise Invest — TestFlight Runbook

The fastest path to getting the app on a tester's iPhone (the co-founder / partner)
**without** the full App Store submission. TestFlight internal testing skips public
review, so no in-app-purchase / App Store Connect metadata work is needed for this step.

> Full public App Store submission is a separate, later effort — see
> [`APP_STORE_SUBMISSION.md`](./APP_STORE_SUBMISSION.md).

**Realistic timeline: ~1 day.** ~30–60 min of active operator work (env vars + kick off
build), then EAS build queue + Apple's TestFlight processing (typically 15–60 min, but can
take a few hours). No Apple *review* wait for internal testers.

---

## What is deliberately deferred for TestFlight

- **RevenueCat / in-app purchase (IAP).** Not needed. Access is granted by
  `lib/auth-context.tsx` when the signed-in user is an admin **OR** has an active
  Supabase `subscriptions` row **OR** holds an active RevenueCat entitlement. The partner
  already has a subscription row, so they get full access with **no paywall configuration**.
  With the RevenueCat keys left empty, `lib/purchases.ts` stays in its safe
  "not configured" state and the paywall renders a graceful fallback instead of crashing —
  but the partner never hits the paywall because their subscription row already unlocks
  access. Provision RevenueCat only for the public App Store build.
- **App Store Connect listing** (screenshots, description, privacy questionnaire,
  IAP products). Only required for public submission, not internal TestFlight.
- **App Review demo account.** Internal testers use their own real accounts; the
  `appreview@bidwiseinvest.com` account is for Apple reviewers during public submission.

---

## Prerequisites (one-time)

1. **Apple Developer Program membership** (paid, $99/yr) on the operator's Apple ID, and an
   **App Store Connect** account. TestFlight internal testing requires the app to exist as
   an app record; EAS can create it on first submit.
2. **EAS CLI** authenticated:

   ```powershell
   npm install --global eas-cli
   eas login
   ```

3. The Expo project is already linked — `app.json` has
   `extra.eas.projectId = 4349ef11-6d7c-4052-9903-20c37a58e06f` and `owner: kaijiharris`.
   No `eas init` needed.

---

## Step 1 — Set EAS environment variables (REQUIRED — build crashes at launch without them)

The `EXPO_PUBLIC_*` vars must exist as **EAS environment variables** for the profile you build,
or the binary throws at startup in `lib/supabase.ts`.

> **Corrected 2026-07-25.** This section used to claim EAS "does not read your local
> `.env.local` because it archives via git and `.env.local` is gitignored." That was wrong on
> both counts: EAS archives per `.easignore`, not `.gitignore`, and the root `.easignore` did
> not exclude `mobile/.env*` — so `mobile/.env.local` (a LAN `192.168.x` host) *was* being
> uploaded. Fixed in the same change that added this note. `lib/supabase.ts` now also rejects
> non-HTTPS and private-network hosts in release builds, so a stray dev value fails the app
> loudly instead of silently pointing at an unreachable address.

Check what is already set:

```powershell
cd <repo-root>\mobile
eas env:list
```

Set anything missing for the `preview` (and `production`) environments. **Pull the real
values from your Vercel project env / Supabase dashboard — do NOT paste secrets into this
file or any committed file.**

Required (app will not start without these two):

| Variable | Where the value comes from |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon/public key |

> **`EXPO_PUBLIC_APP_URL` is already pinned to `https://bidwiseinvest.com` in `eas.json`** for the
> `preview` and `production` profiles, so you do **not** set it here. eas.json `env` overrides any
> dashboard value, which is exactly what stops a build from targeting a LAN/dev host again — the
> cause of the "JSON Parse error: Unexpected character: <" deals bug. **If a stale dashboard
> `EXPO_PUBLIC_APP_URL` with a `192.168.x` / `localhost` value exists, delete it** to avoid confusion.

Recommended:

| Variable | Notes |
|---|---|
| `EXPO_PUBLIC_ADMIN_EMAILS` | Comma-separated admin emails (grants access without a subscription row). Optional. |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry → project → Client Keys (DSN). Leave empty to keep crash reporting off. |
| `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_HOST` | PostHog project API key + host. Leave empty to keep analytics off. |

Deferred (leave EMPTY for TestFlight):

| Variable | Notes |
|---|---|
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | Only needed for IAP on the public App Store build. |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | Same. |

Example (run once per missing var; choose the environment(s) you build):

```powershell
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value "<from Supabase>" --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<from Supabase>" --visibility plaintext
```

(The anon key is a public client key, so `plaintext` visibility is fine. Re-run for the
`production` environment too if/when you do the public build.)

Re-verify:

```powershell
eas env:list --environment preview
```

---

## Step 2 — Build the iOS binary

> **Build `production`, not `preview`.** Verified 2026-07-25: the `preview` environment has
> **zero** EAS variables set, while `production` is fully provisioned. A `--profile preview`
> build therefore has no Supabase URL or anon key and throws at launch — precisely the crash
> the troubleshooting section at the bottom of this file describes. `production` is also
> `distribution: store`, which is what TestFlight wants anyway.
>
> If you deliberately want a `preview` build, first mirror the two Supabase vars into that
> environment (`eas env:create --environment preview …`) and re-check with `eas env:list`.

```powershell
cd <repo-root>\mobile
eas build --profile production --platform ios
```

On the first iOS build EAS will prompt to create/manage the Apple **distribution
certificate** and **provisioning profile** — let EAS manage them unless you have an existing
signing setup to preserve. EAS also creates the App Store Connect app record for
`com.bidwiseinvest.mobile` if it does not exist yet.

When the build finishes, EAS prints a build page URL and a downloadable `.ipa`.

---

## Step 3 — Deliver the build to TestFlight

Submit the finished build to App Store Connect (which routes it into TestFlight):

```powershell
eas submit --profile production --platform ios --latest
```

`--latest` grabs the build you just made. (The `submit.production.ios` profile in
`eas.json` is intentionally empty — EAS prompts interactively for the Apple credentials /
App Store Connect app the first time and remembers them.)

Alternatively, build + submit in one step:

```powershell
eas build --profile preview --platform ios --auto-submit
```

After submission, Apple **processes** the build (encryption compliance is already declared
via `usesNonExemptEncryption: false` in `app.json`, so there is no export-compliance
prompt). Processing usually completes in 15–60 min; the build then appears under
**TestFlight → iOS builds** in App Store Connect.

---

## Step 4 — Add the partner as an internal tester

1. App Store Connect → your app → **TestFlight** tab.
2. **Internal Testing** → create/select an internal group (e.g. "BidWise Founders").
3. **Users and Access**: ensure the partner's **Apple ID email** is added as a user with a
   role that allows TestFlight (App Manager or Developer). Internal testers must be members
   of your App Store Connect team — internal testing is capped at 100 testers and needs no
   Beta App Review.
4. Add the partner to the internal group and assign the processed build.
5. The partner installs the **TestFlight** app from the App Store, accepts the invite email,
   and installs BidWise Invest.

The partner signs in with their existing BidWise account. Because their Supabase
`subscriptions` row is active, `hasActiveAccess` is true and they land straight in the feed
— no paywall.

---

## Verification checklist

- [ ] `eas env:list --environment preview` shows the two Supabase vars set (`EXPO_PUBLIC_APP_URL` is pinned in `eas.json`, not here).
- [ ] `eas build --profile preview --platform ios` finished green.
- [ ] Build shows in App Store Connect → TestFlight → iOS builds as "Ready to Test".
- [ ] Partner's Apple ID is an App Store Connect user + member of the internal group.
- [ ] Partner installs via TestFlight, signs in, and reaches the deals feed (county picker
      shows DeKalb / Gwinnett / Cobb / Clayton), opens a property, and sees scores.
- [ ] Push-alerts CTA on the Profile tab prompts for notification permission (optional to test).

---

## If the app crashes immediately on launch

Almost always missing EAS env vars. Confirm `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` are set for the `preview` environment (Step 1) and rebuild.
`lib/supabase.ts` throws a descriptive error at import time when they are absent.
