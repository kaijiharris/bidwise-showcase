"""
BidWise — 3-Day Pre-Auction Reprune
====================================
Three days before each county's upcoming auction date, re-fetches the latest
auction list from source and compares against properties currently approved
in Supabase. Properties that no longer appear on the active list get marked
review_status='pruned' (which auto-unpublishes via the trigger in
migration 002_tier_gating_and_review.sql).

Why we do this:
County tax-deed auction lists shift in the final days before sale (last-
minute redemptions, withdrawals, paperwork issues). Without this step,
paying users could open the app expecting a property that's no longer
biddable — bad first impression, refund-bait.

Usage:
    python execution/reprune_pre_auction.py --county dekalb
    python execution/reprune_pre_auction.py --all
    python execution/reprune_pre_auction.py --all --dry-run

Schedule (when ready): nightly cron via Supabase Scheduled Function or
Vercel Cron. Idempotent — running twice on the same day is a no-op.

Requires in .env:
    SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import sys
import json
import argparse
import logging
import subprocess
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Set, Optional

import dotenv
import requests

# ── Setup ─────────────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT_DIR))

env_path = ROOT_DIR / '.env'
dotenv.load_dotenv(dotenv_path=env_path)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("reprune_pre_auction")

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

REPRUNE_WINDOW_DAYS = 3   # rerun parser when auction is <= 3 days away
COUNTIES = ["dekalb", "cobb", "gwinnett"]

# Each county's parser script — output JSON path used to extract the fresh
# parcel list. The parsers already exist; we just invoke them and read output.
PARSER_CONFIG = {
    "dekalb":   {"script": "parse_dekalb_improved.py", "output_glob": "dekalb_parsed_*.json"},
    "cobb":     {"script": "parse_cobb.py",            "output_glob": "cobb_parsed_*.json"},
    "gwinnett": {"script": "parse_gwinnett.py",        "output_glob": "gwinnett_parsed_*.json"},
}

# Safety threshold: if the fresh list is <50% the size of the DB list, we
# abort (likely a parser failure rather than mass withdrawal). Tune as we
# learn the natural variance.
MIN_FRESH_RATIO = 0.5


# ── Supabase reads ────────────────────────────────────────────────────────────
def fetch_active_properties(county: str) -> List[Dict]:
    """Approved properties whose auction is between today and today+3 days."""
    today = datetime.now(timezone.utc).date()
    cutoff = today + timedelta(days=REPRUNE_WINDOW_DAYS)
    url = (
        f"{SUPABASE_URL}/rest/v1/properties"
        f"?select=id,parcel_id,address,auction_date,review_status"
        f"&county=eq.{county.title()}"
        f"&review_status=eq.approved"
        f"&auction_date=gte.{today.isoformat()}"
        f"&auction_date=lte.{cutoff.isoformat()}"
    )
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


# ── Fresh parse ───────────────────────────────────────────────────────────────
def fresh_parcels_for_county(county: str) -> Optional[Set[str]]:
    """Run the county's existing parser and return the set of fresh parcel_ids.

    Assumes parsers in execution/parse_*.py write a JSON list of records to
    .tmp/<output_glob>; each record has a `parcel_id` field. Returns None on
    parser failure (caller should treat as 'unknown' and abort, not as 'all
    pruned').
    """
    cfg = PARSER_CONFIG[county]
    script_path = ROOT_DIR / "execution" / cfg["script"]
    if not script_path.exists():
        logger.error(f"{county}: parser missing at {script_path}")
        return None

    logger.info(f"{county}: re-parsing source via {cfg['script']}")
    result = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
        timeout=900,
    )
    if result.returncode != 0:
        logger.error(f"{county}: parser exited {result.returncode}\nstderr:\n{result.stderr[-2000:]}")
        return None

    # Find the most recent parser output (parsers timestamp their output files)
    tmp_dir = ROOT_DIR / ".tmp"
    matches = sorted(tmp_dir.glob(cfg["output_glob"]), key=lambda p: p.stat().st_mtime, reverse=True)
    if not matches:
        logger.error(f"{county}: parser ran but produced no output matching {cfg['output_glob']}")
        return None

    fresh_path = matches[0]
    logger.info(f"{county}: reading fresh parcels from {fresh_path.name}")
    try:
        records = json.loads(fresh_path.read_text())
        return {r["parcel_id"] for r in records if r.get("parcel_id")}
    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"{county}: failed to extract parcel_ids from {fresh_path.name}: {e}")
        return None


# ── Mutations ─────────────────────────────────────────────────────────────────
def mark_pruned(property_ids: List[str], reason: str, dry_run: bool = False):
    if not property_ids:
        return
    if dry_run:
        logger.info(f"DRY-RUN: would prune {len(property_ids)} properties")
        return
    now = datetime.now(timezone.utc).isoformat()
    for pid in property_ids:
        url = f"{SUPABASE_URL}/rest/v1/properties?id=eq.{pid}"
        body = {
            "review_status": "pruned",
            "pruned_reason": reason,
            "pruned_at": now,
        }
        r = requests.patch(url, json=body, headers=HEADERS, timeout=30)
        r.raise_for_status()


def queue_user_notifications(pruned_property_ids: List[str], dry_run: bool = False) -> List[Dict]:
    """Find users with pruned properties in their saved list. Logs a queue;
    actual notification dispatch is a separate worker (TODO)."""
    if not pruned_property_ids:
        return []
    ids_csv = ",".join(pruned_property_ids)
    url = (
        f"{SUPABASE_URL}/rest/v1/saved_properties"
        f"?select=user_id,property_id&property_id=in.({ids_csv})"
    )
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    affected = r.json()
    logger.info(f"Notification queue: {len(affected)} saved-property records affected")
    if dry_run:
        return affected
    # TODO: insert into notifications table once it exists, or POST to a
    # transactional email worker. For v1, we log so admin can manually notify.
    return affected


# ── Per-county reprune ────────────────────────────────────────────────────────
def reprune(county: str, dry_run: bool = False) -> Dict:
    db_props = fetch_active_properties(county)
    if not db_props:
        logger.info(f"{county}: no approved properties within {REPRUNE_WINDOW_DAYS}-day window")
        return {"county": county, "checked": 0, "pruned": 0}

    db_parcels = {p["parcel_id"]: p["id"] for p in db_props}
    fresh = fresh_parcels_for_county(county)
    if fresh is None:
        logger.warning(f"{county}: parser failed/missing — aborting to avoid false-prune")
        return {"county": county, "checked": len(db_parcels), "pruned": 0, "aborted": "parser_failed"}

    if len(fresh) < len(db_parcels) * MIN_FRESH_RATIO:
        logger.warning(
            f"{county}: fresh parcel count ({len(fresh)}) is <{MIN_FRESH_RATIO*100:.0f}% of "
            f"DB ({len(db_parcels)}) — aborting (looks like parser data quality issue, not mass withdrawal)"
        )
        return {"county": county, "checked": len(db_parcels), "pruned": 0, "aborted": "low_fresh_count"}

    missing_parcels = set(db_parcels.keys()) - fresh
    if not missing_parcels:
        logger.info(f"{county}: all {len(db_parcels)} active properties still listed")
        return {"county": county, "checked": len(db_parcels), "pruned": 0}

    pruned_ids = [db_parcels[p] for p in missing_parcels]
    reason = f"Removed from active auction list at T-{REPRUNE_WINDOW_DAYS} reprune ({datetime.now(timezone.utc).date().isoformat()})"
    mark_pruned(pruned_ids, reason, dry_run=dry_run)
    affected_users = queue_user_notifications(pruned_ids, dry_run=dry_run)

    logger.warning(
        f"{county}: pruned {len(pruned_ids)} properties; "
        f"{len(affected_users)} user-saves affected"
    )
    return {
        "county": county,
        "checked": len(db_parcels),
        "pruned": len(pruned_ids),
        "affected_user_saves": len(affected_users),
        "missing_parcels_sample": sorted(missing_parcels)[:10],
        "dry_run": dry_run,
    }


def main():
    parser = argparse.ArgumentParser(description="3-day pre-auction reprune")
    parser.add_argument("--county", choices=COUNTIES, help="Single county; omit for --all")
    parser.add_argument("--all", action="store_true", help="Run all configured counties")
    parser.add_argument("--dry-run", action="store_true", help="Re-parse and compare but don't mutate")
    args = parser.parse_args()

    if not args.county and not args.all:
        parser.error("specify --county <name> or --all")

    counties = COUNTIES if args.all else [args.county]
    summary = []
    for c in counties:
        try:
            summary.append(reprune(c, dry_run=args.dry_run))
        except Exception as e:
            logger.exception(f"{c}: reprune crashed: {e}")
            summary.append({"county": c, "error": str(e)})

    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
