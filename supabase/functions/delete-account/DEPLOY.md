# Deploying `delete-account` and `generate-brief`

Two edge functions the mobile + web clients already call by name:

- **`delete-account`** — in-app account deletion (Apple 5.1.1(v) + GDPR/CCPA
  erasure). Verifies the caller's JWT, then uses the SERVICE ROLE key to delete
  the user's rows across all user-owned tables and `auth.admin.deleteUser`.
  Idempotent. Invoked via `supabase.functions.invoke('delete-account')`.
- **`generate-brief`** — real AI investment brief. Verifies the caller's JWT,
  reads the `ANTHROPIC_API_KEY` secret, calls the Anthropic Messages API, and
  returns `{ brief }`. Invoked via
  `supabase.functions.invoke('generate-brief', { body })`.

Project ref: `SUPABASE-PROJECT-REF` (from `https://SUPABASE-PROJECT-REF.supabase.co`).

---

## 1. Secrets

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
auto-injected into every edge function by Supabase — you do NOT set these.

You MUST set the Anthropic key for `generate-brief`:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   --project-ref SUPABASE-PROJECT-REF
# optional — defaults to claude-sonnet-4-6 (a bare alias; do NOT add a date suffix):
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-6 --project-ref SUPABASE-PROJECT-REF
```

`delete-account` needs no extra secrets.

## 2. Deploy

```bash
supabase functions deploy delete-account  --project-ref SUPABASE-PROJECT-REF
supabase functions deploy generate-brief  --project-ref SUPABASE-PROJECT-REF
```

Both verify the caller's JWT, so they can run with the default (JWT-required)
auth — do NOT pass `--no-verify-jwt`. The functions also re-verify the token
themselves via `auth.getUser()`, so they're safe either way.

> The Supabase CLI must be installed via Scoop, not npm (npm's postinstall is
> blocked in this environment), and `supabase login` needs a TTY. Run these from
> a real terminal, not from the agent.

## 3. Smoke test

```bash
# delete-account (use a THROWAWAY test user's access token — this is destructive)
curl -i -X POST \
  https://SUPABASE-PROJECT-REF.supabase.co/functions/v1/delete-account \
  -H "Authorization: Bearer <test-user-access-token>" \
  -H "apikey: <anon-key>"
# → 200 {"success":true,"user_id":"...","tables_deleted":[...]}
# Re-run with the same (now-deleted) user → still 200 (idempotent).

# generate-brief
curl -i -X POST \
  https://SUPABASE-PROJECT-REF.supabase.co/functions/v1/generate-brief \
  -H "Authorization: Bearer <any-valid-access-token>" \
  -H "apikey: <anon-key>" \
  -H "content-type: application/json" \
  -d '{"property":{"address":"123 Main St","arv":250000,"tax_due":4200,"rehab":35000,"roi_percent":42}}'
# → 200 {"brief":"..."}   (a real, data-grounded brief)
# Missing ANTHROPIC_API_KEY → 503 {"error":"ai_not_configured"}
```

## 4. Notes

- `delete-account` deletes from this table set (missing tables tolerated):
  auction_pipeline, lead_pipeline, watchlists, off_market_leads,
  saved_properties, property_unlocks, content_unlocks, plan_usage_events,
  user_trials, device_tokens, subscriptions, user_profiles — then
  `auth.admin.deleteUser`. FK `ON DELETE CASCADE` cleans up anything missed.
- Neither function hardcodes any secret. `ANTHROPIC_MODEL` defaults to the
  current Claude Sonnet alias; override the secret to change models.
