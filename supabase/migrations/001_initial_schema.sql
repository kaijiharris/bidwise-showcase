-- ============================================================
-- BidWise Invest — Initial Schema
-- Run this in the Supabase SQL editor for your project
-- ============================================================

-- ── PROPERTIES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id           TEXT        UNIQUE NOT NULL,
  county              TEXT        NOT NULL,
  address             TEXT,
  city                TEXT,
  state               TEXT        DEFAULT 'GA',
  zip                 TEXT,
  property_type       TEXT,

  -- Physical
  beds                INTEGER,
  baths               NUMERIC(4,1),
  sqft                INTEGER,
  year_built          INTEGER,
  lot_size            NUMERIC(10,2),

  -- Financial
  tax_due             NUMERIC(12,2),
  arv                 NUMERIC(12,2),
  rehab_cost          NUMERIC(12,2),
  all_in_cost         NUMERIC(12,2),
  net_profit          NUMERIC(12,2),
  roi_pct             NUMERIC(8,2),
  max_bid             NUMERIC(12,2),

  -- Auction
  auction_date        DATE,
  min_bid             NUMERIC(12,2),
  source              TEXT,
  source_url          TEXT,

  -- Scoring
  deal_score          NUMERIC(5,2),
  risk_score          NUMERIC(5,2),
  crime_score         NUMERIC(5,2),
  flood_zone          TEXT,
  comp_count          INTEGER,
  arv_confidence      TEXT,
  data_quality_score  NUMERIC(5,2),

  -- Batch / admin
  batch_id            UUID,
  published           BOOLEAN     DEFAULT FALSE,
  flagged             BOOLEAN     DEFAULT FALSE,
  admin_notes         TEXT,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── USER PROFILES ─────────────────────────────────────────────────────────────
-- Extends Supabase auth.users; created automatically on signup via trigger.
CREATE TABLE IF NOT EXISTS user_profiles (
  id               UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            TEXT,
  role             TEXT  DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  full_name        TEXT,
  county_preference TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── SUBSCRIPTIONS ─────────────────────────────────────────────────────────────
-- Synced from Stripe via webhook. Source of truth for access gating.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID  REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT  UNIQUE,
  plan                    TEXT  CHECK (plan IN ('starter', 'pro', 'expert')),
  status                  TEXT  CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  billing_cycle           TEXT  CHECK (billing_cycle IN ('monthly', 'annual')),
  trial_end               TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── SAVED PROPERTIES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_properties (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID  REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id  UUID  REFERENCES properties(id) ON DELETE CASCADE,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, property_id)
);

-- ── COUNTY RUNS ──────────────────────────────────────────────────────────────
-- Tracks each monthly batch cycle per county. Admins use this to manage
-- the pipeline: run analysis → review → publish.
CREATE TABLE IF NOT EXISTS county_runs (
  id                   UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  county               TEXT  NOT NULL,
  state                TEXT  DEFAULT 'GA',
  status               TEXT  CHECK (status IN ('not_started','processing','review','published','stale')) DEFAULT 'not_started',
  property_count       INTEGER DEFAULT 0,
  batch_id             UUID  DEFAULT gen_random_uuid(),
  next_auction_date    DATE,
  published_at         TIMESTAMPTZ,
  discovery_check_at   TIMESTAMPTZ,
  discovery_result     TEXT,  -- raw notes from weekly county scrape check
  notes                TEXT,
  run_date             TIMESTAMPTZ DEFAULT NOW(),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_properties_county      ON properties(county);
CREATE INDEX IF NOT EXISTS idx_properties_published   ON properties(published);
CREATE INDEX IF NOT EXISTS idx_properties_deal_score  ON properties(deal_score DESC);
CREATE INDEX IF NOT EXISTS idx_properties_batch_id    ON properties(batch_id);
CREATE INDEX IF NOT EXISTS idx_properties_auction_date ON properties(auction_date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id  ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status   ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_saved_props_user_id    ON saved_properties(user_id);

-- ── ROW-LEVEL SECURITY ────────────────────────────────────────────────────────
ALTER TABLE properties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE county_runs      ENABLE ROW LEVEL SECURITY;

-- Properties: published rows visible to active/trialing subscribers; admins see all
CREATE POLICY "Subscribers see published properties" ON properties
  FOR SELECT TO authenticated
  USING (
    published = TRUE
    AND EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.user_id = auth.uid()
        AND s.status IN ('trialing', 'active')
    )
  );

CREATE POLICY "Admins full access to properties" ON properties
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- User profiles: own row only; admins see all
CREATE POLICY "Users see own profile" ON user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users update own profile" ON user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins full access to profiles" ON user_profiles
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Subscriptions: own row only; admins see all
CREATE POLICY "Users see own subscription" ON subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins full access to subscriptions" ON subscriptions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Saved properties: users manage their own rows
CREATE POLICY "Users manage own saved properties" ON saved_properties
  FOR ALL TO authenticated
  USING (user_id = auth.uid());

-- County runs: admin only
CREATE POLICY "Admins manage county runs" ON county_runs
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── TRIGGERS ─────────────────────────────────────────────────────────────────

-- Auto-create user_profile on signup; assigns admin role to known team emails
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  admin_emails TEXT[] := ARRAY[
    'alerts@bidwiseinvest.com',
    'kaijiharris@bidwiseinvest.com',
    'trent@bidwiseinvest.com',
    'admin2@example.com'
  ];
BEGIN
  INSERT INTO user_profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN NEW.email = ANY(admin_emails) THEN 'admin' ELSE 'client' END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS properties_updated_at ON properties;
CREATE TRIGGER properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS county_runs_updated_at ON county_runs;
CREATE TRIGGER county_runs_updated_at
  BEFORE UPDATE ON county_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS user_profiles_updated_at ON user_profiles;
CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
