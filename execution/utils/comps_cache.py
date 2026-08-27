"""
Comp store of record for paid comps-API responses (Apify / HomeHarvest / RentCast).
===================================================================================
History: comps were cached in memory only, so every pipeline invocation re-bought
every city (2026-07-05: two same-day Clayton runs + one Gwinnett republish
re-fetched ~22 city sweeps and tripped Apify's monthly hard limit). A flat 7-day
disk TTL fixed same-week reruns but still forced a full re-buy every auction
cycle (2026-07-12: 13 DeKalb city sweeps re-bought for $4.13 days after the
equivalent pools were purchased on 07-03/07-04).

Policy now (operator directive 2026-07-12 — recycle comps, don't re-scrape):
tiered comp-age windows instead of a flat TTL. Appraisal practice treats closed
sales within 6 months as standard comparables (Fannie Mae B4-1.3-08 requires at
least three comps and prefers sales within the prior 6 months; ~90 days is the
full-confidence band appraisers reach for first), so:

  age <= 90 days   -> FRESH  : reuse freely, full confidence
  91..180 days     -> AGED   : reuse with an age flag; the deal engine
                               downgrades its existing confidence badge a notch
  > 180 days       -> STALE  : not served; the city is eligible for refresh

A fresh scrape happens ONLY when no stored pool for the city clears the
usable-comp floor (COMPS_REFRESH_FLOOR, default 3) inside the reuse window —
never simply because a new run started.

Layout:  .comp_store/{source}_{city}_{state}.json     (durable, gitignored)
         {"fetched_at": iso, "source": str, "items": [...]}
         Legacy entries in .tmp/comps_cache/ are adopted (copied) on first read
         so pools already paid for survive the migration; the store lives
         outside .tmp because entries are now valid for up to 180 days and
         .tmp gets wiped.

Env:
  COMP_STORE_DIR        — store directory (tests point this at tmp)
  COMPS_CACHE_TTL_DAYS  — override: hard TTL in days (0 bypasses the store
                          entirely; unset = tiered policy above)
  COMPS_REFRESH_FLOOR   — min usable comps a stored pool needs to be served
"""

import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, NamedTuple, Optional, Sequence

from loguru import logger

_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_STORE_DIR = _ROOT / ".comp_store"
LEGACY_CACHE_DIR = _ROOT / ".tmp" / "comps_cache"

# Tier boundaries (days). Rationale in the module docstring: 6-month comps are
# standard appraisal practice; 3 months is the full-confidence band.
FRESH_MAX_AGE_DAYS = 90
REUSE_MAX_AGE_DAYS = 180

TIER_FRESH = "fresh"
TIER_AGED = "aged"
TIER_STALE = "stale"

DEFAULT_REFRESH_FLOOR = 3  # min usable comps before a fresh scrape is justified

# Sources the store knows about, in cost order (already-bought Apify pools
# first, then the free scraper, then metered fallbacks) — used by
# load_best_entry when several sources hold a pool for the same city.
KNOWN_SOURCES = ("apify", "homeharvest", "rentcast", "rapidapi")

# Kept for check_api_budgets display compatibility.
DEFAULT_TTL_DAYS = REUSE_MAX_AGE_DAYS


class CompStoreEntry(NamedTuple):
    """Immutable view of one stored city pool."""

    items: List[dict]
    source: str
    age_days: int
    tier: str  # TIER_FRESH | TIER_AGED | TIER_STALE
    fetched_at: datetime


def store_dir() -> Path:
    override = os.getenv("COMP_STORE_DIR")
    return Path(override) if override else DEFAULT_STORE_DIR


# Back-compat alias used by check_api_budgets (was the .tmp cache dir).
CACHE_DIR = DEFAULT_STORE_DIR


def _ttl_override_days() -> Optional[float]:
    """COMPS_CACHE_TTL_DAYS, when set, acts as a hard TTL (0 = bypass)."""
    raw = os.getenv("COMPS_CACHE_TTL_DAYS")
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _refresh_floor() -> int:
    try:
        return max(1, int(os.getenv("COMPS_REFRESH_FLOOR", str(DEFAULT_REFRESH_FLOOR))))
    except ValueError:
        return DEFAULT_REFRESH_FLOOR


def _slug(city: str, state: str, zip_code: Optional[str] = None) -> str:
    key = f"{zip_code}-{state}" if zip_code else f"{city}-{state}"
    return re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")


def _entry_path(source: str, city: str, state: str, zip_code: Optional[str] = None) -> Path:
    return store_dir() / f"{source}_{_slug(city, state, zip_code)}.json"


def tier_for_age(age_days: float) -> str:
    """Map a pool age in days onto the reuse policy tier."""
    if age_days <= FRESH_MAX_AGE_DAYS:
        return TIER_FRESH
    if age_days <= REUSE_MAX_AGE_DAYS:
        return TIER_AGED
    return TIER_STALE


def usable_comp_count(items: Sequence[dict]) -> int:
    """
    Count items that can anchor a valuation: anything carrying a positive
    price. Handles both processed comp dicts (sale_price) and raw Zillow items
    (price / soldPrice, possibly nested dicts).
    """
    count = 0
    for item in items or []:
        if not isinstance(item, dict):
            continue
        price = item.get("sale_price")
        if price is None:
            price = item.get("price") or item.get("soldPrice")
        if isinstance(price, dict):
            price = price.get("price") or price.get("value") or price.get("amount")
        if isinstance(price, (int, float)) and price > 0:
            count += 1
    return count


def _adopt_legacy_entry(source: str, city: str, state: str) -> Optional[Path]:
    """Copy a legacy .tmp/comps_cache entry into the durable store (best effort)."""
    legacy = LEGACY_CACHE_DIR / f"{source}_{_slug(city, state)}.json"
    try:
        if not legacy.exists():
            return None
        target = _entry_path(source, city, state)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(legacy.read_text(encoding="utf-8"), encoding="utf-8")
        logger.info(f"comp store adopted legacy cache entry {legacy.name}")
        return target
    except Exception as e:  # migration must never break a run
        logger.warning(f"comp store legacy adoption failed for {legacy.name}: {e}")
        return None


def load_entry(
    source: str,
    city: str,
    state: str,
    zip_code: Optional[str] = None,
) -> Optional[CompStoreEntry]:
    """
    Return the stored pool for (source, city/zip, state) with its age tier,
    regardless of tier — callers decide what a STALE pool is good for.
    Returns None when missing/corrupt or when COMPS_CACHE_TTL_DAYS=0. Never raises.
    """
    if (override := _ttl_override_days()) is not None and override <= 0:
        return None
    path = _entry_path(source, city, state, zip_code)
    try:
        if not path.exists():
            if zip_code is None:
                path = _adopt_legacy_entry(source, city, state)
            if path is None or not path.exists():
                return None
        payload = json.loads(path.read_text(encoding="utf-8"))
        fetched_at = datetime.fromisoformat(payload["fetched_at"])
        age = datetime.now() - fetched_at
        if override is not None:
            tier = TIER_FRESH if age <= timedelta(days=override) else TIER_STALE
        else:
            tier = tier_for_age(age / timedelta(days=1))
        return CompStoreEntry(
            items=payload.get("items") or [],
            source=payload.get("source") or source,
            age_days=age.days,
            tier=tier,
            fetched_at=fetched_at,
        )
    except Exception as e:  # corrupt store must never break a run
        logger.warning(f"comp store read failed for {path.name if path else source}: {e}")
        return None


def load_cached_items(
    source: str,
    city: str,
    state: str,
    zip_code: Optional[str] = None,
) -> Optional[List[dict]]:
    """
    Serve a stored pool when the reuse policy allows (FRESH or AGED tier and
    the usable-comp floor is met), else None. This is the drop-in replacement
    for the old flat-TTL read used by the source clients. Never raises.
    """
    entry = load_entry(source, city, state, zip_code)
    if entry is None or entry.tier == TIER_STALE:
        return None
    if usable_comp_count(entry.items) < _refresh_floor():
        logger.info(
            f"comp store pool for {city}, {state} ({source}) is below the "
            f"usable-comp floor — eligible for refresh"
        )
        return None
    logger.info(
        f"comp store HIT for {city}, {state} ({source}, age {entry.age_days}d, "
        f"tier {entry.tier.upper()}) — no API spend"
    )
    return entry.items


def load_best_entry(
    city: str,
    state: str,
    zip_code: Optional[str] = None,
    sources: Sequence[str] = KNOWN_SOURCES,
    min_usable: Optional[int] = None,
) -> Optional[CompStoreEntry]:
    """
    Best reusable pool for a city across sources: freshest tier wins, then the
    KNOWN_SOURCES cost order, so a fresh Apify pool beats an aged HomeHarvest
    one but never the other way round. Returns None when nothing inside the
    reuse window clears the usable-comp floor — i.e. the city needs a scrape.
    """
    floor = min_usable if min_usable is not None else _refresh_floor()
    best: Optional[CompStoreEntry] = None
    best_rank = None
    tier_rank = {TIER_FRESH: 0, TIER_AGED: 1}
    for idx, source in enumerate(sources):
        entry = load_entry(source, city, state, zip_code)
        if entry is None or entry.tier == TIER_STALE:
            continue
        if usable_comp_count(entry.items) < floor:
            continue
        rank = (tier_rank[entry.tier], idx, entry.age_days)
        if best_rank is None or rank < best_rank:
            best, best_rank = entry, rank
    return best


def save_cached_items(
    source: str,
    city: str,
    state: str,
    items: List[dict],
    zip_code: Optional[str] = None,
) -> None:
    """Persist a fetched city pool with its source tag. Never raises."""
    if (override := _ttl_override_days()) is not None and override <= 0:
        return
    if not items:
        return
    try:
        path = _entry_path(source, city, state, zip_code)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "fetched_at": datetime.now().isoformat(),
                    "source": source,
                    "items": items,
                }
            ),
            encoding="utf-8",
        )
    except Exception as e:
        logger.warning(f"comp store write failed for {city}, {state}: {e}")
