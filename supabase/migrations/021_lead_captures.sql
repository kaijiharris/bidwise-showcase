-- 021_lead_captures.sql
--
-- Email capture for the public /free-list/[county] lead-magnet teaser pages
-- (auction-day distribution: DeKalb 2026-07-07, Gwinnett 2026-08-04). Visitors
-- who are not ready to subscribe leave an email to get the full county list;
-- those rows land here for operator follow-up.
--
-- Security model (mirrors 014_security_hardening.sql's deny-by-default posture):
--   * RLS ENABLED with NO anon/authenticated INSERT policy — on purpose.
--     The ONLY writer is web/app/api/lead-capture/route.ts using the
--     service-role key (service_role bypasses RLS) AFTER the route has
--     validated (email format, county allowlist, length caps) and
--     rate-limited the request. A direct PostgREST insert with the anon key
--     is rejected by RLS, so the API route is the single, auditable ingress.
--   * No public reads, ever — captured emails are PII. Admins may read via
--     the is_admin() helper (009, hardened in 014) for follow-up.
--
-- Forward-only, idempotent (IF NOT EXISTS / OR REPLACE), safe to re-run.
-- Depends on: 009 (is_admin).

CREATE TABLE IF NOT EXISTS public.lead_captures (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The route lowercases + trims before insert; the CHECKs are defense in
  -- depth against any future writer skipping route validation.
  email        TEXT        NOT NULL
                           CHECK (char_length(email) <= 254 AND position('@' IN email) > 1),
  -- DB-level allowlist covers every county the app publishes (lib/county-data
  -- KNOWN_COUNTIES); the API route enforces the tighter live free-list set
  -- (dekalb, gwinnett) so new counties need a code change, not a migration.
  county       TEXT        NOT NULL
                           CHECK (county IN ('dekalb', 'gwinnett', 'cobb', 'clayton')),
  source       TEXT        NOT NULL DEFAULT 'free-list'
                           CHECK (char_length(source) <= 64),
  utm_source   TEXT        CHECK (char_length(utm_source) <= 128),
  utm_medium   TEXT        CHECK (char_length(utm_medium) <= 128),
  utm_campaign TEXT        CHECK (char_length(utm_campaign) <= 128),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (email, county): the route upserts with ON CONFLICT DO NOTHING
-- so a double-submit (or re-visit) is idempotent instead of duplicating leads.
-- Email is stored lowercased by the route, so a plain column index suffices.
CREATE UNIQUE INDEX IF NOT EXISTS lead_captures_email_county_key
  ON public.lead_captures (email, county);

CREATE INDEX IF NOT EXISTS lead_captures_created_at_idx
  ON public.lead_captures (created_at DESC);

ALTER TABLE public.lead_captures ENABLE ROW LEVEL SECURITY;

-- Deny-by-default: NO INSERT/UPDATE/DELETE policies for anon or authenticated.
-- service_role (the API route) bypasses RLS; nobody else writes.

-- Admin-only read for in-app follow-up.
DROP POLICY IF EXISTS "Admins read lead captures" ON public.lead_captures;
CREATE POLICY "Admins read lead captures" ON public.lead_captures
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Defense in depth: strip the default PostgREST table grants so that even a
-- future mistakenly-permissive policy cannot expose emails to anon, and
-- authenticated is limited to SELECT (still gated by the RLS policy above).
REVOKE ALL ON public.lead_captures FROM anon;
REVOKE ALL ON public.lead_captures FROM authenticated;
GRANT SELECT ON public.lead_captures TO authenticated;

COMMENT ON TABLE public.lead_captures IS
  'Emails captured on the public /free-list/[county] teaser pages. Inserted '
  'only via service_role from web/app/api/lead-capture/route.ts (validated + '
  'rate-limited). RLS deny-by-default: no anon access, admin-only reads.';
