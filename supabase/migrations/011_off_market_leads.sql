-- 011_off_market_leads.sql
--
-- Canonical home for the off-market deal-engine tables. These were previously
-- only defined under web/supabase/migrations/ (001_off_market_leads.sql +
-- 002_off_market_leads_expansion.sql) — a second, separate migration dir that
-- the canonical supabase/ CLI does not apply. They ARE queried in production by
-- both the web app and the mobile app:
--   off_market_leads, watchlists, watchlist_leads, lead_pipeline
-- plus the safe view `visible_off_market_leads_safe` (which had no migration
-- anywhere). This brings all of them under supabase/migrations/ so the schema
-- is single-sourced.
--
-- Everything is IF NOT EXISTS / idempotent, so applying this in an environment
-- where the web/supabase/ migrations already ran is a no-op.

-- shared updated_at trigger fn (matches web/supabase/migrations/001)
CREATE OR REPLACE FUNCTION public.bw_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 1. OFF-MARKET LEADS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.off_market_leads (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at              TIMESTAMPTZ DEFAULT now() NOT NULL,
  address                 TEXT        NOT NULL,
  city                    TEXT,
  state                   TEXT        DEFAULT 'GA',
  zip_code                TEXT,
  county                  TEXT,
  estimated_equity        NUMERIC,
  mortgage_balance        NUMERIC,
  owner_type              TEXT,
  years_owned             INTEGER,
  open_liens              INTEGER,
  foreclosure_status      TEXT,
  listing_status          TEXT,
  last_sold_price         NUMERIC,
  last_sold_date          TEXT,
  assessed_value          NUMERIC,
  tax_amount              NUMERIC,
  propstream_found        BOOLEAN       DEFAULT FALSE,
  equity_tier             TEXT          CHECK (equity_tier IN (
                                          'HIGH_EQUITY','MED_EQUITY',
                                          'LOW_EQUITY','UNDERWATER','UNKNOWN')),
  deal_score              INTEGER       CHECK (deal_score >= 0 AND deal_score <= 100),
  deal_type               TEXT          CHECK (deal_type IN (
                                          'flip','wholesale','rental',
                                          'buy_and_hold','distressed','unknown')),
  distress_signals        JSONB         DEFAULT '[]',
  propstream_enriched_at  TIMESTAMPTZ,
  propstream_error        TEXT,
  source                  TEXT          DEFAULT 'propstream',
  batch_id                TEXT,
  ai_brief                TEXT,
  ai_brief_generated_at   TIMESTAMPTZ,
  -- expansion fields (web/supabase/migrations/002)
  mailing_address         TEXT,
  mailing_city            TEXT,
  mailing_state           TEXT,
  mailing_zip             TEXT,
  owner_name              TEXT,
  owner_phone             TEXT,
  owner_email             TEXT,
  year_built              INTEGER,
  building_sqft           INTEGER,
  beds                    INTEGER,
  baths                   NUMERIC,
  est_value               NUMERIC,
  UNIQUE (user_id, address, zip_code)
);

-- The expansion columns are also added defensively for environments where the
-- table already existed before this consolidated migration.
ALTER TABLE public.off_market_leads
  ADD COLUMN IF NOT EXISTS mailing_address TEXT,
  ADD COLUMN IF NOT EXISTS mailing_city TEXT,
  ADD COLUMN IF NOT EXISTS mailing_state TEXT,
  ADD COLUMN IF NOT EXISTS mailing_zip TEXT,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_phone TEXT,
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS year_built INTEGER,
  ADD COLUMN IF NOT EXISTS building_sqft INTEGER,
  ADD COLUMN IF NOT EXISTS beds INTEGER,
  ADD COLUMN IF NOT EXISTS baths NUMERIC,
  ADD COLUMN IF NOT EXISTS est_value NUMERIC;

DROP TRIGGER IF EXISTS off_market_leads_updated_at ON public.off_market_leads;
CREATE TRIGGER off_market_leads_updated_at
  BEFORE UPDATE ON public.off_market_leads
  FOR EACH ROW EXECUTE FUNCTION public.bw_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_oml_user_id      ON public.off_market_leads (user_id);
CREATE INDEX IF NOT EXISTS idx_oml_county       ON public.off_market_leads (county);
CREATE INDEX IF NOT EXISTS idx_oml_deal_score   ON public.off_market_leads (deal_score DESC);
CREATE INDEX IF NOT EXISTS idx_oml_equity_tier  ON public.off_market_leads (equity_tier);
CREATE INDEX IF NOT EXISTS idx_oml_deal_type    ON public.off_market_leads (deal_type);
CREATE INDEX IF NOT EXISTS idx_oml_created_at   ON public.off_market_leads (created_at DESC);

ALTER TABLE public.off_market_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own leads"   ON public.off_market_leads;
DROP POLICY IF EXISTS "Users insert own leads" ON public.off_market_leads;
DROP POLICY IF EXISTS "Users update own leads" ON public.off_market_leads;
DROP POLICY IF EXISTS "Users delete own leads" ON public.off_market_leads;
DROP POLICY IF EXISTS "Service role full access to leads" ON public.off_market_leads;

CREATE POLICY "Users see own leads"   ON public.off_market_leads
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own leads" ON public.off_market_leads
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own leads" ON public.off_market_leads
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own leads" ON public.off_market_leads
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role full access to leads" ON public.off_market_leads
  FOR ALL USING (auth.role() = 'service_role');

-- ── 2. WATCHLISTS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.watchlists (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  name          TEXT        NOT NULL,
  description   TEXT,
  criteria      JSONB       NOT NULL DEFAULT '{}',
  alert_email   BOOLEAN     DEFAULT TRUE,
  alert_sms     BOOLEAN     DEFAULT FALSE,
  is_active     BOOLEAN     DEFAULT TRUE
);

DROP TRIGGER IF EXISTS watchlists_updated_at ON public.watchlists;
CREATE TRIGGER watchlists_updated_at
  BEFORE UPDATE ON public.watchlists
  FOR EACH ROW EXECUTE FUNCTION public.bw_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON public.watchlists (user_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_active  ON public.watchlists (is_active) WHERE is_active = TRUE;

ALTER TABLE public.watchlists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own watchlists"            ON public.watchlists;
DROP POLICY IF EXISTS "Service role full access to watchlists" ON public.watchlists;
CREATE POLICY "Users manage own watchlists" ON public.watchlists
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access to watchlists" ON public.watchlists
  FOR ALL USING (auth.role() = 'service_role');

-- ── 3. WATCHLIST_LEADS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.watchlist_leads (
  watchlist_id  UUID        REFERENCES public.watchlists(id) ON DELETE CASCADE NOT NULL,
  lead_id       UUID        REFERENCES public.off_market_leads(id) ON DELETE CASCADE NOT NULL,
  matched_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  notified      BOOLEAN     DEFAULT FALSE,
  PRIMARY KEY (watchlist_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_wl_lead_id  ON public.watchlist_leads (lead_id);
CREATE INDEX IF NOT EXISTS idx_wl_notified ON public.watchlist_leads (notified) WHERE notified = FALSE;

ALTER TABLE public.watchlist_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own watchlist matches"            ON public.watchlist_leads;
DROP POLICY IF EXISTS "Service role full access to watchlist_leads" ON public.watchlist_leads;
CREATE POLICY "Users see own watchlist matches" ON public.watchlist_leads
  FOR SELECT TO authenticated
  USING (watchlist_id IN (SELECT id FROM public.watchlists WHERE user_id = auth.uid()));
CREATE POLICY "Service role full access to watchlist_leads" ON public.watchlist_leads
  FOR ALL USING (auth.role() = 'service_role');

-- ── 4. LEAD_PIPELINE ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_pipeline (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lead_id       UUID        REFERENCES public.off_market_leads(id) ON DELETE CASCADE NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  stage         TEXT        NOT NULL DEFAULT 'new'
                            CHECK (stage IN ('new','qualified','outreach',
                                   'negotiating','under_contract','closed','dead')),
  notes         TEXT,
  assigned_to   TEXT,
  activity_log  JSONB       DEFAULT '[]',
  UNIQUE (user_id, lead_id)
);

DROP TRIGGER IF EXISTS lead_pipeline_updated_at ON public.lead_pipeline;
CREATE TRIGGER lead_pipeline_updated_at
  BEFORE UPDATE ON public.lead_pipeline
  FOR EACH ROW EXECUTE FUNCTION public.bw_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_lp_user_id ON public.lead_pipeline (user_id);
CREATE INDEX IF NOT EXISTS idx_lp_stage   ON public.lead_pipeline (stage);
CREATE INDEX IF NOT EXISTS idx_lp_lead_id ON public.lead_pipeline (lead_id);

ALTER TABLE public.lead_pipeline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own lead pipeline"          ON public.lead_pipeline;
DROP POLICY IF EXISTS "Service role full access to lead_pipeline" ON public.lead_pipeline;
CREATE POLICY "Users manage own lead pipeline" ON public.lead_pipeline
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access to lead_pipeline" ON public.lead_pipeline
  FOR ALL USING (auth.role() = 'service_role');

-- ── 5. SAFE VIEW: visible_off_market_leads_safe ──────────────────────────────
-- The leads feed (web + mobile) reads this view. It exposes only non-sensitive
-- summary columns, plus a `locked` flag and `user_plan`, mirroring the auction
-- visible_properties_safe pattern. Owner PII (name/phone/email/mailing) is NOT
-- exposed here. RLS on off_market_leads already scopes rows to the owner; the
-- view is security_invoker so it runs with the caller's privileges.
CREATE OR REPLACE VIEW public.visible_off_market_leads_safe
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.address,
  l.city,
  l.state,
  l.zip_code,
  l.county,
  l.estimated_equity,
  l.owner_type,
  l.years_owned,
  l.open_liens,
  l.foreclosure_status,
  l.equity_tier,
  l.deal_score,
  l.deal_type,
  l.distress_signals,
  l.propstream_found,
  l.created_at,
  -- Off-market leads are user-owned data the user already paid to ingest, so
  -- they are never locked for their owner. The column exists for client parity
  -- with the auction feed.
  FALSE AS locked,
  COALESCE(
    (SELECT plan FROM public.subscriptions s
      WHERE s.user_id = auth.uid()
        AND s.status IN ('trialing','active')
      ORDER BY s.current_period_end DESC NULLS LAST
      LIMIT 1),
    'none'
  ) AS user_plan
FROM public.off_market_leads l;

GRANT SELECT ON public.visible_off_market_leads_safe TO authenticated;
