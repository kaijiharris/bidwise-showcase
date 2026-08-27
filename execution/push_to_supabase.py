"""
BidWise — Pipeline → Supabase Bridge
=====================================
Reads the latest enriched county analysis JSON from .tmp/ and upserts
all properties to the Supabase `properties` table.

Usage:
    python execution/push_to_supabase.py --county dekalb
    python execution/push_to_supabase.py --county gwinnett
    python execution/push_to_supabase.py --county cobb
    python execution/push_to_supabase.py --all

Final pre-auction pull — also auto-refunds unlocks on removed parcels:
    python execution/push_to_supabase.py --county dekalb --final
    python execution/push_to_supabase.py --county dekalb --final --auction-date 2026-06-02

`--final` diffs the new pull against the previously-published parcels for that
(county, auction_date). Every parcel that vanished is marked
`auction_status='cancelled_before_auction'` and any monthly-quota unlock on it
is credited back via the `refund_unlocks_for_parcel` RPC (migration 007).
The matching record in `web/data/{county}.json` is patched in place so
the dashboard's static-JSON path renders the "Removed — unlock refunded" badge.

Requires in .env:
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   (NOT the anon key)
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import uuid

import dotenv
import requests

# ── Setup ─────────────────────────────────────────────────────────────────────

env_path = Path(__file__).parent.parent / '.env'
dotenv.load_dotenv(dotenv_path=env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger("push_to_supabase")

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env\n"
        "Use the service role key (not anon key) — it bypasses RLS for admin writes."
    )
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",   # upsert on conflict
}

TMP_DIR = Path(__file__).parent.parent / ".tmp"

COUNTY_RESULT_DIRS = {
    "dekalb":   TMP_DIR / "dekalb_results",
    "gwinnett": TMP_DIR / "gwinnett_results",
    "cobb":     TMP_DIR / "cobb_results",
}

# Filename patterns that indicate the most enriched output per county
COUNTY_FILE_PATTERNS = {
    "dekalb":   ["dekalb_enriched_", "dekalb_enhanced_", "dekalb_deterministic_"],
    "gwinnett": ["gwinnett_enriched_", "gwinnett_analysis_"],
    "cobb":     ["cobb_enriched_", "cobb_analysis_"],
}

# Canonical county display names. MUST match run_ga_county's COUNTY_CONFIG
# display_name, the web dashboard county configs (DashboardClient COUNTIES),
# and the mobile county filter chips — every consumer filters rows with
# county=eq.<name>. str.title() breaks interior capitals ("DeKalb" ->
# "Dekalb"), which made pushed rows invisible to those queries (found and
# prod data normalized 2026-07-17).
COUNTY_DISPLAY = {
    "dekalb":   "DeKalb",
    "gwinnett": "Gwinnett",
    "cobb":     "Cobb",
}


def canonical_county(county_key: str) -> str:
    """Display name for a county CLI key; title-case fallback covers future
    counties without interior capitals (add them to COUNTY_DISPLAY if not)."""
    return COUNTY_DISPLAY.get(county_key.lower(), county_key.title())

# ── File Discovery ─────────────────────────────────────────────────────────────

def find_latest_file(county: str) -> Optional[Path]:
    """Return the most recently modified enriched JSON file for a county."""
    result_dir = COUNTY_RESULT_DIRS.get(county)
    if not result_dir or not result_dir.exists():
        logger.error(f"Result directory not found: {result_dir}")
        return None

    patterns = COUNTY_FILE_PATTERNS.get(county, [])
    candidates = []
    for pattern in patterns:
        candidates.extend(result_dir.glob(f"{pattern}*.json"))

    if not candidates:
        logger.error(f"No enriched JSON found in {result_dir} for county={county}")
        return None

    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    logger.info(f"Using file: {latest.name}")
    return latest


# ── Field Mapping ─────────────────────────────────────────────────────────────

def map_property(raw: dict, county: str, batch_id: str) -> dict:
    """Map raw pipeline output fields → Supabase properties table columns."""

    def safe_float(val) -> Optional[float]:
        try:
            return float(val) if val is not None else None
        except (TypeError, ValueError):
            return None

    def safe_int(val) -> Optional[int]:
        try:
            return int(val) if val is not None else None
        except (TypeError, ValueError):
            return None

    def bool_or_none(val) -> Optional[bool]:
        # None stays None ("pipeline never screened this row"), everything else
        # coerces strictly — some archives serialise the flags as 0/1.
        return None if val is None else bool(val)

    def text_or_none(val) -> Optional[str]:
        # Older pipeline scripts stamp ''/whitespace notes; store NULL instead
        # so PostgREST "is null" filters stay meaningful.
        if val is None:
            return None
        text = str(val).strip()
        return text or None

    parcel_id = (
        raw.get("tax_id")
        or raw.get("parcel_id")
        or raw.get("pin")
        or raw.get("id")
    )
    if not parcel_id:
        return {}   # skip — no identifier

    address = (
        raw.get("full_address")
        or raw.get("address")
        or raw.get("assessor_address")
    )

    rehab_cost = safe_float(
        raw.get("estimated_rehab")
        or raw.get("estimated_rehab_cost")
        or raw.get("rehab_cost")
    )

    auction_date = raw.get("auction_date") or raw.get("sale_date")
    if auction_date:
        try:
            # Normalise to YYYY-MM-DD if it's a datetime string
            auction_date = str(auction_date)[:10]
        except Exception:
            auction_date = None

    return {
        "parcel_id":          str(parcel_id).strip(),
        "county":             canonical_county(county),
        "address":            str(address).strip() if address else None,
        "city":               raw.get("city"),
        "state":              raw.get("state", "GA"),
        "zip":                raw.get("zip_code") or raw.get("zip"),
        "property_type":      raw.get("property_type"),

        # Physical
        "beds":               safe_int(raw.get("beds")),
        "baths":              safe_float(raw.get("baths")),
        "sqft":               safe_int(raw.get("sqft")),
        "year_built":         safe_int(raw.get("year_built")),
        "lot_size":           safe_float(raw.get("lot_size")),

        # Financial
        "tax_due":            safe_float(raw.get("tax_due")),
        "arv":                safe_float(raw.get("arv")),
        "rehab_cost":         rehab_cost,
        "all_in_cost":        safe_float(raw.get("all_in_cost")),
        "net_profit":         safe_float(raw.get("net_profit")),
        "roi_pct":            safe_float(raw.get("roi_percent") or raw.get("roi_pct")),
        "max_bid":            safe_float(raw.get("recommended_max_bid") or raw.get("max_bid")),

        # Auction
        "min_bid":            safe_float(raw.get("min_bid")),
        "auction_date":       auction_date,
        "source":             raw.get("source"),
        "source_url":         raw.get("source_url"),

        # Scoring
        "deal_score":         safe_float(raw.get("deal_score")),
        "risk_score":         safe_float(raw.get("risk_score") or raw.get("composite_risk_score")),
        "crime_score":        safe_float(raw.get("crime_score")),
        "flood_zone":         raw.get("flood_zone"),
        "comp_count":         safe_int(raw.get("comp_count") or raw.get("arv_comp_count")),
        "arv_confidence":     raw.get("arv_confidence"),
        "data_quality_score": safe_float(raw.get("data_quality_score") or raw.get("comp_quality_score")),

        # Guardrail / trust / redemption signals (columns from migrations
        # 020 + 022). The Flutter feed and the dashboard's Supabase path key
        # NO-BID / estimate-only suppression off these; NULL means "never
        # screened" and renders as a normal row, so legacy archives without
        # the fields stay unsuppressed rather than falsely screened.
        "score_tier":                text_or_none(raw.get("score_tier")),
        "is_no_bid":                 bool_or_none(raw.get("is_no_bid")),
        "no_bid_reason":             text_or_none(raw.get("no_bid_reason")),
        "estimate_only":             bool_or_none(raw.get("estimate_only")),
        "analysis_notes":            text_or_none(raw.get("analysis_notes")),
        "roi_if_redeemed_year1_pct": safe_float(raw.get("roi_if_redeemed_year1_pct")),
        "roi_if_deed_matures":       safe_float(raw.get("roi_if_deed_matures")),

        # Batch / admin
        "batch_id":           batch_id,
        "published":          False,   # admin must explicitly publish each batch
        "flagged":            False,
        "admin_notes":        None,
    }


# ── Supabase Upsert ────────────────────────────────────────────────────────────

def upsert_properties(records: list[dict]) -> int:
    """Upsert a list of mapped property records. Returns count of upserted rows."""
    if not records:
        return 0

    # Supabase REST upsert in chunks of 500 to stay under payload limits
    chunk_size = 500
    total = 0
    for i in range(0, len(records), chunk_size):
        chunk = records[i : i + chunk_size]
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/properties",
            headers=HEADERS,
            json=chunk,
            timeout=60,
        )
        if resp.status_code in (200, 201):
            total += len(chunk)
            logger.info(f"  Upserted chunk {i // chunk_size + 1}: {len(chunk)} records")
        else:
            logger.error(f"  Upsert failed (HTTP {resp.status_code}): {resp.text[:300]}")
            raise RuntimeError(f"Supabase upsert error: {resp.status_code}")

    return total


# ── Final-pull diff: removed parcels + unlock refunds ────────────────────────

# Server-only dataset dir (moved out of web/public/ so PII JSON isn't publicly
# downloadable). Named *_DATA_DIR for continuity; the path is now web/data.
PUBLIC_DATA_DIR = Path(__file__).parent.parent / "web" / "data"


def fetch_published_parcels(county: str, auction_date: Optional[str]) -> set[str]:
    """Return the set of parcel_ids currently in Supabase for (county, auction_date).

    Used by --final to detect parcels that were in the previous pull but are
    missing from the new one (= the auction-status drop-offs we want to
    refund). If `auction_date` is None the diff is skipped (we don't want to
    refund across auctions). Returns empty set on any error — caller logs and
    treats as "nothing to refund" rather than risking false refunds.
    """
    if not auction_date:
        return set()

    url = (
        f"{SUPABASE_URL}/rest/v1/properties"
        f"?select=parcel_id"
        f"&county=eq.{canonical_county(county)}"
        f"&auction_date=eq.{auction_date}"
        f"&auction_status=eq.active"
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        rows = r.json()
        return {row["parcel_id"] for row in rows if row.get("parcel_id")}
    except Exception as e:
        logger.error(f"fetch_published_parcels failed: {e}")
        return set()


def call_refund_rpc(county: str, parcel_id: str, reason: str = "cancelled_before_auction") -> dict:
    """Invoke public.refund_unlocks_for_parcel via PostgREST RPC.

    Idempotent server-side: re-running on an already-removed parcel returns
    `{"ok": true, "already_marked": true, "refunded": 0}`.
    """
    url = f"{SUPABASE_URL}/rest/v1/rpc/refund_unlocks_for_parcel"
    payload = {
        "p_county":    canonical_county(county),
        "p_parcel_id": parcel_id,
        "p_reason":    reason,
    }
    try:
        r = requests.post(url, headers=HEADERS, json=payload, timeout=30)
        r.raise_for_status()
        return r.json() if r.text else {"ok": True}
    except Exception as e:
        logger.error(f"refund RPC failed for {county}/{parcel_id}: {e}")
        return {"ok": False, "error": str(e), "parcel": parcel_id}


def _parcel_key(raw: dict) -> Optional[str]:
    """Same parcel_id resolution map_property uses, for diff symmetry."""
    pid = raw.get("tax_id") or raw.get("parcel_id") or raw.get("pin") or raw.get("id")
    return str(pid).strip() if pid else None


def patch_public_json_with_removals(county: str, removed_parcels: set[str], reason: str) -> int:
    """Stamp auction_status + removed_at on the static dashboard JSON.

    The dashboard reads `web/data/{county}.json` (server-side) for the JSON
    path. We patch in place so the "Removed — unlock
    refunded" badge fires there too, not only on the Supabase path.

    Returns the count of records actually updated. If the file or property
    isn't present, that's a soft warning — Supabase still got patched.
    """
    if not removed_parcels:
        return 0

    json_path = PUBLIC_DATA_DIR / f"{county}.json"
    if not json_path.exists():
        logger.warning(f"public JSON missing — skipping client patch: {json_path}")
        return 0

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"could not read {json_path}: {e}")
        return 0

    if isinstance(data, dict) and "properties" in data:
        prop_list = data["properties"]
    elif isinstance(data, list):
        prop_list = data
    else:
        logger.warning(f"unexpected JSON shape in {json_path.name}; skipping client patch")
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    patched = 0
    for p in prop_list:
        pid = _parcel_key(p)
        if pid and pid in removed_parcels:
            # Only stamp if not already marked, so re-runs don't reset removed_at.
            if p.get("auction_status") != "cancelled_before_auction":
                p["auction_status"] = "cancelled_before_auction"
                p["removed_at"]     = now_iso
                p["removal_reason"] = reason
                patched += 1

    if patched:
        json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.info(f"patched {patched} record(s) in {json_path.name} with removal status")
    return patched


def refund_removed_parcels(county: str, current_parcels: set[str], auction_date: Optional[str]) -> dict:
    """Diff vs Supabase, fire refund RPC for missing parcels, patch JSON.

    Returns a summary dict for the run log. Caller should only invoke this on
    a `--final` run; intermediate refreshes routinely have <100% parcel
    overlap (parser flakiness, paging) and should NOT trigger refunds.
    """
    if not auction_date:
        logger.warning(
            "--final requested but no --auction-date given and none could be inferred "
            "from the input JSON — skipping refund diff to avoid cross-auction refunds."
        )
        return {"skipped": "no_auction_date"}

    previous = fetch_published_parcels(county, auction_date)
    if not previous:
        logger.info(f"--final: no prior parcels for {county}/{auction_date} — nothing to diff")
        return {"previous": 0, "removed": 0, "refunded_unlocks": 0}

    removed = previous - current_parcels
    if not removed:
        logger.info(f"--final: 100% overlap ({len(previous)} parcels still present) — no refunds")
        return {"previous": len(previous), "removed": 0, "refunded_unlocks": 0}

    # Safety floor — if >50% of previously-published parcels are "missing",
    # that's almost certainly a parser regression, not real mass-redemption.
    # Bail out before mass-refunding.
    if len(removed) > len(previous) * 0.5:
        logger.error(
            f"--final ABORTED: {len(removed)}/{len(previous)} parcels missing "
            f"(>50%) for {county}/{auction_date}. Looks like a parser data-quality "
            f"issue, not real removals. Re-run the parser and verify before retrying."
        )
        return {
            "aborted":  "removed_ratio_above_50pct",
            "previous": len(previous),
            "removed":  len(removed),
        }

    logger.warning(f"--final: {len(removed)}/{len(previous)} parcels removed; refunding…")
    refunded_unlocks = 0
    rpc_errors      = 0
    for pid in sorted(removed):
        resp = call_refund_rpc(county, pid)
        if resp.get("ok"):
            refunded_unlocks += int(resp.get("refunded", 0) or 0)
        else:
            rpc_errors += 1

    patched_in_json = patch_public_json_with_removals(
        county, removed, reason="cancelled_before_auction"
    )

    return {
        "previous":          len(previous),
        "removed":           len(removed),
        "refunded_unlocks":  refunded_unlocks,
        "rpc_errors":        rpc_errors,
        "patched_in_json":   patched_in_json,
        "removed_sample":    sorted(removed)[:10],
    }


def upsert_county_run(county: str, batch_id: str, property_count: int) -> None:
    """Insert a county_run record marking this batch as 'review' status."""
    record = {
        "county":          canonical_county(county),
        "state":           "GA",
        "status":          "review",
        "property_count":  property_count,
        "batch_id":        batch_id,
        "run_date":        datetime.now(timezone.utc).isoformat(),
    }
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/county_runs",
        headers={**HEADERS, "Prefer": "return=minimal"},
        json=record,
        timeout=30,
    )
    if resp.status_code in (200, 201):
        logger.info(f"County run recorded for {canonical_county(county)} (batch {batch_id})")
    else:
        logger.warning(f"Failed to record county run: {resp.status_code} {resp.text[:200]}")


# ── Main ───────────────────────────────────────────────────────────────────────

def push_county(county: str, final: bool = False, auction_date: Optional[str] = None) -> None:
    logger.info(f"── Pushing {canonical_county(county)} County ──────────────────────")
    file_path = find_latest_file(county)
    if not file_path:
        return

    with open(file_path, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    # Handle both list format and {"properties": [...]} format
    if isinstance(raw_data, dict) and "properties" in raw_data:
        raw_list = raw_data["properties"]
    elif isinstance(raw_data, list):
        raw_list = raw_data
    else:
        logger.error(f"Unexpected JSON structure in {file_path.name}")
        return

    logger.info(f"Loaded {len(raw_list)} properties from {file_path.name}")

    batch_id = str(uuid.uuid4())
    records = []
    current_parcels: set[str] = set()
    inferred_auction_date: Optional[str] = None
    skipped = 0
    for raw in raw_list:
        mapped = map_property(raw, county, batch_id)
        if mapped:
            records.append(mapped)
            current_parcels.add(mapped["parcel_id"])
            if not inferred_auction_date and mapped.get("auction_date"):
                inferred_auction_date = mapped["auction_date"]
        else:
            skipped += 1

    if skipped:
        logger.warning(f"Skipped {skipped} records (missing parcel_id)")

    if not records:
        logger.error("No valid records to push.")
        return

    logger.info(f"Upserting {len(records)} properties to Supabase...")
    count = upsert_properties(records)
    logger.info(f"Done — {count} properties upserted.")

    if final:
        # All parcels in this final batch get implicitly reset to 'active' is
        # NOT what we want — refund_unlocks_for_parcel relies on the prior
        # auction_status sticking. We DO NOT include auction_status in the
        # upsert payload (it's omitted from map_property), so existing rows
        # keep whatever status they had; only brand-new rows get the column
        # DEFAULT 'active'. Now run the diff.
        eff_date = auction_date or inferred_auction_date
        logger.info(f"--final: diffing prior pull vs current ({len(current_parcels)} parcels, auction_date={eff_date})")
        refund_summary = refund_removed_parcels(county, current_parcels, eff_date)
        logger.info(f"--final refund summary: {json.dumps(refund_summary)}")

    upsert_county_run(county, batch_id, count)
    logger.info(
        f"\nNext step: log in to the BidWise admin dashboard, review the batch,\n"
        f"then click 'Publish' to make these properties visible to subscribers.\n"
        f"Batch ID: {batch_id}"
    )


def main():
    parser = argparse.ArgumentParser(description="Push county analysis results to Supabase")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--county", choices=["dekalb", "gwinnett", "cobb"], help="County to push")
    group.add_argument("--all", action="store_true", help="Push all counties")
    parser.add_argument(
        "--final",
        action="store_true",
        help="Treat this as the final pre-auction pull: diff vs previously-published "
             "parcels for the same (county, auction_date) and auto-refund unlocks on "
             "parcels that have vanished (calls refund_unlocks_for_parcel RPC).",
    )
    parser.add_argument(
        "--auction-date",
        dest="auction_date",
        default=None,
        help="YYYY-MM-DD. Required for --final when the input JSON has mixed or "
             "no auction_date values. If omitted, the first non-null auction_date "
             "in the input is used.",
    )
    args = parser.parse_args()

    counties = list(COUNTY_RESULT_DIRS.keys()) if args.all else [args.county]
    if args.final and args.all and not args.auction_date:
        # --all + --final without an explicit date is unsafe: different counties
        # have different sale dates, and using each county's inferred date is
        # fine — that path is allowed below.
        logger.warning(
            "--final --all: per-county auction_date will be inferred from each "
            "county's input JSON. Pass --auction-date to override for all."
        )

    for county in counties:
        try:
            push_county(county, final=args.final, auction_date=args.auction_date)
        except Exception as e:
            logger.error(f"Failed to push {county}: {e}")

    logger.info("Pipeline bridge complete.")


if __name__ == "__main__":
    main()
