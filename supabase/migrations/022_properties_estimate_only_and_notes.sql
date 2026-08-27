-- 022_properties_estimate_only_and_notes.sql
--
-- Close the pipeline -> Supabase data-contract gap: push_to_supabase.py now
-- upserts the full guardrail/trust signal set, but two of those fields never
-- had columns:
--
--   * estimate_only  — the land model's "never ranks" flag (deal_score is
--     hard-set to 0 and roi_percent is a rough heuristic, not a scoreable
--     signal). Consumers exclude these rows from ranked lists.
--   * analysis_notes — the pipeline's human-readable reasoning trail
--     (pipe-separated stipulations, ARV caveats, error notes).
--
-- Also REBUILDS visible_properties + visible_properties_safe. This is
-- load-bearing, not cosmetic: visible_properties is defined as SELECT p.*
-- (migration 002), and a view's * expands at CREATE time. Migration 020 added
-- score_tier / is_no_bid / no_bid_reason / roi_if_* to `properties` and
-- referenced them as v.<col> in visible_properties_safe WITHOUT recreating the
-- base view — on a database where visible_properties still has its 002 shape,
-- 020's CREATE OR REPLACE of the _safe view fails ("column v.score_tier does
-- not exist"). DROP + CREATE of both views (in dependency order) re-expands
-- p.* and makes this migration self-sufficient regardless of whether 020's
-- view half applied.
--
-- DROP (not CREATE OR REPLACE) is intentional for the rebuild: OR REPLACE
-- cannot reorder or insert view columns, and re-expanding p.* moves the
-- computed columns (rank_in_batch/user_plan/user_is_admin/locked) to new
-- positions. Both views are plain (non-materialized) reads with no dependent
-- objects; grants + security_invoker are re-asserted below, so a DROP loses
-- nothing.
--
-- Deploy order: apply this BEFORE the next push_to_supabase.py run — the
-- upsert payload now carries estimate_only/analysis_notes and PostgREST
-- rejects unknown columns.
--
-- Forward-only, idempotent, ADDITIVE on the table (new nullable columns; old
-- rows get NULL = "pipeline never screened this row" and must render
-- unsuppressed).
--
-- Depends on: 001 (properties), 002 (both views), 004/014 (security_invoker
-- posture), 020 (Wave-3 columns exposed in the _safe view).

-- ── 1. New columns on `properties` (additive, nullable) ──────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS estimate_only  BOOLEAN,
  ADD COLUMN IF NOT EXISTS analysis_notes TEXT;

COMMENT ON COLUMN public.properties.estimate_only IS
  'Land-model flag: valuation is a rough heuristic and deal_score is hard-set '
  'to 0 — the parcel must never appear in a ranked/top list. NULL = row '
  'predates the flag (treat as not screened).';
COMMENT ON COLUMN public.properties.analysis_notes IS
  'Pipeline reasoning trail (pipe-separated stipulations / ARV caveats). '
  'Financial detail — masked on locked rows in visible_properties_safe.';

-- ── 2. Rebuild visible_properties (fresh p.* expansion; body = migration 002
--       verbatim, tier gating and lock semantics unchanged) ──────────────────
DROP VIEW IF EXISTS public.visible_properties_safe;
DROP VIEW IF EXISTS public.visible_properties;

CREATE VIEW public.visible_properties AS
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

ALTER VIEW public.visible_properties SET (security_invoker = on);
GRANT SELECT ON public.visible_properties TO authenticated;

-- ── 3. Rebuild visible_properties_safe (migration 020 body + the two new
--       fields appended at the end, keeping client-facing column order) ──────
-- estimate_only is a guardrail/trust signal like is_no_bid — ALWAYS visible,
-- even on locked rows, so a user is never nudged to unlock a land-heuristic
-- parcel. analysis_notes embeds ARV/cost reasoning — a financial, masked to
-- NULL on locked rows exactly like roi_pct.
CREATE VIEW public.visible_properties_safe AS
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
  CASE WHEN v.locked THEN NULL ELSE v.arv_confidence END AS arv_confidence,
  -- Wave 3: trust / guardrail signals — visible even when locked.
  v.score_tier                                       AS score_tier,
  v.is_no_bid                                         AS is_no_bid,
  v.no_bid_reason                                     AS no_bid_reason,
  -- Wave 3: redemption dual-ROI — financials, masked on locked rows.
  CASE WHEN v.locked THEN NULL ELSE v.roi_if_redeemed_year1_pct END AS roi_if_redeemed_year1_pct,
  CASE WHEN v.locked THEN NULL ELSE v.roi_if_deed_matures       END AS roi_if_deed_matures,
  -- 022: land-model flag (always visible) + reasoning trail (masked).
  v.estimate_only                                     AS estimate_only,
  CASE WHEN v.locked THEN NULL ELSE v.analysis_notes            END AS analysis_notes
FROM visible_properties v;

ALTER VIEW public.visible_properties_safe SET (security_invoker = on);
GRANT SELECT ON public.visible_properties_safe TO authenticated;

COMMENT ON VIEW public.visible_properties_safe IS
  'Locked-card payload: visible_properties with financials nulled on locked '
  'rows. Wave 3 adds score_tier / is_no_bid / no_bid_reason (always visible) '
  'and roi_if_redeemed_year1_pct / roi_if_deed_matures (masked when locked). '
  '022 adds estimate_only (always visible) and analysis_notes (masked).';
