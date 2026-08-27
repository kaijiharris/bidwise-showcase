-- 028: subscriptions.provider + revenuecat_subscription_id (RevenueCat reconciliation)
-- ==========================================================================================
-- App Store prep step 2 of 3 — directives/revenuecat_reconciliation_scope.md.
-- An iOS in-app purchase is recorded by the revenuecat-webhook edge function as
-- a subscriptions row with provider='revenuecat', keyed by Apple's
-- original_transaction_id (stable across renewals → the upsert conflict key).
-- Existing rows keep provider='stripe'; stripe_* columns stay NULL on RC rows
-- (they are already nullable in 001).
--
-- Idempotent. Additive. Safe on live data (constraint adds are guarded like
-- migration 010's PK add).

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_provider_check'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_provider_check
      CHECK (provider IN ('stripe', 'revenuecat'));
  END IF;
END $$;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS revenuecat_subscription_id TEXT;

-- UNIQUE is required: the webhook upserts ON CONFLICT (revenuecat_subscription_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_revenuecat_subscription_id_key'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_revenuecat_subscription_id_key
      UNIQUE (revenuecat_subscription_id);
  END IF;
END $$;

COMMENT ON COLUMN public.subscriptions.provider IS
  'Billing system of record for this row: stripe (web checkout) or revenuecat (iOS IAP via revenuecat-webhook).';
COMMENT ON COLUMN public.subscriptions.revenuecat_subscription_id IS
  'RevenueCat original_transaction_id — stable per Apple subscription across renewals; upsert conflict key for the revenuecat-webhook edge function.';
