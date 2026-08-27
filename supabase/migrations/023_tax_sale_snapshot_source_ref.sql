-- ════════════════════════════════════════════════════════════════════════════
-- Migration 023: source_ref fingerprint for PDF-based tax-sale sources
-- Renumbered from 016 on 2026-07-17 (duplicate prefix from parallel merges).
-- Applied to prod under the old number; idempotent — re-apply is a no-op.
--
-- The notify-tax-sale watchdog now monitors PDF-based listings (Gwinnett,
-- Cobb, Clayton) alongside DeKalb's HTML table. For those sources the diff
-- signal isn't only the parcel set — it's also the listing file itself:
-- a new/replaced PDF must alert even when parcel parsing yields nothing
-- (Cobb's placeholder swap) or when parcels are unchanged but the file was
-- re-uploaded.
--
-- `source_ref` stores that fingerprint: "<pdf-url-without-query>#sha256:<hex16>".
-- NULL for HTML-table sources (DeKalb) and for rows written before this
-- migration — the function treats NULL as "no fingerprint diff available".
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tax_sale_snapshots
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

COMMENT ON COLUMN public.tax_sale_snapshots.source_ref IS
  'Listing-file fingerprint for PDF sources: <url>#sha256:<hex16>. NULL = HTML source or pre-016 row.';
