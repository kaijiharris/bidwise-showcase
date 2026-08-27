"""
HomeHarvest ($0) sold-comps source for the GA county pipeline.
==============================================================
HomeHarvest (pip, MIT) scrapes realtor.com's public search API and returns
MLS-sourced CLOSED sales — the same FMLS/GAMLS transactions Zillow shows.
Vault research 2026-07-02 (internal-notes/research/
2026-07-02-comps-resilience-and-deal-analysis.md) live-tested it from this
machine: 2,499 Decatur sold records in 11.6s, 100% with sold price/date,
8.65% median ARV delta vs the stored Apify baseline. Endorsed as the free
fallback layer (Zillow-on-RapidAPI is dead — all 8 hosts 404).

Slot in the cost-ordered chain (operator directive 2026-07-12):
  comp store -> HomeHarvest (free) -> Apify fresh (budget-gated)
             -> RentCast (50 free/mo) -> assessor ARV

Reliability posture: it is a scraper and realtor.com periodically 403-blocks
it (history shows multi-month degradation windows). Every failure path here
degrades to the next chain layer by returning [] — a HomeHarvest outage must
NEVER crash or block a run. Version pinned to 0.8.18 (the release the vault
research validated).

Results are written into the shared comp store tagged source="homeharvest" so
the confidence system can discount them independently of Apify pools.
"""
import sys
from pathlib import Path
from typing import Dict, List, Optional

from loguru import logger

# Allow running standalone as well as via the pipeline package
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from execution.utils.comps_cache import load_cached_items, save_cached_items

try:
    from homeharvest import scrape_property  # noqa: F401
    HOMEHARVEST_AVAILABLE = True
except Exception:  # ImportError or any import-time breakage in the scraper
    HOMEHARVEST_AVAILABLE = False

# Match the Apify primary's 12-month sold window so ARV math sees the same
# look-back regardless of which source filled the pool.
PAST_DAYS = 365
# City pools are capped like the Apify sweeps (maxItems=500) to keep store
# entries comparable in size and the per-run filter cost bounded.
MAX_POOL_SIZE = 500


class HomeHarvestComps:
    """Free realtor.com sold-comps client (fallback-chain interface)."""

    def __init__(self):
        if not HOMEHARVEST_AVAILABLE:
            raise ValueError(
                "homeharvest not installed — run: pip install homeharvest==0.8.18"
            )
        self.logger = logger.bind(service="HomeHarvest")
        self.logger.info("HomeHarvest comps client initialized (free tier of the chain)")

    def get_sold_properties(
        self,
        city: str,
        state_code: str,
        bedrooms: Optional[int] = None,
        bathrooms: Optional[int] = None,
        max_price: Optional[int] = None,
        limit: int = 25,
    ) -> List[Dict]:
        """
        Recently sold MLS records for a city in the pipeline's canonical comp
        shape. All errors degrade to [] (next chain layer), never raise.
        """
        try:
            cached = load_cached_items("homeharvest", city, state_code)
            if cached is not None:
                return self._apply_filters(cached, bedrooms, bathrooms, max_price)[:limit]

            comps = self._scrape_city(city, state_code)
            if comps:
                save_cached_items("homeharvest", city, state_code, comps)
            return self._apply_filters(comps, bedrooms, bathrooms, max_price)[:limit]
        except Exception as e:
            # Scraper-class source: enforcement windows (403s), schema drift and
            # pandas quirks are all expected failure modes. Log loudly, hand the
            # city to the next layer.
            self.logger.warning(
                f"HomeHarvest fetch failed for {city}, {state_code} — degrading "
                f"to the next comps layer. Cause: {e}"
            )
            return []

    def _scrape_city(self, city: str, state_code: str) -> List[Dict]:
        """One realtor.com sold sweep -> canonical comp dicts (may raise)."""
        location = f"{city}, {state_code}"
        self.logger.info(f"HomeHarvest sold sweep for {location} ($0, realtor.com)")
        df = scrape_property(
            location=location,
            listing_type="sold",
            past_days=PAST_DAYS,
            extra_property_data=False,  # vault-validated flag: faster, fewer 403s
        )
        if df is None or getattr(df, "empty", True):
            self.logger.warning(f"HomeHarvest returned no rows for {location}")
            return []

        comps: List[Dict] = []
        city_lower = city.lower()
        for row in df.to_dict("records"):
            comp = self._row_to_comp(row)
            if comp is None:
                continue
            # Post-fetch city filter — the vault backtest saw ~0.2% stray rows
            # from neighboring markets leak into city queries.
            row_city = str(row.get("city") or "").lower()
            if row_city and row_city != city_lower:
                continue
            comps.append(comp)
            if len(comps) >= MAX_POOL_SIZE:
                break
        self.logger.info(f"HomeHarvest found {len(comps)} usable sold comps in {location}")
        return comps

    @staticmethod
    def _row_to_comp(row: Dict) -> Optional[Dict]:
        """Map one HomeHarvest row to the canonical comp dict (None = drop)."""
        # NaN is truthy, so `sold_price or list_price` would keep a NaN sold
        # price instead of falling back — check each candidate explicitly.
        price = None
        for key in ("sold_price", "list_price"):
            candidate = row.get(key)
            if isinstance(candidate, (int, float)) and candidate == candidate and candidate > 0:
                price = candidate
                break
        if price is None:
            return None
        address = ", ".join(
            str(part)
            for part in (
                row.get("full_street_line") or row.get("street"),
                row.get("city"),
                f"{row.get('state') or ''} {row.get('zip_code') or ''}".strip(),
            )
            if part
        ) or "Unknown"

        def _num(value):
            if isinstance(value, (int, float)) and value == value:
                return value
            return None

        return {
            "address": address,
            "sale_price": price,
            "sale_date": str(row.get("last_sold_date")) if row.get("last_sold_date") else None,
            "bedrooms": _num(row.get("beds")),
            "bathrooms": _num(row.get("full_baths")),
            "sqft": _num(row.get("sqft")),
            "year_built": _num(row.get("year_built")),
            "latitude": _num(row.get("latitude")),
            "longitude": _num(row.get("longitude")),
            "distance_miles": None,
            "source": "HomeHarvest",
        }

    @staticmethod
    def _apply_filters(
        comps: List[Dict],
        bedrooms: Optional[int],
        bathrooms: Optional[int],
        max_price: Optional[int],
    ) -> List[Dict]:
        """Same downstream criteria the Apify path applies (beds/baths ±1)."""
        filtered = []
        for comp in comps or []:
            if bedrooms and comp.get("bedrooms") and abs(comp["bedrooms"] - bedrooms) > 1:
                continue
            if bathrooms and comp.get("bathrooms") and abs(comp["bathrooms"] - bathrooms) > 1:
                continue
            if max_price and comp.get("sale_price") and comp["sale_price"] > max_price:
                continue
            filtered.append(comp)
        return filtered
