"""
Apify monthly-budget guard.
===========================
2026-07-05 incident: repeat same-day pipeline runs re-bought every city's
comps and hit the account's monthly usage hard limit mid-session, silently
degrading every later fetch to fallbacks. Founder direction: warn at 50%
usage and never let one session max the plan.

check_apify_budget() is called by run_ga_county before any comps fetching:
  < 50% used   → info line with the current spend
  >= 50% used  → loud WARNING banner (the "half of our credits" notification)
  >= 90% used  → run REFUSES to fetch comps unless APIFY_BUDGET_OVERRIDE=1
                 (use --no-comps or the disk cache instead)

The check fails OPEN (returns ok) when the limits endpoint is unreachable —
a monitoring outage must not block auction publishing.
"""

import os
from typing import NamedTuple, Optional

import requests
from loguru import logger

WARN_PCT = 50.0
BLOCK_PCT = 90.0
LIMITS_URL = "https://api.apify.com/v2/users/me/limits"


class BudgetStatus(NamedTuple):
    ok: bool                  # False only when >= BLOCK_PCT and no override
    used_usd: Optional[float]
    limit_usd: Optional[float]
    pct: Optional[float]


def _fetch_usage(token: str) -> tuple:
    resp = requests.get(LIMITS_URL, params={"token": token}, timeout=15)
    resp.raise_for_status()
    data = (resp.json() or {}).get("data") or {}
    used = ((data.get("current") or {}).get("monthlyUsageUsd"))
    limit = ((data.get("limits") or {}).get("maxMonthlyUsageUsd"))
    return used, limit


def check_apify_budget(token: Optional[str] = None) -> BudgetStatus:
    """Report Apify monthly usage and enforce the 50%/90% thresholds."""
    token = token or os.getenv("APIFY_API_KEY") or os.getenv("APIFY_API_TOKEN")
    if not token:
        return BudgetStatus(True, None, None, None)

    try:
        used, limit = _fetch_usage(token)
    except Exception as e:
        logger.warning(f"Apify budget check unavailable ({e}) — proceeding without it")
        return BudgetStatus(True, None, None, None)

    if not used or not limit or limit <= 0:
        logger.info("Apify budget: usage/limit not reported by the API — skipping check")
        return BudgetStatus(True, used, limit, None)

    pct = round(used / limit * 100, 1)

    if pct >= BLOCK_PCT:
        if os.getenv("APIFY_BUDGET_OVERRIDE") == "1":
            logger.warning(
                f"Apify budget {pct}% used (${used:.2f} of ${limit:.2f}) — OVERRIDE active, proceeding"
            )
            return BudgetStatus(True, used, limit, pct)
        logger.error(
            f"APIFY BUDGET GUARD: {pct}% of the ${limit:.2f} monthly limit is spent "
            f"(${used:.2f}). Comps fetching refused — use the disk cache, --no-comps, "
            f"or set APIFY_BUDGET_OVERRIDE=1 to proceed anyway."
        )
        return BudgetStatus(False, used, limit, pct)

    if pct >= WARN_PCT:
        logger.warning(
            "!" * 62 + "\n"
            f"!!  APIFY BUDGET: {pct}% USED — ${used:.2f} of ${limit:.2f} this month  !!\n"
            f"!!  Repeat runs re-use the 7-day comps disk cache for free.   !!\n"
            + "!" * 62
        )
    else:
        logger.info(f"Apify budget: ${used:.2f} of ${limit:.2f} used this month ({pct}%)")

    return BudgetStatus(True, used, limit, pct)
