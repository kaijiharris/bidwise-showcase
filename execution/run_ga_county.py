"""
GA County Analysis Pipeline — DeKalb / Cobb / Gwinnett
=======================================================
Single entry point that runs the full analysis for any active GA county.
Replaces the three separate run_*_deterministic.py files for the shared logic.

Pipeline stages:
  0. (Optional) Auto-parse the county PDF if no parsed JSON exists yet
  1. Load parsed properties (JSON from parse_*.py output)
  2. ArcGIS enrichment — free public API, sqft / beds / baths / year_built
  3. Comps — Apify Zillow primary; when Apify errors/returns 0 comps the
     fallback chain runs in order: RapidAPI US-Real-Estate (if RAPIDAPI_KEY)
     → RentCast (if RENTCAST_API_KEY). A run where a comps fetch failed
     outright is DEGRADED: dashboard JSON + auction index are NOT written
     and the process exits 2.
  4. Deal metrics — GA tax deed cost model (ga_deal_calculator.py)
  5. PropStream enrichment — equity / liens / owner type (OPTIONAL, local browser)
  5b. Equity delta tracking — compare to previous PropStream snapshot
  6. Export — dashboard JSON + Excel + .tmp archive

Usage:
    python execution/run_ga_county.py --county dekalb
    python execution/run_ga_county.py --county cobb
    python execution/run_ga_county.py --county gwinnett
    python execution/run_ga_county.py --county dekalb --propstream   # include PropStream pass
    python execution/run_ga_county.py --county dekalb --parse        # auto-parse PDF first
    python execution/run_ga_county.py --county dekalb --input .tmp/dekalb_results/dekalb_parsed_20260428.json
    python execution/run_ga_county.py --county dekalb --scrape --date 2026-05-05  # scrape live listing
"""

import os
import re
import sys
import json
import logging
import argparse
import subprocess
import pandas as pd
import dotenv
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from datetime import datetime

# ── Path setup ─────────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT_DIR))

from execution.enrichment.apify_comps import ApifyZillowComps
from execution.utils.ga_deal_calculator import (
    calculate_deal_metrics,
    calculate_land_metrics,
    calculate_commercial_metrics,
    calculate_arv_from_comps,
)
from execution.utils.nobid_guardrail import apply_guardrail
from execution.utils.publish_guard import all_parcels_unpriced
from execution.utils.confidence_tier import apply_confidence_tier
from execution.utils import comps_cache as comp_store
from execution.utils.auction_index import register_auction, update_index_to_main
from execution.utils.top_deals import (
    POSSIBLE_DEAL_MIN_ROI,
    TOP_DEAL_MIN_ROI,
    is_rankable,
    is_top_deal,
    stamp_top_deals,
)

env_path = ROOT_DIR / ".env"
dotenv.load_dotenv(dotenv_path=env_path)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("GACountyPipeline")

# Address patterns that strongly indicate a commercial property even when ArcGIS
# returns no structural data.  Used as a fallback before "Vacant Land" default.
_COMMERCIAL_ADDR_RE = re.compile(
    r'\b(INDUSTRIAL|INDUSTRY|HWY|HIGHWAY|STATE\s+ROUTE|US\s+ROUTE|SR\s*\d|'
    r'COMMERCE|COMMERCIAL|BUSINESS\s*PARK|CORP(?:ORATE)?\s*(?:BLVD|DR|PKWY|WAY)|'
    r'LOGISTICS|DISTRIBUTION|TECH(?:NOLOGY)?\s*PKWY|PEACHTREE\s+INDUSTRIAL)\b',
    re.IGNORECASE,
)

# Multi-family class codes that must NOT be run through the residential deal model.
_MULTI_FAMILY_CLASSES = frozenset({
    'MULTI-FAMILY', 'MULTI_FAMILY', 'MULTIFAMILY', 'MULTI FAMILY',
    'APARTMENT', 'APARTMENTS', 'APT COMPLEX', 'APT',
})

# Substrings in a descriptive property_class (Gwinnett-style: "Office
# Condominium", "Warehouse, PreFab", "Commercial Auxiliary Imp") that mark a
# commercial/industrial parcel. Checked case-insensitively and BEFORE the
# multi-family keywords so "Office Condominium" routes commercial, not
# residential-condo.
_COMMERCIAL_CLASS_KEYWORDS = (
    'WAREHOUSE', 'OFFICE', 'COMMERCIAL', 'RETAIL', 'INDUSTRIAL', 'STORAGE',
    'SHOPPING', 'MOTEL', 'HOTEL', 'RESTAURANT', 'MEDICAL', 'PROFESSIONAL',
    'MANUFACTUR', 'DISTRIBUTION', 'AUXILIARY IMP', 'MINI-WAREHOUSE', 'BANK',
    # Institutional/healthcare (2026-07-04: a 47k-sqft "Nursing Home" shipped
    # through the residential flip model at 279% ROI on the Gwinnett 8/4 list)
    'NURSING', 'HEALTH', 'CLINIC', 'ASSISTED', 'CHURCH', 'SCHOOL',
    'FUNERAL', 'DAYCARE', 'DAY CARE',
)
_MULTIFAMILY_CLASS_KEYWORDS = (
    'DUPLEX', 'TRIPLEX', 'QUADPLEX', 'FOURPLEX', 'MULTI-FAMILY', 'MULTIFAMILY',
    'MULTI FAMILY', 'APARTMENT',
)


def _is_nonresidential_class(prop_class_raw: str) -> bool:
    """True when a property_class is commercial/industrial/multi-family and must
    NOT be run through the single-family residential deal model.

    Handles both DeKalb coded classes (C1/I2 via ``^[CI]\\d``) and Gwinnett
    descriptive strings ("Office Condominium", "Warehouse", "Residential
    Duplex"). Commercial keywords are tested before multi-family so an "Office
    Condominium" is treated as commercial rather than a residential condo.
    Added 2026-07-02 after verification found 5 Gwinnett commercial parcels
    (warehouse, office condos) shipping through the residential flip model.
    """
    s = (prop_class_raw or "").strip().upper()
    if not s:
        return False
    if re.match(r'^[CI]\d', s):
        return True
    if s in _MULTI_FAMILY_CLASSES:
        return True
    if any(k in s for k in _COMMERCIAL_CLASS_KEYWORDS):
        return True
    if any(k in s for k in _MULTIFAMILY_CLASS_KEYWORDS):
        return True
    return False


# ── County registry ───────────────────────────────────────────────────────────
# Each county entry defines its enricher class, city list, and output paths.
# Adding a new county only requires adding an entry here.

COUNTY_CONFIG = {
    "dekalb": {
        "display_name":    "DeKalb",
        "state":           "GA",
        "enricher_class":  "DeKalbArcGISEnricher",
        "enricher_module": "execution.enrichment.dekalb_arcgis_enrichment",
        "parser_script":   "execution/parse_dekalb_improved.py",    # relative to project root
        "tmp_dir":         ".tmp/dekalb_results",
        "parsed_glob":     "dekalb_parsed_*.json",
        "dashboard_json":  "web/data/dekalb.json",
        "cities": [
            "ATLANTA", "DECATUR", "DORAVILLE", "DUNWOODY",
            "CHAMBLEE", "STONE MOUNTAIN", "LITHONIA", "CLARKSTON",
            "AVONDALE ESTATES", "PINE LAKE", "TUCKER",
            "ELLENWOOD", "SCOTTDALE", "STONECREST", "REDAN",
            "BROOKHAVEN", "CONLEY",
        ],
        "default_city": "Decatur",
    },
    "cobb": {
        "display_name":    "Cobb",
        "state":           "GA",
        "enricher_class":  "CobbArcGISEnricher",
        "enricher_module": "execution.enrichment.cobb_arcgis_enrichment",
        "parser_script":   "execution/parse_cobb.py",
        "tmp_dir":         ".tmp/cobb_results",
        "parsed_glob":     "cobb_parsed_*.json",
        "dashboard_json":  "web/data/cobb.json",
        "cities": [
            "MARIETTA", "SMYRNA", "KENNESAW", "ACWORTH", "POWDER SPRINGS",
            "AUSTELL", "MABLETON", "VININGS", "FAIR OAKS", "CLARKDALE",
        ],
        "default_city": "Marietta",
    },
    "gwinnett": {
        "display_name":    "Gwinnett",
        "state":           "GA",
        "enricher_class":  "GwinnettArcGISEnricher",
        "enricher_module": "execution.enrichment.gwinnett_arcgis_enrichment",
        "parser_script":   "execution/parse_gwinnett.py",
        "tmp_dir":         ".tmp/gwinnett_results",
        "parsed_glob":     "gwinnett_parsed_*.json",
        "dashboard_json":  "web/data/gwinnett.json",
        "cities": [
            "LAWRENCEVILLE", "DULUTH", "NORCROSS", "BUFORD", "SNELLVILLE",
            "LILBURN", "LOGANVILLE", "AUBURN", "DACULA", "GRAYSON",
            "SUGAR HILL", "SUWANEE", "PEACHTREE CORNERS", "BRASELTON",
        ],
        "default_city": "Lawrenceville",
    },
    "clayton": {
        "display_name":    "Clayton",
        "state":           "GA",
        "enricher_class":  "ClaytonArcGISEnricher",
        "enricher_module": "execution.enrichment.clayton_arcgis_enrichment",
        "parser_script":   "execution/parse_clayton.py",
        "tmp_dir":         ".tmp/clayton_results",
        "parsed_glob":     "clayton_parsed_*.json",
        "dashboard_json":  "web/data/clayton.json",
        "cities": [
            "JONESBORO", "RIVERDALE", "FOREST PARK", "MORROW", "LAKE CITY",
            "LOVEJOY", "COLLEGE PARK", "HAMPTON", "ELLENWOOD", "REX", "CONLEY",
        ],
        "default_city": "Jonesboro",
        # Clayton sale lists cry suffixed/unit parcel ids (091002Y, A002 O04)
        # that are secondary tax accounts — enable dedup + condotel unit rules.
        "secondary_assessment_rules": True,
    },
}

# PropStream signals that elevate a deal's priority
PROPSTREAM_PRIORITY_FLAGS = {
    "HIGH_EQUITY",        # ≥ $100K equity — motivated sellers have options
    "absentee_owner",     # Out-of-area owner more willing to discount
    "foreclosure",        # Distress signal — time pressure on owner
    "open_liens",         # Hidden costs for unprepared buyers (our edge)
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_enricher(county_key: str):
    """Dynamically import the correct ArcGIS enricher for the given county."""
    cfg = COUNTY_CONFIG[county_key]
    import importlib
    module = importlib.import_module(cfg["enricher_module"])
    enricher_cls = getattr(module, cfg["enricher_class"])
    return enricher_cls()


def extract_city(full_address: str, raw_text: str, county_key: str) -> str:
    """Extract city from address text using county's city list."""
    cfg    = COUNTY_CONFIG[county_key]
    search = (full_address + " " + raw_text).upper()
    for city in cfg["cities"]:
        if city in search:
            return city.title()
    return cfg["default_city"]


_STREET_SUFFIXES = {
    "RD", "ROAD", "ST", "STREET", "DR", "DRIVE", "LN", "LANE", "CT", "COURT",
    "WAY", "TRL", "TRAIL", "CIR", "CIRCLE", "AVE", "AVENUE", "BLVD", "PKWY",
    "HWY", "PL", "PLACE", "TER", "TERRACE", "XING", "RUN", "PT", "PATH",
    "NE", "NW", "SE", "SW",
}


def extract_city_from_assessor(assessor_address: Optional[str], county_key: str) -> Optional[str]:
    """Derive the real city from the assessor's situs address.

    The parser-supplied city is frequently the county-seat placeholder (every
    DeKalb web-scrape row says "Decatur"), which pulls comps for the wrong
    market and collapses all land values to one number. The assessor situs is
    authoritative. Handles both formats seen in the wild:
      Gwinnett: "123 MAIN ST, LAWRENCEVILLE, GA 30046"          (comma-delimited)
      DeKalb:   "4036 Smithfield Trail Ellenwood, GA 30294"     (city glued to street)
    Returns None when no city can be derived with confidence.
    """
    if not assessor_address:
        return None
    m = re.search(r"^(.*?),?\s*GA[\s,]*\d{0,5}\s*$", assessor_address.strip(), re.IGNORECASE)
    if not m:
        return None
    head = m.group(1).strip().rstrip(",")
    if "," in head:
        cand = head.split(",")[-1].strip()
        if cand and not any(ch.isdigit() for ch in cand):
            return cand.title()
        return None
    words = head.split()
    known = {c.upper() for c in COUNTY_CONFIG[county_key]["cities"]}
    for n in (3, 2, 1):
        if len(words) > n:
            cand = " ".join(words[-n:]).upper()
            if cand in known:
                return cand.title()
    tail = words[-1] if words else ""
    if tail and tail.upper() not in _STREET_SUFFIXES and not any(ch.isdigit() for ch in tail):
        return tail.title()
    return None


def _run_county_parser(county_key: str) -> bool:
    """
    Auto-invoke the county's parse_*.py script to convert the PDF.

    The parser script is expected to:
      - Read the county's PDF from the standard location it expects
      - Write a timestamped parsed JSON to .tmp/{county}_results/

    Returns True if parsing succeeded, False otherwise.

    Why this exists:
      Without this, the operator has to remember to run `parse_dekalb_improved.py` before
      `run_ga_county.py`. With --parse, the full pipeline is a single command.
    """
    cfg         = COUNTY_CONFIG[county_key]
    parser_path = ROOT_DIR / cfg["parser_script"]

    if not parser_path.exists():
        logger.error(
            f"Parser script not found: {parser_path}\n"
            f"  Create execution/parse_{county_key}.py or place the PDF in the expected path."
        )
        return False

    logger.info(f"[Stage 0] Running county parser: {parser_path}")
    try:
        result = subprocess.run(
            [sys.executable, str(parser_path)],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            timeout=300,   # 5 minutes max for PDF parsing
        )
        if result.returncode == 0:
            logger.info(f"  ✓ Parser completed successfully.")
            if result.stdout:
                logger.info(result.stdout[-500:])  # last 500 chars of output
            return True
        else:
            logger.error(f"  Parser exited with code {result.returncode}")
            if result.stderr:
                logger.error(result.stderr[-500:])
            return False
    except subprocess.TimeoutExpired:
        logger.error("  Parser timed out after 5 minutes.")
        return False
    except Exception as e:
        logger.error(f"  Parser error: {e}")
        return False


def _latest_parsed_file(county_key: str) -> Optional[Path]:
    """Return the most recently modified parsed JSON file for the county."""
    cfg   = COUNTY_CONFIG[county_key]
    files = sorted(
        Path(cfg["tmp_dir"]).glob(cfg["parsed_glob"]),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return files[0] if files else None


# ── Stage 2+3+4: ArcGIS + Comps + Metrics ─────────────────────────────────────

# Nominal look-back window (months) reported for fallback sold-comps results.
# Neither US-Real-Estate nor RentCast exposes an explicit window parameter;
# 12 matches the Apify primary window for dashboard display.
FALLBACK_WINDOW_MONTHS = 12

# All comp_source values a property can carry (order used in the summary).
COMP_SOURCES = ("apify", "homeharvest", "rapidapi", "rentcast", "none")

# Sources whose store pools hold RAW vendor items that must be re-processed by
# their own client (vs. canonical comp dicts servable directly).
_RAW_POOL_SOURCES = frozenset({"apify"})


def _fresh_pool_meta() -> Dict:
    """Pool metadata for a comps pool fetched this run (age 0 = fresh tier)."""
    return {"age_days": 0, "tier": comp_store.TIER_FRESH, "store_hit": False}


def _serve_from_comp_store(
    city: str,
    state_code: str,
    apify_client,
) -> Optional[Tuple[List[Dict], int, str, bool, Dict]]:
    """
    Cost layer 0: the comp store of record. Returns a full result tuple when a
    stored pool inside the 180-day reuse window clears the usable-comp floor,
    else None (the city genuinely needs a scrape). $0 — never touches the
    network beyond what a client's own store read does.
    """
    entry = comp_store.load_best_entry(city, state_code)
    if entry is None:
        return None
    meta = {"age_days": entry.age_days, "tier": entry.tier, "store_hit": True}

    if entry.source in _RAW_POOL_SOURCES:
        # Raw Zillow items: route through the Apify client, whose own store
        # read serves the same entry and applies the 12/24-month processing.
        if apify_client is None:
            return None
        try:
            comps, window_months = apify_client.get_sold_properties(
                city=city, state_code=state_code
            )
            if comps:
                logger.info(
                    f"  Comp store served {city} from the {entry.source} pool "
                    f"(age {entry.age_days}d, tier {entry.tier.upper()}) — $0"
                )
                return comps, window_months, entry.source, False, meta
        except Exception as e:
            logger.warning(f"  Comp store apify-pool processing failed for {city}: {e}")
        return None

    # Canonical comp dicts (homeharvest / rentcast / rapidapi pools).
    comps = [dict(item) for item in entry.items if isinstance(item, dict)]
    if not comps:
        return None
    logger.info(
        f"  Comp store served {city} from the {entry.source} pool "
        f"(age {entry.age_days}d, tier {entry.tier.upper()}) — $0"
    )
    return comps[:25], FALLBACK_WINDOW_MONTHS, entry.source, False, meta


def _fetch_comps_with_fallback(
    city: str,
    state_code: str,
    apify_client,
    fallback_clients=None,
    free_clients=None,
) -> Tuple[List[Dict], int, str, bool, Dict]:
    """
    Resolve sold comps for one city at the lowest possible cost:

      0. comp store of record  ($0 — reuse ≤180d pools; operator directive
         2026-07-12: recycling beats re-scraping)
      1. free_clients          ($0 — HomeHarvest realtor.com scraper)
      2. Apify fresh sweep     (paid, budget-gated at fetch time)
      3. fallback_clients      (metered: RapidAPI / RentCast 50-call free tier)

    free_clients / fallback_clients are ordered lists of (source_name, client)
    tuples where each client exposes get_sold_properties(city, state_code,
    limit) -> List.

    Returns (comps, window_months, comp_source, fetch_failed, pool_meta) where
    comp_source is 'apify' | <source name> | 'none' and pool_meta carries
    {'age_days', 'tier', 'store_hit'} for the confidence system. fetch_failed
    is True only when the Apify fetch FAILED (raised, or hit its internal
    failure sentinel of 0 comps with window_months == 0) and nothing else
    recovered any comps — a degraded city, as opposed to a market with no
    recent sales.
    """
    # ── Layer 0: comp store of record ($0) ─────────────────────────────────
    served = _serve_from_comp_store(city, state_code, apify_client)
    if served is not None:
        return served

    # ── Layer 1: free scraper(s) before any paid spend ─────────────────────
    for source_name, client in (free_clients or []):
        try:
            logger.info(f"  Fetching {source_name} comps for {city}, {state_code} ($0)...")
            free_comps = client.get_sold_properties(
                city=city, state_code=state_code, limit=25
            )
            if free_comps:
                logger.info(f"  {source_name} found {len(free_comps)} comps in {city}")
                return free_comps, FALLBACK_WINDOW_MONTHS, source_name, False, _fresh_pool_meta()
            logger.warning(f"  {source_name} returned 0 comps for {city} — trying paid layers")
        except Exception as e:
            logger.error(f"  {source_name} error for {city}: {e} — trying paid layers")

    # ── Layer 2: Apify fresh sweep (budget-gated inside the client) ────────
    comps: List[Dict] = []
    window_months = 0
    apify_failed  = False
    if apify_client is not None:
        try:
            logger.info(f"  Fetching Zillow comps for {city}, {state_code}...")
            comps, window_months = apify_client.get_sold_properties(city=city, state_code=state_code)
            # ApifyZillowComps swallows API errors internally and returns ([], 0);
            # window_months == 0 is its failure sentinel (incl. budget refusal).
            apify_failed = not comps and window_months == 0
            logger.info(f"  Found {len(comps)} Apify comps in {city} (window: {window_months}mo)")
        except Exception as e:
            apify_failed = True
            logger.error(f"  Apify error for {city}: {e}")

    if comps:
        return comps, window_months, "apify", False, _fresh_pool_meta()

    # ── Layer 3: metered fallbacks ──────────────────────────────────────────
    for source_name, client in (fallback_clients or []):
        logger.warning(f"  Apify yielded 0 comps for {city} — falling back to {source_name}")
        try:
            fb_comps = client.get_sold_properties(
                city=city, state_code=state_code, limit=25
            )
            if fb_comps:
                logger.info(f"  {source_name} fallback found {len(fb_comps)} comps in {city}")
                return fb_comps, FALLBACK_WINDOW_MONTHS, source_name, False, _fresh_pool_meta()
            logger.warning(f"  {source_name} fallback also returned 0 comps for {city}")
        except Exception as e:
            logger.error(f"  {source_name} fallback error for {city}: {e}")

    if apify_failed and not fallback_clients:
        logger.error(f"  No comps fallback configured — comps for {city} LOST this run")

    return [], 0, "none", apify_failed, {"age_days": None, "tier": None, "store_hit": False}


def _append_note(prop: Dict, text: str) -> None:
    """Accumulate human-readable stipulations on a property (pipe-separated)."""
    existing = prop.get("analysis_notes") or ""
    prop["analysis_notes"] = f"{existing} | {text}" if existing else text


# Financial fields nulled on secondary assessment records so the same physical
# property is never analyzed twice (mirrors the non-residential nulling rule).
_SECONDARY_NULL_KEYS = (
    "arv", "net_profit", "roi_percent", "net_proceeds", "selling_costs",
    "asis_sale_price", "asis_all_in_cost", "asis_net_profit", "asis_roi_percent",
    "land_value",
)


def _apply_secondary_assessment_rules(results: List[Dict]) -> List[Dict]:
    """
    Suffixed parcel ids ("06070 091002Y") are separate tax accounts on the SAME
    land — typically a mobile home or separately-assessed improvement. When the
    base parcel is in the same sale, the deal analysis lives on the base record
    only; the suffixed record keeps its identity/bid but carries stipulation
    notes instead of duplicate financials (user direction 2026-07-04).
    """
    by_id = {r.get("tax_id"): r for r in results}
    for r in results:
        tid = r.get("tax_id") or ""
        tokens = tid.split(" ")
        if len(tokens) != 2:
            continue
        stripped = re.sub(r"(?<=\d)[A-Z]+$", "", tokens[-1])
        base_id = f"{tokens[0]} {stripped}"
        if stripped == tokens[-1] or base_id not in by_id:
            continue
        base = by_id[base_id]
        for key in _SECONDARY_NULL_KEYS:
            if key in r:
                r[key] = None
        r["estimated_rehab_cost"] = 0
        # Respect a guardrail NO-BID: never resurrect a positive bid on a parcel
        # the disqualification layer already nulled (a suffixed secondary record
        # can also be raw land / small lot / flood). Only fall back to the tax-due
        # opening bid when the parcel was NOT disqualified.
        if r.get("is_no_bid"):
            r["max_bid"] = r["recommended_max_bid"] = None
        else:
            r["max_bid"] = r["recommended_max_bid"] = r.get("tax_due")
        r["deal_score"] = 0.0
        # Drop model-math notes (ARV guard, rehab basis) — the financials they
        # explain were just nulled. Parcel-level red flags (floodplain etc.) stay.
        kept_notes = [
            n for n in (r.get("analysis_notes") or "").split(" | ")
            if n and not n.startswith(("ARV GUARD", "Rehab estimate basis"))
        ]
        r["analysis_notes"] = " | ".join(kept_notes)
        _append_note(
            r,
            f"SECONDARY ASSESSMENT RECORD: separate tax account on the same land as "
            f"{base_id} (typically a mobile home or separately-assessed improvement). "
            f"Full analysis is on {base_id}. This deed likely conveys only the "
            f"improvement interest, not the land; either deed holder can redeem "
            f"against the other — title/attorney review required before bidding.",
        )
        _append_note(
            base,
            f"NOTE: a secondary assessment record on this same land "
            f"({tid}, opening bid ${r.get('tax_due') or 0:,.2f}) is cried separately "
            f"at this sale. Acquiring both deeds avoids a split-interest conflict.",
        )
        logger.info(f"  Secondary assessment: {tid} -> analysis carried by {base_id}")
    return results


def analyze_properties(
    properties: List[Dict],
    county_key: str,
    apify_client,
    fallback_clients=None,
    free_clients=None,
) -> Tuple[List[Dict], List[Dict], List[str]]:
    """
    Core analysis loop.

    Returns:
        (results, all_comparables, degraded_cities) — comparables list for
        dashboard display; degraded_cities non-empty means comps fetching
        failed and the run's ARV/ROI numbers are NOT publishable.
    """
    arcgis     = _load_enricher(county_key)
    results    = []
    city_cache: Dict[str, tuple] = {}
    all_comps: List[Dict]        = []
    degraded_cities: set         = set()
    cfg = COUNTY_CONFIG[county_key]

    arcgis_keys = (
        "sqft", "beds", "baths", "year_built",
        "assessed_value", "appraised_value",
        "property_class", "assessor_address", "lot_acres",
        "building_quality", "zoning", "floodplain",
        "latitude", "longitude",
    )

    for i, prop in enumerate(properties, 1):
        prop   = dict(prop)
        tax_id = prop.get("tax_id", "")
        logger.info(f"[{i}/{len(properties)}] {tax_id}")

        city = prop.get("city") or extract_city(
            prop.get("full_address", ""),
            prop.get("raw_text", ""),
            county_key,
        )

        # ── Stage 2: ArcGIS enrichment ────────────────────────────────────
        specs = arcgis.get_specs(tax_id, prop.get("full_address", ""), city)
        for key in arcgis_keys:
            if specs.get(key) is not None:
                prop[key] = specs[key]
        prop["data_source_specs"] = specs.get("data_source", "unknown")
        prop["data_confidence"]   = specs.get("data_confidence", "NONE")

        # Re-derive the city from the assessor situs now that Stage 2 ran —
        # the parser city is often a county-seat placeholder (2026-07-02
        # incident: all 35 DeKalb parcels "Decatur" → one shared land_value).
        assessor_city = extract_city_from_assessor(prop.get("assessor_address"), county_key)
        if assessor_city and assessor_city != city:
            logger.info(f"  City: {city} → {assessor_city} (assessor situs)")
            city = assessor_city
        prop["city"] = city
        prop["city_source"] = "assessor" if assessor_city else "parser"

        if specs.get("sqft") or specs.get("year_built"):
            logger.info(
                f"  ArcGIS: sqft={specs.get('sqft')} yr={specs.get('year_built')} "
                f"beds={specs.get('beds')} appr=${specs.get('appraised_value')} "
                f"conf={specs.get('data_confidence')}"
            )
        else:
            logger.warning(f"  ArcGIS: no specs for {tax_id} — using ARV fallback for rehab")

        # Unit-record rule (condotel / condo regimes, 2026-07-04): a 3+-token
        # parcel id that only resolved via base-parcel fallback, where the base
        # parcel is a common area, is a deeded UNIT inside a condominium regime
        # (e.g. Clayton 12114C A002 O04 = room in a hotel run as a condotel).
        # Route to the commercial/specialist model with stipulation notes.
        if (
            cfg.get("secondary_assessment_rules")
            and len(tax_id.split(" ")) >= 3
            and "base parcel" in (specs.get("data_source") or "")
            and "COMMON" in (prop.get("property_class") or "").upper()
        ):
            prop["property_type"] = "Commercial"
            _append_note(
                prop,
                "CONDOMINIUM UNIT RECORD: this parcel id is a deeded unit inside a "
                "condominium regime — the GIS base parcel is the association common "
                "area (site evidence indicates an operating hotel/condotel). A GA "
                "tax-deed buyer owes association dues/assessments during the "
                "redemption period, takes subject to the regime's declaration and "
                "use restrictions, and needs quiet title for marketable title. "
                "Specialist + attorney review required; county FMV shown for "
                "reference only.",
            )
            logger.info(f"  Unit record inside condo regime — routed to specialist model")

        # Early commercial detection so we don't waste Apify credits on properties
        # that will never use SFR comps.
        prop_class_raw_early = (prop.get("property_class") or "").strip().upper()
        is_commercial_early = (
            _is_nonresidential_class(prop_class_raw_early)
            or prop.get("property_type") == "Commercial"
        )

        pool_meta: Dict = {"age_days": None, "tier": None, "store_hit": False}
        if is_commercial_early:
            comps, window_months, comp_source = [], 0, "none"
            logger.info(f"  Skipping comp fetch — commercial property detected")
        elif apify_client is None and not fallback_clients and not free_clients:
            # --no-comps: intentional skip (not a degraded run) — residential ARV
            # falls back to the assessor appraised value downstream.
            comps, window_months, comp_source = [], 0, "none"
        else:
            if city not in city_cache:
                city_cache[city] = _fetch_comps_with_fallback(
                    city, cfg["state"], apify_client, fallback_clients, free_clients
                )
            else:
                logger.info(f"  Using cached comps for {city} ({len(city_cache[city][0])} comps)")
            comps, window_months, comp_source, fetch_failed, pool_meta = city_cache[city]
            if fetch_failed:
                degraded_cities.add(city)

        addr = prop.get("full_address", "")
        for comp in comps:
            cc = dict(comp)
            cc["used_for_address"] = addr
            all_comps.append(cc)

        # ── Stage 2b: structure_confirmed flag ────────────────────────────
        # True only when at least one structural attribute was returned by any
        # enrichment source. Used downstream to distinguish unconfirmed-structure
        # R3 parcels (likely vacant lots) from genuine SFRs with no data gaps.
        structure_confirmed = bool(
            prop.get("sqft") or prop.get("beds") or prop.get("year_built")
        )
        prop["structure_confirmed"] = structure_confirmed

        # ── Stage 4: Deal metrics ────────────────────────────────────────
        arv_data = calculate_arv_from_comps(
            comps,
            prop.get("sqft"),
            property_beds=prop.get("beds"),
            property_baths=prop.get("baths"),
        )

        # Classify as Vacant Land when no structural data confirmed — but first
        # check for commercial address patterns so highways and industrial parcels
        # are not mislabeled as vacant land.
        if not structure_confirmed and not prop.get("property_type"):
            addr = prop.get("full_address", "")
            if _COMMERCIAL_ADDR_RE.search(addr):
                prop["property_type"] = "Commercial"
                prop["data_confidence"] = "MEDIUM"
                logger.info(f"  Classified as Commercial from address pattern: {addr}")
            else:
                prop["property_type"] = "Vacant Land"
                prop["data_confidence"] = "LOW"
                logger.info("  Classified as Vacant Land (no structure confirmed from any enrichment source)")

        is_land = prop.get("property_type") == "Vacant Land"
        prop_class_raw = (prop.get("property_class") or "").strip().upper()
        # C/I-prefixed ArcGIS codes (DeKalb) and full-string multi-family/commercial
        # codes (Gwinnett) all route to the commercial/specialist model.
        is_commercial_class = (
            _is_nonresidential_class(prop_class_raw)
            or prop.get("property_type") == "Commercial"
        )
        arv_source = "N/A"  # overridden below for residential properties

        if is_land:
            # Land model: 20% of avg residential comp price.
            # comp_avg_price is always returned even when sqft is unknown.
            metrics = calculate_land_metrics(prop, arv_data["comp_avg_price"], arv_data["comp_count"], prop.get("closing_legal_fee"))
            logger.info(
                f"  Land: land_value=${metrics.get('land_value') or 0:,.0f}"
                f"  all_in=${metrics['all_in_cost']:,.0f}"
                f"  flag={metrics.get('land_acreage_flag')}"
            )
        elif is_commercial_class:
            # Commercial model: acquisition cost only; no ARV, no rehab, no ROI.
            # Label the type so the dashboard never badges a warehouse as "SFR"
            # (2026-07-02: was showing null → SFR for these).
            if not prop.get("property_type"):
                is_mf = any(k in prop_class_raw for k in _MULTIFAMILY_CLASS_KEYWORDS)
                prop["property_type"] = "Multi-Family" if is_mf else "Commercial"
            metrics = calculate_commercial_metrics(prop)
            logger.info(f"  {prop['property_type']}: all_in=${metrics['all_in_cost']:,.0f} (specialist valuation required)")
        else:
            # Residential: post-rehab + as-is profit views.
            if not prop.get("property_type"):
                prop["property_type"] = "SFR"
            arv = arv_data["arv"]
            arv_source = "zillow_comps"
            appraised = prop.get("appraised_value")
            comps_used = arv_data.get("comps_used", 0)
            if arv is None and appraised:
                arv = appraised
                arv_source = "assessor_appraisal_fallback"
                prop["data_confidence"] = "LOW"
                logger.info(f"  ARV fallback: using assessor appraised_value ${arv:,.0f} (no Zillow comps matched)")
            elif arv is not None and appraised:
                # ARV guard (2026-07-04): city-median comps price outliers badly
                # (e.g. a 6,236sqft house "valued" from 2 comps at 42% of the
                # county appraisal; a mis-citied parcel at 147% of it). When comp
                # support is thin AND the comp ARV deviates >30% from the county
                # appraisal, the appraisal is the better anchor — both directions.
                deviation = abs(arv - appraised) / appraised
                weak_support = (
                    comps_used < 5
                    or arv_data.get("sqft_filter_relaxed")
                    or arv_data.get("comp_pool_quality") == "WEAK"
                )
                # >30% off with thin comp support, or >50% off regardless —
                # city-median comps can produce many "matches" from the wrong
                # market (2026-07-04: 10 Atlanta-citywide comps priced a Clayton
                # pocket at 187% of the county appraisal).
                if (weak_support and deviation > 0.30) or deviation > 0.50:
                    _append_note(
                        prop,
                        f"ARV GUARD: comp-based ARV ${arv:,.0f} (from {comps_used} comps"
                        f"{', sqft filter relaxed' if arv_data.get('sqft_filter_relaxed') else ''}) "
                        f"deviated {deviation*100:.0f}% from the county appraisal "
                        f"${appraised:,.0f}; the county appraisal is used instead. "
                        f"Verify with street-level comps before bidding.",
                    )
                    logger.info(
                        f"  ARV guard: comp ARV ${arv:,.0f} ({comps_used} comps) vs "
                        f"appraisal ${appraised:,.0f} — using appraisal"
                    )
                    arv = appraised
                    arv_source = "assessor_appraisal_arv_guard"
                    if prop.get("data_confidence") == "HIGH":
                        prop["data_confidence"] = "MEDIUM"
            metrics = calculate_deal_metrics(prop, arv, comp_count=arv_data["comp_count"])
            logger.info(
                f"  Residential: arv=${arv or 0:,.0f}"
                f"  post-rehab ROI={metrics.get('roi_percent')}%"
                f"  as-is ROI={metrics.get('asis_roi_percent')}%"
            )

        # ── NO-BID guardrail ──────────────────────────────────────────────
        # Screen every parcel BEFORE recommended_max_bid is emitted. Raw land
        # without land comps, small vacant lots, and flood-zone dirt get a NO-BID
        # (bid nulled, deal_score 0, no_bid_reason set); an improved parcel in a
        # floodplain is flagged + score-penalized, not killed. Fixes the
        # 2026-07-07 Cobb failure (landlocked $185k / 1414% ROI on zero comps).
        # comp_count is injected here (it isn't on `metrics` yet — the result dict
        # adds it below) so the commercial/industrial-no-comps rule can fire.
        metrics = {**metrics, "comp_count": arv_data["comp_count"]}
        metrics = apply_guardrail(prop, metrics)
        if metrics.get("is_no_bid"):
            _append_note(prop, f"NO BID — {metrics['no_bid_reason']}.")
            logger.info(f"  NO BID: {metrics['no_bid_reason']}")

        # ── Wave 2: confidence tier (runs on guardrail SURVIVORS only) ────────
        # A verbatim no-op on is_no_bid, so a NO-BID is never resurrected. On a
        # survivor it grades valuation confidence (comp COD + count + pool quality),
        # clamps roi_percent<=200, and rewrites deal_score/max_bid by tier:
        # ESTIMATE_ONLY (comp_count<=1 — the thin-comp second net) nulls the bid;
        # LOW/MEDIUM cap the score; HIGH (well-comped) is preserved byte-for-byte.
        # comp_pool_quality + ranked_comps are surfaced so COD can be computed.
        # comp_pool age (recycling policy 2026-07-12): an AGED store pool
        # (91–180d) demotes HIGH→MEDIUM inside the existing Wave-2 tiering.
        tier_prop = {**prop, "ranked_comps": arv_data.get("ranked_comps", []),
                     "comp_pool_quality": arv_data.get("comp_pool_quality", "NO_DATA")}
        metrics = apply_confidence_tier(tier_prop, metrics, pool_age_tier=pool_meta.get("tier"))
        if pool_meta.get("tier") == comp_store.TIER_AGED:
            _append_note(
                prop,
                f"COMP AGE: valuation reuses a {pool_meta.get('age_days')}-day-old "
                f"comp pool (aged tier, 91–180d). Standard appraisal practice "
                f"accepts 6-month comps; confidence badge capped at MEDIUM.",
            )

        # Data-driven stipulation notes (surface county red flags the models
        # don't price in).
        if (prop.get("floodplain") or "").upper() == "YES":
            _append_note(prop, "FLOODPLAIN: the county flags this parcel as in a "
                               "floodplain — affects insurability, financing and resale.")
        if (prop.get("zoning") or "").upper() == "AG":
            _append_note(prop, "Zoned agricultural (AG) per county GIS.")
        if metrics.get("rehab_basis") and not is_land and not is_commercial_class:
            _append_note(prop, f"Rehab estimate basis: {metrics['rehab_basis']} "
                               f"(x1.15 contingency).")

        result = {
            **prop,
            "county":              cfg["display_name"],
            "city":                city,
            "state":               cfg["state"],
            "comp_count":          arv_data["comp_count"],
            "comps_used_for_arv":  arv_data.get("comps_used", 0),
            "avg_comp_price":      arv_data["comp_avg_price"],
            "avg_price_sqft":      arv_data["avg_price_sqft"],
            "comp_pool_quality":   arv_data.get("comp_pool_quality", "NO_DATA"),
            "comp_window_months":  window_months,
            "comp_pool_age_days":  pool_meta.get("age_days"),
            "comp_pool_tier":      pool_meta.get("tier"),
            "comp_source":         comp_source,
            "arv_source":          arv_source,
            "ranked_comps":        arv_data.get("ranked_comps", []),
            **metrics,
            # Fail safe: never emit a positive bid on a guardrail NO-BID, even if
            # a future edit lets max_bid and recommended_max_bid diverge upstream.
            "recommended_max_bid": None if metrics.get("is_no_bid") else metrics["max_bid"],
            "analysis_date":       datetime.now().isoformat(),
            # PropStream fields — populated later if --propstream flag used
            "propstream_found":    False,
            "estimated_equity":    None,
            "mortgage_balance":    None,
            "equity_tier":         None,
            "is_absentee_owner":   None,
            "has_foreclosure":     None,
            "has_open_liens":      None,
            "open_liens":          None,
            "owner_type":          None,
            "years_owned":         None,
            "foreclosure_status":  None,
            "propstream_priority": False,
        }
        results.append(result)

    # Belt-and-braces: the 2026-07-02 incident signature was EVERY city coming
    # back with 0 comps (dead Apify token). Even if no individual fetch tripped
    # the failure sentinel, an all-zero comps run is never publishable.
    attempted = list(city_cache)
    if attempted and all(not city_cache[c][0] for c in attempted):
        degraded_cities.update(attempted)

    if cfg.get("secondary_assessment_rules"):
        results = _apply_secondary_assessment_rules(results)

    return results, all_comps, sorted(degraded_cities)


# ── Stage 5: PropStream enrichment ────────────────────────────────────────────

def enrich_with_propstream(results: List[Dict]) -> List[Dict]:
    """
    Run PropStream enrichment on results that have a valid address.

    Only enriches properties where arv is known (skip land / no-data parcels
    because PropStream data wouldn't improve actionability there).

    Adds propstream_priority=True for properties with high-value signals.
    """
    from execution.enrichment.propstream_enricher import PropStreamEnricher

    # Filter: only enrich properties where we have ARV data (analysis is useful)
    candidates = [r for r in results if r.get("arv")]
    skipped    = [r for r in results if not r.get("arv")]

    if not candidates:
        logger.warning("No properties with ARV data — skipping PropStream enrichment.")
        return results

    logger.info(
        f"Running PropStream enrichment on {len(candidates)} properties "
        f"(skipping {len(skipped)} with no ARV)..."
    )

    props_for_ps = [
        {
            "address":  r.get("full_address", r.get("address", "")),
            "city":     r.get("city", ""),
            "state":    r.get("state", "GA"),
            "zip_code": r.get("zip_code", ""),
        }
        for r in candidates
    ]

    enricher   = PropStreamEnricher()
    ps_results = enricher.run_enrichment_flow(props_for_ps)

    # Merge PropStream data back by address
    ps_by_address = {r.get("address", ""): r for r in ps_results}

    enriched_candidates = []
    for result in candidates:
        addr   = result.get("full_address", result.get("address", ""))
        ps_data = ps_by_address.get(addr, {})

        # Merge PropStream fields
        result.update({k: v for k, v in ps_data.items() if k != "address"})

        # Compute propstream_priority flag
        signals = set()
        if result.get("equity_tier") == "HIGH_EQUITY":
            signals.add("HIGH_EQUITY")
        if result.get("is_absentee_owner"):
            signals.add("absentee_owner")
        if result.get("has_foreclosure"):
            signals.add("foreclosure")
        if result.get("has_open_liens"):
            signals.add("open_liens")

        result["propstream_priority"]  = bool(signals & PROPSTREAM_PRIORITY_FLAGS)
        result["propstream_signals"]   = list(signals)

        enriched_candidates.append(result)

    return enriched_candidates + skipped


# ── Stage 6: Export ───────────────────────────────────────────────────────────

EXCEL_COLUMN_ORDER = [
    # Identity
    "tax_id", "full_address", "city", "state", "zip_code", "county",
    # Physical specs
    "sqft", "beds", "baths", "year_built", "property_class", "data_confidence",
    # Deal decision
    "recommendation", "top_deal", "is_no_bid", "no_bid_reason",
    "deal_score",
    "arv_confidence", "roi_percent", "net_profit", "arv", "arv_source",
    "min_bid", "max_bid", "recommended_max_bid",
    # Wave 1 (#1/#4): As-Is anchor + redemption dual-ROI
    "as_is_value", "as_is_source", "as_is_confidence",
    "base_margin_factor", "risk_adjustment_factor",
    "roi_if_redeemed_year1_pct", "roi_if_deed_matures",
    "analysis_notes", "rehab_basis",
    "zoning", "floodplain", "buildable_flag", "building_quality",
    # Cost breakdown
    "estimated_rehab_cost", "legal_closing_costs", "closing_costs", "title_insurance", "transfer_tax",
    "recording_fees", "inspection_cost", "quiet_title_cost", "carrying_total",
    "all_in_cost", "selling_costs", "net_proceeds",
    # Land fields
    "land_value", "land_value_source", "land_comp_quality", "land_acreage_flag",
    # Comps
    "comp_count", "comps_used_for_arv", "comp_pool_quality", "comp_window_months",
    "comp_pool_age_days", "comp_pool_tier",
    "avg_comp_price", "avg_price_sqft", "comp_cod", "assessor_implied_fmv",
    # PropStream enrichment
    "propstream_found", "propstream_priority", "propstream_signals",
    "estimated_equity", "equity_tier", "mortgage_balance",
    "is_absentee_owner", "owner_type", "years_owned",
    "has_foreclosure", "foreclosure_status", "has_open_liens", "open_liens",
    "last_sold_price", "last_sold_date",
    # Meta
    "source", "data_source_specs", "analysis_date",
]


def export_results(
    results:    List[Dict],
    all_comps:  List[Dict],
    county_key: str,
    timestamp:  str,
    degraded:   bool = False,
) -> Dict[str, str]:
    """Save JSON archive, Excel, and dashboard JSON. Returns dict of output paths.

    degraded=True keeps the .tmp archives (for debugging) but skips the
    dashboard JSON — web/data/{county}.json gets committed and auto-deploys,
    so a 0-comps run must never overwrite it with normal-looking output.
    """
    cfg        = COUNTY_CONFIG[county_key]
    result_dir = Path(cfg["tmp_dir"])
    result_dir.mkdir(parents=True, exist_ok=True)
    display    = cfg["display_name"].lower()

    # JSON archive
    json_path = result_dir / f"{display}_deterministic_{timestamp}.json"
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    logger.info(f"Saved JSON: {json_path}")

    # Excel
    excel_path = result_dir / f"{display}_deterministic_{timestamp}.xlsx"
    df          = pd.DataFrame(results)
    ordered     = [c for c in EXCEL_COLUMN_ORDER if c in df.columns]
    df[ordered].to_excel(excel_path, index=False)
    logger.info(f"Saved Excel: {excel_path}")

    # Dashboard JSON — never written on a degraded run (see docstring).
    if degraded:
        logger.error(f"DEGRADED run — dashboard JSON NOT written: {cfg['dashboard_json']}")
        dashboard_out = "(skipped — DEGRADED run)"
    else:
        dashboard_path = Path(cfg["dashboard_json"])
        dashboard_path.parent.mkdir(parents=True, exist_ok=True)
        dashboard_payload = {
            "properties":       results,
            "comparables":      all_comps,
            "total_properties": len(results),
            "county":           cfg["display_name"],
            "analysis_date":    datetime.now().isoformat(),
        }
        with open(dashboard_path, "w") as f:
            json.dump(dashboard_payload, f, indent=2, default=str)
        logger.info(f"Dashboard JSON updated: {dashboard_path}")
        dashboard_out = str(dashboard_path)

    return {
        "json":      str(json_path),
        "excel":     str(excel_path),
        "dashboard": dashboard_out,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def _run_web_scraper(county_key: str) -> Optional[Path]:
    """Run the county web scraper and return the path to the saved parsed JSON."""
    scrapers = {
        "dekalb": "execution.scrapers.dekalb_web_scraper",
    }
    if county_key not in scrapers:
        logger.warning(f"No web scraper registered for {county_key}")
        return None
    try:
        import importlib
        mod = importlib.import_module(scrapers[county_key])
        _, saved_path = mod.scrape()
        return saved_path
    except Exception as e:
        logger.error(f"Web scraper failed: {e}")
        return None


def main(county_key: str, input_file: Optional[str], use_propstream: bool, auto_parse: bool,
         auction_date: Optional[str] = None, web_scrape: bool = False,
         limit: Optional[int] = None, no_comps: bool = False):
    county_key = county_key.lower()
    if county_key not in COUNTY_CONFIG:
        logger.error(f"Unknown county: {county_key}. Choices: {list(COUNTY_CONFIG.keys())}")
        sys.exit(1)

    cfg = COUNTY_CONFIG[county_key]
    logger.info(f"\n{'='*70}")
    logger.info(f"GA County Pipeline — {cfg['display_name']} County")
    logger.info(f"{'='*70}")

    # Stage 0a: Web-scrape live listing if requested
    if web_scrape:
        logger.info("[Stage 0] Web-scraping live auction listing...")
        scraped = _run_web_scraper(county_key)
        if not scraped:
            logger.error("Web scraper returned no data. Check the site or supply --input manually.")
            sys.exit(1)
        input_file = str(scraped)
        logger.info(f"Scraper produced: {input_file}")

    # Stage 0b: Auto-parse PDF if requested
    elif auto_parse:
        ok = _run_county_parser(county_key)
        if not ok:
            logger.error("Parser failed. Fix the parser or supply --input manually.")
            sys.exit(1)

    # Find input file
    if not input_file:
        latest = _latest_parsed_file(county_key)
        if not latest:
            logger.error(
                f"No parsed {cfg['display_name']} file found in {cfg['tmp_dir']}.\n"
                f"  Option 1: Run with --scrape to fetch the live web listing (DeKalb).\n"
                f"  Option 2: Run with --parse to auto-invoke the PDF parser.\n"
                f"  Option 3: Supply --input <path> directly."
            )
            sys.exit(1)
        input_file = str(latest)
        logger.info(f"Auto-selected latest parsed file: {input_file}")

    with open(input_file) as f:
        properties = json.load(f)
    logger.info(f"Loaded {len(properties)} properties from {input_file}")

    if limit and limit > 0:
        properties = properties[:limit]
        logger.info(f"--limit {limit}: analyzing first {len(properties)} properties only")

    # Amount-less-source guard (Fulton observer-only decision, 2026-07-20).
    # The deal engine requires a per-parcel opening bid (tax_due); every
    # publishable county's parser guarantees it, so this can only fire on a
    # source that published NO amounts (Fulton sheriff levy lists). Refuse
    # BEFORE the expensive comps run rather than silently publish fabricated
    # ROIs/scores/$0-bids. See execution/utils/publish_guard.py and
    # directives/fulton_onboarding_scope.md.
    if all_parcels_unpriced(properties):
        logger.error(
            f"REFUSING TO RUN — {cfg['display_name']} input has {len(properties)} "
            f"parcels and NONE carry an opening bid (tax_due). The deal engine "
            f"cannot value a parcel without its bid; running would publish "
            f"fabricated ROIs, inflated scores, and $0 bids. This is the Fulton "
            f"observer-only case (directives/fulton_onboarding_scope.md) — NOT a "
            f"comps DEGRADE. Provide a per-parcel amount source before analysis."
        )
        sys.exit(2)

    # Apify / Zillow comps
    apify = None
    fallback_clients = []
    free_clients = []
    if no_comps:
        logger.warning(
            "--no-comps: comps fetch disabled — residential ARV falls back to "
            "assessor appraised values. Do NOT publish this run's ROI numbers."
        )
    else:
        apify_key = os.getenv("APIFY_API_KEY") or os.getenv("APIFY_API_TOKEN")
        if not apify_key:
            logger.error("APIFY_API_KEY not found in .env — cannot fetch comps.")
            sys.exit(1)
        # Budget pre-flight (2026-07-05, softened 2026-07-12): warn at 50% of
        # the monthly Apify limit; at 90% the run continues but every FRESH
        # actor sweep is refused inside ApifyZillowComps (fetch-time re-check),
        # so a run with full comp-store coverage still completes at ~$0 while
        # the hard stop on new spend stays in force.
        from execution.utils.apify_budget import check_apify_budget
        budget = check_apify_budget(apify_key)
        if not budget.ok:
            logger.error(
                "Apify budget >=90%: fresh Apify sweeps are DISABLED for this run. "
                "Comp-store pools and free fallbacks (HomeHarvest) still serve; "
                "cities with no reusable pool will degrade down the chain."
            )
        apify = ApifyZillowComps()

        # Free comps layer — tried BEFORE any fresh Apify spend (cost order:
        # store → HomeHarvest $0 → Apify paid → RentCast metered). No key
        # needed; armed whenever the package is installed.
        if os.getenv("COMPS_DISABLE_HOMEHARVEST") != "1":
            try:
                from execution.enrichment.homeharvest_comps import HomeHarvestComps
                free_clients.append(("homeharvest", HomeHarvestComps()))
                logger.info("HomeHarvest free comps layer armed (pip package present).")
            except Exception as e:
                logger.warning(f"HomeHarvest free comps layer unavailable: {e}")

        # Comps fallback chain — each layer armed only when its key is configured.
        if os.getenv("RAPIDAPI_KEY"):
            try:
                from execution.enrichment.rapidapi_comps import RapidAPIComps
                fallback_clients.append(("rapidapi", RapidAPIComps()))
                logger.info("RapidAPI comps fallback armed (RAPIDAPI_KEY present).")
            except Exception as e:
                logger.warning(f"RapidAPI comps fallback unavailable: {e}")
        if os.getenv("RENTCAST_API_KEY"):
            try:
                from execution.enrichment.rentcast_comps import RentCastComps
                fallback_clients.append(("rentcast", RentCastComps()))
                logger.info("RentCast comps fallback armed (RENTCAST_API_KEY present).")
            except Exception as e:
                logger.warning(f"RentCast comps fallback unavailable: {e}")
        if not fallback_clients:
            logger.warning(
                "No comps fallback configured (RAPIDAPI_KEY / RENTCAST_API_KEY unset) "
                "— run will be DEGRADED if Apify fails."
            )

    # Stages 2–4
    results, all_comps, degraded_cities = analyze_properties(
        properties, county_key, apify, fallback_clients, free_clients
    )
    degraded = bool(degraded_cities)

    # Write auction_date into every property record so the dashboard column
    # is populated consistently.  Infer from the first property if not supplied.
    effective_auction_date = auction_date or next(
        (r.get("auction_date") for r in results if r.get("auction_date")), None
    )
    if effective_auction_date:
        for r in results:
            if not r.get("auction_date"):
                r["auction_date"] = effective_auction_date

    # Stage 5: PropStream (optional)
    if use_propstream:
        logger.info("\n[Stage 5] PropStream enrichment (browser will open)...")
        results = enrich_with_propstream(results)

        # Stage 5b: Equity delta tracking
        logger.info("\n[Stage 5b] Saving PropStream snapshot for delta tracking...")
        try:
            from execution.enrichment.equity_delta_tracker import EquityDeltaTracker
            tracker = EquityDeltaTracker()
            tracker.save_run(county_key, results)
            delta = tracker.compare_latest_runs(county_key)
            if "summary_text" in delta:
                logger.info(f"\nEquity Delta Report:\n{delta['summary_text']}")
                tracker.export_delta_report(county_key)
        except Exception as e:
            logger.warning(f"Delta tracking failed (non-critical): {e}")
    else:
        logger.info("\n[Stage 5] PropStream skipped (run with --propstream to enable).")

    # Stage 6: Export
    # Stamp the client-facing top_deal verdict first — dashboard JSON, Excel,
    # and the auction index all persist it, and web/mobile render the flag
    # (arv_source is server-only, so clients cannot re-derive the gate).
    results = stamp_top_deals(results)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    paths     = export_results(results, all_comps, county_key, timestamp, degraded=degraded)

    if degraded:
        logger.error("DEGRADED run — auction index NOT updated, auction NOT registered.")
    else:
        if auction_date:
            register_auction(county_key, auction_date, results)
            logger.info(f"Registered auction {auction_date} in {county_key}_auctions.json")

        # Always sync the auction index to the main {county}.json so the dashboard
        # never loads a stale dated snapshot after a fresh pipeline run.
        update_index_to_main(county_key, results, auction_date or '')

    # Summary
    # Canonical rankable gate — shared with auction_index.summarize_results so
    # the run summary and the dashboard's "{n} Top Deals" badge can never drift
    # apart again (truth-gap fix 2026-07-17; web mirror: web/lib/topDeals.ts).
    top_deals   = [r for r in results if is_top_deal(r)]
    poss_deals  = [r for r in results if is_rankable(r)
                   and POSSIBLE_DEAL_MIN_ROI <= r["roi_percent"] < TOP_DEAL_MIN_ROI]
    ps_priority = [r for r in results if r.get("propstream_priority")]
    source_counts: Dict[str, int] = {}
    for r in results:
        src = r.get("comp_source", "none")
        source_counts[src] = source_counts.get(src, 0) + 1

    print(f"\n{'='*70}")
    print(f"{cfg['display_name'].upper()} ANALYSIS COMPLETE")
    print(f"{'='*70}")
    print(f"Properties Analyzed      : {len(results)}")
    print(f"Cities Covered           : {len(set(r.get('city') for r in results))}")
    print(f"Comp Sources             : " + "  ".join(
        f"{k}={source_counts.get(k, 0)}" for k in COMP_SOURCES))
    print(f"Top Deals  (ROI >= {TOP_DEAL_MIN_ROI:.0f}%)  : {len(top_deals)}")
    print(f"Possible   (ROI >= {POSSIBLE_DEAL_MIN_ROI:.0f}%)  : {len(poss_deals)}")
    if use_propstream:
        print(f"PropStream Priority Leads: {len(ps_priority)}")
    print(f"\nOutput Files:")
    print(f"  JSON      : {paths['json']}")
    print(f"  Excel     : {paths['excel']}")
    print(f"  Dashboard : {paths['dashboard']}")
    if no_comps:
        print("NOTE: --no-comps run — ARV from assessor values only; re-run with comps before publishing.")
    print(f"{'='*70}\n")

    if degraded:
        print(f"{'!'*70}")
        print("!!  DEGRADED RUN — DO NOT PUBLISH  !!")
        print(f"{'!'*70}")
        print(f"Comps fetch failed / returned 0 for: {', '.join(degraded_cities)}")
        print("ARV / ROI / land values in this output are UNRELIABLE.")
        print("Dashboard JSON and auction index were NOT updated.")
        print("Fix the comps source (directives/county_analysis_procedure.md ->")
        print("'DEGRADED run' entry), then re-run.")
        print(f"{'!'*70}\n")
        sys.exit(2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GA County Tax Deed Analysis Pipeline")
    parser.add_argument(
        "--county", required=True,
        choices=list(COUNTY_CONFIG.keys()),
        help="County to analyze: dekalb | cobb | gwinnett | clayton",
    )
    parser.add_argument(
        "--input", default=None,
        help="Path to parsed properties JSON (auto-selects latest if omitted)",
    )
    parser.add_argument(
        "--date", default=None,
        help="Auction date YYYY-MM-DD — registers output in the county auction index",
    )
    parser.add_argument(
        "--scrape", action="store_true",
        help="Fetch live auction listing from the county website before analysis (DeKalb only)",
    )
    parser.add_argument(
        "--propstream", action="store_true",
        help="Run PropStream browser enrichment after analysis (opens browser window)",
    )
    parser.add_argument(
        "--parse", action="store_true",
        help="Auto-run parse_{county}.py before analysis (converts PDF to JSON)",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Only process the first N properties (useful for testing)",
    )
    parser.add_argument(
        "--no-comps", action="store_true",
        help="Skip comps fetching (saves API credits; ARV falls back to assessor values)",
    )
    args = parser.parse_args()
    main(args.county, args.input, args.propstream, args.parse,
         auction_date=args.date, web_scrape=args.scrape,
         limit=args.limit, no_comps=args.no_comps)
