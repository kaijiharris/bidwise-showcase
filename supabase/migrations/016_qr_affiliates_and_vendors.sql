-- 016_qr_affiliates_and_vendors.sql
--
-- QR-driven affiliate attribution + vendor waitlist (spec: brands/bidwise/
-- qr-flows-spec-2026-07-07.md in the internal-notes vault).
--
--   * affiliates            — partner registry; one Crockford-base32 code per
--                             partner (printed QR encodes /a/<code>).
--   * affiliate_events      — APPEND-ONLY attribution ledger: scan → signup →
--                             subscription_started → conversion_paid, with
--                             conversion_voided as the correction mechanism
--                             (never UPDATE/DELETE a ledger row).
--   * vendor_applications   — /vendors/apply intake queue for the future
--                             vendor marketplace (statuses pending → vetting →
--                             approved/rejected/waitlisted).
--   * user_profiles         — + referred_by_code / referred_at (first-write-wins
--                             stamp made by /auth/callback from the bw_aff cookie).
--   * app_config            — + vendor_qr_codes JSONB allowlist for /v/<code>
--                             (013's app_config is a typed singleton row, not a
--                             KV table, so the allowlist is a column on it).
--
-- Trust model: RLS enabled, NO anon/authenticated write policies anywhere —
-- every write goes through a route handler using the service-role key (same
-- model as the Stripe webhook / processed_stripe_events in 013). Admin
-- visibility uses public.is_admin() (009 — never inline the role subquery;
-- it recurses on user_profiles).
--
-- Depends on: 001 (user_profiles), 009 (is_admin), 011 (bw_set_updated_at),
-- 013 (app_config). Idempotent / additive. No raw IPs are ever stored — only
-- sha256(ip + AFF_IP_SALT) hashes.

-- ── 1. affiliates ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.affiliates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- <2-char human prefix>-<6 Crockford base32 chars> e.g. AJ-7K2MQ4.
  -- Crockford set excludes I, L, O, U to avoid misreads on printed material.
  code              TEXT NOT NULL UNIQUE
                      CHECK (code ~ '^[A-Z]{2}-[0-9A-HJKMNP-TV-Z]{6}$'),
  display_name      TEXT NOT NULL,
  email             TEXT NOT NULL,            -- payout contact + self-referral guard
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- if the affiliate also has a BidWise account
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'paused', 'terminated')),
  -- Compensation config. Launch model is percent-of-collected: the affiliate
  -- earns commission_pct of every collected invoice for a referred customer's
  -- first commission_months months, paid on collection (see the affiliate-comp
  -- model doc 2026-07-07). flat_bounty remains a valid model for back-compat,
  -- but new affiliates default to the pct model — no schema change needed to
  -- switch an existing row, only these three field values.
  commission_model  TEXT NOT NULL DEFAULT 'pct_first_n_months'
                      CHECK (commission_model IN ('flat_bounty', 'pct_first_n_months')),
  commission_flat_cents INTEGER NOT NULL DEFAULT 0,      -- flat model only; unused by the pct default
  commission_pct        NUMERIC(5,2) DEFAULT 20.00,      -- pct model: 20% of each collected invoice
  commission_months     INTEGER DEFAULT 12,              -- pct model window: first 12 months
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS affiliates_updated_at ON public.affiliates;
CREATE TRIGGER affiliates_updated_at
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.bw_set_updated_at();

-- ── 2. affiliate_events — append-only attribution ledger ─────────────────────
CREATE TABLE IF NOT EXISTS public.affiliate_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id  UUID REFERENCES public.affiliates(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL
                  CHECK (event_type IN ('scan', 'signup', 'subscription_started',
                                        'conversion_paid', 'conversion_voided')),
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_subscription_id TEXT,
  plan          TEXT,                     -- snapshot at event time
  billing_cycle TEXT,
  -- Commission fields are FROZEN from the affiliates row at conversion time so
  -- later config changes never rewrite history. Payout math =
  -- conversion_paid minus conversion_voided per subscription.
  commission_model      TEXT,
  commission_flat_cents INTEGER,
  commission_pct        NUMERIC(5,2),
  commission_months     INTEGER,
  ip_hash       TEXT,                     -- sha256(ip + AFF_IP_SALT); never raw IP
  user_agent    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { dedup, void_reason, invoice_id, ... }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_events_affiliate_created
  ON public.affiliate_events (affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_events_type
  ON public.affiliate_events (event_type);
CREATE INDEX IF NOT EXISTS idx_affiliate_events_user
  ON public.affiliate_events (user_id) WHERE user_id IS NOT NULL;
-- One subscription STARTS at most once — webhook retries and redeliveries
-- collide here with 23505, which the handler treats as dedup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_events_sub_started
  ON public.affiliate_events (stripe_subscription_id, event_type)
  WHERE stripe_subscription_id IS NOT NULL
    AND event_type = 'subscription_started';
-- conversion_paid is per-INVOICE, not per-subscription: the pct-of-collected
-- model records one conversion_paid per paid invoice inside the 12-month
-- window, so idempotency keys on metadata.invoice_id (webhook retries for the
-- same invoice collide with 23505 = dedup). A subscription can therefore have
-- up to 12 conversion_paid rows (one per monthly invoice), each a distinct
-- invoice_id, exactly as the payout math requires.
CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_events_conv_invoice
  ON public.affiliate_events (stripe_subscription_id, (metadata->>'invoice_id'))
  WHERE stripe_subscription_id IS NOT NULL
    AND event_type = 'conversion_paid';

-- ── 3. attribution on the user ────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS referred_by_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_at      TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_user_profiles_referred_by
  ON public.user_profiles (referred_by_code) WHERE referred_by_code IS NOT NULL;

-- ── 4. vendor QR allowlist on the app_config singleton ───────────────────────
-- /v/<code> checks membership here; unknown codes still land on the public
-- application form, just without a src attribution.
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS vendor_qr_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── 5. vendor_applications ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendor_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name   TEXT NOT NULL,
  -- Fixed enum via CHECK, not a Postgres ENUM type — CHECKs are cheaper to
  -- extend in later migrations (this repo has no ENUM types today).
  category        TEXT NOT NULL
                    CHECK (category IN ('general_contractor','roofing','plumbing',
                      'electrical','hvac','landscaping','cleaning_hauling',
                      'inspection','title_closing','lending','insurance',
                      'property_management','other')),
  service_counties TEXT[] NOT NULL DEFAULT '{}',
  license_number  TEXT,
  is_insured      BOOLEAN NOT NULL DEFAULT FALSE,
  years_in_business INTEGER CHECK (years_in_business >= 0 AND years_in_business < 100),
  website         TEXT,
  phone           TEXT NOT NULL,
  email           TEXT NOT NULL,
  referral_source TEXT,                    -- free-text "how did you hear about us"
  src_code        TEXT,                    -- the /v/<code> the QR carried, if any
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','vetting','approved','rejected','waitlisted')),
  admin_notes     TEXT,
  ip_hash         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live application per email+category; resubmission updates the row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_app_email_category
  ON public.vendor_applications (lower(email), category);
CREATE INDEX IF NOT EXISTS idx_vendor_app_status
  ON public.vendor_applications (status, created_at DESC);

DROP TRIGGER IF EXISTS vendor_applications_updated_at ON public.vendor_applications;
CREATE TRIGGER vendor_applications_updated_at
  BEFORE UPDATE ON public.vendor_applications
  FOR EACH ROW EXECUTE FUNCTION public.bw_set_updated_at();

-- ── 6. RLS: deny-by-default; service role bypasses RLS; admins read/manage ───
ALTER TABLE public.affiliates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_applications ENABLE ROW LEVEL SECURITY;

-- NO anon/authenticated INSERT policies anywhere: every write goes through a
-- route handler using the service-role client (same trust model as the Stripe
-- webhook). Admin visibility uses public.is_admin() (migration 009 — never
-- inline the role subquery; it recurses on user_profiles).
DROP POLICY IF EXISTS "Admins manage affiliates" ON public.affiliates;
CREATE POLICY "Admins manage affiliates" ON public.affiliates
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Ledger is append-only even for admins: SELECT only. Corrections are new
-- conversion_voided rows written by the service role, never edits.
DROP POLICY IF EXISTS "Admins read affiliate events" ON public.affiliate_events;
CREATE POLICY "Admins read affiliate events" ON public.affiliate_events
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins manage vendor applications" ON public.vendor_applications;
CREATE POLICY "Admins manage vendor applications" ON public.vendor_applications
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
