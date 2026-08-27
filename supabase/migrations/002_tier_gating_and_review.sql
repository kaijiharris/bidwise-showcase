-- ============================================================
-- BidWise — Tier Gating + Admin Review (Migration 002)
-- Depends on: 001_initial_schema.sql
--
-- What this adds:
--   1. Admin review fields on properties (review_status, approved_at,
--      public_at, pruned_at, reviewed_by, review_notes).
--   2. Auto-trigger that flips `published` and stamps timestamps when
--      review_status transitions to 'approved' / 'pruned' / 'rejected'.
--   3. property_unlocks table for pay-per-unlock and admin grants.
--   4. Helper functions for tier caps (single source of truth).
--   5. visible_properties view: returns everything a user can see, with
--      a `locked` flag computed from their tier + rank within batch +
--      release-window timing (Expert sees on approve, Pro/Starter +24h).
-- ============================================================

-- ── 1. ADD REVIEW + RELEASE-WINDOW COLUMNS ────────────────────────────────────
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS review_status   TEXT
    CHECK (review_status IN ('pending_review','approved','rejected','pruned'))
    DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pruned_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pruned_reason   TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by     UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS review_notes    TEXT;

CREATE INDEX IF NOT EXISTS idx_properties_review_status ON properties(review_status);
CREATE INDEX IF NOT EXISTS idx_properties_public_at     ON properties(public_at);
CREATE INDEX IF NOT EXISTS idx_properties_approved_at   ON properties(approved_at);

-- Backfill: existing published rows are treated as already-approved + public.
UPDATE properties
SET review_status = 'approved',
    approved_at   = COALESCE(approved_at, NOW()),
    public_at     = COALESCE(public_at, NOW())
WHERE published = TRUE
  AND review_status = 'pending_review';

-- ── 2. TRIGGER: review_status transitions auto-stamp + sync `published` ──────
CREATE OR REPLACE FUNCTION on_property_review_status_change()
RETURNS TRIGGER AS $$
DECLARE
  old_status TEXT := CASE TG_OP WHEN 'INSERT' THEN NULL ELSE OLD.review_status END;
BEGIN
  IF NEW.review_status = 'approved' AND old_status IS DISTINCT FROM 'approved' THEN
    NEW.approved_at := COALESCE(NEW.approved_at, NOW());
    NEW.public_at   := COALESCE(NEW.public_at, NEW.approved_at + INTERVAL '24 hours');
    NEW.published   := TRUE;
  ELSIF NEW.review_status = 'pruned' AND old_status IS DISTINCT FROM 'pruned' THEN
    NEW.pruned_at := COALESCE(NEW.pruned_at, NOW());
    NEW.published := FALSE;
  ELSIF NEW.review_status = 'rejected' AND old_status IS DISTINCT FROM 'rejected' THEN
    NEW.published := FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS properties_review_status_change ON properties;
CREATE TRIGGER properties_review_status_change
  BEFORE INSERT OR UPDATE OF review_status ON properties
  FOR EACH ROW EXECUTE FUNCTION on_property_review_status_change();

-- ── 3. PROPERTY UNLOCKS (pay-per-unlock + admin grants) ──────────────────────
CREATE TABLE IF NOT EXISTS property_unlocks (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID  REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  property_id  UUID  REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  source       TEXT  CHECK (source IN ('one_time','admin_grant','tier_bonus'))
                     DEFAULT 'one_time',
  payment_id   TEXT,                          -- Stripe charge id or Apple txn id
  amount_cents INTEGER,                       -- nullable; 0 for admin_grant
  unlocked_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_property_unlocks_user_id ON property_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_property_unlocks_property ON property_unlocks(property_id);

ALTER TABLE property_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own unlocks" ON property_unlocks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Inserts go through the service role (Stripe webhook / Apple IAP webhook),
-- which bypasses RLS. We still allow self-inserts in case of client-side
-- one-time unlock confirmations, but with the WITH CHECK guard.
CREATE POLICY "Users insert own unlocks" ON property_unlocks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins full access to unlocks" ON property_unlocks
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- ── 4. TIER HELPERS (single source of truth for caps) ────────────────────────
CREATE OR REPLACE FUNCTION tier_listing_cap(plan_name TEXT)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE plan_name
    WHEN 'starter' THEN 10
    WHEN 'pro'     THEN 25
    WHEN 'expert'  THEN NULL    -- unlimited
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION tier_offmarket_cap(plan_name TEXT)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE plan_name
    WHEN 'starter' THEN 0
    WHEN 'pro'     THEN 5
    WHEN 'expert'  THEN NULL    -- unlimited
    ELSE 0
  END;
$$;

-- ── 5. VISIBLE_PROPERTIES VIEW ───────────────────────────────────────────────
-- Returns every property the caller is entitled to see, with a `locked`
-- flag computed from tier + per-batch deal_score rank + explicit unlocks.
--
-- Visibility (filter):
--   - Admin: all approved rows.
--   - Expert: rows where approved_at <= NOW().
--   - Starter / Pro: rows where public_at <= NOW() (24h delay).
--   - Anyone else (no active sub): nothing — RLS on `properties` blocks them.
--
-- Locked flag:
--   - Admin or Expert: never locked.
--   - Pro: unlocked if rank_in_batch <= 25 OR explicitly unlocked.
--   - Starter: unlocked if rank_in_batch <= 10 OR explicitly unlocked.
--
-- rank_in_batch is BY deal_score DESC within batch_id. Best deals always
-- show fully — strongest upgrade pressure on locked listings further down.

CREATE OR REPLACE VIEW visible_properties AS
WITH user_ctx AS (
  SELECT
    auth.uid() AS uid,
    COALESCE(
      (SELECT plan FROM subscriptions
        WHERE user_id = auth.uid()
          AND status IN ('trialing','active')
        ORDER BY current_period_end DESC NULLS LAST
        LIMIT 1),
      'none'
    ) AS plan,
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin') AS is_admin
),
ranked AS (
  SELECT
    p.*,
    ROW_NUMBER() OVER (
      PARTITION BY p.batch_id
      ORDER BY p.deal_score DESC NULLS LAST, p.id
    ) AS rank_in_batch
  FROM properties p
  WHERE p.review_status = 'approved'
    AND p.published = TRUE
)
SELECT
  r.*,
  uc.plan       AS user_plan,
  uc.is_admin   AS user_is_admin,
  CASE
    WHEN uc.is_admin THEN FALSE
    WHEN uc.plan = 'expert' THEN FALSE
    WHEN EXISTS (
      SELECT 1 FROM property_unlocks pu
      WHERE pu.user_id = uc.uid AND pu.property_id = r.id
    ) THEN FALSE
    WHEN uc.plan = 'pro'     AND r.rank_in_batch <= 25 THEN FALSE
    WHEN uc.plan = 'starter' AND r.rank_in_batch <= 10 THEN FALSE
    ELSE TRUE
  END AS locked
FROM ranked r, user_ctx uc
WHERE
  uc.is_admin
  OR (uc.plan = 'expert'             AND r.approved_at <= NOW())
  OR (uc.plan IN ('starter','pro')   AND r.public_at   <= NOW());

GRANT SELECT ON visible_properties TO authenticated;

-- ── 6. CONVENIENCE: locked-card payload (what a Starter sees on a locked row) ─
-- Same as visible_properties but financial fields nulled out when locked,
-- so client code can render straight from this view without per-row gating.
CREATE OR REPLACE VIEW visible_properties_safe AS
SELECT
  v.id, v.parcel_id, v.county, v.address, v.city, v.state, v.zip,
  v.property_type, v.beds, v.baths, v.sqft, v.year_built, v.lot_size,
  v.auction_date, v.min_bid, v.deal_score,
  v.batch_id, v.created_at, v.updated_at,
  v.locked, v.user_plan, v.user_is_admin, v.rank_in_batch,
  -- Financials revealed only when unlocked
  CASE WHEN v.locked THEN NULL ELSE v.tax_due       END AS tax_due,
  CASE WHEN v.locked THEN NULL ELSE v.arv           END AS arv,
  CASE WHEN v.locked THEN NULL ELSE v.rehab_cost    END AS rehab_cost,
  CASE WHEN v.locked THEN NULL ELSE v.all_in_cost   END AS all_in_cost,
  CASE WHEN v.locked THEN NULL ELSE v.net_profit    END AS net_profit,
  CASE WHEN v.locked THEN NULL ELSE v.roi_pct       END AS roi_pct,
  CASE WHEN v.locked THEN NULL ELSE v.max_bid       END AS max_bid,
  CASE WHEN v.locked THEN NULL ELSE v.risk_score    END AS risk_score,
  CASE WHEN v.locked THEN NULL ELSE v.crime_score   END AS crime_score,
  CASE WHEN v.locked THEN NULL ELSE v.flood_zone    END AS flood_zone,
  CASE WHEN v.locked THEN NULL ELSE v.comp_count    END AS comp_count,
  CASE WHEN v.locked THEN NULL ELSE v.arv_confidence END AS arv_confidence
FROM visible_properties v;

GRANT SELECT ON visible_properties_safe TO authenticated;
