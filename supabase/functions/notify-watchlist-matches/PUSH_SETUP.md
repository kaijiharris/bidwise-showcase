# Push notifications setup

Companion to [DEPLOY.md](./DEPLOY.md). The Edge Function already sends emails;
this guide turns on the parallel push-notification leg.

---

## What this turns on

When a new watchlist match is found, the function now:

1. Sends the existing Resend email digest
2. Looks up every Expo push token registered for that user (`device_tokens`)
3. Fires a single batched push to Expo's `/push/send` endpoint
4. Marks the matches as `notified=true` in `watchlist_leads`

Push is **best-effort** — if Expo's API rejects, the email already succeeded
and matches still get recorded. Errors land in the function response's
`errors` array.

---

## 1. Apply the schema change

In Supabase Studio → SQL Editor, paste the contents of
`supabase/migrations/005_device_tokens.sql` and run it.

(Or run `supabase db push` if you've wired up CLI migrations — the project
currently applies them manually.)

Verify:

```sql
select count(*) from device_tokens;  -- 0 rows, no errors
```

## 2. Redeploy the Edge Function

The function now also reads from `device_tokens` and POSTs to Expo's push
service. No new secrets needed — Expo's `/push/send` endpoint is auth-free
for unauthenticated tokens (the `ExponentPushToken[...]` itself is the auth).

```powershell
cd <repo-root>
supabase functions deploy notify-watchlist-matches --no-verify-jwt
```

Smoke-test from the mobile Profile screen → tap **Preview** — the response
should now include `pushes 0` in the last-run summary (zero because no
device tokens exist yet).

## 3. Build a custom dev client (Expo Go can't do push)

**Push notifications do not work in Expo Go on SDK 53+.** You need a custom
dev client built via EAS.

Prereqs (one-time):

```powershell
npm i -g eas-cli
cd <repo-root>\mobile
eas login          # opens browser
eas init           # links the project — creates app.json extra.eas.projectId
```

**Credentials:**

- iOS push needs an Apple Developer account ($99/yr). When you run
  `eas build` it'll prompt for Apple ID + 2FA the first time and auto-
  generate the APNs key for you.
- Android push: EAS auto-generates FCM credentials.

**Build the dev client:**

```powershell
eas build --profile development --platform ios
```

If you don't have an `eas.json` yet, run `eas build:configure` first to
scaffold the development / preview / production profiles.

## 4. Install the dev client on your phone

When the build finishes EAS gives you a URL or QR code. Install it like any
other app, then open it. You'll be prompted "Allow notifications?" — tap
**Allow**. The `registerPushToken` call in `lib/auth-context.tsx` will then
upsert your token into `device_tokens`.

Verify in Supabase Studio:

```sql
select user_id, platform, last_seen_at from device_tokens;
```

You should see one row per device per user.

## 5. Trigger a push end-to-end

In the dev client:

1. **Watch tab** → delete the catch-all "All matches (test)" watchlist (so
   matches go back to unsent).
2. **Watch tab → + New** → create a fresh "All matches v2" with everything
   set to **Any** and email alerts **On**.
3. **Profile tab → Send Test Alert.** You should see the success Alert
   showing `emails 1 · pushes 1 · recorded N`. Within a few seconds your
   phone gets a push: **"N new matches — All matches v2 · tap to review"**.

If push count is 0 but emails worked:

- Check `select * from device_tokens` — is your token there?
- Check `Notifications.getPermissionsAsync()` — did you tap Allow?
- Check the function logs for an `expo push 400 …` error.

## 6. Token rotation / cleanup

Expo push tokens can rotate (OS reinstall, restore). The current upsert
keeps `last_seen_at` fresh on every app launch. Stale tokens that haven't
been seen in 30+ days are safe to garbage-collect:

```sql
delete from device_tokens
 where last_seen_at < now() - interval '30 days';
```

Not scheduled — run manually or wire into a future cron if device counts
grow.

## Rollback

Re-deploy after reverting code:

```powershell
supabase functions deploy notify-watchlist-matches --no-verify-jwt
```

To disable push without removing the code, drop the table:

```sql
drop table device_tokens cascade;
```

The function gracefully handles zero tokens (`pushes_sent` just stays 0).
