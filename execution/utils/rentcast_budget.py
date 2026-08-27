"""
RentCast monthly-call guard.
============================
RentCast's free "Developer" tier allows 50 API calls/month and exposes NO
usage endpoint, so — unlike Apify — we cannot ask the vendor how many remain.
This module keeps a local, persistent counter (one file, keyed by calendar
month) so the pipeline knows exactly how many calls it has made and refuses to
blow the plan in a single session.

2026-07-05 incident: the Clayton refresh fell through to RentCast (Apify was
maxed) and consumed the whole 50-call free tier with no accounting. Fix: count
every real (non-cached) call, warn at 50%, block at 90%.

Enforcement lives at the single call site (rentcast_comps.get_sold_properties):
  check_budget() before each request, record_call() after each response.

State file: .api_usage/rentcast_usage.json (gitignored; survives .tmp wipes,
which the 7-day comps cache does not). The RentCast dashboard at
app.rentcast.io remains the authoritative figure — this counter only knows the
calls THIS system made.

Env overrides:
  RENTCAST_USAGE_FILE      — counter path (tests point this at a tmp file)
  RENTCAST_MONTHLY_LIMIT   — plan limit (default 50; raise if you upgrade)
  RENTCAST_BUDGET_OVERRIDE — set to "1" to force past the 90% block
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import NamedTuple

from loguru import logger

_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_USAGE_FILE = _ROOT / ".api_usage" / "rentcast_usage.json"
DEFAULT_MONTHLY_LIMIT = 50  # RentCast free "Developer" tier
WARN_PCT = 50.0
BLOCK_PCT = 90.0


class RentCastUsage(NamedTuple):
    """Immutable snapshot of this month's RentCast call accounting."""

    month: str        # "YYYY-MM"
    count: int        # calls recorded this month
    limit: int
    remaining: int
    pct: float


def _usage_file() -> Path:
    override = os.getenv("RENTCAST_USAGE_FILE")
    return Path(override) if override else DEFAULT_USAGE_FILE


def _month_key() -> str:
    return datetime.now().strftime("%Y-%m")


def _limit() -> int:
    try:
        return max(1, int(os.getenv("RENTCAST_MONTHLY_LIMIT", str(DEFAULT_MONTHLY_LIMIT))))
    except ValueError:
        return DEFAULT_MONTHLY_LIMIT


def _read_count() -> int:
    """Calls recorded for the current month (0 if file missing or month rolled over)."""
    try:
        data = json.loads(_usage_file().read_text())
    except (OSError, ValueError):
        return 0
    if data.get("month") != _month_key():
        return 0  # new calendar month → counter resets automatically
    try:
        return max(0, int(data.get("count", 0)))
    except (TypeError, ValueError):
        return 0


def get_usage() -> RentCastUsage:
    """Read-only snapshot of current usage. Never mutates the counter."""
    limit = _limit()
    count = _read_count()
    remaining = max(0, limit - count)
    pct = round(count / limit * 100, 1) if limit else 0.0
    return RentCastUsage(_month_key(), count, limit, remaining, pct)


def record_call() -> RentCastUsage:
    """Increment the monthly counter by one and persist. Call once per real request."""
    before = get_usage()
    path = _usage_file()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"month": before.month, "count": before.count + 1}))
    except OSError as e:
        logger.warning(f"RentCast usage counter could not be saved ({e})")
    after = get_usage()
    # Loud banner the first time a run crosses the 50% notification line.
    if before.pct < WARN_PCT <= after.pct:
        logger.warning(
            "!" * 62 + "\n"
            f"!!  RENTCAST BUDGET: {after.pct}% USED — {after.count} of {after.limit} calls this month  !!\n"
            f"!!  {after.remaining} free calls left. Repeat runs reuse the 7-day comps cache.  !!\n"
            + "!" * 62
        )
    return after


def check_budget() -> bool:
    """Return False (refuse the call) when >= BLOCK_PCT of the monthly limit is spent."""
    usage = get_usage()
    if usage.pct >= BLOCK_PCT:
        if os.getenv("RENTCAST_BUDGET_OVERRIDE") == "1":
            logger.warning(
                f"RentCast budget {usage.pct}% ({usage.count}/{usage.limit}) — OVERRIDE active, proceeding"
            )
            return True
        logger.error(
            f"RENTCAST BUDGET GUARD: {usage.count}/{usage.limit} monthly calls used "
            f"({usage.pct}%). Refusing further RentCast calls — reuse the disk cache, "
            f"run with --no-comps, or set RENTCAST_BUDGET_OVERRIDE=1 to force."
        )
        return False
    if usage.pct >= WARN_PCT:
        logger.warning(
            f"RentCast budget: {usage.count}/{usage.limit} calls used this month "
            f"({usage.pct}%, {usage.remaining} left)"
        )
    return True
