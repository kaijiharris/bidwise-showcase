"""
DeKalb County Property Enrichment — Automated Spec Retrieval
=============================================================
Gets actual beds / baths / sqft / year_built for any DeKalb parcel.

Data source priority:
  1. DeKalb County PARCEL_TAX_JOIN (ArcGIS Online, public, free)
     Layer: services2.arcgis.com/IxVN2oUE9EYLSnPE/…/PARCEL_TAX_JOIN/FeatureServer/0
     Key fields: SFLA (sqft living area), RMBED (beds), FIXBATH (full baths),
                 FIXHALF (half baths), YRBLT (year built), TOTAPR1 (appraised value)
     Parcel ID format: "06 280 06 039"  (2+3+2+3 with spaces)

  2. Google Search via Apify + Gemini parsing
     Searches "{street}, {city} GA beds baths sqft site:zillow.com OR site:redfin.com"
     Gemini extracts structured data from search snippets.

  3. None (returns empty dict — caller handles as unknown)

Usage:
    enricher = DeKalbArcGISEnricher(apify_key=..., gemini_key=...)
    specs = enricher.get_specs("0628006039")
    # Returns: {sqft, beds, baths, year_built, assessed_value, appraised_value,
    #           data_source, data_confidence}
"""

import os
import re
import json
import time
import requests
from typing import Optional, Dict
from loguru import logger

from execution.utils.http_client import http_get


# ── ArcGIS Online — PARCEL_TAX_JOIN ─────────────────────────────────────────
ARCGIS_URL = (
    "https://services2.arcgis.com/IxVN2oUE9EYLSnPE/arcgis/rest/services"
    "/PARCEL_TAX_JOIN/FeatureServer/0/query"
)

# Fields we actually need (reduces response size)
ARCGIS_FIELDS = ",".join([
    "PARCELID", "SFLA", "RMBED", "FIXBATH", "FIXHALF",
    "YRBLT", "STORIES", "TOTAPR1", "assessed_value", "Appraised_value",
    "CLASSDSCRP",    # property class description (e.g. "R3" = residential)
    "USEDSCRP",      # use description (e.g. "Single Family Residential")
    "SITEADDRESS",   # site address from assessor
    "BLDGAREA",      # total building area (fallback if SFLA null)
    "RESFLRAREA",    # residential floor area (another sqft fallback)
    # NOTE: lot size fields (LOTAC, LOTAREA) excluded — field names unverified for this layer.
    # When confirmed, add them back and uncomment the lot_acres extraction below.
])


def _normalize_to_spaced(parcel_id: str) -> str:
    """
    Convert any parcel ID format to the spaced form required by PARCEL_TAX_JOIN.

    Examples:
        "0628006039"   → "06 280 06 039"
        "06-280-06-039"→ "06 280 06 039"
        "06 280 06 039"→ "06 280 06 039"  (already correct)

    DeKalb parcel ID structure: XX XXX XX XXX  (2+3+2+3 digits)
    """
    digits = re.sub(r'\D', '', parcel_id)
    if len(digits) != 10:
        return parcel_id  # Can't normalize — return as-is
    return f"{digits[0:2]} {digits[2:5]} {digits[5:7]} {digits[7:10]}"


class DeKalbArcGISEnricher:
    """
    Retrieves actual property characteristics for DeKalb County parcels.
    Falls back through multiple sources automatically.
    """

    def __init__(self, apify_key: Optional[str] = None, gemini_key: Optional[str] = None):
        self.apify_key = apify_key or os.getenv("APIFY_API_KEY")
        self.gemini_key = gemini_key or os.getenv("GEMINI_API_KEY")
        self._cache: Dict[str, dict] = {}

    # ────────────────────────────────────────────────────────────────────────
    # PUBLIC ENTRY POINT
    # ────────────────────────────────────────────────────────────────────────

    def get_specs(self, parcel_id: str, address: str = "", city: str = "") -> dict:
        """
        Get property specs for a DeKalb parcel.

        Args:
            parcel_id : Parcel ID in any format (e.g. "0628006039")
            address   : Street address (used as Google fallback)
            city      : City name (used as Google fallback)

        Returns:
            dict with keys:
                sqft, beds, baths, year_built,
                assessed_value, appraised_value,
                property_class, assessor_address,
                data_source, data_confidence
            All values may be None if not found.
        """
        if parcel_id in self._cache:
            return self._cache[parcel_id]

        # Method 1: ArcGIS Online PARCEL_TAX_JOIN
        arcgis_result = self._from_arcgis(parcel_id)
        if arcgis_result.get("sqft") or arcgis_result.get("beds"):
            arcgis_result["data_source"] = "DeKalb ArcGIS (PARCEL_TAX_JOIN)"
            arcgis_result["data_confidence"] = "HIGH"
            logger.info(f"ArcGIS OK for {parcel_id}: {arcgis_result}")
            self._cache[parcel_id] = arcgis_result
            return arcgis_result

        # ArcGIS found the parcel but has no building specs — check if it's vacant land
        arcgis_found = bool(arcgis_result.get("appraised_value") or arcgis_result.get("assessor_address") or arcgis_result.get("property_class"))
        has_building = bool(arcgis_result.get("sqft") or arcgis_result.get("year_built") or arcgis_result.get("beds"))

        if arcgis_found and not has_building:
            logger.info(f"ArcGIS found {parcel_id} but no building specs (vacant land). Skipping Google fallback.")
            arcgis_result["data_source"] = "DeKalb ArcGIS (Vacant Land)"
            arcgis_result["data_confidence"] = "HIGH"
            self._cache[parcel_id] = arcgis_result
            return arcgis_result

        arcgis_city = self._extract_city_from_address(arcgis_result.get("assessor_address", ""))
        google_city = arcgis_city or city  # prefer ArcGIS-returned city over caller-supplied

        logger.warning(f"ArcGIS returned no specs for {parcel_id} — trying Google fallback (city={google_city!r})")

        # Method 2: Google Search + Gemini parsing
        if address and self.apify_key and self.gemini_key:
            google_result = self._from_google_search(address, google_city)
            if google_result.get("sqft") or google_result.get("beds"):
                # Merge: Google specs + ArcGIS financial/class data
                merged = {**arcgis_result, **google_result}
                merged["data_source"] = "Google Search + Gemini"
                merged["data_confidence"] = "MEDIUM"
                logger.info(f"Google fallback OK for {parcel_id}: {merged}")
                self._cache[parcel_id] = merged
                return merged

        # All methods failed — still return any ArcGIS financial/lot data we have
        logger.warning(f"All enrichment methods failed for {parcel_id}")
        fallback = {
            "sqft": None, "beds": None, "baths": None, "year_built": None,
            "assessed_value":  arcgis_result.get("assessed_value"),
            "appraised_value": arcgis_result.get("appraised_value"),
            "property_class":  arcgis_result.get("property_class"),
            "assessor_address": arcgis_result.get("assessor_address"),
            "lot_acres":       None,
            "data_source": "NOT_FOUND", "data_confidence": "NONE",
        }
        self._cache[parcel_id] = fallback
        return fallback

    # Known DeKalb County cities/communities (covers multi-word names first)
    _DEKALB_CITIES = [
        "Stone Mountain", "Avondale Estates", "Pine Lake", "Peachtree Corners",
        "Druid Hills", "Gresham Park", "Belvedere Park", "Lake City",
        "Panthersville", "Ellenwood", "Scottdale", "Clarkston", "Doraville",
        "Dunwoody", "Chamblee", "Decatur", "Lithonia", "Tucker", "Conley",
        "Atlanta", "Redan", "Columbia", "Flat Rock",
    ]

    @classmethod
    def _extract_city_from_address(cls, assessor_address: str) -> str:
        """Pull city from ArcGIS SITEADDRESS like '3935 South River Lane Ellenwood, GA 30294'.
        Handles multi-word city names like 'Stone Mountain'."""
        if not assessor_address:
            return ""
        # Try known cities first (longest match wins, case-insensitive)
        addr_upper = assessor_address.upper()
        for city in sorted(cls._DEKALB_CITIES, key=len, reverse=True):
            if city.upper() in addr_upper:
                return city
        # Fallback: last word(s) before ", GA XXXXX"
        match = re.search(r'([A-Za-z][A-Za-z\s]{1,25}?),\s*GA\s*\d{5}', assessor_address)
        if match:
            # Strip leading street-type words (Lane, Road, etc.) if city bleeding
            return match.group(1).strip().split()[-1]
        return ""

    # ────────────────────────────────────────────────────────────────────────
    # METHOD 1: DeKalb ArcGIS Online PARCEL_TAX_JOIN
    # ────────────────────────────────────────────────────────────────────────

    def _from_arcgis(self, parcel_id: str) -> dict:
        """Query the public ArcGIS Online feature layer for parcel specs."""
        spaced_id = _normalize_to_spaced(parcel_id)
        params = {
            "where": f"PARCELID='{spaced_id}'",
            "outFields": ARCGIS_FIELDS,
            "returnGeometry": "false",
            "f": "json",
        }
        try:
            # Retry/backoff on transient failures (429/5xx/timeout) instead of
            # immediately degrading to {}. A persistent failure raises and is
            # logged loudly below — it is NOT silently treated as "no data".
            resp = http_get(ARCGIS_URL, params=params, timeout=20)
            resp.raise_for_status()
            data = resp.json()

            features = data.get("features", [])
            if not features:
                logger.debug(f"ArcGIS: no features for parcel '{spaced_id}'")
                return {}

            attrs = features[0].get("attributes", {})
            logger.debug(f"ArcGIS raw attrs for {parcel_id}: {attrs}")

            # baths = full baths + 0.5 per half bath
            full_baths = attrs.get("FIXBATH") or 0
            half_baths = attrs.get("FIXHALF") or 0
            baths = (full_baths + half_baths * 0.5) if (full_baths or half_baths) else None

            # SFLA = heated living area (primary); fall back to RESFLRAREA then BLDGAREA
            sqft = attrs.get("SFLA") or attrs.get("RESFLRAREA") or attrs.get("BLDGAREA")
            beds = attrs.get("RMBED")
            year_built = attrs.get("YRBLT")
            appraised = attrs.get("Appraised_value") or attrs.get("TOTAPR1")
            assessed = attrs.get("assessed_value")
            prop_class = attrs.get("CLASSDSCRP") or attrs.get("USEDSCRP")
            site_addr = attrs.get("SITEADDRESS")

            # Treat 0 values as None (assessor puts 0 for commercial/land with no structure)
            sqft = int(sqft) if sqft and sqft > 0 else None
            beds = int(beds) if beds and beds > 0 else None
            year_built = int(year_built) if year_built and year_built > 1800 else None
            if baths == 0:
                baths = None

            return {
                "sqft": sqft,
                "beds": beds,
                "baths": baths,
                "year_built": year_built,
                "assessed_value":  float(assessed)  if assessed  else None,
                "appraised_value": float(appraised) if appraised else None,
                "property_class":  prop_class,
                "assessor_address": site_addr,
                "lot_acres":        None,  # requires verified field name — see ARCGIS_FIELDS note
            }

        except Exception as e:
            # Loud failure after retries are exhausted. This is a degraded run,
            # not a clean "no data" — surfaced at ERROR so it can't pass silently.
            logger.error(f"ArcGIS enrichment FAILED (after retries) for {parcel_id}: {e}")
            return {}

    # ────────────────────────────────────────────────────────────────────────
    # METHOD 2: Google Search + Gemini parsing
    # ────────────────────────────────────────────────────────────────────────

    def _from_google_search(self, address: str, city: str) -> dict:
        """
        Search Google for the property and parse snippets with Gemini.

        Searches multiple queries to maximize hit rate:
          - "{address} {city} GA real estate"
          - "{address} {city} GA zillow"
          - "{address} {city} GA redfin"
        """
        try:
            from apify_client import ApifyClient
            import google.generativeai as genai

            client = ApifyClient(self.apify_key)
            genai.configure(api_key=self.gemini_key)

            search_queries = [
                f"{address} {city} GA real estate",
                f"{address} {city} GA zillow beds baths sqft",
                f"{address} {city} GA redfin",
            ]
            # Filter out empty parts
            search_queries = [q.strip() for q in search_queries if q.strip()]

            logger.info(f"Google search for: {search_queries[0]}")

            run = client.actor("apify/google-search-scraper").call(run_input={
                "queries": "\n".join(search_queries),
                "resultsPerPage": 5,
                "countryCode": "us",
            }, timeout_secs=90)

            items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
            snippets = []
            for item in items:
                for res in item.get("organicResults", []):
                    title = res.get("title", "")
                    desc = res.get("description", "")
                    if title or desc:
                        snippets.append(f"Title: {title}\nSnippet: {desc}")

            if not snippets:
                logger.warning(f"No Google snippets for {address}")
                return {}

            combined = "\n---\n".join(snippets[:12])  # Cap to keep prompt small
            return self._parse_with_gemini(address, city, combined)

        except Exception as e:
            logger.error(f"Google search error for {address}: {e}")
            return {}

    def _parse_with_gemini(self, address: str, city: str, snippets: str) -> dict:
        """Use Gemini to extract structured property data from search snippets."""
        try:
            import google.generativeai as genai

            model = genai.GenerativeModel("gemini-2.5-flash")
            prompt = f"""You are a real estate data extraction assistant.

I searched Google for a property at: {address}, {city}, GA

Below are search result snippets from Zillow, Redfin, Realtor.com and similar sites.
Extract the property characteristics for THIS SPECIFIC address (not nearby listings).

Return ONLY valid JSON with this exact schema:
{{
  "sqft": <integer or null>,
  "beds": <integer or null>,
  "baths": <float or null>,
  "year_built": <integer or null>,
  "property_type": <"Single Family" | "Condo" | "Townhouse" | "Multi-Family" | "Land" | null>
}}

Rules:
- Only extract data that clearly refers to {address}
- If a snippet mentions another address, ignore it
- If you cannot confidently determine a field, return null
- Do NOT guess or infer from neighborhood context
- sqft refers to LIVING AREA / HEATED SQFT only (not lot size)

Search snippets:
{snippets}
"""
            generation_config = genai.types.GenerationConfig(
                temperature=0.1,
                response_mime_type="application/json",
            )
            response = model.generate_content(prompt, generation_config=generation_config)
            text = response.text.strip()
            # Strip markdown fences if present
            text = re.sub(r"^```json\s*", "", text)
            text = re.sub(r"\s*```$", "", text)

            parsed = json.loads(text)
            return {
                "sqft": parsed.get("sqft"),
                "beds": parsed.get("beds"),
                "baths": parsed.get("baths"),
                "year_built": parsed.get("year_built"),
                "property_class": parsed.get("property_type"),
                "assessed_value": None,
                "appraised_value": None,
                "assessor_address": None,
            }

        except Exception as e:
            logger.error(f"Gemini parsing error for {address}: {e}")
            return {}


# ── Standalone test ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import dotenv
    from pathlib import Path
    dotenv.load_dotenv(Path(__file__).parent.parent.parent / ".env")

    enricher = DeKalbArcGISEnricher()

    test_cases = [
        ("0628006039", "3050 BERNAUER TRCE", "Dunwoody"),
        ("0630701029", "5249 ARRIE WAY",     "Dunwoody"),
        ("0630701032", "5264 ARRIE WAY",     "Dunwoody"),
        ("0630701059", "5277 WINTERS CHAPEL RD", "Dunwoody"),
        ("0630701095", "5246 MARSTON RD",    "Dunwoody"),
        ("0624901010", "4340 BANKERS CIR",   "Doraville"),   # Known industrial — should return no sqft
    ]

    print("\n=== DeKalb ArcGIS Enrichment Test ===\n")
    for pid, addr, city in test_cases:
        print(f"Parcel: {pid}  |  {addr}, {city}")
        specs = enricher.get_specs(pid, addr, city)
        print(f"  sqft={specs.get('sqft')}  beds={specs.get('beds')}  "
              f"baths={specs.get('baths')}  yr={specs.get('year_built')}  "
              f"appr=${specs.get('appraised_value')}  "
              f"class={specs.get('property_class')}  "
              f"src={specs.get('data_source')}")
        print()
        time.sleep(0.3)
