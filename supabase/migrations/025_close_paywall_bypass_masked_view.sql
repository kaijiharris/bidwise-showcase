-- 025_close_paywall_bypass_masked_view.sql
--
-- CRITICAL (2026-07-17 database review): any active subscriber could bypass
-- the top-10/top-25 tier caps by querying PostgREST directly:
--
--   GET {SUPABASE_URL}/rest/v1/visible_properties?select=roi_pct,max_bid,...
--   GET {SUPABASE_URL}/rest/v1/properties?select=*
--
-- Root cause, three surfaces:
--   1. visible_properties (002, rebuilt verbatim in 022) returned EVERY
--      properties column unmasked (tax_due / arv / rehab_cost / net_profit /
--      roi_pct / max_bid / analysis_notes / admin_notes / ...) with `locked`
--      merely advisory — and was GRANTed to authenticated.
--   2. Both views ran WITH (security_invoker = on) (004/014), which forces the
--      caller to hold transitive SELECT on visible_properties AND on the raw
--      properties table for visible_properties_safe to work at all — so the
--      unmasked base view and the table HAD to stay readable. A simple REVOKE
--      breaks the app.
--   3. The properties RLS SELECT policy (001, "Subscribers see published
--      properties") checks only published + any active/trialing subscription —
--      no tier — so RLS never stops the read either.
--
-- Fix (collapse + definer boundary):
--   * DROP visible_properties entirely. Nothing queries it (verified by grep:
--     web + mobile + edge functions consume only visible_properties_safe).
--   * Recreate visible_properties_safe as ONE self-contained view that ranks,
--     entitles, and masks in a single body. It deliberately runs WITHOUT
--     security_invoker (definer semantics; owner = postgres) so callers no
--     longer need — and no longer receive — any privilege on the underlying
--     tables. The body itself enforces everything the invoker chain used to:
--       - visibility: approved + published + (admin | expert w/ approved_at |
--         starter/pro w/ public_at) — the 002/022 WHERE, verbatim;
--       - per-user scoping: every subquery filters on auth.uid(), which is
--         derived from the request JWT (not the role), so definer semantics
--         leak nothing across users. Anon (uid NULL) matches no visibility
--         branch → zero rows, and holds no grant anyway.
--     security_barrier = on keeps non-leakproof user predicates from being
--     pushed below the entitlement filter. Note: even leakproof eq/in
--     filters (county/auction_date/id) never reach a properties index
--     through this view anyway — Postgres refuses to push quals into a
--     subquery level containing a window function (ranked's ROW_NUMBER()),
--     so every query ranks the full approved+published set first, then
--     filters. Fine at current few-thousand-row scale (inherited shape from
--     002/022, not new here); if the input set grows materially, add:
--       CREATE INDEX idx_properties_batch_rank ON public.properties
--         (batch_id, deal_score DESC NULLS LAST, id)
--         WHERE review_status = 'approved' AND published = TRUE;
--   * DROP the tier-blind subscriber SELECT policy on properties AND REVOKE
--     SELECT on properties from anon/authenticated. Two independent locks:
--     either alone closes the direct-table read; together they survive future
--     grant or policy drift. service_role (pipeline upserts, server API
--     routes) is untouched. "Admins full access" RLS stays: it documents
--     intent and still governs writes should a write grant ever return.
--
-- LOW finding folded in: visible_properties_safe never exposed auction_status
-- / removed_at (added to properties in 007), so the dashboard's Supabase path
-- defaulted every row to 'active' and the "Removed — unlock refunded" badge
-- could only fire on the JSON path. Both columns are appended at the end,
-- ALWAYS visible (locked or not): removal state is operational, not
-- financial — a locked row must still show why it left the list, and its
-- unlock refund must be explainable.
--
-- Consumer audit (2026-07-17):
--   * web/app/dashboard/DashboardClient.tsx — Supabase path selects * from
--     visible_properties_safe (new columns flow automatically; the row mapper
--     already reads auction_status / removed_at). Its legacy flag-off
--     unlock-hydrate read of `properties` is repointed to this view in the
--     same PR; the previously-deployed bundle degrades gracefully (try/catch
--     → localStorage fallback) during the deploy window.
--   * web/app/api/export/route.ts — visible_properties_safe with an explicit
--     column list; every column preserved verbatim here.
--   * web/lib/data-access.ts — reads properties with the service-role client;
--     unaffected.
--   * mobile/ (Expo, shipping) — consumes /api/data/* only; unaffected.
--   * bidwise_invest/ (Flutter, DORMANT, never shipped) — read properties
--     directly with user JWTs and enforced no tier caps; those reads now get
--     permission denied. Intended: that path WAS the leak. Repoint it to
--     visible_properties_safe if that app is ever revived.
--
-- Replay note: supersedes the view sections of 020 (§2) and 022 (§§2–3). On a
-- from-scratch replay run 001..022 first (skipping 020 §2 per its own header),
-- then this file. The CREATE VIEW below fails loudly if properties is missing
-- the 007 / 020 §1 / 022 §1 columns — that is the dependency signal. Do NOT
-- set FORCE ROW LEVEL SECURITY on properties without revisiting this view:
-- the owner (postgres) must keep bypassing RLS for the definer body to see
-- rows at all.
--
-- ── DEPLOY (prod — Supabase Management API; memory: supabase-prod-ddl) ───────
--  0. Preflight (read-only, POST /v1/projects/{ref}/database/query):
--       SELECT column_name FROM information_schema.columns
--        WHERE table_schema='public' AND table_name='properties'
--          AND column_name IN ('auction_status','removed_at','score_tier',
--                              'estimate_only','analysis_notes');
--     → must return all 5 rows (007 + 020 §1 + 022 §1 applied). Also snapshot
--       what you are replacing:
--       SELECT viewname   FROM pg_views    WHERE schemaname='public'
--                                            AND viewname LIKE 'visible_properties%';
--       SELECT policyname FROM pg_policies WHERE tablename='properties';
--  1. Apply this WHOLE file as one query (single transaction):
--       POST https://api.supabase.com/v1/projects/{ref}/database/query
--       Authorization: Bearer $SUPABASE_PAT     {"query": "<this file>"}
--  2. Verify:
--       a. SELECT viewname FROM pg_views WHERE schemaname='public'
--            AND viewname LIKE 'visible_properties%';
--          → ONLY visible_properties_safe remains.
--       b. SELECT c.reloptions FROM pg_class c
--            JOIN pg_namespace n ON n.oid = c.relnamespace
--           WHERE n.nspname='public' AND c.relname='visible_properties_safe';
--          → contains security_barrier=on AND security_invoker=off.
--       c. SELECT grantee, privilege_type
--            FROM information_schema.role_table_grants
--           WHERE table_schema='public'
--             AND table_name IN ('properties','visible_properties_safe')
--             AND grantee IN ('anon','authenticated');
--          → properties: NO SELECT rows; view: authenticated SELECT only.
--       d. Functional, with a real Starter-user JWT:
--            GET /rest/v1/properties?select=id&limit=1          → permission denied (42501)
--            GET /rest/v1/visible_properties?select=id&limit=1  → 404 (relation gone)
--            GET /rest/v1/visible_properties_safe?select=id,locked,roi_pct,tax_due,auction_status&limit=100
--              → rows return; EVERY locked=true row has roi_pct/tax_due NULL.
--     (PostgREST reloads its schema cache on DDL; if stale, run
--      NOTIFY pgrst, 'reload schema';)
--  3. Order vs web deploy: apply this migration FIRST, then ship the web
--     bundle with the DashboardClient repoint.
--
-- ── ROLLBACK (restores the vulnerable-but-working 022 state) ─────────────────
--  1. Re-run 022 §§2–3 (recreates both security_invoker views + grants).
--  2. Recreate the subscriber policy (body verbatim from 001; drop-first so
--     the rollback itself is re-run-safe — CREATE POLICY has no OR REPLACE):
--       DROP POLICY IF EXISTS "Subscribers see published properties" ON public.properties;
--       CREATE POLICY "Subscribers see published properties" ON public.properties
--         FOR SELECT TO authenticated
--         USING (published = TRUE AND EXISTS (
--           SELECT 1 FROM subscriptions s
--           WHERE s.user_id = auth.uid() AND s.status IN ('trialing','active')));
--  3. GRANT SELECT ON public.properties TO anon, authenticated;
--     (deliberately SELECT-only: the pre-025 default-privilege write grants
--      were never needed by any client and are not restored)
--
-- Forward-only, idempotent, safe to re-run.

-- ── 1. Collapse: drop both views (dependents first) ──────────────────────────
DROP VIEW IF EXISTS public.visible_properties_safe;
DROP VIEW IF EXISTS public.visible_properties;

-- ── 2. The single masked surface ─────────────────────────────────────────────
-- Body = 022's visible_properties (user_ctx / ranked / lock CASE / visibility
-- WHERE, verbatim) folded into the 022 _safe column contract, + auction_status
-- and removed_at appended. security_invoker stays OFF on purpose — see header.
CREATE VIEW public.visible_properties_safe
WITH (security_invoker = off, security_barrier = on) AS
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
),
entitled AS (
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
    OR (uc.plan IN ('starter','pro')   AND r.public_at   <= NOW())
)
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
  CASE WHEN v.locked THEN NULL ELSE v.analysis_notes            END AS analysis_notes,
  -- 025 (LOW fix): removal state — operational, never masked. Powers the
  -- "Removed — unlock refunded" badge on the dashboard's Supabase path (007).
  v.auction_status                                    AS auction_status,
  v.removed_at                                        AS removed_at
FROM entitled v;

-- ── 3. Grants: exactly SELECT for authenticated, nothing else ────────────────
-- Supabase default privileges auto-grant broadly on CREATE; pin the final
-- state explicitly. service_role keeps its default grant (untouched).
REVOKE ALL ON public.visible_properties_safe FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.visible_properties_safe TO authenticated;

-- ── 4. Close the direct-table surface ────────────────────────────────────────
-- Lock 1: no tier-blind row policy. Lock 2: no table privileges at all —
-- ALL, not just SELECT: Supabase default privileges auto-granted client
-- writes at CREATE too, and those must not survive with RLS as their only
-- lock (2026-07-17 DB review; no client-side writes exist anywhere).
DROP POLICY IF EXISTS "Subscribers see published properties" ON public.properties;
REVOKE ALL ON public.properties FROM anon, authenticated;

COMMENT ON VIEW public.visible_properties_safe IS
  'THE ONLY client-readable properties surface (025). Self-contained definer '
  'view (security_invoker=off, security_barrier=on): ranks per batch, applies '
  'tier visibility windows, and NULLs financials on locked rows. Wave 3 adds '
  'score_tier / is_no_bid / no_bid_reason (always visible) and redemption '
  'dual-ROI (masked). 022 adds estimate_only (visible) + analysis_notes '
  '(masked). 025 adds auction_status / removed_at (always visible) and closes '
  'the direct properties / visible_properties PostgREST bypass.';
