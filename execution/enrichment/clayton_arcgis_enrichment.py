"""
Clayton County Property Enrichment — ArcGIS REST
=================================================
Gets sqft / beds / baths / year_built / values for any Clayton County GA parcel.

Data source (verified 2026-07-02):
  Clayton County ArcGIS Enterprise (11.5) — TaxAssessor/Parcels MapServer, Layer 0
  https://gis.claytoncountyga.gov/server/rest/services/TaxAssessor/Parcels/MapServer/0

  Field mapping (NOTE: almost all fields are STRINGS, including numerics):
    PARCELID    → parcel id, same format as the tax-sale PDF: "05176A D012", "06070 091002"
    SITEADDRES  → situs street address (may have a leading space when no house number)
    SITECITY    → situs city (JONESBORO, MORROW, HAMPTON, ...)
    SITEZIP5    → situs ZIP
    YEARBUILT   → year built ("" when vacant)
    SQRFT       → finished sqft ("" when vacant)
    BED / BATH  → bed / bath counts ("" when vacant; BATH can be "2.5")
    APPRVAL     → appraised (fair market) value
    ASSESSVAL   → assessed value (40% of FMV)
    LANDUSEC    → land-use code: 1xx res, 2xx multi-family/hotel, 3xx comm,
                  4xx industrial, 500 salvage, 6xx exempt, 7xx utility, 888 incentive
    LANDUSED    → land-use description ("Residential 1 family", ...)
    ACERAGE     → lot acres (double) — VERIFIED field name but usually 0.0 even on
                  built parcels, so only trusted when > 0
    STRUCTYPE   → structure type ("RANCH", "TWO STORY", ...)

Known limitations:
  - Tax-sale rows with suffixed parcel ids ("06070 091002Y" mobile-home/improvement
    records, "12114C A002 O04" unit records) do NOT exist in the layer. We fall back
    to the base parcel for STRUCTURE data only, at MEDIUM confidence, and return
    appraised/assessed = None because the base parcel's valuation belongs to a
    different assessment record (e.g. base of "12114C A002 O04" is a $100 HOA
    common area while the PDF row is a $125K unit).
  - property_class is normalized so the pipeline's routing works:
    2xx → "MULTI-FAMILY"; 3xx/5xx/6xx/7xx/8xx → "C{code} {desc}"; 4xx → "I{code} {desc}";
    1xx stays "{code} {desc}" (residential; no ^[CI]\\d match).

Usage:
    enricher = ClaytonArcGISEnricher()
    specs = enricher.get_specs("05176A D012")
    # Returns: {sqft, beds, baths, year_built, appraised_value, assessed_value,
    #           property_class, assessor_address, lot_acres, data_source, data_confidence}
"""

import re
import sys
from pathlib import Path
from typing import Dict, Optional

# Allow running standalone (python execution/enrichment/clayton_arcgis_enrichment.py)
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from execution.utils.http_client import http_get
from loguru import logger

PARCELS_QUERY_URL = (
    "https://gis.claytoncountyga.gov/server/rest/services"
    "/TaxAssessor/Parcels/MapServer/0/query"
)

ARCGIS_FIELDS = (
    "PARCELID,SITEADDRES,SITECITY,SITEZIP5,YEARBUILT,SQRFT,BED,BATH,"
    "APPRVAL,ASSESSVAL,LANDUSEC,LANDUSED,STRUCTYPE,ACERAGE,"
    "QUALITYOFBUILDING,ZONE,FLOODPLAIN"
)


def _normalize_pin(parcel_id: str) -> str:
    """Collapse whitespace and uppercase: '05176a  d012 ' → '05176A D012'."""
    return re.sub(r"\s+", " ", parcel_id.strip()).upper()


def _base_pin_candidates(pin: str) -> list:
    """
    Fallback parcel ids for suffixed tax-sale rows that don't exist in the layer.

    "06070 091002Y"   → ["06070 091002"]                (trailing letter = separate
                                                         improvement/mobile-home record)
    "12114C A002 O04" → ["12114C A002"]                 (third token = unit record)
    """
    candidates = []
    tokens = pin.split(" ")
    if len(tokens) > 2:
        candidates.append(" ".join(tokens[:2]))
    stripped = re.sub(r"(?<=\d)[A-Z]+$", "", tokens[-1])
    if stripped != tokens[-1]:
        candidates.append(" ".join(tokens[:-1] + [stripped]))
    return [c for c in candidates if c and c != pin]


def _to_int(raw) -> Optional[int]:
    try:
        val = int(float(str(raw).replace(",", "").strip()))
        return val if val > 0 else None
    except (ValueError, TypeError):
        return None


def _to_float(raw) -> Optional[float]:
    try:
        val = float(str(raw).replace(",", "").strip())
        return val if val > 0 else None
    except (ValueError, TypeError):
        return None


def _map_property_class(code: str, desc: str) -> Optional[str]:
    """
    Normalize Clayton land-use codes into strings the pipeline routes correctly:
      run_ga_county matches ^[CI]\\d for commercial/industrial and the exact
      string "MULTI-FAMILY" for multi-family.
    """
    code = (code or "").strip()
    desc = (desc or "").strip()
    if not code and not desc:
        return None
    first = code[:1]
    if first == "2":
        return "MULTI-FAMILY"
    if first in ("3", "5", "6", "7", "8"):
        return f"C{code} {desc}".strip()
    if first == "4":
        return f"I{code} {desc}".strip()
    return f"{code} {desc}".strip()


def _ring_centroid(geometry: Optional[dict]) -> tuple:
    """(lat, lng) from the mean of the outer-ring vertices — pin-grade accuracy."""
    try:
        ring = (geometry or {}).get("rings", [[]])[0]
        if len(ring) < 3:
            return None, None
        xs = [pt[0] for pt in ring]
        ys = [pt[1] for pt in ring]
        return round(sum(ys) / len(ys), 6), round(sum(xs) / len(xs), 6)
    except (TypeError, IndexError, ZeroDivisionError):
        return None, None


def _empty_result(source: str = "NOT_FOUND", confidence: str = "NONE") -> dict:
    """Full required-field dict — every get_specs() return path uses this shape."""
    return {
        "sqft": None, "beds": None, "baths": None, "year_built": None,
        "appraised_value": None, "assessed_value": None,
        "property_class": None, "assessor_address": None,
        "lot_acres": None,
        "building_quality": None, "zoning": None, "floodplain": None,
        "latitude": None, "longitude": None,
        "data_source": source, "data_confidence": confidence,
    }


class ClaytonArcGISEnricher:
    """
    Retrieves property characteristics for Clayton County parcels from the
    county's own ArcGIS Enterprise TaxAssessor/Parcels layer.
    """

    def __init__(self):
        self._cache: Dict[str, dict] = {}

    # ─────────────────────────────────────────────────────────────────────────
    # PUBLIC ENTRY POINT
    # ─────────────────────────────────────────────────────────────────────────

    def get_specs(self, parcel_id: str, address: str = "", city: str = "") -> dict:
        """
        Returns dict with: sqft, beds, baths, year_built, appraised_value,
        assessed_value, property_class, assessor_address, lot_acres,
        data_source, data_confidence.  All keys present on every return path.
        """
        pin = _normalize_pin(parcel_id)
        if pin in self._cache:
            return self._cache[pin]

        try:
            result = self._lookup(pin)
        except Exception as e:
            logger.error(f"Clayton ArcGIS enrichment FAILED (after retries) for {pin}: {e}")
            result = _empty_result(source="ERROR", confidence="NONE")

        self._cache[pin] = result
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # INTERNALS
    # ─────────────────────────────────────────────────────────────────────────

    def _lookup(self, pin: str) -> dict:
        feature = self._query_exact(pin)
        if feature:
            result = self._attrs_to_result(feature.get("attributes", {}))
            result["latitude"], result["longitude"] = _ring_centroid(feature.get("geometry"))
            result["data_source"] = "Clayton ArcGIS (TaxAssessor/Parcels)"
            result["data_confidence"] = "HIGH"
            logger.info(
                f"ArcGIS OK for {pin}: sqft={result.get('sqft')} "
                f"beds={result.get('beds')} yr={result.get('year_built')}"
            )
            return result

        # Suffixed tax-sale record — base parcel gives structure context only.
        for base in _base_pin_candidates(pin):
            feature = self._query_exact(base)
            if feature:
                result = self._attrs_to_result(feature.get("attributes", {}))
                result["latitude"], result["longitude"] = _ring_centroid(feature.get("geometry"))
                # Valuations belong to a different assessment record — drop them.
                result["appraised_value"] = None
                result["assessed_value"] = None
                result["data_source"] = f"Clayton ArcGIS (base parcel {base})"
                result["data_confidence"] = "MEDIUM"
                logger.info(f"ArcGIS base-parcel fallback for {pin} -> {base}")
                return result

        logger.warning(f"Clayton ArcGIS: no parcel found for {pin}")
        return _empty_result()

    def _query_exact(self, pin: str) -> Optional[dict]:
        """Exact PARCELID match. Returns the full feature (attributes + WGS84
        geometry for the subject map pin) or None."""
        params = {
            "where": f"PARCELID='{pin.replace(chr(39), chr(39) * 2)}'",
            "outFields": ARCGIS_FIELDS,
            "returnGeometry": "true",
            "outSR": 4326,
            "resultRecordCount": 1,
            "f": "json",
        }
        resp = http_get(PARCELS_QUERY_URL, params=params, timeout=20)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise RuntimeError(f"ArcGIS error response: {data['error']}")
        features = data.get("features", [])
        return features[0] if features else None

    @staticmethod
    def _attrs_to_result(a: dict) -> dict:
        result = _empty_result()
        result["sqft"] = _to_int(a.get("SQRFT"))
        result["beds"] = _to_int(a.get("BED"))
        result["baths"] = _to_float(a.get("BATH"))

        year = _to_int(a.get("YEARBUILT"))
        result["year_built"] = year if year and year > 1800 else None

        result["appraised_value"] = _to_float(a.get("APPRVAL"))
        result["assessed_value"] = _to_float(a.get("ASSESSVAL"))
        result["property_class"] = _map_property_class(a.get("LANDUSEC"), a.get("LANDUSED"))

        site_addr = (a.get("SITEADDRES") or "").strip()
        site_city = (a.get("SITECITY") or "").strip()
        site_zip = (a.get("SITEZIP5") or "").strip()
        if site_addr or site_city:
            result["assessor_address"] = f"{site_addr}, {site_city}, GA {site_zip}".strip(", ")

        acres = _to_float(a.get("ACERAGE"))
        result["lot_acres"] = acres  # None unless the county actually populated it (> 0)

        # Condition / buildability context (verified field names, 2026-07-04):
        # QUALITYOFBUILDING grades: E(xcellent) G(ood) A(verage) F(air) L(ow) V —
        # drives the rehab tier in ga_deal_calculator. ZONE + FLOODPLAIN feed the
        # vacant-land buildable-candidate flag.
        result["building_quality"] = (a.get("QUALITYOFBUILDING") or "").strip().upper() or None
        result["zoning"] = (a.get("ZONE") or "").strip().upper() or None
        result["floodplain"] = (a.get("FLOODPLAIN") or "").strip().upper() or None
        return result


# ── Standalone test ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import time

    enricher = ClaytonArcGISEnricher()
    test_cases = [
        ("05176A D012", "SFR ranch, Jonesboro"),
        ("12053D A011", "SFR two story, Jonesboro"),
        ("12175D A081", "vacant residential, Morrow"),
        ("06070 091002Y", "suffixed improvement record -> base-parcel fallback"),
        ("12114C A002 O04", "unit record -> base-parcel fallback (no valuations)"),
        ("99999 000000", "nonexistent -> NOT_FOUND"),
    ]

    print("\n=== Clayton ArcGIS Enrichment Test ===\n")
    for pid, note in test_cases:
        specs = enricher.get_specs(pid)
        print(f"Parcel: {pid}  ({note})")
        print(f"  sqft={specs.get('sqft')}  beds={specs.get('beds')}  "
              f"baths={specs.get('baths')}  yr={specs.get('year_built')}  "
              f"appr={specs.get('appraised_value')}  "
              f"class={specs.get('property_class')}  "
              f"acres={specs.get('lot_acres')}  "
              f"conf={specs.get('data_confidence')}  "
              f"src={specs.get('data_source')}")
        print()
        time.sleep(0.3)
