-- 019_deal_outcomes_and_views.sql
--
-- Launch-test instrumentation, part 2 of 2 (spec: vault
-- business/bidwise-launch-test-runbook-2026-06-29.md §2b–d). Adds:
--   1. deal_outcomes     — user-reported / admin-recorded auction outcomes.
--                          "I got a deal from a BidWise list" is the #1
--                          retention signal and currently has nowhere to live.
--   2. v_user_activation — signup → first meaningful product action funnel
--                          (first unlock from 012's content_unlocks, first AI
--                          brief from 015's ai_usage_events, trial start from
--                          012's user_trials). Activated = first unlock within
--                          7 days of signup.
--   3. v_cohort_retention — monthly signup cohorts × subscription survival at
--                          30/60/90 days, with churn timing taken from 018's
--                          subscription_status_history.
--
-- Forward-only, idempotent, additive. Safe to re-run.
-- NOTE: numbering finalized 2026-07-17; see 023/024 for the renumbered tax-sale files.
--
-- Depends on: 001 (subscriptions), 009 (is_admin), 012 (content_unlocks,
-- user_trials), 015 (ai_usage_events), 018 (subscription_status_history).

-- ── 0. Schema-drift guard: subscriptions.created_at ─────────────────────────
-- Migration 001 declares subscriptions.created_at, but prod was provisioned
-- from a drifted schema (010 documents the same drift for the `id` column:
-- prod's actual columns lacked it). v_cohort_retention groups cohorts by
-- s.created_at, so reconcile it the same way 010 reconciled `id`. For any
-- pre-existing drifted rows the backfilled value is the migration-apply time —
-- acceptable: the launch test measures cohorts from subscriber #1 forward.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 1. deal_outcomes ─────────────────────────────────────────────────────────
-- One row per reported auction outcome. content_type/content_id mirror
-- content_unlocks (012) so an outcome can be joined back to the unlocked deal;
-- county is denormalized for the per-county launch verdict without a join
-- through properties.
CREATE TABLE IF NOT EXISTS public.deal_outcomes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content_type    TEXT        NOT NULL DEFAULT 'auction_property'
                                CHECK (content_type IN ('auction_property','off_market_lead')),
  content_id      TEXT,       -- properties.id / off_market_leads.id as text (as in content_unlocks)
  county          TEXT,
  outcome         TEXT        NOT NULL
                                CHECK (outcome IN ('bid_placed','won','closed','passed')),
  purchase_amount NUMERIC,    -- what they paid at auction (if won/closed)
  est_profit      NUMERIC,    -- self-reported estimated profit
  note            TEXT,
  reported_by     TEXT        NOT NULL DEFAULT 'user'
                                CHECK (reported_by IN ('user','admin')),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when the auction outcome happened
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()   -- when the row was recorded
);

CREATE INDEX IF NOT EXISTS deal_outcomes_user_idx
  ON public.deal_outcomes (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS deal_outcomes_county_idx
  ON public.deal_outcomes (county, outcome);

-- RLS: users report and see their OWN outcomes (self-report is the product
-- surface); admins have full access to record outcomes on a user's behalf and
-- to read everything. No user UPDATE/DELETE — outcomes are append-only from
-- the client's perspective; corrections go through an admin. The WITH CHECK
-- pins reported_by='user' so a client cannot masquerade as an admin record.
ALTER TABLE public.deal_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own deal outcomes" ON public.deal_outcomes;
CREATE POLICY "Users see own deal outcomes" ON public.deal_outcomes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users report own deal outcomes" ON public.deal_outcomes;
CREATE POLICY "Users report own deal outcomes" ON public.deal_outcomes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND reported_by = 'user');

DROP POLICY IF EXISTS "Admins manage deal outcomes" ON public.deal_outcomes;
CREATE POLICY "Admins manage deal outcomes" ON public.deal_outcomes
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.deal_outcomes IS
  'User-reported or admin-recorded auction outcomes ("got a deal from a '
  'BidWise list") — the #1 retention signal of the 90-day launch test.';

-- ── 2. v_user_activation ─────────────────────────────────────────────────────
-- Signup → first-value funnel, one row per auth user: when they signed up,
-- whether/when a trial started (012), when they first unlocked a deal (012 —
-- THE activation signal), when they first generated an AI brief (015), and
-- whether the first unlock landed within 7 days of signup ("activated_7d").
--
-- SECURITY: both views read auth.users and cross-user rows, so they are
-- deliberately NOT security_invoker (an invoker view over auth.users is
-- unreadable by `authenticated` anyway, and invoker semantics would leak
-- nothing but errors). Instead they run with definer (owner) rights and access
-- is gated by GRANTs: service_role only — these are operator/admin-dashboard
-- reads via the service-role client, never client-side queries. anon/
-- authenticated get REVOKEd explicitly.
CREATE OR REPLACE VIEW public.v_user_activation AS
SELECT
  u.id                                                       AS user_id,
  u.created_at                                               AS signed_up_at,
  t.started_at                                               AS trial_started_at,
  cu.first_unlock_at,
  ai.first_ai_brief_at,
  (cu.first_unlock_at IS NOT NULL
    AND cu.first_unlock_at <= u.created_at + INTERVAL '7 days') AS activated_7d
FROM auth.users u
LEFT JOIN LATERAL (
  SELECT MIN(c.unlocked_at) AS first_unlock_at
  FROM public.content_unlocks c
  WHERE c.user_id = u.id AND c.refunded_at IS NULL
) cu ON TRUE
LEFT JOIN LATERAL (
  SELECT MIN(a.created_at) AS first_ai_brief_at
  FROM public.ai_usage_events a
  WHERE a.user_id = u.id
) ai ON TRUE
LEFT JOIN LATERAL (
  SELECT MIN(tr.started_at) AS started_at
  FROM public.user_trials tr
  WHERE tr.user_id = u.id
) t ON TRUE;

REVOKE ALL ON public.v_user_activation FROM PUBLIC;
REVOKE ALL ON public.v_user_activation FROM anon;
REVOKE ALL ON public.v_user_activation FROM authenticated;
GRANT SELECT ON public.v_user_activation TO service_role;

COMMENT ON VIEW public.v_user_activation IS
  'Launch-test activation funnel: signup -> trial -> first unlock -> first AI '
  'brief, with activated_7d = first unlock within 7 days of signup. '
  'Service-role (operator dashboard) read only.';

-- ── 3. v_cohort_retention ────────────────────────────────────────────────────
-- Monthly signup cohorts of paying/trialing subscribers × survival at 30/60/90
-- days. A user's cohort month is the month their FIRST non-incomplete
-- subscription was created; their churn moment is the FIRST 'canceled'
-- transition in subscription_status_history at/after that start. Users with no
-- canceled transition count as surviving every threshold so far — read the
-- d30/d60/d90 columns only for cohorts old enough to have crossed them.
CREATE OR REPLACE VIEW public.v_cohort_retention AS
WITH first_sub AS (
  SELECT s.user_id, MIN(s.created_at) AS started_at
  FROM public.subscriptions s
  WHERE s.status <> 'incomplete'
  GROUP BY s.user_id
),
churn AS (
  SELECT f.user_id, f.started_at,
         (SELECT MIN(h.occurred_at)
            FROM public.subscription_status_history h
           WHERE h.user_id = f.user_id
             AND h.new_status = 'canceled'
             AND h.occurred_at >= f.started_at) AS canceled_at
  FROM first_sub f
)
SELECT
  date_trunc('month', started_at)::date AS cohort_month,
  COUNT(*)                              AS cohort_size,
  COUNT(*) FILTER (WHERE canceled_at IS NULL
                      OR canceled_at > started_at + INTERVAL '30 days') AS active_d30,
  COUNT(*) FILTER (WHERE canceled_at IS NULL
                      OR canceled_at > started_at + INTERVAL '60 days') AS active_d60,
  COUNT(*) FILTER (WHERE canceled_at IS NULL
                      OR canceled_at > started_at + INTERVAL '90 days') AS active_d90,
  COUNT(*) FILTER (WHERE canceled_at IS NULL)                           AS still_active
FROM churn
GROUP BY 1
ORDER BY 1;

REVOKE ALL ON public.v_cohort_retention FROM PUBLIC;
REVOKE ALL ON public.v_cohort_retention FROM anon;
REVOKE ALL ON public.v_cohort_retention FROM authenticated;
GRANT SELECT ON public.v_cohort_retention TO service_role;

COMMENT ON VIEW public.v_cohort_retention IS
  'Monthly signup cohorts x subscription survival at 30/60/90 days; churn '
  'timing from subscription_status_history (018). The 90-day launch verdict '
  'reads this, not the headline subscriber count. Service-role read only.';
