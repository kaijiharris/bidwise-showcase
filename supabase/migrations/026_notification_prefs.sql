-- 026_notification_prefs.sql
--
-- Per-user notification preferences for the tax-sale subscriber fan-out
-- (supabase/functions/notify-tax-sale/subscribers.ts).
--
-- Design contract:
--   • ABSENCE of a row = default ON for all counties. No signup-flow change
--     and no backfill required — subscribers.ts substitutes DEFAULT_PREF for
--     missing rows.
--   • `counties` holds lowercase county slugs. NULL = every county the
--     product alerts on (the subscriber-eligible set in sources.ts). An
--     empty array matches nothing and behaves like an opt-out.
--   • Duplicate accounts sharing one email are merged MOST-RESTRICTIVELY at
--     send time (any opt-out wins; county lists intersect) — see
--     subscribers.ts mergePrefs.
--   • subscribers.ts FAILS CLOSED when this table cannot be read: it skips
--     subscriber sends for that run rather than risk emailing a user who
--     opted out. The miss is loud in the run log + operator digest.

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tax_sale_alerts boolean NOT NULL DEFAULT true,
  -- Allowlist mirrors the counties the watchdog observes (sources.ts). A new
  -- county needs a migration to extend this CHECK — deliberate: the same
  -- deploy that adds an observer decides who may subscribe to it.
  counties text[] DEFAULT NULL
    CHECK (counties IS NULL
           OR counties <@ ARRAY['dekalb','gwinnett','cobb','clayton','fulton']),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Keep updated_at truthful on every UPDATE (house pattern from 003).
CREATE OR REPLACE FUNCTION public.touch_notification_prefs_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_prefs_touch_updated_at ON public.notification_prefs;
CREATE TRIGGER trg_notification_prefs_touch_updated_at
  BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_notification_prefs_updated_at();

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users read own notification prefs" ON public.notification_prefs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users insert own notification prefs" ON public.notification_prefs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users update own notification prefs" ON public.notification_prefs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Deleting your row = reverting to the defaults (alerts ON, all counties).
DROP POLICY IF EXISTS "Users delete own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users delete own notification prefs" ON public.notification_prefs
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Defense in depth (house pattern from 021): strip default PostgREST grants;
-- authenticated gets exactly the verbs the RLS policies gate.
REVOKE ALL ON public.notification_prefs FROM anon;
REVOKE ALL ON public.notification_prefs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_prefs TO authenticated;

COMMENT ON TABLE public.notification_prefs IS
  'Per-user tax-sale alert preferences. No row = alerts ON for all counties. '
  'Read by supabase/functions/notify-tax-sale (service role, fail-closed); '
  'row-owner managed via RLS for the future preferences UI. Duplicate '
  'accounts on one email merge most-restrictively at send time.';
