"""
NO-BID Disqualification Guardrail — GA tax-deed deal pipeline
============================================================
A single, pure screening layer that runs AFTER the deal-math models
(calculate_deal_metrics / calculate_land_metrics / calculate_commercial_metrics)
and BEFORE recommended_max_bid is emitted to the dashboard/investor.

Why this exists (proven failure, 2026-07-07 Cobb run — see
brands/bidwise/cobb-numeric-comparison-2026-07-07.md):
  A landlocked VACANT COMMERCIAL parcel (1490 Sandtown Rd) with ZERO market comps
  shipped a $185,051 recommended bid at a fabricated 1414% ROI — valued off a
  county appraisal our residential-comp engine has no business bidding on. 8 of the
  9 parcels the human analyst marked NO BID got a positive machine bid.

Screens implemented (calibrated against the REAL pipeline output, not constructed
profiles — verified by running run_ga_county.py on the manual Cobb list and
diffing by address against cobb-july-parcels-manual.json):

  1. Commercial/industrial vacant land with NO market comps → NO BID. The county
     appraisal is not a basis for a five-figure bid our comp engine can't support.
     This is THE fix for the $185k Sandtown case (property_class C3, comp_count 0).
  2. Vacant land with no defensible valuation at all (no land_value AND no ARV) →
     NO BID.
  3. Small vacant residential lots below a build floor → NO BID.
  4. Vacant land in a floodplain → NO BID (see the flood note below — coverage is
     honest: we read flood_risk/floodplain from the record; FEMA-by-lat/lon is a
     documented roadmap dependency, NOT claimed here).

What we deliberately do NOT do:
  - We never disqualify a parcel the pipeline routed to the RESIDENTIAL model that
    produced a valid ARV / net_profit — that IS a defensible valuation (e.g. 95
    Woods Dr, an SFR with a $500k ARV the human bid on). A stale "RESIDENTIAL
    VACANT" land_use string must not override a real residential valuation.
  - We do not claim to catch true LANDLOCK/ACCESS (532 Wallace, 510 Tower): that is
    a physical fact with no field in our data. Documented as a residual limitation.

The functions are pure (return NEW dicts; never mutate inputs) and do no I/O, so
they are deterministic and unit-testable without network/API keys.
"""

from typing import Dict, Optional, Tuple

# ── Named thresholds (defensible constants; see comments for the tradeoff) ─────

# Small-lot floor for VACANT residential land. Calibrated to the human reference
# verdicts on the Cobb 2026-07-07 list: every human "Small lot" NO-BID sits at
# 4,356 sq ft, while the human's smallest BID vacant lot is 4,700 sq ft (405
# Edwards Dr, 50x94). The floor MUST land strictly between those two so it screens
# the human's rejects without over-firing on the human's bids: 4,500 sq ft does
# exactly that (4,356 < 4,500 <= 4,700). Tradeoff: a genuinely buildable
# 4,356-4,500 sq ft infill lot would be screened out — the safe direction for a
# financial-safety guardrail (a missed cheap lot costs nothing; a bad five-figure
# bid on unbuildable dirt costs real money). Improved parcels are exempt.
SMALL_LOT_FLOOR_SQFT = 4_500

# Square feet per acre — for normalizing lot_acres into a comparable sqft figure.
SQFT_PER_ACRE = 43_560

# Reason categories — stable strings the UI and tests key off.
REASON_COMMERCIAL_NO_COMPS = "cannot value commercial/industrial land without comps"
REASON_NO_LAND_VALUE = "no land comps — cannot value raw land"
REASON_SMALL_LOT = "small lot — uneconomic to build"
REASON_FLOOD_ZONE = "flood zone"

# Property-class / use substrings that mark a parcel as vacant / raw land.
_VACANT_LAND_KEYWORDS = (
    "VACANT", "RAW LAND", "UNIMPROVED", "UNDEVELOPED", "LAND ONLY", "VACANT LOT",
)

# Substrings that name a real, valuable building — used to tell a thinly-parsed
# raw parcel (no sqft, no class) from an actual improved property.
_STRUCTURE_WORDS = (
    "1 FAMILY", "SINGLE FAMILY", "RESIDENTIAL 1", "CONDOMINIUM", "TOWNHOUSE",
    "APARTMENT", "DUPLEX", "OFFICE", "WAREHOUSE", "RETAIL", "STORE",
)

# Score/risk penalty applied to an IMPROVED parcel that sits in a floodplain.
# It is not disqualified (a house in a flood zone can still be a deal), but the
# extra insurability/financing/resale risk should visibly lower its score.
FLOODPLAIN_IMPROVED_SCORE_PENALTY = 15.0


# ── Field-alias readers (props arrive from parser, ArcGIS, or reference JSON) ──

def _first_present(prop: Dict, *keys: str):
    """Return the first non-None value among the given keys (alias resolution)."""
    for key in keys:
        val = prop.get(key)
        if val is not None:
            return val
    return None


def _to_float(raw) -> Optional[float]:
    """Best-effort float coercion; returns None on any non-numeric input."""
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _building_sqft(prop: Dict) -> Optional[float]:
    """Structure size across the schemas: pipeline `sqft`, reference `bldg_sqft`."""
    return _to_float(_first_present(prop, "sqft", "bldg_sqft", "building_sqft"))


def _lot_size_sqft(prop: Dict) -> Optional[float]:
    """Lot size in sq ft across schemas; converts lot_acres when only acres exist."""
    direct = _to_float(_first_present(prop, "lot_size_sf", "lot_size", "lot_size_sqft", "lot_sqft"))
    if direct is not None:
        return direct
    acres = _to_float(_first_present(prop, "lot_acres", "lot_size_acres"))
    return acres * SQFT_PER_ACRE if acres is not None else None


def _class_text(prop: Dict) -> str:
    """Concatenate every field that can describe use/class, upper-cased."""
    parts = [
        prop.get("property_type"), prop.get("property_class"),
        prop.get("land_use"), prop.get("zoning_code"), prop.get("use_desc"),
    ]
    return " ".join(str(p) for p in parts if p).upper()


def _is_commercial_class(prop: Dict) -> bool:
    """
    True when the parcel is commercial / industrial by class or use. Covers the
    Cobb assessor C-/I-prefixed class codes (C3, C4, I3) and descriptive
    commercial/industrial land-use strings.
    """
    pclass = str(prop.get("property_class") or "").strip().upper()
    # Require a digit after the C/I prefix (C3, C4, I3, C332...). A bare "C"/"I"
    # is treated as noise, not a commercial code — avoids disqualifying a parcel
    # on a truncated/garbage property_class.
    if pclass[:1] in ("C", "I") and pclass[1:2].isdigit():
        return True
    text = _class_text(prop)
    return any(w in text for w in ("COMMERCIAL", "INDUSTRIAL", "OFFICE", "RETAIL"))


def _has_valid_valuation(metrics: Dict) -> bool:
    """
    True when the deal model produced a defensible number to bid against:
    a positive ARV, a computed net_profit, or a positive land_value. This is the
    signal that a parcel is genuinely valued (residential ARV or land value),
    NOT raw dirt priced only off an assessor record with no comps.
    """
    for key in ("arv", "net_profit", "land_value"):
        val = _to_float(metrics.get(key))
        if val is not None and val > 0:
            return True
    return False


def _is_floodplain(prop: Dict) -> bool:
    """
    True when the county floodplain flag is YES, or the record's flood_risk is
    High. NOTE (honest coverage): this reads flood risk only when it is already
    present on the record. A FEMA floodplain lookup by lat/lon is NOT wired here —
    the input records do not reliably carry flood, so flood recall is partial. See
    the module docstring; wiring FEMA (risk_scorer) is a documented roadmap item.
    """
    flood = str(prop.get("floodplain") or "").strip().upper()
    if flood in ("YES", "TRUE", "Y"):
        return True
    return str(prop.get("flood_risk") or "").strip().upper() == "HIGH"


def is_vacant_land(prop: Dict, metrics: Optional[Dict] = None) -> bool:
    """
    A parcel is vacant/raw land for guardrail purposes when the pipeline routed it
    to the land path — property_type in {Land, Vacant Land} — OR it carries no
    structure and no class naming a building.

    Crucially, this RESPECTS the pipeline's routing: a parcel the pipeline sent
    through the residential model that produced a valid ARV / net_profit is NOT
    vacant land here, even if a stale land_use string says "RESIDENTIAL VACANT".
    (95 Woods Dr: land_use "RESIDENTIAL VACANT" but routed SFR with a $125k ARV —
    a human BID that must not be screened as un-valuable dirt.)
    """
    ptype = str(prop.get("property_type") or "").strip().upper()
    if ptype in ("LAND", "VACANT LAND"):
        return True
    if ptype in ("SFR", "RESIDENTIAL", "MULTI-FAMILY", "COMMERCIAL"):
        # Pipeline gave it a concrete non-land type — it is not raw land.
        return False

    # No property_type set (thin parse): fall back to structure/valuation evidence.
    if metrics is not None and _has_valid_valuation(metrics):
        return False
    text = _class_text(prop)
    if any(w in text for w in _STRUCTURE_WORDS):
        return False
    sqft = _building_sqft(prop)
    if sqft is not None and sqft > 0:
        return False
    if any(kw in text for kw in _VACANT_LAND_KEYWORDS):
        return True
    # No structure, no building class → treat as unimproved dirt.
    return prop.get("beds") in (None, 0)


def _comp_count(prop: Dict, metrics: Dict) -> Optional[int]:
    """Market-comp count, read from metrics or the prop record."""
    raw = metrics.get("comp_count")
    if raw is None:
        raw = prop.get("comp_count")
    val = _to_float(raw)
    return int(val) if val is not None else None


# ── Core disqualification decision (pure) ─────────────────────────────────────

def evaluate_disqualifiers(prop: Dict, metrics: Dict) -> Tuple[Optional[str], Optional[str]]:
    """
    Decide whether a parcel is a NO BID. Pure — reads prop + computed metrics,
    returns (no_bid_reason, buildable_flag_reason) without side effects.

    Returns (reason, None) when disqualified (reason is a REASON_* constant), or
    (None, None) when the parcel passes.

    Rule order (first match wins; land integrity is the highest-impact screen):
      1. Commercial/industrial vacant land with 0 market comps → REASON_COMMERCIAL_NO_COMPS
      2. Vacant land with no defensible valuation at all        → REASON_NO_LAND_VALUE
      3. Vacant land in a floodplain                           → REASON_FLOOD_ZONE
      4. Vacant residential land below the small-lot floor     → REASON_SMALL_LOT

    Improved / residentially-valued parcels are never disqualified here (flood
    handling for improved parcels is a penalty applied in apply_guardrail).

    KNOWN LIMITATION (honest): true LANDLOCK / no-access (e.g. 532 Wallace, 510
    Tower) is a physical fact with NO field in our data — a landlocked lot that
    still carries residential comps is valued and screened identically to a
    buildable lot. The guardrail does not (and must not pretend to) catch that
    class; closing it needs an access/frontage data source. Flood recall is also
    partial until a FEMA lat/lon lookup is wired (see _is_floodplain).
    """
    if not is_vacant_land(prop, metrics):
        return None, None

    comps = _comp_count(prop, metrics)

    # 1. Commercial/industrial vacant land with no market comps — THE big one.
    #    Our residential-comp engine cannot value it; the county appraisal alone
    #    is not a basis for a five-figure bid. Kills 1490 Sandtown ($185k / 1414%).
    if _is_commercial_class(prop) and comps == 0:
        return REASON_COMMERCIAL_NO_COMPS, None

    # 2. No defensible valuation at all (no land_value, no ARV, no net_profit).
    if not _has_valid_valuation(metrics):
        return REASON_NO_LAND_VALUE, None

    # 3. Floodplain on VACANT land — raw dirt in a flood zone cannot be a deal.
    if _is_floodplain(prop):
        return REASON_FLOOD_ZONE, None

    # 4. Small-lot floor — uneconomic to build.
    lot_sqft = _lot_size_sqft(prop)
    if lot_sqft is not None and lot_sqft < SMALL_LOT_FLOOR_SQFT:
        return REASON_SMALL_LOT, None

    return None, None


def apply_guardrail(prop: Dict, metrics: Dict) -> Dict:
    """
    Return a NEW metrics dict with the NO-BID guardrail applied.

    On disqualify: recommended_max_bid/max_bid=None, deal_score=0, buildable_flag=
    False, is_no_bid=True, recommendation="NO BID", no_bid_reason set.

    On pass:
      - buildable_flag populated truthfully (True for vacant land that cleared all
        screens; the model's own flag is preserved for improved parcels),
      - recommended_max_bid mirrored off max_bid so the output is self-consistent,
      - an IMPROVED parcel in a floodplain gets floodplain=True + a score penalty
        (NOT a NO BID — a house in a flood zone can still be a deal). The
        deduction is also recorded on score_penalty so the confidence tier —
        which rebuilds deal_score from ROI — re-applies it after its rewrite.

    Never mutates `prop` or the input `metrics`.
    """
    reason, _ = evaluate_disqualifiers(prop, metrics)
    out = dict(metrics)

    if reason is not None:
        out["recommended_max_bid"] = None
        out["max_bid"] = None
        out["deal_score"] = 0.0
        out["buildable_flag"] = False
        out["is_no_bid"] = True
        out["recommendation"] = "NO BID"
        out["no_bid_reason"] = reason
        return out

    # ── Passing parcel ──
    out["is_no_bid"] = False
    out["recommendation"] = "BID"
    out["no_bid_reason"] = None
    out["recommended_max_bid"] = out.get("max_bid")

    vacant = is_vacant_land(prop, metrics)
    if vacant:
        out["buildable_flag"] = True
    else:
        if out.get("buildable_flag") is None:
            out["buildable_flag"] = True
        if _is_floodplain(prop):
            out["floodplain"] = True
            # Recorded (not just subtracted) because the confidence tier rebuilds
            # deal_score from roi_percent and re-applies score_penalty post-cap;
            # without the field the -15 vanished for every bid-able parcel.
            out["score_penalty"] = (out.get("score_penalty") or 0.0) + FLOODPLAIN_IMPROVED_SCORE_PENALTY
            score = out.get("deal_score")
            if isinstance(score, (int, float)):
                out["deal_score"] = max(0.0, round(score - FLOODPLAIN_IMPROVED_SCORE_PENALTY, 1))

    return out
