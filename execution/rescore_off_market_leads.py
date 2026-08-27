"""
BidWise — Off-Market Lead Rescoring
====================================
Recomputes deal_score, equity_tier, distress_signals, and deal_type for every
row in `off_market_leads`, using the updated formula defined in
web/lib/scoring.ts.

Why this exists:
    The original scoring formula started at 50 and granted generous bonuses,
    so any PropStream "motivated seller" upload clamped at 100. The new
    formula starts at 0 and spreads scores so 100 means "exceptional," not
    "any active foreclosure with positive equity."

Usage:
    python execution/rescore_off_market_leads.py                # dry run
    python execution/rescore_off_market_leads.py --apply        # write updates

Requires in .env (same as push_to_supabase.py):
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   (NOT the anon key)

This is a one-shot remediation tool. Re-run it whenever scoring.ts changes
or after a fresh CSV upload that you want re-scored under the latest formula.
"""

import os
import sys
import argparse
import logging
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ImportError:
    sys.exit("missing dependency: pip install python-dotenv")

try:
    from supabase import create_client, Client
except ImportError:
    sys.exit("missing dependency: pip install supabase")


# ─── scoring (mirror of web/lib/scoring.ts) ──────────────────────────────────


def calculate_deal_score(lead: dict) -> dict:
    """Mirror of web/lib/scoring.ts:calculateDealScore. Keep in sync."""
    score = 0
    signals: list[str] = []
    equity_tier = "UNKNOWN"

    # 1. Equity
    equity = lead.get("estimated_equity")
    if equity is not None:
        if equity < 0:
            equity_tier = "UNDERWATER"
        elif equity < 30_000:
            equity_tier = "LOW_EQUITY"
            score += 10
        elif equity < 100_000:
            equity_tier = "MED_EQUITY"
            score += 25
        else:
            equity_tier = "HIGH_EQUITY"
            score += 40

    # 2. Absentee owner
    owner_type = (lead.get("owner_type") or "").strip().lower()
    if owner_type == "absentee owner":
        score += 15
        signals.append("absentee_owner")

    # 3. Foreclosure (lis pendens scored higher)
    fc = (lead.get("foreclosure_status") or "").strip().lower()
    if fc and fc not in {"none", "", "n/a"}:
        if "lis pendens" in fc:
            score += 26
            signals.append("lis_pendens")
        else:
            score += 18
            signals.append("foreclosure")

    # 4. Open liens
    liens = lead.get("open_liens") or 0
    if liens > 0:
        signals.append("open_liens")
        if liens <= 2:
            score += 5
        elif liens <= 5:
            score += 0
        else:
            score -= 8

    # 5. Years owned
    years = lead.get("years_owned") or 0
    if years > 20:
        score += 12
        signals.append("long_held")
    elif years > 10:
        score += 8
        signals.append("long_held")

    # 6. Listing status
    listing = (lead.get("listing_status") or "").strip().lower()
    if listing and listing not in {"none", "", "n/a"}:
        score += 5
        signals.append("listed")

    score = max(0, min(100, score))

    # Deal type
    deal_type = "unknown"
    if equity_tier in {"HIGH_EQUITY", "MED_EQUITY"} and "absentee_owner" in signals:
        deal_type = "wholesale"
    elif equity_tier == "HIGH_EQUITY" and "foreclosure" in signals:
        deal_type = "flip"
    elif "long_held" in signals and "absentee_owner" in signals:
        deal_type = "rental"
    elif score > 70:
        deal_type = "flip"
    elif "lis_pendens" in signals or "open_liens" in signals:
        deal_type = "distressed"

    return {
        "score": score,
        "equity_tier": equity_tier,
        "signals": signals,
        "deal_type": deal_type,
    }


# ─── runner ──────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write updates to Supabase. Omit for a dry run preview.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit rows processed (for testing).",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("rescore")

    # Load env from root .env first, then web/.env.local (where the
    # SUPABASE_SERVICE_ROLE_KEY actually lives in this repo).
    root = Path(__file__).resolve().parents[1]
    for p in [root / ".env", root / "web" / ".env.local"]:
        if p.exists():
            load_dotenv(p, override=False)

    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        log.error(
            "Missing Supabase credentials. Need SUPABASE_URL (or "
            "NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in either "
            ".env or web/.env.local"
        )
        return 1

    sb: Client = create_client(url, key)

    log.info("fetching off_market_leads…")
    select_cols = (
        "id, estimated_equity, owner_type, foreclosure_status, open_liens, "
        "years_owned, listing_status, deal_score, equity_tier, deal_type, distress_signals"
    )
    query = sb.table("off_market_leads").select(select_cols)
    if args.limit:
        query = query.limit(args.limit)
    rows = query.execute().data or []
    log.info("loaded %d leads", len(rows))

    if not rows:
        log.warning("no leads found — nothing to rescore")
        return 0

    distribution = {"0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0}
    changes = 0
    no_change = 0
    updates: list[dict[str, Any]] = []

    for row in rows:
        out = calculate_deal_score(row)
        new_score = out["score"]
        new_tier = out["equity_tier"]
        new_signals = sorted(out["signals"])
        new_type = out["deal_type"]

        if new_score <= 20:
            distribution["0-20"] += 1
        elif new_score <= 40:
            distribution["21-40"] += 1
        elif new_score <= 60:
            distribution["41-60"] += 1
        elif new_score <= 80:
            distribution["61-80"] += 1
        else:
            distribution["81-100"] += 1

        old_signals = sorted(row.get("distress_signals") or [])
        if (
            row.get("deal_score") == new_score
            and row.get("equity_tier") == new_tier
            and row.get("deal_type") == new_type
            and old_signals == new_signals
        ):
            no_change += 1
            continue

        changes += 1
        updates.append(
            {
                "id": row["id"],
                "deal_score": new_score,
                "equity_tier": new_tier,
                "deal_type": new_type,
                "distress_signals": new_signals,
            }
        )

    log.info("score distribution under new formula:")
    for band, count in distribution.items():
        bar = "█" * max(1, (count * 40) // max(1, len(rows)))
        log.info("  %s  %4d  %s", band, count, bar)

    log.info("%d rows would change, %d unchanged", changes, no_change)

    if not args.apply:
        log.info("dry run — re-run with --apply to write %d updates", changes)
        return 0

    if not updates:
        log.info("nothing to update")
        return 0

    log.info("writing %d updates…", len(updates))
    batch_size = 100
    written = 0
    for i in range(0, len(updates), batch_size):
        batch = updates[i : i + batch_size]
        for u in batch:
            sb.table("off_market_leads").update(
                {
                    "deal_score": u["deal_score"],
                    "equity_tier": u["equity_tier"],
                    "deal_type": u["deal_type"],
                    "distress_signals": u["distress_signals"],
                }
            ).eq("id", u["id"]).execute()
            written += 1
        log.info("  wrote %d / %d", written, len(updates))

    log.info("done — %d leads rescored", written)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
