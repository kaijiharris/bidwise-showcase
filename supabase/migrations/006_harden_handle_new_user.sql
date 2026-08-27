-- 006_harden_handle_new_user.sql
--
-- Fixes intermittent "Database error saving new user" failures during signup.
--
-- Two changes vs. the original trigger in 001:
--
--  1. SET search_path = public, pg_temp
--     Without this, SECURITY DEFINER functions inherit the *caller's* search
--     path. On auth.users INSERT, the caller is the auth service, whose
--     search_path doesn't include 'public' — so `user_profiles` resolves to
--     nothing and the INSERT fails. This is the root cause of the
--     "Database error saving new user" message reported in production.
--
--  2. EXCEPTION WHEN OTHERS THEN RAISE WARNING
--     Auth account creation should never be blocked by a profile-row issue.
--     If the INSERT still fails for any reason (column-level constraint
--     added later, etc.), we log a warning instead of rolling back the
--     entire auth.users row. The user can still sign in; their profile row
--     gets backfilled on next sign-in (handled via app-level upsert).
--
-- Safe to re-run; CREATE OR REPLACE is idempotent.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  admin_emails TEXT[] := ARRAY[
    'alerts@bidwiseinvest.com',
    'kaijiharris@bidwiseinvest.com',
    'trent@bidwiseinvest.com',
    'admin2@example.com'
  ];
BEGIN
  BEGIN
    INSERT INTO public.user_profiles (id, email, role)
    VALUES (
      NEW.id,
      NEW.email,
      CASE WHEN NEW.email = ANY(admin_emails) THEN 'admin' ELSE 'client' END
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user failed for %: %', NEW.email, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Re-create the trigger (no-op if already pointing at the function, but safe).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
