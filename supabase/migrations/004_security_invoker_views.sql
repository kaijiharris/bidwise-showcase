-- Fix Supabase lint 0010_security_definer_view.
--
-- The visible_properties and visible_properties_safe views in migration 002
-- were created without `with (security_invoker = on)`. PostgREST exposes them
-- via the REST API, and without security_invoker they run with the definer's
-- privileges — which means they bypass the RLS policies on the underlying
-- `properties` table.
--
-- `properties` already has correct RLS:
--   * "Subscribers see published properties" (migration 001:134)
--   * "Admins full access to properties"     (migration 001:145)
--
-- Switching the views to security_invoker makes them evaluate with the calling
-- user's privileges so those policies apply as intended. Non-destructive: this
-- preserves the existing GRANT SELECT on the views and does not touch the view
-- bodies.

alter view public.visible_properties      set (security_invoker = on);
alter view public.visible_properties_safe set (security_invoker = on);

-- Optional belt-and-suspenders: re-confirm GRANTs in case a future env-restore
-- forgets to carry them. Idempotent.
grant select on public.visible_properties      to authenticated;
grant select on public.visible_properties_safe to authenticated;
