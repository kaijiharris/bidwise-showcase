-- 014_security_hardening.sql
--
-- Consolidated security hardening from an adversarial review. Forward-only,
-- idempotent (DROP ... IF EXISTS / CREATE OR REPLACE), safe to re-run.
--
-- Items (matching the review):
--   A. (CRITICAL) Create the missing SECURITY DEFINER RPC
--      consume_content_unlock_for_user(...) that web/app/api/unlocks/route.ts
--      calls. Without it, every paid unlock 500s.
--   B. (CRITICAL) Drop the user self-INSERT policies on content_unlocks (012)
--      and property_unlocks (002) — they were a paywall bypass. After this,
--      inserts happen only via the RPC (A) / service_role.
--   C. (HIGH) Remove the hardcoded admin-email grant from handle_new_user()
--      (006) — registering with a listed email would self-grant admin.
--   D. (HIGH) Recreate visible_properties / visible_properties_safe WITH
--      (security_invoker = true) so the view definition itself is safe (no
--      reliance on the separate 004 ALTER VIEW patch).
--   E. (MEDIUM) Document plan_usage_events insert model + add a defensive
--      per-user INSERT policy scoped to auth.uid().
--   F. (MEDIUM) REVOKE EXECUTE on is_admin() from anon.
--
-- Depends on: 001, 002, 006, 009, 011, 012.

-- ============================================================================
-- A. consume_content_unlock_for_user — SECURITY DEFINER unlock consumer
-- ============================================================================
-- Resolves the user's effective plan (active/trialing subscription, else active
-- trial, else 'none') and that plan's monthly auction-unlock allowance from
-- plan_entitlements. Counts the user's non-refunded auction_property unlocks
-- for the current calendar month. Then:
--   * already unlocked this content  -> { unlocked: true,  ... } (idempotent)
--   * unlimited (-1) or under the cap -> INSERT, { unlocked: true,  message }
--   * at/over the cap                 -> { unlocked: false, message }
--
-- Concurrency-safe: the INSERT uses ON CONFLICT (user_id, content_type,
-- content_id) DO NOTHING. If a concurrent request already inserted the same
-- row, RETURNING yields no row and we report the idempotent success rather than
-- double-spending the quota. Off-market leads (offmarket_unlocks_per_month) are
-- gated against their own cap with the same logic.
--
-- Returns json (the route reads result.unlocked / result.message).
-- service_role-only: the route calls it with the service-role key after it has
-- itself authenticated the caller and resolved p_user_id from the JWT.
CREATE OR REPLACE FUNCTION public.consume_content_unlock_for_user(
  p_user_id      UUID,
  p_content_type TEXT,
  p_content_id   TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan        TEXT;
  v_cap         INTEGER;
  v_used        INTEGER;
  v_inserted_id UUID;
BEGIN
  -- Validate content type up front.
  IF p_content_type NOT IN ('auction_property', 'off_market_lead') THEN
    RETURN json_build_object('unlocked', false, 'message', 'unsupported content type');
  END IF;

  IF p_user_id IS NULL OR p_content_id IS NULL OR length(p_content_id) = 0 THEN
    RETURN json_build_object('unlocked', false, 'message', 'invalid request');
  END IF;

  -- Serialize concurrent unlock attempts for the SAME user. ON CONFLICT only
  -- guards a duplicate of the same content_id; without this, N concurrent
  -- requests for N DIFFERENT content_ids could each pass the cap check before
  -- any insert lands and overshoot the monthly cap. The advisory lock is
  -- transaction-scoped (released at function/txn end) and keyed per user, so it
  -- never blocks unrelated users.
  PERFORM pg_advisory_xact_lock(hashtext('content_unlock:' || p_user_id::text));

  -- Idempotent fast-path: already unlocked (and not refunded) → success.
  IF EXISTS (
    SELECT 1 FROM public.content_unlocks
    WHERE user_id = p_user_id
      AND content_type = p_content_type
      AND content_id = p_content_id
      AND refunded_at IS NULL
  ) THEN
    RETURN json_build_object('unlocked', true, 'message', 'already unlocked');
  END IF;

  -- Resolve effective plan (mirrors current_plan_usage view in 012).
  v_plan := COALESCE(
    (SELECT s.plan FROM public.subscriptions s
      WHERE s.user_id = p_user_id
        AND s.status IN ('trialing', 'active')
      ORDER BY s.current_period_end DESC NULLS LAST
      LIMIT 1),
    (SELECT t.plan FROM public.user_trials t
      WHERE t.user_id = p_user_id
        AND t.trial_ends_at > now()
      LIMIT 1),
    'none'
  );

  -- Monthly cap for this content type from plan_entitlements. -1 == unlimited.
  IF p_content_type = 'auction_property' THEN
    SELECT COALESCE(pe.auction_unlocks_per_month, 0) INTO v_cap
    FROM public.plan_entitlements pe WHERE pe.plan = v_plan;
  ELSE
    SELECT COALESCE(pe.offmarket_unlocks_per_month, 0) INTO v_cap
    FROM public.plan_entitlements pe WHERE pe.plan = v_plan;
  END IF;
  v_cap := COALESCE(v_cap, 0);  -- no matching entitlement row → no allowance

  -- Count this month's non-refunded consumed unlocks of this content type.
  SELECT count(*)::int INTO v_used
  FROM public.content_unlocks cu
  WHERE cu.user_id = p_user_id
    AND cu.content_type = p_content_type
    AND cu.refunded_at IS NULL
    AND cu.unlocked_at >= date_trunc('month', now());

  -- Enforce the cap (unlimited when < 0).
  IF v_cap >= 0 AND v_used >= v_cap THEN
    RETURN json_build_object(
      'unlocked', false,
      'message',  'limit reached',
      'plan',     v_plan,
      'used',     v_used,
      'limit',    v_cap
    );
  END IF;

  -- Consume one slot. ON CONFLICT DO NOTHING makes a concurrent duplicate a
  -- no-op rather than a double-spend (UNIQUE(user_id, content_type, content_id)).
  INSERT INTO public.content_unlocks (user_id, content_type, content_id, source)
  VALUES (p_user_id, p_content_type, p_content_id, 'monthly_quota')
  ON CONFLICT (user_id, content_type, content_id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    -- A concurrent request already inserted this exact unlock. Treat as the
    -- idempotent success path; the quota was only spent once.
    RETURN json_build_object('unlocked', true, 'message', 'already unlocked');
  END IF;

  -- Mirror the consumption onto the append-only usage ledger so the
  -- current_plan_usage meter and refund flow (007) stay consistent.
  INSERT INTO public.plan_usage_events (user_id, event_type, content_id)
  VALUES (
    p_user_id,
    CASE WHEN p_content_type = 'auction_property'
         THEN 'unlock_consumed' ELSE 'offmarket_unlock_consumed' END,
    p_content_id
  );

  RETURN json_build_object(
    'unlocked', true,
    'message',  'unlocked',
    'plan',     v_plan,
    'used',     v_used + 1,
    'limit',    v_cap
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_content_unlock_for_user(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_content_unlock_for_user(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.consume_content_unlock_for_user(UUID, TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_content_unlock_for_user(UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.consume_content_unlock_for_user(UUID, TEXT, TEXT) IS
  'Consume one monthly-quota content unlock for a user, enforcing the plan cap '
  'from plan_entitlements. Idempotent + concurrency-safe (ON CONFLICT DO '
  'NOTHING). SECURITY DEFINER, service_role only. Called by '
  'web/app/api/unlocks/route.ts after it authenticates the caller.';

-- ============================================================================
-- B. Drop user self-INSERT policies (paywall bypass)
-- ============================================================================
-- content_unlocks (012) — user could INSERT their own unlock rows directly,
-- bypassing the quota. Inserts now happen only via the RPC above / service_role.
DROP POLICY IF EXISTS "Users insert own content unlocks" ON public.content_unlocks;

-- property_unlocks (002) — "Users insert own unlocks" let a user grant
-- themselves a pay-per-unlock with no payment. Service-role webhooks insert
-- these; users must not.
DO $$
BEGIN
  IF to_regclass('public.property_unlocks') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Users insert own unlocks" ON public.property_unlocks';
  END IF;
END$$;

-- ============================================================================
-- C. handle_new_user() — drop the hardcoded admin-email grant
-- ============================================================================
-- Every new user gets role='client'. Admin must be granted explicitly out-of-
-- band (UPDATE user_profiles SET role='admin' ...), never via the email a
-- registrant controls. Keeps the 006 hardening (search_path + swallow errors).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'client')
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user failed for %: %', NEW.email, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- D. Recreate visible_properties / visible_properties_safe as security_invoker
-- ============================================================================
-- 002 created them SECURITY DEFINER; 004 ALTERed them to security_invoker as a
-- separate step (a single point of failure on env restore). Re-declare the view
-- bodies WITH (security_invoker = true) so the safe setting lives with the
-- definition. View bodies preserved verbatim from 002.
-- Achieve the security_invoker end-state via ALTER (idempotent, no column risk)
-- rather than CREATE OR REPLACE. The view bodies already exist from 002; we only
-- flip the option so the safe setting lives with the view independent of the
-- separate 004 patch. CREATE OR REPLACE would re-expand the `SELECT r.*` column
-- list and ERROR on apply if the properties table gained any column since 002;
-- ALTER touches no columns and is safe regardless of the current properties shape.
DO $$
BEGIN
  IF to_regclass('public.visible_properties') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.visible_properties SET (security_invoker = true)';
  END IF;
  IF to_regclass('public.visible_properties_safe') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.visible_properties_safe SET (security_invoker = true)';
  END IF;
END$$;

GRANT SELECT ON public.visible_properties      TO authenticated;
GRANT SELECT ON public.visible_properties_safe TO authenticated;

-- ============================================================================
-- E. plan_usage_events — scoped per-user INSERT policy
-- ============================================================================
-- 012 left this table with SELECT (own) + admin-all policies but no INSERT
-- policy. The canonical writer is the consume_content_unlock_for_user RPC (A,
-- SECURITY DEFINER) and the service role — both bypass RLS — so a missing
-- INSERT policy means no normal user can write it. We add a defensive,
-- tightly-scoped INSERT policy (auth.uid() = user_id) so any future direct
-- client write is still constrained to the caller's own rows and can never
-- forge another user's usage. It does NOT widen quota bypass risk: the quota is
-- enforced by content_unlocks (B locks down its inserts), not by this ledger.
DROP POLICY IF EXISTS "Users insert own usage events" ON public.plan_usage_events;
CREATE POLICY "Users insert own usage events" ON public.plan_usage_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- F. is_admin() — revoke EXECUTE from anon
-- ============================================================================
-- 009 granted EXECUTE to authenticated, anon, service_role. anon never needs to
-- evaluate admin status; revoke it. authenticated + service_role keep it.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
