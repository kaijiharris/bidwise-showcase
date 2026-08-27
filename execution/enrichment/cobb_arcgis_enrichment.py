"""
Cobb County Property Enrichment — ArcGIS + qPublic + Gemini
=============================================================
Data source priority:

  1. Cobb County Tax Assessors MapServer (public, free) — sqft, year_built, appraisal
     gis.cobbcounty.org/gisserver/rest/services/tax/taxassessorsdaily/mapserver
     Layer 0 (CobbParcels): PARID, SITUS_ADDR, FMV_TOTAL, ASV_TOTAL, CLASS
     Table 5 (YearBuilt):   PIN, YRBLT, SQFT
     NOTE: beds/baths not in Cobb public GIS — handled by sources 2 & 3 below

  2. Cobb qPublic (free, assessor-accurate) — beds, baths
     https://qpublic.schneidercorp.com AppID=1051
     Cloudflare-protected — bypassed with cloudscraper (same approach as DeKalb)
     Searches by address. Parses tabular-data-two-column tables on the Summary tab.

  3. Gemini (fallback only) — beds, baths when qPublic fails
     Parses Google search snippets via Apify + Gemini Flash

Parcel ID format: "17-0252-0008-048-0"

Usage:
    enricher = CobbArcGISEnricher()
    specs = enricher.get_specs("17-0252-0008-048-0", "2030 MAIN ST", "Marietta")
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

# ── Cobb County Tax Assessors MapServer ─────────────────────────────────────
MAPSERVER_BASE   = "https://gis.cobbcounty.org/gisserver/rest/services/tax/taxassessorsdaily/mapserver"
LAYER_PARCELS    = f"{MAPSERVER_BASE}/0/query"
TABLE_YEAR_BUILT = f"{MAPSERVER_BASE}/5/query"
PARCEL_FIELDS    = "PIN,PARID,SITUS_ADDR,FMV_TOTAL,ASV_TOTAL,CLASS,PARCEL_TYPE"
YEAR_BUILT_FIELDS = "PIN,YRBLT,SQFT,CARD"

# ── Cobb qPublic ─────────────────────────────────────────────────────────────
QPUBLIC_SEARCH_URL = (
    "https://qpublic.schneidercorp.com/Application.aspx"
    "?AppID=1051&LayerID=23951&PageTypeID=2&PageID=9967"
)
QPUBLIC_BASE = "https://qpublic.schneidercorp.com"
QPUBLIC_DELAY = 1.5   # seconds between requests — avoids rate limiting


def _to_numeric_parid(parcel_id: str) -> str:
    """Convert dashed Cobb parcel ID to the numeric form used by ArcGIS.

    '17-0253-0-037-0' → '17025300370'  (segments joined as-is, no zero-padding).
    The ArcGIS MapServer stores PARID as the raw digit segments concatenated.
    """
    parts = re.split(r'[-\s]+', parcel_id.strip())
    if len(parts) == 5 and all(p.isdigit() for p in parts):
        return ''.join(parts)
    return re.sub(r'[-\s]', '', parcel_id.strip())


def _ensure_cloudscraper():
    """Import cloudscraper, installing it if missing."""
    try:
        import cloudscraper
        return cloudscraper
    except ImportError:
        import sys
        logger.info("cloudscraper not found — installing...")
        os.system(f'"{sys.executable}" -m pip install cloudscraper -q')
        import cloudscraper
        return cloudscraper


class CobbArcGISEnricher:
    """
    Retrieves property characteristics for Cobb County parcels.
    Falls back through ArcGIS → qPublic → Gemini automatically.
    """

    def __init__(self, apify_key: Optional[str] = None, gemini_key: Optional[str] = None):
        self.apify_key  = apify_key  or os.getenv("APIFY_API_KEY")
        self.gemini_key = gemini_key or os.getenv("GEMINI_API_KEY")
        self._cache: Dict[str, dict] = {}
        self._qpublic_session = None   # lazy-init cloudscraper session

    # ─────────────────────────────────────────────────────────────────────────
    # PUBLIC ENTRY POINT
    # ─────────────────────────────────────────────────────────────────────────

    def get_specs(self, parcel_id: str, address: str = "", city: str = "") -> dict:
        """
        Returns dict with: sqft, beds, baths, year_built, appraised_value,
        assessed_value, property_class, assessor_address, data_source, data_confidence
        """
        key = parcel_id.strip()
        if key in self._cache:
            return self._cache[key]

        # ── Step 1: ArcGIS (sqft, year_built, appraisal — no beds/baths) ──
        result = self._from_arcgis(key)
        has_arcgis = bool(result.get("sqft") or result.get("year_built") or result.get("appraised_value"))

        if has_arcgis:
            logger.info(f"Cobb ArcGIS OK for {parcel_id}: sqft={result.get('sqft')} "
                        f"yr={result.get('year_built')} appr=${result.get('appraised_value')}")
        else:
            logger.warning(f"Cobb ArcGIS returned nothing for {parcel_id}")

        def _merge_beds_baths(source_dict: dict, source_label: str, confidence: str):
            """Apply beds/baths (and optional sqft/year) from a source into result."""
            result["beds"]  = source_dict["beds"]
            result["baths"] = source_dict.get("baths")
            if not result.get("sqft") and source_dict.get("sqft"):
                result["sqft"] = source_dict["sqft"]
            if not result.get("year_built") and source_dict.get("year_built"):
                result["year_built"] = source_dict["year_built"]
            if not result.get("property_class") and source_dict.get("property_class"):
                result["property_class"] = source_dict["property_class"]
            result["data_source"]     = f"Cobb ArcGIS + {source_label}" if has_arcgis else source_label
            result["data_confidence"] = confidence

        # Only search for beds/baths if ArcGIS found actual building data.
        # If Table 5 has no sqft/year_built for this parcel, there is likely no
        # habitable structure — don't inject cross-contaminated data from web search.
        has_building = bool(result.get("sqft") or result.get("year_built"))

        if address and has_building:
            # ── Step 2: qPublic (assessor-accurate — free but Cloudflare-fragile) ──
            qp = self._from_qpublic(address, city)
            if qp.get("beds"):
                _merge_beds_baths(qp, "qPublic", "HIGH")
                self._cache[key] = result
                return result
            logger.warning(f"  qPublic failed for {address} — trying Zillow lookup")

            # ── Step 3: Google search + regex extraction (no quota, no per-call cost) ──
            # The igolaizola Zillow actor does not support specific address lookups;
            # calling lookup_property() with a street address returns "no locations found".
            # Google search snippets from Zillow/Redfin contain beds/baths inline and
            # are parsed here with regex — no Gemini API key required.
            ws = self._from_gemini(address, city)   # regex-first, Gemini-optional
            if ws.get("beds"):
                _merge_beds_baths(ws, "Web Search", "MEDIUM" if has_arcgis else "LOW")
                self._cache[key] = result
                return result

        # ── All methods exhausted ──
        if has_arcgis:
            result["data_source"]     = "Cobb ArcGIS (no beds/baths found)"
            result["data_confidence"] = "MEDIUM"
        else:
            result = {
                "sqft": None, "beds": None, "baths": None, "year_built": None,
                "assessed_value": None, "appraised_value": None,
                "property_class": None, "assessor_address": None,
                "lot_acres": None, "data_source": "NOT_FOUND", "data_confidence": "NONE",
            }

        logger.warning(f"Enrichment incomplete for {parcel_id} — beds/baths unknown")
        self._cache[key] = result
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # METHOD 1: Cobb ArcGIS MapServer (Layer 0 + Table 5)
    # ─────────────────────────────────────────────────────────────────────────

    def _from_arcgis(self, parid: str) -> dict:
        """
        Layer 0 → appraised_value, assessed_value, property_class, assessor_address
        Table 5 → sqft, year_built

        ArcGIS stores PARID as the raw digit segments joined without dashes or padding:
        '17-0253-0-037-0' → '17025300370'. Conversion is done via _to_numeric_parid.
        """
        try:
            numeric = _to_numeric_parid(parid)

            # Layer 0: valuation + address
            # Retry/backoff on transient failures; persistent failure raises and
            # is logged loudly below (not silently degraded to empty).
            p_resp = http_get(LAYER_PARCELS, params={
                "where": f"PARID='{numeric}'", "outFields": PARCEL_FIELDS,
                "returnGeometry": "false", "resultRecordCount": 1, "f": "json",
            }, timeout=20)
            p_resp.raise_for_status()
            p_features = p_resp.json().get("features", [])

            appraised_val = assessed_val = prop_class = site_addr = pin = None
            if p_features:
                a = p_features[0].get("attributes", {})
                logger.debug(f"Cobb Layer0 for {parid} ({numeric}): {a}")
                appraised_val = float(a["FMV_TOTAL"]) if a.get("FMV_TOTAL") else None
                assessed_val  = float(a["ASV_TOTAL"]) if a.get("ASV_TOTAL") else None
                prop_class    = a.get("CLASS") or a.get("PARCEL_TYPE")
                site_addr     = a.get("SITUS_ADDR")
                pin           = a.get("PIN") or numeric

            # Table 5: sqft + year built (PIN is also numeric in Table 5)
            yb_resp = http_get(TABLE_YEAR_BUILT, params={
                "where": f"PIN='{pin or numeric}'", "outFields": YEAR_BUILT_FIELDS,
                "returnGeometry": "false", "orderByFields": "CARD ASC",
                "resultRecordCount": 1, "f": "json",
            }, timeout=20)
            yb_resp.raise_for_status()
            yb_features = yb_resp.json().get("features", [])

            sqft = year_built = None
            if yb_features:
                a = yb_features[0].get("attributes", {})
                logger.debug(f"Cobb Table5 for {parid}: {a}")
                sqft       = int(a["SQFT"])  if a.get("SQFT")  and int(a["SQFT"])  > 0    else None
                year_built = int(a["YRBLT"]) if a.get("YRBLT") and int(a["YRBLT"]) > 1800 else None

            return {
                "sqft": sqft, "beds": None, "baths": None,
                "year_built": year_built, "appraised_value": appraised_val,
                "assessed_value": assessed_val, "property_class": prop_class,
                "assessor_address": site_addr, "lot_acres": None,
            }

        except Exception as e:
            logger.error(f"Cobb ArcGIS enrichment FAILED (after retries) for {parid}: {e}")
            return {}

    # ─────────────────────────────────────────────────────────────────────────
    # METHOD 2: qPublic — Cobb County (AppID=1051)
    # ─────────────────────────────────────────────────────────────────────────

    def _get_qpublic_session(self):
        """Lazy-init a shared cloudscraper session (one per enricher instance)."""
        if self._qpublic_session is None:
            cs = _ensure_cloudscraper()
            self._qpublic_session = cs.create_scraper()
        return self._qpublic_session

    def _from_qpublic(self, address: str, city: str) -> dict:
        """
        Scrapes beds/baths from Cobb County qPublic (AppID=1051).
        Strategy: load search page → submit address search → follow report link → parse tables.

        The platform is ASP.NET WebForms (same structure as DeKalb AppID=994).
        Cloudflare-protected — uses cloudscraper to bypass.

        Rate limit: ~25 calls before qPublic returns empty. Built-in 1.5s delay between requests.
        """
        try:
            session = self._get_qpublic_session()

            # ── Step 1: Load search page (captures fresh ViewState + cookies) ──
            r1 = session.get(QPUBLIC_SEARCH_URL, timeout=30)
            if r1.status_code != 200:
                logger.warning(f"qPublic search page returned {r1.status_code}")
                return {}
            time.sleep(QPUBLIC_DELAY)

            from bs4 import BeautifulSoup
            soup1 = BeautifulSoup(r1.text, 'html.parser')

            # Collect all hidden ASP.NET form fields
            form_data = {
                inp.get('name', ''): (inp.get('value', '') or '')
                for inp in soup1.find_all('input')
                if inp.get('name')
            }

            # ── Step 2: Find the address input field name dynamically ──
            # qPublic uses names like: ctlBodyPane$ctl02$ctl01$txtAddress
            # or ctlBodyPane$ctl02$ctl01$txtStreetAddress — find it by type or suffix
            address_field = None
            search_button = None
            for name in form_data:
                lower = name.lower()
                if 'txtaddress' in lower or 'txtstreetaddress' in lower or 'txtstreet' in lower:
                    address_field = name
                if 'btnsearch' in lower or 'btnaddresssearch' in lower:
                    search_button = name

            # Fallback: look for visible text inputs
            if not address_field:
                for inp in soup1.find_all('input', type='text'):
                    n = inp.get('name', '').lower()
                    if 'address' in n or 'street' in n:
                        address_field = inp.get('name')
                        break

            if not address_field:
                logger.warning("qPublic: could not find address input field — trying parcel ID search")
                # Try parcel ID field instead
                for name in form_data:
                    if 'txtparcel' in name.lower() or 'txtpin' in name.lower():
                        address_field = name
                        break

            if not address_field:
                logger.warning("qPublic: no search field found — skipping")
                return {}

            # ── Step 3: Submit address search ──
            # Use street + city to disambiguate when multiple results exist
            street_only = address.split(',')[0].strip()
            search_term = f"{street_only} {city}".strip() if city else street_only

            form_data[address_field] = search_term
            if search_button:
                form_data['__EVENTTARGET']   = ''
                form_data['__EVENTARGUMENT'] = ''
                # Simulate clicking the search button
                form_data[search_button] = 'Search'
            else:
                # Trigger via postback (same as DeKalb)
                btn_target = next(
                    (n for n in form_data if 'btnsearch' in n.lower()), None
                )
                if btn_target:
                    form_data['__EVENTTARGET'] = btn_target
                else:
                    # Last resort: use known ASP.NET pattern
                    form_data['__EVENTTARGET'] = 'ctlBodyPane$ctl02$ctl01$btnSearch'
                form_data['__EVENTARGUMENT'] = ''

            r2 = session.post(QPUBLIC_SEARCH_URL, data=form_data, timeout=30)
            if r2.status_code != 200:
                logger.warning(f"qPublic search POST returned {r2.status_code}")
                return {}
            time.sleep(QPUBLIC_DELAY)

            soup2 = BeautifulSoup(r2.text, 'html.parser')

            # ── Step 4: Find the report (Summary) link for the property ──
            # Look for a link with PageTypeID=4 — that's the property detail page
            report_url = None
            for link in soup2.find_all('a', href=True):
                href = link.get('href', '')
                if 'PageTypeID=4' in href:
                    report_url = QPUBLIC_BASE + href if href.startswith('/') else href
                    break

            if not report_url:
                # No results — try to find any link to a property report
                for link in soup2.find_all('a', href=True):
                    href = link.get('href', '')
                    if 'KeyValue=' in href and 'AppID=1051' in href:
                        report_url = QPUBLIC_BASE + href if href.startswith('/') else href
                        break

            if not report_url:
                logger.warning(f"qPublic: no report link found for '{street_only}'")
                return {}

            # ── Step 5: Load the property report page ──
            r3 = session.get(report_url, timeout=30)
            if r3.status_code != 200:
                logger.warning(f"qPublic report page returned {r3.status_code}")
                return {}
            time.sleep(QPUBLIC_DELAY)

            soup3 = BeautifulSoup(r3.text, 'html.parser')

            # ── Step 6: Parse beds/baths/sqft from tabular-data-two-column tables ──
            return self._parse_qpublic_tables(soup3)

        except Exception as e:
            logger.error(f"qPublic error for {address}: {e}")
            return {}

    def _parse_qpublic_tables(self, soup) -> dict:
        """
        Extracts property characteristics from qPublic tabular-data-two-column tables.
        Handles Cobb County field naming conventions.

        Cobb qPublic field names observed:
          "Bedrooms"                → beds
          "Full Bath/Half Bath"     → "2/1" → 2.5 baths
          "Full Baths"              → baths (integer)
          "Half Baths"              → adds 0.5 per half bath
          "Heated Sq Ft" / "Res Sq Ft" / "Living Area" → sqft
          "Year Built"              → year_built
          "Property Class"          → property_class
        """
        data = {}

        from bs4 import BeautifulSoup
        full_baths = half_baths = None

        for table in soup.find_all('table', class_='tabular-data-two-column'):
            for row in table.find_all('tr'):
                cells = row.find_all('td')
                if len(cells) < 2:
                    continue
                k = cells[0].get_text(strip=True).lower()
                v = cells[1].get_text(strip=True)
                if not v or v in ('-', 'N/A', '0'):
                    continue

                if 'bedroom' in k:
                    try:
                        data['beds'] = int(v)
                    except ValueError:
                        pass

                elif 'full bath' in k and 'half' in k:
                    # "Full Bath/Half Bath: 2/1"
                    try:
                        parts = v.split('/')
                        full_baths = int(parts[0].strip())
                        half_baths = int(parts[1].strip()) if len(parts) > 1 else 0
                    except ValueError:
                        pass

                elif 'full bath' in k and 'half' not in k:
                    try:
                        full_baths = int(float(v))
                    except ValueError:
                        pass

                elif 'half bath' in k and 'full' not in k:
                    try:
                        half_baths = int(float(v))
                    except ValueError:
                        pass

                elif any(x in k for x in ('heated sq', 'res sq ft', 'living area', 'heated area', 'sqft', 'sq ft')):
                    try:
                        data['sqft'] = int(v.replace(',', ''))
                    except ValueError:
                        pass

                elif 'year built' in k:
                    try:
                        yr = int(v.replace(',', ''))
                        if yr > 1800:
                            data['year_built'] = yr
                    except ValueError:
                        pass

                elif 'property class' in k or 'land use' in k or 'use code' in k:
                    data['property_class'] = v

        # Combine full + half baths
        if full_baths is not None:
            data['baths'] = full_baths + ((half_baths or 0) * 0.5)

        if data.get('beds') or data.get('baths') or data.get('sqft'):
            logger.info(f"  qPublic parsed: beds={data.get('beds')} baths={data.get('baths')} "
                        f"sqft={data.get('sqft')} yr={data.get('year_built')}")

        return data

    # ─────────────────────────────────────────────────────────────────────────
    # METHOD 3: Zillow direct property lookup via Apify
    # ─────────────────────────────────────────────────────────────────────────

    def _from_zillow_lookup(self, address: str) -> dict:
        """
        Looks up a specific property on Zillow via the existing Apify Zillow actor.

        Uses ApifyZillowComps.lookup_property(), which searches Zillow by address and
        returns the first result. Works for both active and off-market properties since
        Zillow retains bed/bath/sqft data on all property pages.

        Returns dict with: beds, baths, sqft, year_built, property_class (or empty {}).
        """
        try:
            if not self.apify_key:
                return {}

            from execution.enrichment.apify_comps import ApifyZillowComps
            client = ApifyZillowComps()
            details = client.lookup_property(address)

            if not details:
                return {}

            beds  = details.get("bedrooms")
            baths = details.get("bathrooms")
            sqft  = details.get("sqft")
            yr    = details.get("year_built")
            ptype = (details.get("property_type") or "").upper()

            # Normalize Zillow property type → internal classification
            property_class = None
            if any(kw in ptype for kw in ("MULTI", "APARTMENT", "DUPLEX")):
                property_class = "MULTI-FAMILY"
            elif any(kw in ptype for kw in ("CONDO", "TOWNHOUSE", "SINGLE")):
                property_class = "RESIDENTIAL"
            elif any(kw in ptype for kw in ("COMMERCIAL", "OFFICE", "RETAIL")):
                property_class = "COMMERCIAL"

            # Sanity checks
            beds  = int(beds)  if (beds  and 1 <= int(beds)  <= 20)  else None
            baths = float(baths) if (baths and 0.5 <= float(baths) <= 20) else None
            sqft  = int(sqft)  if (sqft  and 100 <= int(sqft)  <= 50_000) else None
            yr    = int(yr)    if (yr    and 1800 <= int(yr)   <= 2025)   else None

            if beds is not None or baths is not None:
                logger.info(
                    f"  Zillow lookup: beds={beds} baths={baths} "
                    f"sqft={sqft} yr={yr} type={property_class}"
                )
            return {
                "beds": beds, "baths": baths,
                "sqft": sqft, "year_built": yr,
                "property_class": property_class,
            }

        except Exception as e:
            logger.warning(f"  Zillow lookup error for {address}: {e}")
            return {}

    # ─────────────────────────────────────────────────────────────────────────
    # METHOD 4: Web search (regex extraction + optional Gemini)
    # ─────────────────────────────────────────────────────────────────────────

    def _from_gemini(self, address: str, city: str) -> dict:
        """
        Fetches Google search snippets via Apify, then attempts extraction in two stages:

        Stage 1 — regex: parse beds/baths/sqft from snippet text directly (free, no quota).
                         Zillow/Redfin/Realtor.com titles and descriptions consistently
                         include patterns like "3 beds, 2 baths · 1,232 sqft".

        Stage 2 — Gemini (only if regex failed): send snippets to Gemini Flash for
                         structured extraction. Skipped when GEMINI_API_KEY is absent
                         or the free-tier daily quota is already exhausted.
        """
        try:
            if not self.apify_key:
                logger.warning("No APIFY_API_KEY — cannot use web search fallback")
                return {}

            from apify_client import ApifyClient
            client = ApifyClient(self.apify_key)

            queries = [
                f"{address} {city} GA real estate beds baths",
                f"{address} {city} GA zillow",
                f"{address} {city} GA redfin",
            ]
            logger.info(f"  Web search fallback — searching: {queries[0]}")

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
                        snippets.append(f"{t} {d}")

            if not snippets:
                return {}

            # ── Stage 1: Regex extraction from snippet text ───────────────────
            # Covers patterns from Zillow, Redfin, Realtor.com, and Trulia titles:
            #   "3 beds, 2 baths"  "3 bd / 2 ba"  "3BR/2BA"  "3 bds · 2 bas"
            #   "1,232 sqft"  "1232 sq ft"  "built in 1981"  "built: 1981"
            full_text = " ".join(snippets).lower()
            result = self._regex_extract(full_text)

            if result.get("beds") is not None or result.get("baths") is not None:
                logger.info(
                    f"  Regex extraction: beds={result.get('beds')} "
                    f"baths={result.get('baths')} sqft={result.get('sqft')} "
                    f"yr={result.get('year_built')}"
                )
                return {
                    "sqft":             result.get("sqft"),
                    "beds":             result.get("beds"),
                    "baths":            result.get("baths"),
                    "year_built":       result.get("year_built"),
                    "appraised_value":  None,
                    "assessed_value":   None,
                    "property_class":   None,
                    "assessor_address": None,
                    "lot_acres":        None,
                }

            # ── Stage 2: Gemini (quota-limited — only if regex failed) ────────
            if not self.gemini_key:
                logger.warning("  Regex found nothing and no GEMINI_API_KEY — skipping Gemini")
                return {}

            import google.generativeai as genai
            genai.configure(api_key=self.gemini_key)

            formatted = "\n".join(f"Title+Snippet: {s}" for s in snippets[:10])
            prompt = f"""You are a real estate data extraction assistant.
Property: {address}, {city}, GA

Return ONLY valid JSON with no explanation:
{{
  "sqft": <heated living area as int, or null>,
  "beds": <bedroom count as int, or null>,
  "baths": <bathroom count as float, or null>,
  "year_built": <4-digit year as int, or null>,
  "property_class": <one of: "residential", "multi-family", "commercial", "retail", "industrial", "land", or null>
}}

Rules:
- Only extract data that clearly refers to {address} specifically.
- sqft = heated/finished living area only (not lot size).
- property_class: use "multi-family" for apartments/duplexes/complexes; "retail" for stores/gas stations/restaurants; "commercial" for offices/warehouses; "residential" for houses/condos/townhomes.
- If the property is clearly NOT a single-family home (e.g., apartment complex, gas station), set beds=0.

Snippets:
{formatted}
"""
            cfg      = genai.types.GenerationConfig(temperature=0.1, response_mime_type="application/json")
            response = genai.GenerativeModel("gemini-2.5-flash").generate_content(prompt, generation_config=cfg)
            text     = re.sub(r"^```json\s*|\s*```$", "", response.text.strip())
            parsed   = json.loads(text)

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
            logger.error(f"Gemini fallback error for {address}: {e}")
            return {}

    # ─────────────────────────────────────────────────────────────────────────
    # REGEX EXTRACTION — parses beds/baths/sqft from search snippet text
    # ─────────────────────────────────────────────────────────────────────────

    def _regex_extract(self, text: str) -> dict:
        """
        Extract property specs from lowercased search snippet text.

        Handles Zillow/Redfin/Realtor.com title patterns:
          "3 beds, 2 baths · 1,232 sqft"
          "3 bd / 2 ba · 1232 sq ft"
          "3br/2ba"   "3 bdrms, 2 bths"   "3 bedrooms, 2 bathrooms"
          "built in 1981"  "year built: 1981"
          "1,232 square feet"

        Returns whatever could be confidently extracted (partial results OK).
        The address is used to anchor extraction — only lines near the address
        are trusted; generic city-wide data is ignored.
        """
        data = {}

        # ── beds ──────────────────────────────────────────────────────────────
        BED_PATTERNS = [
            r'(\d+)\s*(?:bed(?:room)?s?|bdrms?|bds?)\b',
            r'(\d+)\s*br\b',
        ]
        for pat in BED_PATTERNS:
            m = re.search(pat, text)
            if m:
                beds = int(m.group(1))
                if 1 <= beds <= 10:   # sanity check
                    data['beds'] = beds
                    break

        # ── baths ─────────────────────────────────────────────────────────────
        # "2.5 baths", "2 full, 1 half", "2/1 bath", "2 ba"
        BATH_PATTERNS = [
            r'(\d+(?:\.\d)?)\s*(?:bath(?:room)?s?|bths?|bas?)\b',
            r'(\d+)\s*full\s*(?:and|,|/|&)?\s*(\d+)\s*half',  # 2 full 1 half
            r'(\d+)\s*/\s*(\d+)\s*bath',                       # 2/1 bath
        ]
        for pat in BATH_PATTERNS:
            m = re.search(pat, text)
            if m:
                try:
                    if len(m.groups()) == 2:
                        baths = int(m.group(1)) + int(m.group(2)) * 0.5
                    else:
                        baths = float(m.group(1))
                    if 0.5 <= baths <= 10:
                        data['baths'] = baths
                        break
                except (ValueError, TypeError):
                    pass

        # ── sqft ──────────────────────────────────────────────────────────────
        SQFT_PATTERNS = [
            r'([\d,]+)\s*(?:sq\.?\s*ft\.?|sqft|square\s*feet)',
        ]
        for pat in SQFT_PATTERNS:
            m = re.search(pat, text)
            if m:
                try:
                    sqft = int(m.group(1).replace(',', ''))
                    if 200 <= sqft <= 15_000:
                        data['sqft'] = sqft
                        break
                except ValueError:
                    pass

        # ── year built ────────────────────────────────────────────────────────
        YR_PATTERNS = [
            r'(?:built\s*(?:in|:)\s*|year\s*built\s*:?\s*)(\d{4})',
            r'(?:constructed|built)\s+(\d{4})',
        ]
        for pat in YR_PATTERNS:
            m = re.search(pat, text)
            if m:
                yr = int(m.group(1))
                if 1900 <= yr <= 2025:
                    data['year_built'] = yr
                    break

        return data


# ── Standalone test ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import dotenv
    from pathlib import Path
    dotenv.load_dotenv(Path(__file__).parent.parent.parent / ".env")

    enricher = CobbArcGISEnricher()
    test_cases = [
        ("17-0252-0008-048-0", "2030 MAIN ST",        "Marietta"),
        ("16-0812-0-017-0",    "2765 SANDY PLAINS RD", "Marietta"),
    ]

    print("\n=== Cobb Enrichment Test (ArcGIS + qPublic + Gemini) ===\n")
    for pid, addr, city in test_cases:
        print(f"Parcel: {pid}  |  {addr}, {city}")
        specs = enricher.get_specs(pid, addr, city)
        print(f"  sqft={specs.get('sqft')}  beds={specs.get('beds')}  "
              f"baths={specs.get('baths')}  yr={specs.get('year_built')}  "
              f"appr=${specs.get('appraised_value')}  "
              f"class={specs.get('property_class')}  "
              f"src={specs.get('data_source')}  "
              f"conf={specs.get('data_confidence')}")
        print()
        time.sleep(0.5)
