-- 020_deal_engine_confidence_fields.sql
--
-- ⚠ REPLAY NOTE (2026-07-17): the CREATE OR REPLACE VIEW below references
-- v.score_tier etc., but visible_properties (SELECT p.*, frozen at CREATE
-- time per Postgres semantics) is never rebuilt here — so on a from-scratch
-- sequential replay this file ERRORS at the view statement ("column
-- v.score_tier does not exist"). Migration 022 rebuilds BOTH views and
-- supersedes section 2 of this file; when replaying a fresh database, run
-- section 1 (ALTER TABLE) of this file, skip its view recreate, and let 022
-- establish the views.
--
-- Deal-engine Wave 3 (presentation) data plumbing. Surfaces the confidence /
-- guardrail / redemption fields produced by the Wave 1+2 scoring engine so the
-- web card (components/PropertyCard.tsx + ConfidenceBadge) can render them.
--
-- Forward-only, idempotent, ADDITIVE:
--   * New nullable columns on `properties` — old rows get NULL, no backfill.
--   * `visible_properties_safe` recreated to expose them, keeping the exact
--     locked-masking pattern of the existing financial columns (migration 002).
--   * No existing column is changed or dropped.
--
-- `visible_properties` selects p.* (migration 002:154), so the new base columns
-- flow through it automatically — only the _safe convenience view needs the
-- per-column locked-mask CASE branches added here.
--
-- Depends on: 001 (properties, arv_confidence), 002 (both views),
-- 004/014 (security_invoker on the views).

-- ── 1. New engine columns on `properties` (additive, nullable) ───────────────
-- score_tier / arv_confidence describe trust in the score & valuation.
-- is_no_bid / no_bid_reason carry the guardrail screen-out (migration-independent
-- boolean + human reason). roi_if_* carry the tax-deed redemption dual-ROI so
-- the card can show "Redeemed (yr 1)" and "If deed matures" separately instead
-- of a single misleading blended number.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS score_tier                TEXT,
  ADD COLUMN IF NOT EXISTS is_no_bid                 BOOLEAN,
  ADD COLUMN IF NOT EXISTS no_bid_reason             TEXT,
  ADD COLUMN IF NOT EXISTS roi_if_redeemed_year1_pct NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS roi_if_deed_matures       NUMERIC(8,2);

-- ── 2. Recreate visible_properties_safe with the new columns exposed ─────────
-- Same body as migration 002 plus the Wave 3 fields. score_tier / is_no_bid /
-- no_bid_reason are NOT financials — they are always visible (a locked card
-- still needs to show "NO BID" / confidence so a user isn't nudged to unlock a
-- disqualified parcel). The redemption ROI figures ARE financials, so they are
-- masked to NULL on locked rows exactly like roi_pct.
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
  CASE WHEN v.locked THEN NULL ELSE v.arv_confidence END AS arv_confidence,
  -- Wave 3: trust / guardrail signals — visible even when locked.
  v.score_tier                                       AS score_tier,
  v.is_no_bid                                         AS is_no_bid,
  v.no_bid_reason                                     AS no_bid_reason,
  -- Wave 3: redemption dual-ROI — financials, masked on locked rows.
  CASE WHEN v.locked THEN NULL ELSE v.roi_if_redeemed_year1_pct END AS roi_if_redeemed_year1_pct,
  CASE WHEN v.locked THEN NULL ELSE v.roi_if_deed_matures       END AS roi_if_deed_matures
FROM visible_properties v;

-- Re-assert security_invoker (migrations 004/014) and the authenticated GRANT
-- so the recreate can never regress the RLS-respecting posture.
ALTER VIEW public.visible_properties_safe SET (security_invoker = on);
GRANT SELECT ON public.visible_properties_safe TO authenticated;

COMMENT ON VIEW public.visible_properties_safe IS
  'Locked-card payload: visible_properties with financials nulled on locked '
  'rows. Wave 3 adds score_tier / is_no_bid / no_bid_reason (always visible) '
  'and roi_if_redeemed_year1_pct / roi_if_deed_matures (masked when locked).';
