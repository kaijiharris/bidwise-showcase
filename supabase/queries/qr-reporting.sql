-- qr-reporting.sql — the 3 saved admin queries for the QR affiliate/vendor
-- flows (paste into Supabase Studio's SQL editor and save as snippets).
-- Admin surface v1 is Studio + these queries; the in-app admin page is phase 2.

-- 1) Scans by code by day (deduped by IP within a day)
SELECT a.code, e.created_at::date AS day,
       COUNT(*) AS raw_scans,
       COUNT(DISTINCT e.ip_hash) AS unique_scans
FROM affiliate_events e JOIN affiliates a ON a.id = e.affiliate_id
WHERE e.event_type = 'scan' AND e.created_at > NOW() - INTERVAL '90 days'
GROUP BY a.code, day ORDER BY day DESC, a.code;

-- 2) Conversion funnel by code + commission owed (20%-of-collected, 12-mo window).
--    Commission model: pct_first_n_months. Per paid invoice, commission =
--    amount_paid(cents) * commission_pct/100, summed within 12 months of the
--    customer's FIRST conversion_paid for that subscription. Voids net out.
--    amount_paid lives in metadata.amount_paid (integer cents), commission_pct
--    is frozen on each event. Pay-on-collection: this is money already banked.
WITH first_conv AS (   -- first conversion per subscription = window anchor
  SELECT stripe_subscription_id,
         MIN(created_at) AS first_paid_at
  FROM affiliate_events
  WHERE event_type = 'conversion_paid'
    AND stripe_subscription_id IS NOT NULL
  GROUP BY stripe_subscription_id
),
commissionable AS (    -- each paid/voided event, signed, if inside the 12-mo window
  SELECT e.affiliate_id,
         e.event_type,
         (COALESCE((e.metadata->>'amount_paid')::numeric, 0)
            * COALESCE(e.commission_pct, 0) / 100.0) AS commission_usd_cents
  FROM affiliate_events e
  JOIN first_conv f ON f.stripe_subscription_id = e.stripe_subscription_id
  WHERE e.event_type IN ('conversion_paid', 'conversion_voided')
    AND e.created_at <= f.first_paid_at + INTERVAL '12 months'
)
SELECT a.code, a.display_name,
  COUNT(*) FILTER (WHERE e.event_type = 'scan')                 AS scans,
  COUNT(*) FILTER (WHERE e.event_type = 'signup')               AS signups,
  COUNT(*) FILTER (WHERE e.event_type = 'subscription_started') AS trials_started,
  COUNT(*) FILTER (WHERE e.event_type = 'conversion_paid')      AS paid_invoices,
  COUNT(*) FILTER (WHERE e.event_type = 'conversion_voided')    AS voided,
  ROUND(
    COALESCE(SUM(c.commission_usd_cents)
             FILTER (WHERE c.event_type = 'conversion_paid'), 0) / 100.0
  - COALESCE(SUM(c.commission_usd_cents)
             FILTER (WHERE c.event_type = 'conversion_voided'), 0) / 100.0
  , 2) AS commission_owed_usd
FROM affiliates a
LEFT JOIN affiliate_events e ON e.affiliate_id = a.id
LEFT JOIN commissionable  c ON c.affiliate_id = a.id
GROUP BY a.id ORDER BY paid_invoices DESC, trials_started DESC;

-- 3) Pending vendor applications (work queue)
SELECT id, created_at::date AS applied, business_name, category,
       array_to_string(service_counties, ', ') AS counties,
       is_insured, years_in_business, phone, email, src_code, status
FROM vendor_applications
WHERE status IN ('pending', 'vetting')
ORDER BY status DESC, created_at ASC;

-- 4) This-month payout run: commission on invoices COLLECTED last calendar month,
--    within each customer's 12-mo window, grouped by affiliate, $25 minimum.
--    Sub-$25 balances roll forward (they reappear next month as the window still
--    contains their invoices). A strict already-paid running ledger is deferred
--    to the phase-2 affiliate dashboard (same as the flat model deferred payout).
WITH first_conv AS (
  SELECT stripe_subscription_id, MIN(created_at) AS first_paid_at
  FROM affiliate_events WHERE event_type='conversion_paid'
    AND stripe_subscription_id IS NOT NULL
  GROUP BY stripe_subscription_id
),
due AS (
  SELECT e.affiliate_id,
         SUM( (COALESCE((e.metadata->>'amount_paid')::numeric,0) * e.commission_pct/100.0)
              * CASE WHEN e.event_type='conversion_voided' THEN -1 ELSE 1 END ) / 100.0 AS owed_usd
  FROM affiliate_events e
  JOIN first_conv f ON f.stripe_subscription_id = e.stripe_subscription_id
  WHERE e.event_type IN ('conversion_paid','conversion_voided')
    AND e.created_at <= f.first_paid_at + INTERVAL '12 months'
    AND e.created_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
    AND e.created_at <  date_trunc('month', NOW())
  GROUP BY e.affiliate_id
)
SELECT a.code, a.display_name, a.email, ROUND(d.owed_usd,2) AS pay_this_month_usd
FROM due d JOIN affiliates a ON a.id = d.affiliate_id
WHERE d.owed_usd >= 25.00           -- $25 minimum; sub-$25 rolls forward
ORDER BY pay_this_month_usd DESC;
