"""
API budget snapshot — run any time to see paid-API posture.
============================================================
    python execution/check_api_budgets.py

Prints Apify monthly usage vs limit, RentCast monthly calls vs the free-tier
cap (local counter — RentCast has no usage endpoint; the dashboard at
app.rentcast.io is the authoritative figure), and the comp-store inventory
with age tiers (FRESH ≤90d reuse freely / AGED 91–180d reuse flagged /
STALE >180d eligible for refresh — reusable pools = free repeat runs).
"""

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import dotenv

dotenv.load_dotenv(Path(__file__).parent.parent / ".env")

from execution.utils.apify_budget import check_apify_budget
from execution.utils.comps_cache import (
    FRESH_MAX_AGE_DAYS,
    REUSE_MAX_AGE_DAYS,
    load_entry,
    store_dir,
    usable_comp_count,
)
from execution.utils.rentcast_budget import get_usage as rentcast_usage


def main() -> int:
    print("=" * 60)
    print("API BUDGET SNAPSHOT —", datetime.now().strftime("%Y-%m-%d %H:%M"))
    print("=" * 60)

    status = check_apify_budget()
    if status.pct is not None:
        bar = "#" * int(status.pct // 5) + "-" * (20 - int(status.pct // 5))
        print(f"Apify   [{bar}] {status.pct}%  (${status.used_usd:.2f} / ${status.limit_usd:.2f})")
        if status.pct >= 90:
            print("        >>> BLOCKED for fresh fetches (override: APIFY_BUDGET_OVERRIDE=1)")
        elif status.pct >= 50:
            print("        >>> WARNING: past the 50% notification threshold")
    else:
        print("Apify   usage unavailable (missing token or API error)")

    ru = rentcast_usage()
    rbar = "#" * int(ru.pct // 5) + "-" * (20 - int(ru.pct // 5))
    print(f"RentCast[{rbar}] {ru.pct}%  ({ru.count} / {ru.limit} calls, {ru.remaining} left this month)")
    if ru.pct >= 90:
        print("        >>> BLOCKED for fresh fetches (override: RENTCAST_BUDGET_OVERRIDE=1)")
    elif ru.pct >= 50:
        print("        >>> WARNING: past the 50% notification threshold")
    print("        (local tally of calls THIS system made — verify at app.rentcast.io)")

    print()
    sdir = store_dir()
    entries = sorted(sdir.glob("*.json")) if sdir.exists() else []
    # ASCII only — Windows cp1252 consoles choke on "≤" (known pipe gotcha).
    print(
        f"Comp store ({len(entries)} pools, fresh <={FRESH_MAX_AGE_DAYS}d / "
        f"aged <={REUSE_MAX_AGE_DAYS}d, dir {sdir}):"
    )
    for p in entries:
        source, _, slug = p.stem.partition("_")
        # City/state slugs round-trip through load_entry via the raw slug.
        entry = load_entry(source, slug, "")
        if entry is None:
            print(f"  {p.stem:40} (unreadable)")
            continue
        print(
            f"  {p.stem:40} {entry.tier.upper():6} age {entry.age_days:>3}d  "
            f"{usable_comp_count(entry.items):>4} usable comps"
        )
    if not entries:
        print("  (empty — next pipeline run pays for every city it touches)")

    print("=" * 60)
    return 0 if status.ok else 1


if __name__ == "__main__":
    sys.exit(main())
