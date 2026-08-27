-- 017: reconcile prod subscriptions with the documented schema (billing_cycle, created_at)
-- ==========================================================================================
-- Incident (2026-07-06): execution/invite_user.py — the sanctioned "grant access
-- without Stripe" tool — POSTs a subscriptions row that includes `billing_cycle`.
-- Prod rejected it with 42703 (column does not exist), so the script created the
-- auth user + user_profiles row but NEVER wrote the subscription row. The first
-- real non-admin invitee then bounced off the /dashboard paywall to /pricing,
-- because the middleware found no active subscription. Admins never hit this
-- (ADMIN_EMAILS short-circuits before the subscription query).
--
-- Root cause: same provisioning drift as migration 010 — prod's subscriptions
-- table predates the documented schema in 001_initial_schema.sql, which declares
-- BOTH `billing_cycle` and `created_at`. Prod (verified via information_schema
-- 2026-07-06) had: user_id, stripe_subscription_id, stripe_customer_id, plan,
-- status, trial_end, current_period_end, updated_at, id — no billing_cycle, no
-- created_at (created_at is also used by invite_user.py's latest-row lookup).
--
-- Idempotent. Forward-only. Additive (nullable / defaulted) — safe on live data.
-- Applied to prod 2026-07-07 via the Management API; committed here for the record.
-- NOTE: existing rows get created_at = migration time (best available proxy),
-- exactly as 010 accepted for backfilled ids.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT
    CHECK (billing_cycle IN ('monthly', 'annual'));

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN public.subscriptions.billing_cycle IS
  'monthly | annual. Nullable: rows written before 017 (Stripe webhook rows) may not carry it.';
