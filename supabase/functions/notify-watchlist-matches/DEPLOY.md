# Deploying `notify-watchlist-matches`

This Edge Function scans active watchlists every 15 minutes, finds newly-matching
off-market leads, and emails the owner via Resend. Steps below are the full
one-time setup.

---

## 1. Rotate the Resend key

The key pasted into chat earlier is considered exposed. Before doing anything
else:

1. Go to https://resend.com/api-keys
2. **Delete** the key starting `re_DhyVNP7d_…`
3. **Create new key**, name it `bidwise-prod`, scope: **Sending access**
4. Copy the new key — you'll paste it into `supabase secrets set` below, NOT
   into any file in this repo.

## 2. Install Supabase CLI

```powershell
# Windows (scoop)
scoop install supabase

# or via npm
npm i -g supabase
```

Verify:

```powershell
supabase --version
```

## 3. Link the project

From repo root:

```powershell
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
```

`<YOUR_PROJECT_REF>` is the slug from your Supabase URL: `https://<ref>.supabase.co`.

## 4. Set secrets

```powershell
supabase secrets set RESEND_API_KEY=re_<your_new_key>
supabase secrets set WATCHLIST_FROM_EMAIL=alerts@yourdomain.com
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase
```

**Important:** `WATCHLIST_FROM_EMAIL` must be a domain verified in Resend
(https://resend.com/domains). If you don't have one yet, use the Resend
sandbox sender `onboarding@resend.dev` for testing — but Resend will only
deliver to your own account email until you verify your domain.

## 5. Deploy

```powershell
supabase functions deploy notify-watchlist-matches --no-verify-jwt
```

`--no-verify-jwt` is required because pg_cron invokes it with the service-role
key in a header, not a JWT.

## 6. Smoke test

Manually invoke once to verify wiring before scheduling:

```powershell
$projectRef = "<YOUR_PROJECT_REF>"
$serviceKey = "<YOUR_SERVICE_ROLE_KEY>"
Invoke-RestMethod `
  -Method POST `
  -Uri "https://$projectRef.supabase.co/functions/v1/notify-watchlist-matches" `
  -Headers @{ Authorization = "Bearer $serviceKey" }
```

Expected JSON:

```json
{
  "watchlists_scanned": 1,
  "emails_sent": 1,
  "matches_recorded": 3,
  "errors": []
}
```

Check your inbox for the digest email. Check `watchlist_leads` in Supabase
Studio — the matched pairs should now have `notified = true`.

## 7. Schedule (every 15 min)

In Supabase Studio → SQL Editor, run **once**:

```sql
-- Enable extensions (idempotent)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the service-role key as a Postgres setting so cron can call the
-- function. Only the postgres role can read this.
alter database postgres set app.settings.service_role_key = '<YOUR_SERVICE_ROLE_KEY>';

-- Schedule
select cron.schedule(
  'notify-watchlist-matches-every-15m',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/notify-watchlist-matches',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    )
  ) as request_id;
  $$
);
```

Verify the schedule:

```sql
select jobid, schedule, jobname, active from cron.job;
```

## 8. Monitor

Tail logs:

```powershell
supabase functions logs notify-watchlist-matches --tail
```

Check cron history:

```sql
select * from cron.job_run_details order by start_time desc limit 10;
```

## Rollback

```powershell
supabase functions delete notify-watchlist-matches
```

```sql
select cron.unschedule('notify-watchlist-matches-every-15m');
```

## Cost notes

- Resend free tier: 3,000 emails/mo, 100/day. Pro at $20/mo unlocks 50K/mo.
- Supabase Edge Function: free tier 500K invocations/mo. At 4/hr = ~2,880/mo —
  well within free tier.
- pg_cron + pg_net: no additional cost.

## Behavior

- Function pulls all active alert-enabled watchlists, all off_market_leads,
  and the (watchlist_id, lead_id) pairs already marked `notified=TRUE`.
- For each watchlist, it filters leads through `leadMatchesWatchlist` (same
  logic as mobile/lib/leads-api.ts).
- New matches → one email per (user, watchlist), up to 20 properties per
  email (tunable via `WATCHLIST_MAX_MATCHES` env).
- After Resend confirms 2xx, the (watchlist_id, lead_id) pair is upserted
  into `watchlist_leads` with `notified=TRUE` so it's not re-sent.
- Per-watchlist errors are collected and returned in the response — one
  bad watchlist never blocks others.
