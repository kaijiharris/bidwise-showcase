-- 007_unlock_refunds_and_removal.sql
--
-- Adds the schema needed to auto-refund unlocks when a property is pulled from
-- the auction list before sale day. County tax-deed lists shrink ~40% in the
-- final 3 days as owners redeem; without this, a paying user who unlocked a
-- redeemed parcel would lose their monthly-quota unlock for no value.
--
-- Design notes (see memory/unlock_refund_on_removal.md):
--  * NO predictive "high-risk-of-removal" tagging — the best deals redeem the
--    most often, so flagging them inverts the value proposition. We only act
--    *after* a removal is confirmed by the final pre-auction pull.
--  * `auction_status='cancelled_before_auction'` keeps removed parcels visible
--    on the dashboard with a "Removed — unlock refunded" badge so a user who
--    unlocked one understands why their list shrunk, rather than the parcel
--    silently vanishing.
--  * Unlocks are a monthly-resetting allowance counted via
--    plan_usage_events.refunded_at IS NULL; the existing current_plan_usage
--    view will need to be re-created to honor that filter (out of scope here —
--    that view was created in an uncommitted trial migration).
--
-- Idempotent. Forward-only. Safe to re-run.

-- ── properties: removal flag + timestamp ─────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS auction_status TEXT
    NOT NULL DEFAULT 'active'
    CHECK (auction_status IN ('active', 'cancelled_before_auction', 'sold', 'unknown'));

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS properties_auction_status_idx
  ON public.properties (county, auction_date, auction_status);

-- ── content_unlocks: refund tracking ─────────────────────────────────────────
-- Skipped gracefully if the unlocks table hasn't been created in this env
-- (it was added in an uncommitted trial-system migration).
DO $$
BEGIN
  IF to_regclass('public.content_unlocks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.content_unlocks
             ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ';
    EXECUTE 'ALTER TABLE public.content_unlocks
             ADD COLUMN IF NOT EXISTS refund_reason TEXT';
    EXECUTE 'CREATE INDEX IF NOT EXISTS content_unlocks_refunded_idx
             ON public.content_unlocks (refunded_at)
             WHERE refunded_at IS NOT NULL';
  END IF;
END$$;

-- ── plan_usage_events: refund tracking ───────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.plan_usage_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.plan_usage_events
             ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ';
    EXECUTE 'CREATE INDEX IF NOT EXISTS plan_usage_events_refunded_idx
             ON public.plan_usage_events (refunded_at)
             WHERE refunded_at IS NOT NULL';
  END IF;
END$$;

-- ── RPC: refund all monthly-quota unlocks on a removed parcel ────────────────
-- Marks the property as cancelled_before_auction (idempotent — re-running on
-- an already-cancelled parcel is a no-op) and credits back every unlock that
-- consumed a monthly quota slot. Returns the count of unlock rows refunded.
--
-- Called from execution/push_to_supabase.py --final once per removed parcel
-- after the diff confirms the parcel is no longer in the final auction list.
CREATE OR REPLACE FUNCTION public.refund_unlocks_for_parcel(
  p_county    TEXT,
  p_parcel_id TEXT,
  p_reason    TEXT DEFAULT 'cancelled_before_auction'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_property_id    UUID;
  v_refunded_count INTEGER := 0;
  v_already        BOOLEAN := FALSE;
BEGIN
  -- Resolve the property. parcel_id is currently UNIQUE globally in 001, but
  -- we still match on county defensively in case that constraint ever loosens
  -- to (county, parcel_id) — multiple counties can theoretically reuse a PIN.
  SELECT id, auction_status = 'cancelled_before_auction'
    INTO v_property_id, v_already
    FROM public.properties
   WHERE parcel_id = p_parcel_id
     AND lower(county) = lower(p_county)
   LIMIT 1;

  IF v_property_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok',       FALSE,
      'error',    'property_not_found',
      'county',   p_county,
      'parcel',   p_parcel_id
    );
  END IF;

  -- Idempotent: if already marked removed, just report 0 new refunds.
  IF v_already THEN
    RETURN jsonb_build_object(
      'ok',             TRUE,
      'property_id',    v_property_id,
      'already_marked', TRUE,
      'refunded',       0
    );
  END IF;

  -- Mark the property removed.
  UPDATE public.properties
     SET auction_status = 'cancelled_before_auction',
         removed_at     = NOW()
   WHERE id = v_property_id;

  -- Refund unlocks (and their usage events) only if those tables exist.
  IF to_regclass('public.content_unlocks') IS NOT NULL THEN
    WITH refunded AS (
      UPDATE public.content_unlocks
         SET refunded_at   = NOW(),
             refund_reason = p_reason
       WHERE content_type = 'auction_property'
         AND content_id   = v_property_id::TEXT
         AND refunded_at IS NULL
         AND COALESCE(source, 'monthly_quota') = 'monthly_quota'
      RETURNING user_id
    )
    SELECT COUNT(*) INTO v_refunded_count FROM refunded;

    -- Mirror the refund onto the usage events that backed those unlocks
    -- (current_plan_usage view counts events with refunded_at IS NULL).
    IF to_regclass('public.plan_usage_events') IS NOT NULL THEN
      UPDATE public.plan_usage_events e
         SET refunded_at = NOW()
        FROM public.content_unlocks u
       WHERE u.content_type = 'auction_property'
         AND u.content_id   = v_property_id::TEXT
         AND u.refunded_at IS NOT NULL
         AND e.user_id      = u.user_id
         AND e.event_type   = 'unlock_consumed'
         AND e.refunded_at IS NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',          TRUE,
    'property_id', v_property_id,
    'refunded',    v_refunded_count,
    'county',      p_county,
    'parcel',      p_parcel_id,
    'reason',      p_reason
  );
END;
$$;

-- Service-role only — this bypasses normal RLS billing rules.
REVOKE ALL ON FUNCTION public.refund_unlocks_for_parcel(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_unlocks_for_parcel(TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.refund_unlocks_for_parcel(TEXT, TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_unlocks_for_parcel(TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.refund_unlocks_for_parcel(TEXT, TEXT, TEXT) IS
  'Mark a parcel removed_at=NOW + auction_status=cancelled_before_auction, '
  'and credit back every monthly-quota unlock + usage event tied to it. '
  'Idempotent. Service-role only. Called by execution/push_to_supabase.py --final.';
