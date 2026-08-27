"""
Gwinnett County Property Enrichment — ArcGIS REST
==================================================
Gets beds / baths / sqft / year_built / appraised_value for any Gwinnett parcel.

Data source priority:
  1. Gwinnett Property_and_Tax FeatureServer (public, free)
     Table 8 (Property Improvements): NUMBDRMS, NUM2BATHS, NUM3BATHS, FINSIZE, YRBUILT
     Table 3 (Tax Master):            TOTVAL1 (appraised), PROPCLAS, PCDESC
     Parcel ID format: "R7230 047" — as-is from the PDF (with optional trailing spaces)

  2. Google Search via Apify + Gemini parsing (fallback)

  3. None (returns empty dict — caller handles as unknown)

Usage:
    enricher = GwinnettArcGISEnricher()
    specs = enricher.get_specs("R7230 047")
    # Returns: {sqft, beds, baths, year_built, appraised_value, assessed_value,
    #           property_class, assessor_address, data_source, data_confidence}
"""

import os
import re
import json
import time
import requests
from typing import Optional, Dict

from execution.utils.http_client import http_get
from loguru import logger

# ── ArcGIS Online — Property_and_Tax FeatureServer ──────────────────────────
ARCGIS_BASE = (
    "https://services3.arcgis.com/RfpmnkSAQleRbndX"
    "/arcgis/rest/services/Property_and_Tax/FeatureServer"
)
TABLE_IMPROVEMENTS = f"{ARCGIS_BASE}/8/query"   # beds, baths, sqft, year built
TABLE_TAX_MASTER   = f"{ARCGIS_BASE}/3/query"   # appraised value, property class

IMPROVEMENTS_FIELDS = "PIN,NUMBDRMS,NUM2BATHS,NUM3BATHS,NUM4BATHS,NUM5BATHS,FINSIZE,YRBUILT,USECODE,USEDESC"
TAX_MASTER_FIELDS   = "RPIN,TOTVAL1,DWLGVAL1,PROPCLAS,PCDESC,LOCADDR,LOCCITY,LOCZIP,LEGALAC,ZONING"


def _normalize_pin(parcel_id: str) -> str:
    """
    Gwinnett PINs look like 'R7230 047' or 'R5329 047' — strip trailing spaces only.
    The FeatureServer stores them with trailing whitespace; we query with LIKE to handle it.
    """
    return parcel_id.strip()


class GwinnettArcGISEnricher:
    """
    Retrieves property characteristics for Gwinnett County parcels.
    Falls back through multiple sources automatically.
    """

    def __init__(self, apify_key: Optional[str] = None, gemini_key: Optional[str] = None):
        self.apify_key  = apify_key  or os.getenv("APIFY_API_KEY")
        self.gemini_key = gemini_key or os.getenv("GEMINI_API_KEY")
        self._cache: Dict[str, dict] = {}

    # ─────────────────────────────────────────────────────────────────────────
    # PUBLIC ENTRY POINT
    # ─────────────────────────────────────────────────────────────────────────

    def get_specs(self, parcel_id: str, address: str = "", city: str = "") -> dict:
        """
        Returns dict with: sqft, beds, baths, year_built, appraised_value,
        assessed_value, property_class, assessor_address, data_source, data_confidence
        """
        key = _normalize_pin(parcel_id)
        if key in self._cache:
            return self._cache[key]

        result = self._from_arcgis(key)
        if result.get("sqft") or result.get("beds"):
            result["data_source"]     = "Gwinnett ArcGIS (Property_and_Tax)"
            result["data_confidence"] = "HIGH"
            logger.info(f"ArcGIS OK for {parcel_id}: sqft={result.get('sqft')} "
                        f"beds={result.get('beds')} yr={result.get('year_built')}")
            self._cache[key] = result
            return result

        arcgis_found = bool(result.get("appraised_value") or result.get("assessor_address") or result.get("property_class"))
        has_building = bool(result.get("sqft") or result.get("year_built") or result.get("beds"))

        if arcgis_found and not has_building:
            logger.info(f"ArcGIS found {parcel_id} but no building specs (vacant land). Skipping Google fallback.")
            result["data_source"] = "Gwinnett ArcGIS (Vacant Land)"
            result["data_confidence"] = "HIGH"
            self._cache[key] = result
            return result

        logger.warning(f"ArcGIS returned no specs for {parcel_id} — trying Google fallback")

        if address and self.apify_key and self.gemini_key:
            result = self._from_google_search(address, city)
            if result.get("sqft") or result.get("beds"):
                result["data_source"]     = "Google Search + Gemini"
                result["data_confidence"] = "MEDIUM"
                self._cache[key] = result
                return result

        logger.warning(f"All enrichment methods failed for {parcel_id}")
        result = {
            "sqft": None, "beds": None, "baths": None, "year_built": None,
            "assessed_value": None, "appraised_value": None,
            "property_class": None, "assessor_address": None,
            "lot_acres": None, "data_source": "NOT_FOUND", "data_confidence": "NONE",
        }
        self._cache[key] = result
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # METHOD 1: Gwinnett ArcGIS FeatureServer (Table 8 + Table 3)
    # ─────────────────────────────────────────────────────────────────────────

    def _from_arcgis(self, pin: str) -> dict:
        """
        Two-query approach:
          Table 8 → beds, baths, sqft, year_built
          Table 3 → appraised_value, property_class, address
        Uses LIKE '%{pin}%' to match pins with trailing whitespace in the DB.
        """
        try:
            # ── Table 8: Property Improvements ──
            imp_params = {
                "where":          f"PIN LIKE '{pin}%'",
                "outFields":      IMPROVEMENTS_FIELDS,
                "returnGeometry": "false",
                "resultRecordCount": 1,
                "f":              "json",
            }
            # Retry/backoff on transient failures; persistent failure raises and
            # is logged loudly below (not silently degraded to empty).
            imp_resp = http_get(TABLE_IMPROVEMENTS, params=imp_params, timeout=20)
            imp_resp.raise_for_status()
            imp_data = imp_resp.json()
            imp_features = imp_data.get("features", [])

            beds = baths = sqft = year_built = None
            use_desc = None

            if imp_features:
                a = imp_features[0].get("attributes", {})
                logger.debug(f"Gwinnett Table8 raw for {pin}: {a}")

                # ArcGIS returns these numeric fields as strings since the 2026
                # schema update — coerce defensively before any arithmetic.
                def _num(v) -> float:
                    try:
                        return float(v)
                    except (TypeError, ValueError):
                        return 0.0

                beds = int(_num(a.get("NUMBDRMS"))) if _num(a.get("NUMBDRMS")) > 0 else None
                sqft = int(_num(a.get("FINSIZE"))) if _num(a.get("FINSIZE")) > 0 else None
                year_built = int(_num(a.get("YRBUILT"))) if _num(a.get("YRBUILT")) > 1800 else None
                use_desc = a.get("USEDESC") or a.get("USECODE")

                # Bath count: 2-fixture=half, 3-fixture=full, 4/5-fixture=full+
                n2 = _num(a.get("NUM2BATHS"))  # half baths (toilet + sink)
                n3 = _num(a.get("NUM3BATHS"))  # full baths (toilet + sink + tub)
                n4 = _num(a.get("NUM4BATHS"))  # 4-fixture
                n5 = _num(a.get("NUM5BATHS"))  # 5-fixture
                total_baths = n3 + n4 + n5 + (n2 * 0.5)
                baths = round(total_baths, 1) if total_baths > 0 else None

            # ── Table 3: Tax Master ──
            # 2026 schema change: Table 3's PIN column dropped the R-prefix
            # ('7037 550'); the R-prefixed value lives in RPIN. Query RPIN.
            tax_params = {
                "where":          f"RPIN LIKE '{pin}%'",
                "outFields":      TAX_MASTER_FIELDS,
                "returnGeometry": "false",
                "resultRecordCount": 1,
                "f":              "json",
            }
            tax_resp = http_get(TABLE_TAX_MASTER, params=tax_params, timeout=20)
            tax_resp.raise_for_status()
            tax_data = tax_resp.json()
            tax_features = tax_data.get("features", [])

            appraised_val = assessed_val = prop_class = site_addr = lot_acres = None

            if tax_features:
                a = tax_features[0].get("attributes", {})
                logger.debug(f"Gwinnett Table3 raw for {pin}: {a}")

                def _numval(v) -> Optional[float]:
                    try:
                        f = float(str(v).strip())
                        return f if f > 0 else None
                    except (TypeError, ValueError):
                        return None

                appraised_val = _numval(a.get("TOTVAL1"))
                assessed_val  = _numval(a.get("DWLGVAL1"))
                lot_acres     = _numval(a.get("LEGALAC"))   # e.g. '      0.1500'
                prop_class    = a.get("PCDESC") or a.get("PROPCLAS") or a.get("ZONING")
                loc_addr      = a.get("LOCADDR", "")
                loc_city      = a.get("LOCCITY", "")
                loc_zip       = a.get("LOCZIP", "")
                site_addr = f"{loc_addr}, {loc_city}, GA {loc_zip}".strip(", ")

            return {
                "sqft":             sqft,
                "beds":             beds,
                "baths":            baths,
                "year_built":       year_built,
                "appraised_value":  appraised_val,
                "assessed_value":   assessed_val,
                "property_class":   prop_class or use_desc,
                "assessor_address": site_addr,
                "lot_acres":        lot_acres,
            }

        except Exception as e:
            logger.error(f"Gwinnett ArcGIS enrichment FAILED (after retries) for {pin}: {e}")
            return {}

    # ─────────────────────────────────────────────────────────────────────────
    # METHOD 2: Google Search + Gemini parsing (fallback)
    # ─────────────────────────────────────────────────────────────────────────

    def _from_google_search(self, address: str, city: str) -> dict:
        try:
            from apify_client import ApifyClient
            import google.generativeai as genai

            client = ApifyClient(self.apify_key)
            genai.configure(api_key=self.gemini_key)

            queries = [
                f"{address} {city} GA real estate",
                f"{address} {city} GA zillow beds baths sqft",
                f"{address} {city} GA redfin",
            ]
            logger.info(f"Google search for: {queries[0]}")

            run = client.actor("apify/google-search-scraper").call(run_input={
                "queries": "\n".join(queries),
                "resultsPerPage": 5,
                "countryCode": "us",
            }, timeout_secs=90)

            items    = list(client.dataset(run["defaultDatasetId"]).iterate_items())
            snippets = []
            for item in items:
                for res in item.get("organicResults", []):
                    t, d = res.get("title", ""), res.get("description", "")
                    if t or d:
                        snippets.append(f"Title: {t}\nSnippet: {d}")

            if not snippets:
                return {}
            return self._parse_with_gemini(address, city, "\n---\n".join(snippets[:12]))

        except Exception as e:
            logger.error(f"Google search error for {address}: {e}")
            return {}

    def _parse_with_gemini(self, address: str, city: str, snippets: str) -> dict:
        try:
            import google.generativeai as genai

            model  = genai.GenerativeModel("gemini-2.5-flash")
            prompt = f"""You are a real estate data extraction assistant.
Property: {address}, {city}, GA

Return ONLY valid JSON with exactly these keys:
{{
  "sqft": <heated living area as int, or null>,
  "beds": <bedroom count as int, or null>,
  "baths": <bathroom count as float, or null>,
  "year_built": <4-digit year as int, or null>,
  "property_class": <one of: "residential", "multi-family", "commercial", "retail", "industrial", "land", or null>
}}

Rules:
- Only extract data clearly about {address}.
- sqft = heated/finished living area only (not lot size).
- property_class: use "multi-family" for apartments/duplexes/complexes; "retail" for stores/gas stations/restaurants; "commercial" for offices/warehouses; "residential" for houses/condos/townhomes.
- If the property is clearly NOT a single-family home (e.g., apartment complex, gas station, strip mall), set beds=0.

Snippets:
{snippets}
"""
            cfg      = genai.types.GenerationConfig(temperature=0.1, response_mime_type="application/json")
            response = model.generate_content(prompt, generation_config=cfg)
            text     = re.sub(r"^```json\s*|\s*```$", "", response.text.strip())
            parsed   = json.loads(text)

            # Map Gemini property_class string to our canonical property_class field
            gemini_class = (parsed.get("property_class") or "").lower().strip()
            property_class = None
            if gemini_class in ("multi-family", "multifamily", "apartment"):
                property_class = "MULTI-FAMILY"
            elif gemini_class in ("commercial", "retail", "industrial", "office"):
                property_class = gemini_class.upper()
            elif gemini_class == "residential":
                property_class = "RESIDENTIAL"

            return {
                "sqft":             parsed.get("sqft"),
                "beds":             parsed.get("beds"),
                "baths":            parsed.get("baths"),
                "year_built":       parsed.get("year_built"),
                "appraised_value":  None,
                "assessed_value":   None,
                "property_class":   property_class,
                "assessor_address": None,
                "lot_acres":        None,
            }
        except Exception as e:
            logger.error(f"Gemini parsing error for {address}: {e}")
            return {}


# ── Standalone test ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import dotenv
    from pathlib import Path
    dotenv.load_dotenv(Path(__file__).parent.parent.parent / ".env")

    enricher = GwinnettArcGISEnricher()
    test_cases = [
        ("R7230 047",  "4605 BROOKFIELD DR",   "Duluth"),
        ("R5329 047",  "1600 FRANKLIN CIR",    "Lawrenceville"),
    ]

    print("\n=== Gwinnett ArcGIS Enrichment Test ===\n")
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
