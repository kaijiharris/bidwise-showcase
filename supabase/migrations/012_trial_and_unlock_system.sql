-- 012_trial_and_unlock_system.sql
--
-- The "trial system" tables that migration 007 and the production web app both
-- reference, but which were never committed (they lived only in an uncommitted
-- local migration). This makes them part of the canonical schema:
--
--   * plan_entitlements   — per-plan feature flags + monthly caps (CSV export,
--                           auction-unlock allowance). Read by /api/export and
--                           the current_plan_usage view.
--   * content_unlocks     — a user's monthly auction-property unlocks. Read by
--                           web data-access; refund columns added by 007.
--   * plan_usage_events   — append-only usage ledger backing the monthly quota
--                           (one row per consumed unlock). Refund column from 007.
--   * user_trials         — cardless web trial window. Read by web middleware
--                           (select id where trial_ends_at > now()).
--   * current_plan_usage  — per-user VIEW the dashboard reads for the unlock
--                           meter (used / per_month / remaining).
--
-- Depends on: 001 (subscriptions, user_profiles), 009 (is_admin()).
-- Idempotent / additive. Safe to re-run. Columns that 007 may already have
-- added are re-added with IF NOT EXISTS.

-- ── 1. plan_entitlements ─────────────────────────────────────────────────────
-- One row per plan name. Seeded with the tiers used elsewhere (starter/pro/
-- expert) plus a 'none' row for users with no active plan.
CREATE TABLE IF NOT EXISTS public.plan_entitlements (
  plan                       TEXT PRIMARY KEY
                               CHECK (plan IN ('none','starter','pro','expert')),
  csv_export                 BOOLEAN NOT NULL DEFAULT FALSE,
  auction_unlocks_per_month  INTEGER NOT NULL DEFAULT 0,  -- NULL would mean unlimited; we use a sentinel below
  offmarket_unlocks_per_month INTEGER NOT NULL DEFAULT 0,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed / upsert the canonical entitlements. -1 == unlimited (Expert).
INSERT INTO public.plan_entitlements
  (plan, csv_export, auction_unlocks_per_month, offmarket_unlocks_per_month)
VALUES
  ('none',     FALSE,  0,  0),
  ('starter',  FALSE, 10,  0),
  ('pro',      FALSE, 25,  5),
  ('expert',   TRUE,  -1, -1)
ON CONFLICT (plan) DO UPDATE SET
  csv_export                  = EXCLUDED.csv_export,
  auction_unlocks_per_month   = EXCLUDED.auction_unlocks_per_month,
  offmarket_unlocks_per_month = EXCLUDED.offmarket_unlocks_per_month,
  updated_at                  = now();

ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;
-- Entitlements are non-sensitive config; any authenticated user may read them.
DROP POLICY IF EXISTS "Anyone authenticated can read entitlements" ON public.plan_entitlements;
CREATE POLICY "Anyone authenticated can read entitlements" ON public.plan_entitlements
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins manage entitlements" ON public.plan_entitlements;
CREATE POLICY "Admins manage entitlements" ON public.plan_entitlements
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 2. content_unlocks ───────────────────────────────────────────────────────
-- A user's unlock of a specific piece of gated content (auction property or
-- off-market lead). Monthly quota is computed from these rows (per calendar
-- month, refunded ones excluded). 007 adds refunded_at / refund_reason.
CREATE TABLE IF NOT EXISTS public.content_unlocks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content_type  TEXT        NOT NULL
                              CHECK (content_type IN ('auction_property','off_market_lead')),
  content_id    TEXT        NOT NULL,           -- properties.id / off_market_leads.id as text
  source        TEXT        NOT NULL DEFAULT 'monthly_quota'
                              CHECK (source IN ('monthly_quota','one_time','admin_grant','tier_bonus')),
  unlocked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- refund tracking (also added by 007 if it runs first; harmless either way)
  refunded_at   TIMESTAMPTZ,
  refund_reason TEXT,
  UNIQUE (user_id, content_type, content_id)
);

ALTER TABLE public.content_unlocks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'monthly_quota';
ALTER TABLE public.content_unlocks ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE public.content_unlocks ADD COLUMN IF NOT EXISTS refund_reason TEXT;

CREATE INDEX IF NOT EXISTS content_unlocks_user_month_idx
  ON public.content_unlocks (user_id, content_type, unlocked_at);
CREATE INDEX IF NOT EXISTS content_unlocks_refunded_idx
  ON public.content_unlocks (refunded_at) WHERE refunded_at IS NOT NULL;

ALTER TABLE public.content_unlocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own content unlocks"   ON public.content_unlocks;
DROP POLICY IF EXISTS "Users insert own content unlocks" ON public.content_unlocks;
DROP POLICY IF EXISTS "Admins full access to content unlocks" ON public.content_unlocks;
CREATE POLICY "Users see own content unlocks" ON public.content_unlocks
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own content unlocks" ON public.content_unlocks
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins full access to content unlocks" ON public.content_unlocks
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 3. plan_usage_events ─────────────────────────────────────────────────────
-- Append-only ledger of quota-consuming events. current_plan_usage counts the
-- non-refunded 'unlock_consumed' rows in the current calendar month.
CREATE TABLE IF NOT EXISTS public.plan_usage_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event_type    TEXT        NOT NULL
                              CHECK (event_type IN ('unlock_consumed','offmarket_unlock_consumed')),
  content_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at   TIMESTAMPTZ            -- also added by 007
);

ALTER TABLE public.plan_usage_events ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS plan_usage_events_user_month_idx
  ON public.plan_usage_events (user_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS plan_usage_events_refunded_idx
  ON public.plan_usage_events (refunded_at) WHERE refunded_at IS NOT NULL;

ALTER TABLE public.plan_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own usage events" ON public.plan_usage_events;
DROP POLICY IF EXISTS "Admins full access to usage events" ON public.plan_usage_events;
CREATE POLICY "Users see own usage events" ON public.plan_usage_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins full access to usage events" ON public.plan_usage_events
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 4. user_trials ───────────────────────────────────────────────────────────
-- Cardless trial window. Web middleware grants dashboard access while
-- trial_ends_at > now(). One active trial per user.
CREATE TABLE IF NOT EXISTS public.user_trials (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  trial_ends_at  TIMESTAMPTZ NOT NULL,
  plan           TEXT        NOT NULL DEFAULT 'pro'
                               CHECK (plan IN ('starter','pro','expert')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS user_trials_user_active_idx
  ON public.user_trials (user_id, trial_ends_at);

ALTER TABLE public.user_trials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own trial"  ON public.user_trials;
DROP POLICY IF EXISTS "Admins manage trials" ON public.user_trials;
CREATE POLICY "Users see own trial" ON public.user_trials
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins manage trials" ON public.user_trials
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Inserts/updates happen via the service role (trial-start API), which bypasses RLS.

-- ── 5. current_plan_usage VIEW ───────────────────────────────────────────────
-- Per-user auction-unlock meter for the dashboard. Resolves the caller's
-- effective plan (active/trialing subscription, else active trial, else 'none'),
-- looks up the monthly cap from plan_entitlements, counts non-refunded unlocks
-- consumed this calendar month, and exposes remaining. -1 cap == unlimited →
-- surfaced as a large remaining value the client treats as "unlimited".
CREATE OR REPLACE VIEW public.current_plan_usage
WITH (security_invoker = true) AS
WITH ctx AS (
  SELECT
    auth.uid() AS uid,
    COALESCE(
      (SELECT plan FROM public.subscriptions s
        WHERE s.user_id = auth.uid()
          AND s.status IN ('trialing','active')
        ORDER BY s.current_period_end DESC NULLS LAST
        LIMIT 1),
      (SELECT plan FROM public.user_trials t
        WHERE t.user_id = auth.uid()
          AND t.trial_ends_at > now()
        LIMIT 1),
      'none'
    ) AS plan
),
cap AS (
  SELECT ctx.uid, ctx.plan,
         COALESCE(pe.auction_unlocks_per_month, 0) AS per_month
  FROM ctx
  LEFT JOIN public.plan_entitlements pe ON pe.plan = ctx.plan
),
used AS (
  SELECT count(*)::int AS n
  FROM public.content_unlocks cu, ctx
  WHERE cu.user_id = ctx.uid
    AND cu.content_type = 'auction_property'
    AND cu.refunded_at IS NULL
    AND cu.unlocked_at >= date_trunc('month', now())
)
SELECT
  cap.uid                                   AS user_id,
  cap.plan                                  AS plan,
  used.n                                    AS auction_unlocks_used,
  cap.per_month                             AS auction_unlocks_per_month,
  CASE
    WHEN cap.per_month < 0 THEN 999999      -- unlimited sentinel
    ELSE GREATEST(cap.per_month - used.n, 0)
  END                                       AS auction_unlocks_remaining
FROM cap, used;

GRANT SELECT ON public.current_plan_usage TO authenticated;
