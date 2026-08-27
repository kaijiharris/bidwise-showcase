# DeKalb "September 1" list — provenance (it's the county's own advertisement, snapshotted July 12)

**Date:** 2026-07-30
**Trigger:** Operator was told the DeKalb **August auction was cancelled** and the
**September list "isn't out yet"** — and asked where BidWise's DeKalb 2026-09-01
listing (171 parcels) came from.

## The provenance chain (verified in-repo)

The Sept 1 date was **scraped from DeKalb's own official tax-sale listing page**,
not computed or inferred:

- Dataset: `web/data/dekalb_2026-09-01.json` (171 parcels, 25 top deals), indexed
  in `web/data/dekalb_auctions.json` with `"generated": "2026-07-12T02:01:51"`.
- Every parcel carries `source: "dekalb_web"` and a `raw_text` copied from the
  county table row, e.g.:
  `01-SEP-2026 15 018 03 003 ... 25-R30266748-SEP ... 10-JUL-26 ... $8,559.34`
  - `01-SEP-2026` — the county's own sale-date column
  - sale IDs suffixed **`-SEP`** (September writ)
  - `10-JUL-26` — advertised on the county page ~July 10
- Scrape URL at the time: `publicaccess.dekalbtax.org` tax_sale_listing (see
  `supabase/functions/notify-tax-sale/sources.ts` DeKalb entry).

## Why this reconciles with "August cancelled / September not out"

- **No DeKalb Aug 4 rows exist anywhere in our data** — the county had already
  jumped its parcels straight to Sept 1 by July 10–12 (Gwinnett/Clayton datasets
  show 2026-08-04; DeKalb goes 2026-07-07 → 2026-09-01). The scrape *is* the
  cancellation, seen from the data side.
- **"September list isn't out yet" is also true in the sense meant:** our file is
  a **July 12 snapshot of the county's early September advertisement**. The
  county's final September list would be re-advertised closer to sale day — and
  nobody can currently see it, because DeKalb's listing host has been dead since
  ~July 19 (broken DNS migration to `dekalbtaxga.gov`; lame delegation — see
  `sources.ts` acknowledgedOutage, re-armed 07-28).

## Operational caveats

1. The 171-parcel Sept 1 list is **real county data but stale** (July 12). GA
   counties revise lists until sale day. Web honors this via
   `STALE_ANALYSIS_DAYS = 7` → "as of July 12" framing (`web/lib/county-pages.ts`).
2. **Check the mobile app presents the same "as of" framing** — if it shows the
   171 parcels as the *current* September list while the county site is down,
   it overstates what we know. (Ties into the 7/25 mobile audit thread.)
3. The outage ack expired **07-28** — the watchdog is re-armed; a still-dead
   DeKalb listing now alerts loudly ahead of the Sept 1 sale.

## Generalizable lesson

A dataset's *date label* is a claim about the source, not the scrape — keep both
visible. Because every parcel stored its `raw_text` and `source`, a "where did
this number come from?" question was answerable in minutes, weeks later, with the
origin site dead. Keep raw provenance fields on every scraped row; they are the
audit trail when the upstream source disappears.

See: `docs/lessons/2026-07-17-supabase-data-contract-and-publish.md` (the Sept-1
batch's publish path), memory `bidwise-auction-cycle.md`.
