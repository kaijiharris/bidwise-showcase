-- 009_fix_rls_admin_recursion.sql
--
-- CRITICAL FIX — production-down for all non-admin users.
-- (Committed from the festive-bhaskara worktree, where it was authored as
-- "008_fix_rls_admin_recursion" but never committed. Renumbered to 009 because
-- 008 in the canonical tree is the tax-sale monitor migration.)
--
-- Symptom: any authenticated NON-admin user (including every paying Stripe
-- subscriber) is bounced from /dashboard to /pricing?reason=subscription_required.
-- The web middleware's subscription lookup throws and is treated as "no sub".
--
-- Root cause: the "Admins full access to profiles" policy on public.user_profiles
-- (migration 001) is self-referential — its USING clause does
--     EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
-- i.e. a policy ON user_profiles that SELECTs FROM user_profiles. Any query that
-- evaluates a policy touching user_profiles (e.g. the "Admins full access to
-- subscriptions" policy, which sub-selects user_profiles) recurses infinitely:
--     ERROR 42P17 "infinite recursion detected in policy for relation user_profiles".
-- PostgREST returns HTTP 500, the middleware read fails, and the paywall denies
-- access. Admins never hit it because the middleware short-circuits them via
-- ADMIN_EMAILS before the subscription query runs — which is why it went unnoticed.
--
-- Fix: a SECURITY DEFINER helper public.is_admin() that reads user_profiles as the
-- table owner (owner is exempt from RLS, so no recursion), and rewrite every
-- "Admins full access" policy to call it instead of an inline sub-select on
-- user_profiles.
--
-- Idempotent. Forward-only. Safe to re-run.

-- ── 1. Non-recursive admin check ─────────────────────────────────────────────
-- SECURITY DEFINER → runs as the function owner, who is exempt from RLS on
-- user_profiles (provided FORCE ROW LEVEL SECURITY is not set, which it isn't).
-- This breaks the recursion cycle: evaluating a policy no longer re-enters the
-- user_profiles policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.is_admin() IS
  'True if the current auth.uid() is an admin. SECURITY DEFINER so it bypasses '
  'RLS on user_profiles and does not cause policy recursion. Use this in RLS '
  'policies instead of an inline EXISTS(SELECT FROM user_profiles ...).';

-- ── 2. user_profiles — the recursion source ──────────────────────────────────
-- "Users see own profile" (SELECT, id = auth.uid()) and "Users update own
-- profile" stay as-is; only the self-referential admin policy is replaced.
DROP POLICY IF EXISTS "Admins full access to profiles" ON public.user_profiles;
CREATE POLICY "Admins full access to profiles" ON public.user_profiles
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── 3. Rewrite the other admin policies to use is_admin() ─────────────────────
-- These sub-selected user_profiles inline; routing them through is_admin()
-- avoids re-entering user_profiles RLS on every check and is the clean pattern.
DROP POLICY IF EXISTS "Admins full access to properties" ON public.properties;
CREATE POLICY "Admins full access to properties" ON public.properties
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins full access to subscriptions" ON public.subscriptions;
CREATE POLICY "Admins full access to subscriptions" ON public.subscriptions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage county runs" ON public.county_runs;
CREATE POLICY "Admins manage county runs" ON public.county_runs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- property_unlocks (migration 002). Guarded in case the table isn't present.
DO $$
BEGIN
  IF to_regclass('public.property_unlocks') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins full access to unlocks" ON public.property_unlocks';
    EXECUTE 'CREATE POLICY "Admins full access to unlocks" ON public.property_unlocks
             FOR ALL TO authenticated
             USING (public.is_admin()) WITH CHECK (public.is_admin())';
  END IF;
END$$;

-- NOTE: the trial-system tables (content_unlocks, plan_usage_events,
-- user_trials, plan_entitlements, app_config) created in migration 012/013 use
-- public.is_admin() directly for their admin policies, so they do not
-- reintroduce the recursion.
