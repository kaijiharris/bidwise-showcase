-- 018_subscription_status_history.sql
--
-- Launch-test instrumentation, part 1 of 2 (spec: vault
-- business/bidwise-launch-test-runbook-2026-06-29.md §2a). The 90-day launch
-- test's verdict hinges on cohort renewal, and `subscriptions` only holds the
-- CURRENT status — status changes are not historized, so precise churn timing
-- is unrecoverable after the fact. This table is the append-only ledger of
-- every subscription state transition, written by the Stripe webhook
-- (web/app/api/stripe/webhook/route.ts) on
-- customer.subscription.created/updated/deleted.
--
-- Forward-only, idempotent, additive. Safe to re-run.
-- NOTE: numbering finalized 2026-07-17; see 023/024 for the renumbered tax-sale files.
--
-- Depends on: 001 (subscriptions), 009 (is_admin).

-- ── 1. Append-only status-transition ledger ─────────────────────────────────
-- One row per subscription lifecycle event. `old_status` is the status of the
-- local subscriptions row at the moment the webhook processed the event (NULL
-- for the first event of a subscription); `new_status` is the status Stripe
-- delivered. `stripe_event_id` is UNIQUE so a Stripe retry that re-runs the
-- handler after a partial failure (history written, processed_stripe_events
-- not yet marked) cannot double-record the transition — the webhook treats the
-- 23505 collision as the dedup working, same as processed_stripe_events.
CREATE TABLE IF NOT EXISTS public.subscription_status_history (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: a subscription created without metadata.user_id still gets its
  -- transition recorded (keyed by stripe_subscription_id) instead of vanishing.
  user_id                UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT        NOT NULL,
  plan                   TEXT,       -- canonical plan derived from the price id (NULL if unrecognized)
  stripe_price_id        TEXT,       -- raw price the customer is on, for audit
  old_status             TEXT,
  new_status             TEXT        NOT NULL,
  stripe_event_id        TEXT        UNIQUE,
  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_status_history_user_idx
  ON public.subscription_status_history (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS subscription_status_history_sub_idx
  ON public.subscription_status_history (stripe_subscription_id, occurred_at);
-- The cohort/kill-signal queries scan for cancellations by time.
CREATE INDEX IF NOT EXISTS subscription_status_history_status_idx
  ON public.subscription_status_history (new_status, occurred_at);

-- ── 2. RLS — no public access; service-role writes only ─────────────────────
-- Same posture as ai_usage_events (015) tightened to read-only: the ONLY
-- writer is the webhook's service-role client (RLS-bypassing). There is
-- deliberately NO INSERT/UPDATE/DELETE policy for any client role, so the
-- ledger is append-only from the application's perspective and a client can
-- never forge or rewrite churn history. Admins may read for the launch
-- dashboard; regular users have no access at all (churn history is
-- operator-facing analytics, not a user surface).
ALTER TABLE public.subscription_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read status history" ON public.subscription_status_history;
CREATE POLICY "Admins read status history" ON public.subscription_status_history
  FOR SELECT TO authenticated USING (public.is_admin());

COMMENT ON TABLE public.subscription_status_history IS
  'Append-only ledger of subscription state transitions, one row per Stripe '
  'customer.subscription.created/updated/deleted event. Written only by the '
  'service-role webhook client; admin-read for launch-test cohort analytics '
  '(v_cohort_retention in 019). UNIQUE(stripe_event_id) dedupes Stripe retries.';
