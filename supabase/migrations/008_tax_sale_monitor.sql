-- ════════════════════════════════════════════════════════════════════════════
-- Migration 008: Tax-sale listing monitor state
--
-- Persists the last observed state of each county's official tax-sale listing
-- so the `notify-tax-sale` Edge Function can diff each daily fetch against it
-- and alert (email + push) on three event types:
--   • new_date     — an auction date appears that we've never seen
--   • populated    — a known date's listing goes from empty to populated
--   • changed      — parcels are added to / removed from a known date
--
-- One row per (county, auction_date). The row IS the watermark: after an alert
-- is delivered, the row is advanced to the newly observed state so the same
-- change is never re-alerted (see the function's send-then-upsert gating).
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tax_sale_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  county          TEXT        NOT NULL,
  auction_date    DATE        NOT NULL,
  -- Sorted, de-duplicated parcel IDs observed for this (county, date).
  parcel_ids      TEXT[]      NOT NULL DEFAULT '{}',
  property_count  INTEGER     NOT NULL DEFAULT 0,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bumped only when the parcel set / count actually changes (the "watermark").
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per upcoming sale per county; upsert target for the function.
  UNIQUE (county, auction_date)
);

CREATE INDEX IF NOT EXISTS idx_tax_sale_snapshots_county_date
  ON public.tax_sale_snapshots (county, auction_date);

ALTER TABLE public.tax_sale_snapshots ENABLE ROW LEVEL SECURITY;

-- Service role (the Edge Function) does all writes and the diff reads.
DROP POLICY IF EXISTS "Service role full access to tax_sale_snapshots"
  ON public.tax_sale_snapshots;
CREATE POLICY "Service role full access to tax_sale_snapshots"
  ON public.tax_sale_snapshots FOR ALL
  USING (auth.role() = 'service_role');

-- Authenticated users may read upcoming-sale state (read-only) so the app can
-- surface "next sale: <date> — N properties" later. No client writes.
DROP POLICY IF EXISTS "Authenticated read tax_sale_snapshots"
  ON public.tax_sale_snapshots;
CREATE POLICY "Authenticated read tax_sale_snapshots"
  ON public.tax_sale_snapshots FOR SELECT
  USING (auth.role() = 'authenticated');
