"""
RentCast comps fallback for the GA county pipeline.

Fetches recently-removed (status=Inactive) sale listings for a city as a
sold-comps proxy — RentCast's /listings/sale endpoint has no "Sold" status,
so the last list price of a removed listing stands in for the sold price.
Interface mirrors RapidAPIComps / ApifyZillowComps comp dicts so
run_ga_county's fallback chain can use any of them interchangeably.

Vendor decision: internal-notes/business/attom-pivot-analysis-2026-06-30.md
(RentCast named as the no-contract paid fallback; gated on RENTCAST_API_KEY).
Wired 2026-07-04 as the second layer of the comps fallback chain.
"""
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

import dotenv
import requests
from loguru import logger

# Load the project .env so the client works standalone (mirrors rapidapi_comps).
_ROOT = Path(__file__).resolve().parent.parent.parent
dotenv.load_dotenv(_ROOT / ".env")

if __package__ in (None, ""):
    sys.path.insert(0, str(_ROOT))

from execution.utils.comps_cache import load_cached_items, save_cached_items
from execution.utils.rentcast_budget import check_budget, record_call

RENTCAST_BASE_URL = "https://api.rentcast.io/v1"
# Inactive sale listings removed within this many days form the comp pool —
# roughly matches the pipeline's 12-month Apify comp window.
MAX_LISTING_AGE_DAYS = 365


class RentCastComps:
    """Client for RentCast inactive sale listings used as sold comps."""

    def __init__(self):
        self.api_key = os.getenv("RENTCAST_API_KEY")
        if not self.api_key:
            logger.warning("RENTCAST_API_KEY not found - RentCast comps unavailable")
            raise ValueError("RENTCAST_API_KEY not found in environment variables")

        self.headers = {
            "X-Api-Key": self.api_key,
            "Accept": "application/json",
        }
        self.logger = logger.bind(service="RentCast")
        self.logger.info("RentCast client initialized successfully")

    def get_sold_properties(
        self,
        city: str,
        state_code: str,
        bedrooms: Optional[int] = None,
        bathrooms: Optional[int] = None,
        max_price: Optional[int] = None,   # accepted for interface parity; unused
        limit: int = 10,
    ) -> List[Dict]:
        """
        Get recently-removed sale listings (sold-price proxy) for a city.

        Returns a list of comp dicts in the pipeline's canonical shape:
        address / sale_price / sale_date / bedrooms / bathrooms / sqft /
        year_built / distance_miles / source.
        """
        try:
            # Disk cache (7-day TTL) — one API call per city per cycle, not per run
            # (free tier is 50 calls/month; 2026-07-05 usage discipline).
            cached = load_cached_items("rentcast", city, state_code)
            if cached is not None:
                return cached[:limit]

            # Free tier is 50 calls/month with no vendor usage endpoint — refuse
            # once the local counter says we're at 90% so one session can't max it.
            if not check_budget():
                return []

            params = {
                "city": city,
                "state": state_code,
                "status": "Inactive",             # no 'Sold' status; removed ≈ sold
                "propertyType": "Single Family",  # keep the pool residential
                "daysOld": MAX_LISTING_AGE_DAYS,
                "limit": max(1, min(limit, 500)),
            }
            if bedrooms:
                params["bedrooms"] = bedrooms
            if bathrooms:
                params["bathrooms"] = bathrooms

            self.logger.info(f"Fetching RentCast inactive sale listings for {city}, {state_code}")
            response = requests.get(
                f"{RENTCAST_BASE_URL}/listings/sale",
                headers=self.headers, params=params, timeout=15,
            )
            # Any response that reached RentCast consumes a monthly call — count
            # it before branching on status (a network error never gets here).
            record_call()

            if response.status_code in (401, 403):
                self.logger.warning(
                    f"RentCast auth/quota error ({response.status_code}) — "
                    "check RENTCAST_API_KEY and plan limits"
                )
                return []
            if response.status_code != 200:
                self.logger.warning(f"RentCast request failed: {response.status_code}")
                return []

            data = response.json()
            listings = data if isinstance(data, list) else (data or {}).get("listings", [])

            comps = []
            for item in listings[:limit]:
                comp = {
                    "address": item.get("formattedAddress") or item.get("addressLine1") or "Unknown",
                    # Last list price of a removed listing — closest available
                    # proxy for the sold price on this endpoint.
                    "sale_price": item.get("price"),
                    "sale_date": item.get("removedDate") or item.get("lastSeenDate"),
                    "bedrooms": item.get("bedrooms"),
                    "bathrooms": item.get("bathrooms"),
                    "sqft": item.get("squareFootage"),
                    "year_built": item.get("yearBuilt"),
                    # Pin coordinates for the dashboard comps map (2026-07-05)
                    "latitude": item.get("latitude"),
                    "longitude": item.get("longitude"),
                    "distance_miles": None,  # not provided for city-level queries
                    "source": "RentCast",
                }
                if comp["sale_price"] and comp["sale_price"] > 0:
                    comps.append(comp)

            save_cached_items("rentcast", city, state_code, comps)
            self.logger.info(f"Found {len(comps)} RentCast comps")
            return comps

        except requests.exceptions.RequestException as e:
            self.logger.error(f"Network error fetching RentCast comps: {e}")
            return []
        except Exception as e:
            self.logger.error(f"Error fetching RentCast comps: {e}")
            return []
