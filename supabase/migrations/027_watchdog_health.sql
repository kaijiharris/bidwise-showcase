-- 027_watchdog_health.sql
--
-- Narrow, anon-callable health probe for the tax-sale watchdog, consumed by
-- .github/workflows/watchdog-health.yml (daily; fails loudly when the cron
-- goes stale, which emails the repo owner via GitHub's default notifications).
--
-- Why SECURITY DEFINER: tax_sale_monitor_runs is RLS-locked (anon SELECT
-- returns zero rows), which is correct — run rows carry subscriber previews.
-- This function exposes ONLY operational aggregates: the last run time, how
-- stale it is, and how many of the last 3 runs had source errors (the
-- "county site down for days" signal, e.g. the DeKalb 503 streak of
-- 2026-07-18+). No error text, no subscriber data, no parcel data.

CREATE OR REPLACE FUNCTION public.watchdog_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT ran_at, errors
    FROM public.tax_sale_monitor_runs
    ORDER BY ran_at DESC
    LIMIT 3
  )
  SELECT jsonb_build_object(
    'last_run_at', (SELECT max(ran_at) FROM recent),
    'hours_since_last_run',
      round((extract(epoch FROM (now() - (SELECT max(ran_at) FROM recent))) / 3600.0)::numeric, 1),
    'recent_runs_with_errors',
      (SELECT count(*) FROM recent WHERE cardinality(errors) > 0)
  );
$$;

-- Functions default EXECUTE to PUBLIC; make the narrow grant explicit anyway
-- (house style: no implicit surface).
REVOKE ALL ON FUNCTION public.watchdog_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.watchdog_health() TO anon;

COMMENT ON FUNCTION public.watchdog_health() IS
  'Operational aggregates for the tax-sale watchdog (last run time, staleness, '
  'recent error-run count). SECURITY DEFINER so the RLS-locked run log stays '
  'private while CI can health-check it with the anon key.';
