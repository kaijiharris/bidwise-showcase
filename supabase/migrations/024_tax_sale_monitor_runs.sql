-- ════════════════════════════════════════════════════════════════════════════
-- Migration 024: tax-sale monitor run log + snapshot delisting
-- Renumbered from 020 on 2026-07-17 (duplicate prefix from parallel merges).
-- Applied to prod under the old number; idempotent — re-apply is a no-op.
--
-- Two gaps in the daily watchdog (notify-tax-sale) that this closes:
--
-- 1. "Did it run today?" was unanswerable — the function only wrote state when
--    something changed. `tax_sale_monitor_runs` records EVERY invocation
--    (including dry runs and NO_CHANGE days) with its event list, severity
--    data, channel counts, the subscriber dry-run preview (exactly who would
--    have received what), errors, and duration.
--
-- 2. A future auction date disappearing from a county listing (cancellation /
--    reschedule) previously fired nothing and could never be marked handled.
--    `tax_sale_snapshots.delisted_at` records when the monitor observed a
--    date vanish; NULL = the date is live. A delisted date re-appearing fires
--    `new_date` again ("relisted") and the upsert clears the flag.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tax_sale_snapshots
  ADD COLUMN IF NOT EXISTS delisted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tax_sale_snapshots.delisted_at IS
  'Set when the monitor observed this future auction date disappear from the county listing (cancelled/rescheduled). NULL = live. Cleared automatically if the date re-appears.';

CREATE TABLE IF NOT EXISTS public.tax_sale_monitor_runs (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dry_run                 BOOLEAN     NOT NULL DEFAULT false,
  sources_checked         INTEGER     NOT NULL DEFAULT 0,
  event_count             INTEGER     NOT NULL DEFAULT 0,
  -- true = the run completed and found nothing alertable (severity NO_CHANGE).
  no_change               BOOLEAN     NOT NULL DEFAULT true,
  -- The classified events: [{county, auction_date, type, severity, count, added, removed, note}]
  events                  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  errors                  TEXT[]      NOT NULL DEFAULT '{}',
  emails_sent             INTEGER     NOT NULL DEFAULT 0,
  pushes_sent             INTEGER     NOT NULL DEFAULT 0,
  sms_sent                INTEGER     NOT NULL DEFAULT 0,
  -- Subscriber channel (hard-gated by TAX_SALE_SUBSCRIBER_DRY_RUN):
  subscriber_audience     INTEGER     NOT NULL DEFAULT 0,
  subscriber_emails_sent  INTEGER     NOT NULL DEFAULT 0,
  subscriber_dry_run      BOOLEAN     NOT NULL DEFAULT true,
  -- Dry-run audit trail: [{email, subject}] of exactly who WOULD have been sent.
  subscriber_preview      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  snapshots_upserted      INTEGER     NOT NULL DEFAULT 0,
  duration_ms             INTEGER,
  ok                      BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_tax_sale_monitor_runs_ran_at
  ON public.tax_sale_monitor_runs (ran_at DESC);

ALTER TABLE public.tax_sale_monitor_runs ENABLE ROW LEVEL SECURITY;

-- Service role (the Edge Function) writes; nobody else needs access — the
-- subscriber_preview column contains subscriber email addresses (PII), so no
-- authenticated-read policy on purpose.
DROP POLICY IF EXISTS "Service role full access to tax_sale_monitor_runs"
  ON public.tax_sale_monitor_runs;
CREATE POLICY "Service role full access to tax_sale_monitor_runs"
  ON public.tax_sale_monitor_runs FOR ALL
  USING (auth.role() = 'service_role');
