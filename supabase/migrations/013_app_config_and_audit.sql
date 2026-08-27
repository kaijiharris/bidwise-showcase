-- 013_app_config_and_audit.sql
--
-- Remaining production-queried tables that had no committed migration:
--
--   * app_config              — singleton (id=1) feature-flag row. Read by
--                               web/lib/feature-flags.ts to override
--                               NEXT_PUBLIC_USE_SUPABASE_PROPERTIES at runtime.
--   * processed_stripe_events — Stripe webhook idempotency ledger. Read+inserted
--                               by web/app/api/stripe/webhook/route.ts (service
--                               role) to dedupe redelivered events.
--   * export_audit_logs       — CSV-export audit trail. Inserted/updated by
--                               web/app/api/export/route.ts (service role).
--
-- Depends on: 001 (user_profiles), 009 (is_admin()). Idempotent / additive.

-- ── 1. app_config (singleton) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_config (
  id                              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- NULL = "no override, use the env flag"; TRUE/FALSE = explicit override.
  use_supabase_properties_override BOOLEAN,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure the singleton row exists so .eq('id',1).maybeSingle() returns a row.
INSERT INTO public.app_config (id, use_supabase_properties_override)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
-- Any authenticated user (and anon, for unauthenticated middleware reads) may
-- read the flag; only admins may change it.
DROP POLICY IF EXISTS "Anyone can read app_config" ON public.app_config;
CREATE POLICY "Anyone can read app_config" ON public.app_config
  FOR SELECT TO authenticated, anon USING (TRUE);
DROP POLICY IF EXISTS "Admins manage app_config" ON public.app_config;
CREATE POLICY "Admins manage app_config" ON public.app_config
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 2. processed_stripe_events (webhook idempotency) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  event_id     TEXT        PRIMARY KEY,   -- Stripe event id (evt_...)
  event_type   TEXT        NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;
-- Only the service role (the webhook) touches this. No authenticated-user policy
-- is granted; with RLS enabled and no permissive policy, normal users get zero
-- rows, while the service-role key bypasses RLS entirely.
DROP POLICY IF EXISTS "Admins read processed stripe events" ON public.processed_stripe_events;
CREATE POLICY "Admins read processed stripe events" ON public.processed_stripe_events
  FOR SELECT TO authenticated USING (public.is_admin());

-- ── 3. export_audit_logs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.export_audit_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email      TEXT,
  plan            TEXT,
  ip_address      TEXT,
  content_type    TEXT,
  county_filter   TEXT,
  batch_id_filter TEXT,
  format          TEXT,
  explicit_ids    JSONB,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  result_count    INTEGER,
  success         BOOLEAN,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS export_audit_logs_user_idx ON public.export_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS export_audit_logs_requested_idx ON public.export_audit_logs (requested_at DESC);

ALTER TABLE public.export_audit_logs ENABLE ROW LEVEL SECURITY;
-- Written by the service role (export route). Users may read their own audit
-- rows; admins may read all. No user-facing insert policy (service role only).
DROP POLICY IF EXISTS "Users see own export audits" ON public.export_audit_logs;
CREATE POLICY "Users see own export audits" ON public.export_audit_logs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins full access to export audits" ON public.export_audit_logs;
CREATE POLICY "Admins full access to export audits" ON public.export_audit_logs
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
