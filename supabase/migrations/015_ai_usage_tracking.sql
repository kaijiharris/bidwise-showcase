-- 015_ai_usage_tracking.sql
--
-- Cost visibility + runaway guardrails for the generate-brief edge function
-- (Gemini). Forward-only, idempotent. Adds:
--   1. ai_usage_events  — one row per AI call (tokens), for visibility + the
--      per-user / global daily rate limits the edge function enforces.
--   2. app_config flags — instant kill switch + daily caps the operator can
--      change in SQL with no redeploy.
--   3. ai_usage_summary — a convenience view of today/month/all-time totals.
--
-- Depends on: 009 (is_admin), 013 (app_config).

-- ── 1. Per-call usage ledger ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  fn            TEXT        NOT NULL DEFAULT 'generate_brief',
  model         TEXT,
  prompt_tokens INTEGER     NOT NULL DEFAULT 0,
  output_tokens INTEGER     NOT NULL DEFAULT 0,
  total_tokens  INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_day_idx ON public.ai_usage_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_events_day_idx      ON public.ai_usage_events (created_at);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
-- Users see their own usage; admins see all. INSERTs happen only via the edge
-- function's service-role client (RLS-bypassing) — no user INSERT policy, so a
-- client can never forge usage rows to dodge the rate limit.
DROP POLICY IF EXISTS "Users see own ai usage" ON public.ai_usage_events;
CREATE POLICY "Users see own ai usage" ON public.ai_usage_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins manage ai usage" ON public.ai_usage_events;
CREATE POLICY "Admins manage ai usage" ON public.ai_usage_events
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 2. Kill switch + caps on the app_config singleton (id = 1) ───────────────
ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS ai_briefs_enabled       BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS ai_brief_daily_cap      INTEGER NOT NULL DEFAULT 500;  -- global calls/day
ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS ai_brief_user_daily_cap INTEGER NOT NULL DEFAULT 25;   -- per-user calls/day

-- ── 3. Operator-facing totals (today / month / all-time) ────────────────────
-- security_invoker: an admin (is_admin policy above) sees global totals; a
-- normal user sees only their own. The Supabase SQL editor / service role sees
-- all regardless (RLS-bypassing) — the simplest "how much have I spent" check.
CREATE OR REPLACE VIEW public.ai_usage_summary
WITH (security_invoker = true) AS
SELECT
  count(*)                                                                              AS calls_all_time,
  COALESCE(sum(total_tokens), 0)                                                        AS tokens_all_time,
  count(*) FILTER (WHERE created_at >= date_trunc('day',   now()))                      AS calls_today,
  COALESCE(sum(total_tokens) FILTER (WHERE created_at >= date_trunc('day',   now())),0) AS tokens_today,
  count(*) FILTER (WHERE created_at >= date_trunc('month', now()))                      AS calls_month,
  COALESCE(sum(total_tokens) FILTER (WHERE created_at >= date_trunc('month', now())),0) AS tokens_month
FROM public.ai_usage_events;
GRANT SELECT ON public.ai_usage_summary TO authenticated;
