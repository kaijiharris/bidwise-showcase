# Deploying `notify-tax-sale`

A daily serverless watchdog over county tax-sale listing pages. It fetches each
configured county's official listing, diffs it against the last observed state
in `tax_sale_snapshots`, and on any change emails the operator via Resend,
fires an Expo push, **and** (optionally, if Twilio secrets are set) sends an
SMS — so a new auction date or listing never gets discovered by luck again.

On subscriber-grade events (NEW_LIST / DATE_CHANGED / CANCELLED) it also fans
out an email to every active/trialing subscriber — **hard-gated behind
`TAX_SALE_SUBSCRIBER_DRY_RUN` (default: dry-run, nothing sent)** — and records
EVERY run (including no-change days) in `tax_sale_monitor_runs`, so "did it
run today" and "who would have been emailed" are always answerable in SQL.

Currently watches (see `sources.ts` for the per-county observers):

| County | Source | Diff signal |
|--------|--------|-------------|
| **DeKalb** | HTML table on `publicaccess.dekalbtax.org` | parcel set per auction date |
| **Gwinnett** | Listing PDF linked from `gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales` | parsed PIN set + PDF fingerprint |
| **Cobb** | PDF on `cobbtax.gov/property/tax_sale/index.php` — a placeholder named "There are no Tax Sale parcels at this time.pdf" between sales | placeholder → real filename + PDF fingerprint |
| **Clayton** | Month-named PDFs under `publicaccess.claytoncountyga.gov/content/PDF/` (e.g. `july_2026_tax_sale.pdf`), probed 6 months ahead | new month PDF + parcel set + fingerprint |

Add more counties by appending to `SOURCES` and writing an observer in
`sources.ts`.

> Reuses the same Resend account and `device_tokens` push pipeline as
> `notify-watchlist-matches`. If that function is already deployed, the only new
> infrastructure here is one table (migration 008), one function, and one cron job.

Project ref: `SUPABASE-PROJECT-REF` (from `https://SUPABASE-PROJECT-REF.supabase.co`).

---

## 1. Apply the schema changes

In Supabase Studio → SQL Editor, run (all are idempotent):

1. `supabase/migrations/008_tax_sale_monitor.sql` — the snapshots table
   (skip if already applied).
2. `supabase/migrations/023_tax_sale_snapshot_source_ref.sql` — adds the
   `source_ref` fingerprint column the PDF sources **require**. Deploying the
   multi-county function without 023 breaks every run (`column source_ref
   does not exist`).
3. `supabase/migrations/024_tax_sale_monitor_runs.sql` — the run log
   (`tax_sale_monitor_runs`) **and** the `delisted_at` column that
   cancelled-date detection requires. Without 024 the snapshot select fails
   (`column delisted_at does not exist`) — the function needs it.

Verify:

```sql
select count(*) from tax_sale_snapshots;               -- no errors
select source_ref, delisted_at from tax_sale_snapshots limit 1;  -- columns exist
select count(*) from tax_sale_monitor_runs;            -- run log exists
```

## 2. Confirm secrets (mostly already set)

These were set when `notify-watchlist-matches` was deployed and are reused:

- `RESEND_API_KEY` — required.
- `WATCHLIST_FROM_EMAIL` — used as the default sender if you don't set a
  tax-sale-specific one.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase.

Optional overrides for this function:

```powershell
# Who receives the alert (defaults to alerts@bidwiseinvest.com in code)
supabase secrets set TAX_SALE_ALERT_EMAIL=alerts@bidwiseinvest.com

# Optional: pin the push recipient by user id. If unset, the function resolves
# the operator's user_id by matching TAX_SALE_ALERT_EMAIL via the auth admin API.
supabase secrets set TAX_SALE_ALERT_USER_ID=<your-auth-user-uuid>

# Optional: custom sender (must be a Resend-verified domain)
supabase secrets set TAX_SALE_FROM_EMAIL=alerts@yourdomain.com

# Optional: allow a non-service-role caller (e.g. an admin card) to invoke the
# function. pg_cron uses the service-role key; nothing else is accepted.
supabase secrets set NOTIFY_TAX_SALE_SECRET=<long-random-string>
```

### Subscriber fan-out — HARD GATE (ships dark)

On NEW_LIST / DATE_CHANGED / CANCELLED events the function computes the full
subscriber audience (subscriptions with status `active` or `trialing`, emails
from `user_profiles` with an auth-admin fallback) **but sends nothing** until
you explicitly flip the gate:

```powershell
# Default is dry-run. Every run logs the exact would-have-sent list to
# tax_sale_monitor_runs.subscriber_preview — review a few days of previews
# first, then go live with:
supabase secrets set TAX_SALE_SUBSCRIBER_DRY_RUN=false

# Optional knobs:
supabase secrets set TAX_SALE_DASHBOARD_URL=https://bidwiseinvest.com/dashboard
supabase secrets set TAX_SALE_MAX_SUBSCRIBER_EMAILS=500   # sanity cap; larger audiences force dry-run
```

To pause subscriber sends at any time: `supabase secrets set
TAX_SALE_SUBSCRIBER_DRY_RUN=true` (any value other than `false` = dry-run).
LIST_CHANGED noise (parcel churn, PDF re-uploads) never reaches subscribers
regardless of the gate — operator only.

### Optional SMS channel (Twilio)

The SMS fan-out is **skipped silently** unless ALL of these are set — there is
nothing to disable if you don't want SMS:

```powershell
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_AUTH_TOKEN=<auth-token>
# Recipient(s), E.164, comma-separated for more than one:
supabase secrets set TAX_SALE_SMS_TO=+14045551234
# Sender: an SMS-capable Twilio number you own (E.164) …
supabase secrets set TAX_SALE_SMS_FROM=+16785550000
# … OR a Messaging Service (takes precedence over TAX_SALE_SMS_FROM):
supabase secrets set TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Notes:
- SMS is best-effort like push: a Twilio failure is logged in the run's
  `errors` but never blocks the email or the snapshot watermark.
- US A2P: an unregistered 10DLC number gets error 30034 — register the number
  or use a toll-free/Messaging Service. Trial accounts can only text verified
  numbers.
- Body is capped at 320 chars (≤ 2 segments) — headlines only, details in email.

## 3. Deploy

```powershell
cd <repo-root>
supabase functions deploy notify-tax-sale --no-verify-jwt
```

`--no-verify-jwt` is required because pg_cron invokes with a Bearer service-role
key in the header, not a Supabase-signed JWT.

> CLI auth note (see memory `supabase-edge-cron-pattern`): `supabase login`
> needs a TTY. Either run it yourself in PowerShell, or set a Personal Access
> Token as a **User**-scope env var: `SUPABASE_ACCESS_TOKEN` (the repo `.env`
> holds one as `SUPABASE_PAT`). Process-scope vars don't reach subprocesses.

## 4. Smoke test — preview without sending

Dry run computes events but sends nothing and writes no snapshot state (the
check itself is still recorded in `tax_sale_monitor_runs`, flagged
`dry_run = true`, including the subscriber would-send preview):

```powershell
$ref = "SUPABASE-PROJECT-REF"
$key = "<YOUR_SERVICE_ROLE_KEY>"
Invoke-RestMethod -Method POST `
  -Uri "https://$ref.supabase.co/functions/v1/notify-tax-sale" `
  -Headers @{ Authorization = "Bearer $key"; "Content-Type" = "application/json" } `
  -Body '{"dryRun": true}'
```

On a fresh (empty) table every live listing surfaces as a `new_date` event —
as of 2026-07-02 that means DeKalb's July sale, Gwinnett's August PDF, and
Clayton's July PDF (Cobb shows its "no parcels" placeholder, which is a
legitimate empty state, not an event):

```json
{
  "sources_checked": 4,
  "events": [
    { "county": "DeKalb",   "auction_date": "2026-07-07", "type": "new_date", "severity": "NEW_LIST", "count": 64, "added": 64, "removed": 0, "note": null },
    { "county": "Gwinnett", "auction_date": "2026-08-04", "type": "new_date", "severity": "NEW_LIST", "count": 63, "added": 63, "removed": 0, "note": null },
    { "county": "Clayton",  "auction_date": "2026-07-07", "type": "new_date", "severity": "NEW_LIST", "count": 26, "added": 26, "removed": 0, "note": null }
  ],
  "severities": ["NEW_LIST"],
  "emails_sent": 0,
  "pushes_sent": 0,
  "sms_sent": 0,
  "subscriber_audience": 2,
  "subscriber_emails_sent": 0,
  "subscriber_dry_run": true,
  "subscriber_preview": [
    { "email": "subscriber@example.com", "subject": "3 Georgia tax-sale updates — DeKalb, Gwinnett, Clayton" }
  ],
  "snapshots_upserted": 0,
  "errors": [],
  "dry_run": true,
  "run_logged": true
}
```

`subscriber_audience` / `subscriber_preview` reflect the real current
subscriber list (read-only) — this is the audit trail for the hard gate.

Counts drift as counties add/pull parcels — the shape is what matters. An
entry in `errors` naming one county skips only that county; the others still
process.

## 5. First real run — doubles as confirmation

Run once for real (drop the body or send `{"dryRun": false}`):

```powershell
Invoke-RestMethod -Method POST `
  -Uri "https://$ref.supabase.co/functions/v1/notify-tax-sale" `
  -Headers @{ Authorization = "Bearer $key" }
```

Because the table starts empty, this **first** real run treats every live
listing (DeKalb, Gwinnett, Clayton) as a `new_date` event and emails/pushes
them in one digest — a deliberate end-to-end confirmation that the wiring
works. After it records the snapshots, the watchdog goes quiet until something
actually changes (a new date drops, a listing populates, parcels are
added/removed, or a listing PDF is replaced).

Expected response: `"emails_sent": 1`, `"snapshots_upserted": 3` (one row per
live auction date), `"pushes_sent"` = your registered device count (0 if no
`device_tokens` yet — see `PUSH_SETUP.md` for the watchlist function),
`"sms_sent"` = your `TAX_SALE_SMS_TO` recipient count (0 when Twilio secrets
are unset), `"subscriber_emails_sent": 0` with `"subscriber_dry_run": true`
(the gate ships closed — the would-send list is in `subscriber_preview`), and
`"run_logged": true`.

Verify state was recorded:

```sql
select county, auction_date, property_count, last_changed_at
from tax_sale_snapshots order by auction_date;
```

## 6. Schedule (daily) via Vault + pg_cron

> Use the **Vault** pattern, not `ALTER DATABASE ... SET` — the latter is denied
> on Supabase hosted (`permission denied to set parameter`, 42501). See memory
> `supabase-edge-cron-pattern`.

In Supabase Studio → SQL Editor, run **once**:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the service-role key encrypted (skip if already created for the
-- watchlist function — the secret name is shared).
select vault.create_secret(
  '<YOUR_SERVICE_ROLE_KEY>',
  'service_role_key',
  'Service-role key used by pg_cron to invoke edge functions'
);

-- Daily at 13:00 UTC (~8–9am ET). Listings update infrequently; daily is plenty.
select cron.schedule(
  'notify-tax-sale-daily',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := 'https://SUPABASE-PROJECT-REF.supabase.co/functions/v1/notify-tax-sale',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    )
  ) as request_id;
  $$
);
```

Verify:

```sql
select jobid, schedule, jobname, active from cron.job where jobname = 'notify-tax-sale-daily';
select * from cron.job_run_details order by start_time desc limit 5;
```

## 6b. OPTIONAL — switch the schedule to hourly

> **Prepared, not applied.** Run this only when you decide daily isn't tight
> enough (e.g. auction week, or racing other investors to a fresh listing).
> Cost stays negligible (see Cost notes), but alerts arrive within the hour
> instead of within the day.

Two equivalent ways — pick ONE:

**Option A — alter the existing job in place** (keeps the job name
`notify-tax-sale-daily`, which then no longer matches its cadence — fine if
you don't care about the label):

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'notify-tax-sale-daily'),
  schedule => '0 * * * *'   -- top of every hour
);
```

**Option B — unschedule + reschedule under an accurate name**
(`cron.alter_job` cannot rename a job, so a clean rename is drop + recreate
with the same command body):

```sql
select cron.unschedule('notify-tax-sale-daily');

select cron.schedule(
  'notify-tax-sale-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://SUPABASE-PROJECT-REF.supabase.co/functions/v1/notify-tax-sale',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    )
  ) as request_id;
  $$
);
```

Verify either way:

```sql
select jobid, schedule, jobname, active from cron.job
where jobname in ('notify-tax-sale-daily', 'notify-tax-sale-hourly');
```

To revert to daily: Option A with `schedule => '0 13 * * *'`, or Option B in
reverse (unschedule the hourly name, re-run the §6 daily snippet). Remember to
update the Rollback section's job name if you renamed.

## 7. Monitor

```powershell
supabase functions logs notify-tax-sale --tail
```

"Did it run today?" — every check (real, dry, or no-change) is one row:

```sql
select ran_at, dry_run, no_change, event_count, events->0->>'severity' as top_severity,
       emails_sent, subscriber_dry_run, subscriber_audience, subscriber_emails_sent,
       errors, duration_ms, ok
from tax_sale_monitor_runs
order by ran_at desc
limit 7;
```

Who would have been / was emailed on the last eventful run:

```sql
select ran_at, subscriber_dry_run, subscriber_preview
from tax_sale_monitor_runs
where event_count > 0
order by ran_at desc
limit 3;
```

## Rollback

```powershell
supabase functions delete notify-tax-sale
```

```sql
select cron.unschedule('notify-tax-sale-daily');  -- or 'notify-tax-sale-hourly' if renamed (§6b)
-- Optional: drop table tax_sale_snapshots;
-- Optional: drop table tax_sale_monitor_runs;
```

## Behavior reference

- **Event types**
  - `new_date` — an auction date appears that's not in `tax_sale_snapshots`
    (also fired when a previously-delisted date re-appears — "relisted").
  - `populated` — a known date's listing went from `property_count = 0` to > 0.
  - `changed` — parcels added to / removed from a known date, **or** (for PDF
    sources) the listing file was replaced (`source_ref` fingerprint changed)
    with no parcel-level delta.
  - `date_removed` — a FUTURE auction date vanished from a cleanly-read
    source. Past dates expire silently (counties pull listings after the
    sale); degraded reads (probe errors, parse-fallback notes) never infer a
    cancellation.
- **Severity / notification matrix**

  | Severity | Fired by | Operator | Subscribers |
  |----------|----------|----------|-------------|
  | `NEW_LIST` | `new_date`, `populated` | email + push + SMS | ✅ (gated) |
  | `LIST_CHANGED` | `changed` (parcel churn / file replaced) | email + push + SMS | ❌ never |
  | `DATE_CHANGED` | `date_removed` + `new_date` for the same county in one run (reschedule) | email + push + SMS | ✅ (gated; subscribers get only the new-date side) |
  | `CANCELLED` | `date_removed` alone | email + push + SMS | ✅ (gated) |
  | `NO_CHANGE` | nothing fired | — (run-logged only) | — |

  "Gated" = only when `TAX_SALE_SUBSCRIBER_DRY_RUN=false`; otherwise the
  would-send list is logged to `tax_sale_monitor_runs.subscriber_preview`.
- **Run log** — every invocation inserts one `tax_sale_monitor_runs` row
  (dry runs included). `ok = false` means at least one error was recorded.
- **Auth** — requests must carry `Authorization: Bearer <service-role-key>`
  (what pg_cron sends) or `Bearer <NOTIFY_TAX_SALE_SECRET>`; anything else
  gets 401 before any fetch/send/write.
- **Per-source diff signals**
  - DeKalb: parcel set parsed from the HTML table. The page contains the
    literal string "currently unavailable" even when data is present, so
    maintenance is judged by row count, never that string.
  - Gwinnett: PIN set parsed from the listing PDF (CID/ToUnicode text
    extraction — see `pdf.ts`). Under 3 PINs = extraction failure → falls back
    to the URL+sha256 fingerprint so a changed PDF still alerts.
  - Cobb: between sales the county serves a placeholder PDF ("There are no Tax
    Sale parcels at this time.pdf") — that is a legitimate empty state, not an
    error. A real filename replacing it fires `new_date` (sale date parsed
    from the link text, e.g. "November 3rd, 2026 Tax Sale List"). The `?t=`
    cache-buster on the URL is ignored; the content hash is not.
  - Clayton: month-named PDFs are probed 6 months ahead (GA sales are first
    Tuesday of the month, so `july_2026` ⇒ 2026-07-07 even before the PDF's
    own date is parsed). No PDF up = legitimate lull.
- **Transient-failure guard** — a source that should always have a listing
  (DeKalb, Gwinnett) yielding zero observations is a fetch/maintenance blip:
  skipped, no diff, no overwrite, no false "everything was pulled" alert.
- **Send-then-record** — snapshots for changed dates advance only after Resend
  returns 2xx. A failed email re-triggers the same alert on the next run
  (at-least-once). Push and SMS are best-effort and never block recording.
- **Idempotency** — the `(county, auction_date)` row IS the watermark; once
  advanced to the observed state, the same change won't re-alert.

## Cost notes

- Resend free tier: 3,000 emails/mo. This sends only on change (≈ a few/mo).
- Edge Function: 1 invocation/day (24/day if switched hourly) across 4 sources
  ≈ 4–10 outbound fetches per run — negligible against the 500K/mo free tier.
- pg_cron + pg_net: no additional cost.
- Twilio (only if configured): ~$0.008–0.01 per US SMS segment, sent only on
  change — cents per month.
