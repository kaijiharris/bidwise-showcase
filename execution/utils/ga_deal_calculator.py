"""
Georgia Tax Deed — Shared Cost Constants and Deal Metrics
=========================================================
Single source of truth for all three active GA counties:
  DeKalb · Cobb · Gwinnett

Three property models — each with its own logic:

  calculate_deal_metrics()      — Residential: post-rehab flip + as-is flip
  calculate_land_metrics()      — Vacant land: 20% land value rule, no ARV, no rehab
  calculate_commercial_metrics()— Commercial: acquisition cost only, no ARV/ROI

Usage:
    from execution.utils.ga_deal_calculator import (
        calculate_deal_metrics,
        calculate_land_metrics,
        calculate_commercial_metrics,
        calculate_arv_from_comps,
    )
"""

import math
from typing import Dict, Optional, Tuple

# ── GA Tax Deed Cost Constants ────────────────────────────────────────────────
# Flat default for Georgia closing + legal fees. Override per property via
# prop["closing_legal_fee"] — e.g. when a specific title quote is known.
DEFAULT_CLOSING_LEGAL_FEE = 3_500

GA_COSTS = {
    "quiet_title":       3_500,   # Attorney fees — mandatory in GA before resale
    "recording_fees":    250,     # Standard county recording
    "inspection":        500,     # Standard inspection
    "carrying_months":   12,      # Quiet title (3-6 mo) + marketing/close (3-6 mo)
    "carrying_monthly":  350,     # Utilities $200 + security/maintenance $150
    "selling_cost_pct":  0.07,    # 6% agent + 1% seller closing
    "closing_cost_pct":  0.03,    # 3% of purchase price
    "title_ins_pct":     0.005,   # 0.5% of purchase price
    "transfer_tax_per_k": 1.0,    # GA DOR transfer tax is approximately $1 per $1,000
    "max_bid_arv_factor": 0.65,   # 65% rule — reflects GA quiet-title risk premium
    "land_value_factor":  0.20,   # Land value = 20% of avg residential comp price (configurable heuristic)
}

# ── Wave 1 (#1): As-Is-anchored max-bid ceiling constants ─────────────────────
BARMENT_COST = 1_500                                  # GA barment/foreclose-right cost
# base_margin: fraction of the As-Is anchor a competitive bid targets BEFORE the
# risk discount and the flat transaction-cost stack. Calibrated on the Cobb July
# well-comped residential subset (comp_count>=4: 170 Mathews, 856 Richard, 359
# Roselane, 875 Soaring, 1584 Arden). Against the county-appraised anchor the engine
# uses, the human's implied margin runs 0.55–0.71 (median 0.65). A flat 0.62 across
# tiers lands that subset at MAPE ~10% with no bid over the 0.80 hard cap. Tiers are
# retained (not collapsed to one constant) so a county with a different comp regime
# can re-tune high/mid/low independently without a code change.
BASE_MARGIN_BY_TIER = {'high': 0.62, 'mid': 0.62, 'low': 0.62}
AS_IS_TIER_HIGH = 400_000
AS_IS_TIER_MID  = 200_000
RISK_FLOOR = 0.55                # risk multiplier product is never allowed below this
CEILING_OF_CEILING = 0.80        # a bid never exceeds As-Is × 0.80 (hard cap)
COMP_WEAK_FACTOR = 0.85

# ── Wave 2: ROI caps ──────────────────────────────────────────────────────────
# Two DISTINCT caps:
#   ROI_SANITY_CEILING — display clamp on the emitted roi_percent (Wave-1 A5). The
#     corpus showed uncapped post-rehab ROIs of 778.3 / 220.4 / 1414%; anything
#     over 200 is a data artifact, not a real return, and must not be stored.
#   ROI_SCORE_CAP — score-curve INPUT cap: a >150% ROI already saturates the
#     opportunity curve at 100, so feeding cap_roi(roi) makes the score deterministic
#     and immune to ROI inflation.
ROI_SANITY_CEILING = 200.0
ROI_SCORE_CAP = 150.0

DELINQUENCY_FACTOR = 0.92
OCCUPANCY_FACTOR = 0.90
CONDITION_UNCERTAINTY_FACTOR = 0.90
REDEMPTION_FACTOR = 0.95         # always-on statutory-redemption discount
COMP_WEAK_COMP_COUNT_MAX = 2     # comp_count<=2 is the thin-comp proxy (no confidence_tier yet)

# Segmentation: bid COMPETITIVELY (toward the As-Is anchor, hard-capped at ×0.80)
# ONLY on well-comped residential where the number is defensible. Everything else
# (thin comps, commercial, land, no-anchor) stays CONSERVATIVE on the tax_due floor.
WELL_COMPED_MIN_COMPS = 4                                  # comps needed to trust the anchor
DEFENSIBLE_AS_IS_SOURCES = ('distressed_comp', 'county_appraised')  # not arv_derived_fallback
# property_type values the live ga runner assigns to single-family residential.
RESIDENTIAL_TYPES = ('SFR', 'RESIDENTIAL')

# ── Wave 1 (#4): GA redemption dual-ROI constants ─────────────────────────────
GA_REDEMPTION_PREMIUM_YEAR1  = 0.20   # 20% statutory premium in year 1
GA_REDEMPTION_PREMIUM_ANNUAL = 0.10   # +10% per additional year
REDEMPTION_SCENARIO_MONTHS = (3, 6, 12, 18, 24)
MATURATION_MONTHS_DEFAULT = 21        # assumed months to deed maturation
DAYS_PER_MONTH = 30.4                 # annualization denominator base


# ── Wave 1 (#1): As-Is-anchored max-bid ceiling helpers ───────────────────────

def _coerce_positive_float(value) -> Optional[float]:
    """Return float(value) if it parses and is > 0, else None (absent)."""
    try:
        num = float(value)
    except (ValueError, TypeError):
        return None
    return num if num > 0 else None


def _asis_anchor(prop: Dict, arv: Optional[float]) -> Tuple[float, str, str]:
    """
    As-Is anchor value + source + confidence, by priority chain (immutable):
      1. distressed_comp_value  → HIGH
      2. appraised_value / county_appraised_value → MEDIUM
      3. arv × 0.82 (fallback)  → LOW
      4. (0.0, 'none', 'NONE')
    """
    distressed = _coerce_positive_float(prop.get('distressed_comp_value'))
    if distressed is not None:
        return (round(distressed, 2), 'distressed_comp', 'HIGH')

    appraised = _coerce_positive_float(prop.get('appraised_value'))
    if appraised is None:
        appraised = _coerce_positive_float(prop.get('county_appraised_value'))
    if appraised is not None:
        return (round(appraised, 2), 'county_appraised', 'MEDIUM')

    arv_val = _coerce_positive_float(arv)
    if arv_val is not None:
        return (round(arv_val * 0.82, 2), 'arv_derived_fallback', 'LOW')

    return (0.0, 'none', 'NONE')


def _base_margin(as_is_value: float) -> float:
    """Tighter margin for higher As-Is value: >=400k→0.50, >=200k→0.60, else 0.70."""
    if as_is_value >= AS_IS_TIER_HIGH:
        return BASE_MARGIN_BY_TIER['high']
    if as_is_value >= AS_IS_TIER_MID:
        return BASE_MARGIN_BY_TIER['mid']
    return BASE_MARGIN_BY_TIER['low']


def _risk_adjustment(
    prop: Dict, comp_count: Optional[int], as_is_confidence: str
) -> Tuple[float, Dict]:
    """
    Multiplicative risk discount + breakdown of the factors that fired (immutable).
    REDEMPTION_FACTOR is always on; the rest fire on their respective signals.
    """
    factor = 1.0
    breakdown: Dict[str, float] = {}

    factor *= REDEMPTION_FACTOR
    breakdown['redemption'] = REDEMPTION_FACTOR

    if comp_count is None or comp_count <= COMP_WEAK_COMP_COUNT_MAX:
        factor *= COMP_WEAK_FACTOR
        breakdown['comp_weak'] = COMP_WEAK_FACTOR

    if prop.get('has_open_liens'):
        factor *= DELINQUENCY_FACTOR
        breakdown['delinquency'] = DELINQUENCY_FACTOR

    if prop.get('owner_occupied'):
        factor *= OCCUPANCY_FACTOR
        breakdown['occupancy'] = OCCUPANCY_FACTOR

    if as_is_confidence in ('LOW', 'NONE'):
        factor *= CONDITION_UNCERTAINTY_FACTOR
        breakdown['condition_uncertainty'] = CONDITION_UNCERTAINTY_FACTOR

    return (round(factor, 4), breakdown)


def _is_well_comped_residential(
    property_type: Optional[str], comp_count: Optional[int], as_is_source: str
) -> bool:
    """
    True only when the parcel is defensibly valuable enough to bid COMPETITIVELY:
    a residential/SFR property, with a defensible As-Is anchor (distressed comp or
    county appraisal — NOT an arv-derived fallback), backed by >= WELL_COMPED_MIN_COMPS
    comps. Thin-comp / commercial / land / arv-fallback parcels return False and are
    kept CONSERVATIVE on the tax_due floor (we never chase what we can't value).
    """
    if (property_type or '').strip().upper() not in RESIDENTIAL_TYPES:
        return False
    if as_is_source not in DEFENSIBLE_AS_IS_SOURCES:
        return False
    return comp_count is not None and comp_count >= WELL_COMPED_MIN_COMPS


def _asis_ceiling(
    as_is_value: float,
    base_margin: float,
    risk_factor: float,
    cost_stack: float,
    tax_due: float,
) -> float:
    """
    As-Is-anchored competitive ceiling for WELL-COMPED RESIDENTIAL only.

    ceiling = As-Is x base_margin x max(risk, RISK_FLOOR) - flat_cost_stack,
    hard-capped at As-Is x 0.80, floored at tax_due.

    The As-Is anchor drives the bid: the old min(ceiling, existing_arv_max_bid)
    clamp was removed (2026-07-07) because it pinned every raise back down to the
    too-low arv-derived number, so #1 could only ever LOWER a bid. cost_stack is
    TRANSACTION costs only (quiet title + barment + carrying + closing/recording);
    rehab belongs to the ARV/flip model, not the as-is purchase ceiling.
    """
    ceiling = as_is_value * base_margin * max(risk_factor, RISK_FLOOR) - cost_stack
    ceiling = min(ceiling, as_is_value * CEILING_OF_CEILING)
    ceiling = max(ceiling, tax_due)
    return round(ceiling, 2)


# ── Wave 1 (#4): GA redemption dual-ROI ───────────────────────────────────────

def calculate_redemption_scenario(
    prop: Dict, closing_legal_fee: Optional[float] = None
) -> Dict:
    """
    Redemption ROI grid for a GA redeemable tax deed (pure, no ARV/comps).

    Redemption base = winning_bid + subsequent_taxes (NEVER bid alone). Premium is
    a step function: 20% in year 1, +10% per additional year (via ceil(months/12)).
    `closing_legal_fee` is accepted for signature compatibility; it is unused.
    """
    winning_bid = float(
        prop.get('winning_bid') or prop.get('max_bid') or prop.get('tax_due') or 0
    )
    subsequent_taxes = float(prop.get('subsequent_taxes') or 0)
    sunk_barment = BARMENT_COST
    redemption_base = winning_bid + subsequent_taxes
    invested = winning_bid + subsequent_taxes + sunk_barment

    scenarios = []
    for m in REDEMPTION_SCENARIO_MONTHS:
        years = math.ceil(m / 12)
        premium_pct = (GA_REDEMPTION_PREMIUM_YEAR1 if years == 1
                       else GA_REDEMPTION_PREMIUM_YEAR1 + GA_REDEMPTION_PREMIUM_ANNUAL * (years - 1))
        redemption_payment = redemption_base * (1 + premium_pct)
        net = redemption_payment - winning_bid - subsequent_taxes - sunk_barment
        total_return_pct = (net / invested * 100) if invested > 0 else 0.0
        annualized = (
            ((1 + total_return_pct / 100) ** (365 / (m * DAYS_PER_MONTH)) - 1) * 100
            if invested > 0 else 0.0
        )
        scenarios.append({
            'month': m,
            'years': years,
            'premium_pct': round(premium_pct * 100, 1),
            'redemption_payment': round(redemption_payment, 2),
            'net_profit': round(net, 2),
            'total_return_pct': round(total_return_pct, 2),
            'annualized_return_pct': round(annualized, 2),
        })

    return {
        'roi_if_redeemed_year1_pct': 20.0,
        'redemption_base': round(redemption_base, 2),
        'scenarios': scenarios,
        'maturation_months_assumed': MATURATION_MONTHS_DEFAULT,
    }

# Rehab rates per sqft for GA tax deed properties (neglected 2-5+ years)
REHAB_RATES = {
    "light":  35,   # Built after 2005 (<20 yrs): cosmetic but still distressed
    "medium": 55,   # Built 1981-2005 (20-45 yrs): mechanicals, kitchen/bath
    "heavy":  85,   # Built before 1981 (>45 yrs): structural, lead paint risk
}
REHAB_CONTINGENCY = 1.15  # +15% contingency on all rehab estimates


# ── Shared helpers ────────────────────────────────────────────────────────────

def _base_acquisition_costs(tax_due: float, closing_legal_fee: Optional[float] = None) -> Dict:
    """
    Compute the acquisition-side costs that apply to every property type.
    Returns a dict of cost line items (does NOT include rehab).
    """
    c = GA_COSTS
    fee = closing_legal_fee if closing_legal_fee is not None else DEFAULT_CLOSING_LEGAL_FEE
    # Itemised components kept for transparency even though the headline
    # legal_closing_costs is now a flat default.
    closing_costs   = round(tax_due * c["closing_cost_pct"], 2)
    title_insurance = round(tax_due * c["title_ins_pct"], 2)
    transfer_tax    = round((tax_due / 1_000) * c["transfer_tax_per_k"], 2)
    carrying_total  = round(c["carrying_monthly"] * c["carrying_months"], 2)
    legal_closing_costs = fee
    return {
        "closing_costs":       closing_costs,
        "legal_closing_costs": legal_closing_costs,
        "title_insurance":     title_insurance,
        "transfer_tax":        transfer_tax,
        "recording_fees":      c["recording_fees"],
        "inspection_cost":     c["inspection"],
        "quiet_title_cost":    c["quiet_title"],
        "carrying_total":      carrying_total,
        "_sum": round(
            legal_closing_costs + c["inspection"] + carrying_total,
            2,
        ),
    }


# County assessor building-quality grade → rehab rate tier (approved 2026-07-04).
# The grade is the appraiser's physical condition/quality rating — real county
# data, so a "Good" 1988 house is not charged a full gut. Unknown or low grades
# keep the conservative age-based rate (tax-deed default).
QUALITY_GRADE_RATES = {
    "E": "light",    # Excellent → cosmetic-level rehab
    "G": "light",    # Good      → cosmetic-level rehab
    "A": "medium",   # Average   → mechanicals / kitchen / bath
    # F(air), L(ow), V, missing → fall through to age-based rate
}


def estimate_rehab_cost(
    arv: Optional[float],
    sqft: Optional[int],
    year_built: Optional[int],
    building_quality: Optional[str] = None,
) -> float:
    """
    Tiered rehab cost: sqft × rate × 15% contingency.

    Rate selection: the county assessor's building-quality grade wins when it
    maps to a tier (E/G → light, A → medium); otherwise the age-based rate
    applies (built <20yrs light, 20-45 medium, >45 heavy). Counties whose
    enrichers don't supply `building_quality` behave exactly as before.

    When sqft is unknown, falls back to a conservative median-SFR estimate
    (1,400 sqft at the heavy rate + contingency = $136,850), NOT ARV × 0.20.
    `arv × 0.20` is the land lot-value formula — it scales rehab with VALUE
    instead of condition, understating repair cost (and so inflating ROI and the
    recommended max-bid) on exactly the low-data residential parcels where caution
    matters most. A residential structure is never assigned $0 rehab. (`arv`
    retained for signature compatibility; no longer used.)
    """
    if sqft and sqft > 0:
        grade_tier = QUALITY_GRADE_RATES.get((building_quality or "").strip().upper())
        if grade_tier:
            rate = REHAB_RATES[grade_tier]
        else:
            age = (2026 - year_built) if (year_built and year_built > 1900) else 50
            if age < 20:
                rate = REHAB_RATES["light"]
            elif age < 45:
                rate = REHAB_RATES["medium"]
            else:
                rate = REHAB_RATES["heavy"]
        return round(sqft * rate * REHAB_CONTINGENCY, 2)
    # sqft unknown — conservative worst-case: median GA SFR at the heavy distressed rate.
    MEDIAN_SFR_SQFT = 1_400
    return round(MEDIAN_SFR_SQFT * REHAB_RATES["heavy"] * REHAB_CONTINGENCY, 2)


def rehab_basis_label(sqft: Optional[int], year_built: Optional[int],
                      building_quality: Optional[str] = None) -> str:
    """Human-readable explanation of which rehab rate applied (for analysis notes)."""
    if not (sqft and sqft > 0):
        return "sqft unknown — conservative 1,400 sqft x heavy rate assumed"
    grade = (building_quality or "").strip().upper()
    grade_tier = QUALITY_GRADE_RATES.get(grade)
    if grade_tier:
        return f"county building grade '{grade}' -> {grade_tier} ${REHAB_RATES[grade_tier]}/sqft"
    age = (2026 - year_built) if (year_built and year_built > 1900) else 50
    tier = "light" if age < 20 else ("medium" if age < 45 else "heavy")
    return f"age-based ({year_built or 'year unknown'}) -> {tier} ${REHAB_RATES[tier]}/sqft"


# ── Model 1: Residential ──────────────────────────────────────────────────────

def calculate_deal_metrics(prop: Dict, arv: Optional[float], closing_legal_fee: Optional[float] = None,
                           comp_count: Optional[int] = None) -> Dict:
    """
    Residential GA tax deed — two profit views:

    Post-rehab view: buy at auction, fix up, sell at ARV.
    As-is view:      buy at auction, quiet title, sell to another investor
                     at the distressed price (ARV − rehab). No repair cost.

    Only residential properties should use this function.
    """
    tax_due    = prop.get("tax_due", 0) or 0
    sqft       = prop.get("sqft")
    year_built = prop.get("year_built")
    quality    = prop.get("building_quality")
    c          = GA_COSTS

    rehab_cost = estimate_rehab_cost(arv, sqft, year_built, quality)
    costs      = _base_acquisition_costs(tax_due, closing_legal_fee)

    # ── Post-rehab all-in (includes rehab) ───
    all_in_cost = round(tax_due + rehab_cost + costs["_sum"], 2)

    if arv:
        selling_costs = round(arv * c["selling_cost_pct"], 2)
        net_proceeds  = round(arv - selling_costs, 2)
        net_profit    = round(net_proceeds - all_in_cost, 2)
        roi = round(net_profit / all_in_cost * 100, 1) if all_in_cost > 0 else None
    else:
        selling_costs = net_proceeds = net_profit = roi = None

    # Wave 1 (#1): As-Is-anchored max-bid ceiling replaces the raw 65% number.
    # (The old ARV-anchored 65% bid was only ever used to clamp the ceiling DOWN,
    # which pinned every As-Is raise back to the too-low arv number — removed.)
    _cc = comp_count if comp_count is not None else prop.get("comp_count")
    if _cc is None and prop.get("ranked_comps") is not None:
        _cc = len(prop["ranked_comps"])
    # This function is residential-only (land/commercial have their own models), so
    # no _canonical_type normalization is needed here. _is_well_comped_residential
    # upper-cases and matches RESIDENTIAL_TYPES, so 'SFR'/'Residential' behave identically.
    property_type = prop.get("property_type") or "Residential"
    (as_is_value, as_is_source, as_is_confidence) = _asis_anchor(prop, arv)
    base_margin_factor = _base_margin(as_is_value)
    (risk_adjustment_factor, risk_adjustment_breakdown) = _risk_adjustment(
        prop, _cc, as_is_confidence
    )
    # SEGMENTED risk posture: bid competitively (As-Is-anchored, hard-capped at
    # x0.80) ONLY on well-comped residential; stay conservative (tax_due floor) on
    # thin-comp / no-defensible-anchor parcels — never chase.
    if as_is_value > 0 and _is_well_comped_residential(property_type, _cc, as_is_source):
        cost_stack = c["quiet_title"] + BARMENT_COST + costs["carrying_total"]
        max_bid = _asis_ceiling(
            as_is_value, base_margin_factor, risk_adjustment_factor,
            cost_stack, tax_due,
        )
    else:
        max_bid = tax_due

    # ── As-is view (no rehab cost; sell distressed to investor at ARV − rehab) ─
    # As-is sale price = what a downstream investor will pay = ARV minus their rehab.
    # This answers: "What can I flip this for without fixing anything?"
    if arv and rehab_cost > 0:
        asis_sale_price   = round(arv - rehab_cost, 2)
        asis_all_in       = round(tax_due + costs["_sum"], 2)  # no rehab
        if asis_sale_price > 0:
            asis_selling_costs = round(asis_sale_price * c["selling_cost_pct"], 2)
            asis_net_proceeds  = round(asis_sale_price - asis_selling_costs, 2)
            asis_net_profit    = round(asis_net_proceeds - asis_all_in, 2)
            asis_roi           = round(asis_net_profit / asis_all_in * 100, 1) if asis_all_in > 0 else None
        else:
            asis_selling_costs = asis_net_proceeds = asis_net_profit = asis_roi = None
    else:
        asis_sale_price = asis_all_in = asis_selling_costs = asis_net_proceeds = asis_net_profit = asis_roi = None

    # Wave 1 (#4): redemption dual-ROI. Base uses the computed ceiling, so pass a
    # copy with max_bid set. Purely additive — roi/deal_score/max_bid untouched.
    red = calculate_redemption_scenario({**prop, "max_bid": max_bid})
    roi_matures_annualized = (
        round(((1 + roi / 100) ** (365 / (MATURATION_MONTHS_DEFAULT * DAYS_PER_MONTH)) - 1) * 100, 2)
        if roi is not None else None
    )

    return {
        "min_bid":               tax_due,
        "max_bid":               max_bid,
        "arv":                   arv,
        "estimated_rehab_cost":  rehab_cost,
        "rehab_basis":           rehab_basis_label(sqft, year_built, quality),
        # Acquisition costs
        "closing_costs":         costs["closing_costs"],
        "legal_closing_costs":   costs["legal_closing_costs"],
        "title_insurance":       costs["title_insurance"],
        "transfer_tax":          costs["transfer_tax"],
        "recording_fees":        costs["recording_fees"],
        "inspection_cost":       costs["inspection_cost"],
        "quiet_title_cost":      costs["quiet_title_cost"],
        "carrying_total":        costs["carrying_total"],
        # Post-rehab view
        "all_in_cost":           all_in_cost,
        "selling_costs":         selling_costs,
        "net_proceeds":          net_proceeds,
        "net_profit":            net_profit,
        # Wave-1 A5 display clamp: the stored/exported post-rehab ROI never exceeds
        # ROI_SANITY_CEILING (corpus showed 778.3 / 220.4 / 1414% artifacts). Only
        # roi_percent is clamped — asis_roi/roi_if_deed_matures stay uncapped.
        "roi_percent":           None if roi is None else min(roi, ROI_SANITY_CEILING),
        # As-is view
        "asis_sale_price":       asis_sale_price,
        "asis_all_in_cost":      asis_all_in,
        "asis_net_profit":       asis_net_profit,
        "asis_roi_percent":      asis_roi,
        # Wave 1 (#1): As-Is anchor value + provenance + factors.
        "as_is_value":               as_is_value,
        "as_is_source":              as_is_source,
        "as_is_confidence":          as_is_confidence,
        "base_margin_factor":        base_margin_factor,
        "risk_adjustment_factor":    risk_adjustment_factor,
        "risk_adjustment_breakdown": risk_adjustment_breakdown,
        # Wave 1 (#4): two labeled ROIs, never blended.
        "roi_if_redeemed_year1_pct":      20.0,
        "roi_if_deed_matures":            roi,
        "roi_if_deed_matures_annualized": roi_matures_annualized,
        "redemption":                     red,
        # Wave 2: score from the SCORE-CAPPED roi (cap_roi 150) so a >150% ROI
        # saturates the curve at 100 deterministically. The confidence-tier rewrite
        # (HIGH keep / MEDIUM 80 / LOW 50 / ESTIMATE_ONLY 0) runs later in the runner
        # path (apply_confidence_tier), on guardrail survivors only.
        "deal_score":            raw_opportunity_score(cap_roi(roi)),
    }


# ── Model 2: Vacant land ──────────────────────────────────────────────────────

def calculate_land_metrics(prop: Dict, comp_avg_price: Optional[float] = None, comp_count: int = 0, closing_legal_fee: Optional[float] = None) -> Dict:
    """
    Vacant land valuation — configurable land value factor rule.

    ARV is a residential concept and does NOT apply to vacant land.
    Land value = land_value_factor (default 20%) of average comparable residential property value.
    comp_count is used to assess how reliable the heuristic is (land_comp_quality flag).

    No rehab. No ARV.
    """
    tax_due    = prop.get("tax_due", 0) or 0
    lot_acres  = prop.get("lot_acres")
    zoning     = (prop.get("zoning") or "").strip().upper() or None
    floodplain = (prop.get("floodplain") or "").strip().upper() or None
    c          = GA_COSTS
    costs      = _base_acquisition_costs(tax_due, closing_legal_fee)
    all_in     = round(tax_due + costs["_sum"], 2)
    factor     = c["land_value_factor"]

    # Buildability screen (data only — dev-value model is a spec'd follow-up).
    # Residential zoning + explicitly outside the floodplain → candidate for
    # infill development; floodplain parcels are flagged; unknown stays None.
    if floodplain == "YES":
        buildable_flag = "FLOODPLAIN"
    elif zoning and zoning.startswith("R") and floodplain == "NO":
        buildable_flag = "BUILDABLE_CANDIDATE"
    else:
        buildable_flag = None

    # Determine comp pool quality for the land heuristic
    if comp_count >= 5 and comp_avg_price and comp_avg_price >= 150_000:
        land_comp_quality = "STRONG"
    elif comp_count >= 3 and comp_avg_price and comp_avg_price > 0:
        land_comp_quality = "ADEQUATE"
    elif comp_count > 0 and comp_avg_price and comp_avg_price > 0:
        land_comp_quality = "WEAK"
    else:
        land_comp_quality = "NO_DATA"

    # Land value anchoring (revised 2026-07-02 after verification found a
    # $600 county-appraised parcel shipping at $75,624 from the city-flat
    # heuristic). For vacant land the county's OWN appraised value IS the land
    # value and is authoritative — prefer it. The 20%-of-residential-comp
    # heuristic is a last resort, used only when the assessor returned nothing,
    # and is always labeled estimate-only.
    appraised = prop.get("appraised_value") or 0
    if appraised and appraised > 0:
        land_value        = round(float(appraised), 2)
        land_value_source = f"county appraised value (${appraised:,.0f})"
        acreage_flag      = None if lot_acres else "ACREAGE_UNKNOWN"
    elif comp_avg_price and comp_avg_price > 0:
        land_value        = round(comp_avg_price * factor, 2)
        land_value_source = (
            f"{int(factor*100)}% of avg residential comp (${comp_avg_price:,.0f}) "
            "— estimate only, no county appraisal"
        )
        acreage_flag      = None if lot_acres else "ACREAGE_UNKNOWN"
    else:
        land_value        = None
        land_value_source = "No comps or appraisal available — cannot estimate"
        acreage_flag      = "NO_COMPS"

    if land_value:
        selling_costs = round(land_value * c["selling_cost_pct"], 2)
        net_proceeds  = round(land_value - selling_costs, 2)
        net_profit    = round(net_proceeds - all_in, 2)
        roi = round(net_profit / all_in * 100, 1) if all_in > 0 else None
        max_bid = round((land_value * c["max_bid_arv_factor"]) - c["quiet_title"] - costs["carrying_total"], 2)
        max_bid = max(max_bid, tax_due)
    else:
        selling_costs = net_proceeds = net_profit = roi = None
        max_bid = tax_due

    return {
        "min_bid":               tax_due,
        "max_bid":               max_bid,
        "arv":                   None,          # intentionally None — land has no ARV
        "land_value":            land_value,
        "land_value_source":     land_value_source,
        "land_comp_quality":     land_comp_quality,
        "land_acreage_flag":     acreage_flag,
        "lot_acres":             lot_acres,
        "zoning":                zoning,
        "floodplain":            floodplain,
        "buildable_flag":        buildable_flag,
        "estimated_rehab_cost":  0,
        # Acquisition costs
        "closing_costs":         costs["closing_costs"],
        "legal_closing_costs":   costs["legal_closing_costs"],
        "title_insurance":       costs["title_insurance"],
        "transfer_tax":          costs["transfer_tax"],
        "recording_fees":        costs["recording_fees"],
        "inspection_cost":       costs["inspection_cost"],
        "quiet_title_cost":      costs["quiet_title_cost"],
        "carrying_total":        costs["carrying_total"],
        "all_in_cost":           all_in,
        "selling_costs":         selling_costs,
        "net_proceeds":          net_proceeds,
        "net_profit":            net_profit,
        "roi_percent":           roi,
        # Directive contract (county_analysis_procedure.md): land requires
        # specialist evaluation and does NOT receive an automated deal_score —
        # the ROI above is a rough heuristic, not a bid recommendation. Scored
        # 0 (with estimate_only=True) until an acreage-aware model lands, so
        # land parcels never dominate the leaderboard as false "top deals".
        "deal_score":            0.0,
        "estimate_only":         True,
    }


# ── Model 3: Commercial ───────────────────────────────────────────────────────

def calculate_commercial_metrics(prop: Dict, closing_legal_fee: Optional[float] = None) -> Dict:
    """
    Commercial / industrial property — acquisition cost only.

    ARV and rehab do NOT apply. Residential comp data is irrelevant.
    The county appraised value is shown as a reference point only.
    A specialist commercial appraisal is required before bidding.
    """
    tax_due = prop.get("tax_due", 0) or 0
    costs   = _base_acquisition_costs(tax_due)
    all_in  = round(tax_due + costs["_sum"], 2)

    return {
        "min_bid":               tax_due,
        "max_bid":               tax_due,       # cannot calculate without commercial appraisal
        "arv":                   None,
        "land_value":            None,
        "estimated_rehab_cost":  0,
        # Acquisition costs
        "closing_costs":         costs["closing_costs"],
        "legal_closing_costs":   costs["legal_closing_costs"],
        "title_insurance":       costs["title_insurance"],
        "transfer_tax":          costs["transfer_tax"],
        "recording_fees":        costs["recording_fees"],
        "inspection_cost":       costs["inspection_cost"],
        "quiet_title_cost":      costs["quiet_title_cost"],
        "carrying_total":        costs["carrying_total"],
        "all_in_cost":           all_in,
        "selling_costs":         None,
        "net_proceeds":          None,
        "net_profit":            None,
        "roi_percent":           None,
        "deal_score":            0.0,
    }


# ── ARV from comps ────────────────────────────────────────────────────────────

def calculate_arv_from_comps(
    comps: list,
    property_sqft: Optional[float] = None,
    property_beds: Optional[int] = None,
    property_baths: Optional[float] = None,
    top_weight_count: int = 5,
    max_comps: int = 10,
) -> Dict:
    """
    Derive ARV from Apify/Zillow comparable sales using weighted averaging.

    Pipeline:
      1. Filter city-level pool to similar properties (sqft ±25%, beds ±1)
      2. Score each candidate by recency + sqft similarity + bed/bath match
      3. Select up to max_comps (default 10) from the ranked pool
      4. Weighted average: top top_weight_count (default 5) carry 2x weight;
         remaining comps carry 1x weight — top 5 drive the ARV, extras refine it
      5. Return ranked_comps list with per-comp detail + top5 flag for dashboard

    comp_avg_price is always returned (used by the land 20% rule).
    """
    from datetime import datetime

    if not comps:
        return {
            "arv": None, "comp_count": 0, "comps_used": 0,
            "avg_price_sqft": None, "comp_avg_price": None,
            "comp_pool_quality": "NO_DATA",
        }

    today = datetime.now()

    # ── Step 1: Subject-specific filtering ──────────────────────────────────
    candidates = []
    for c in comps:
        sale_price = c.get("sale_price", 0)
        if not sale_price or not isinstance(sale_price, (int, float)) or sale_price <= 0:
            continue

        comp_sqft = c.get("sqft")
        comp_beds = c.get("bedrooms")

        # Sqft filter: ±25% of subject when both are known.
        # When subject sqft is unknown we skip this filter (can't filter what we don't know).
        if property_sqft and comp_sqft:
            try:
                ratio = float(comp_sqft) / float(property_sqft)
                if ratio < 0.75 or ratio > 1.25:
                    continue
            except (TypeError, ValueError, ZeroDivisionError):
                pass

        # Bed filter: ±1 of subject when both are known.
        if property_beds and comp_beds:
            try:
                if abs(int(comp_beds) - int(property_beds)) > 1:
                    continue
            except (TypeError, ValueError):
                pass

        candidates.append(c)

    # Fallback: if strict sqft filter eliminated all candidates, retry without
    # the sqft constraint so outlier properties (e.g. 6000+ sqft) still get an
    # ARV estimate. Marks pool quality as WEAK and notes it in arv_source.
    sqft_filter_relaxed = False
    if not candidates and property_sqft:
        for c in comps:
            sale_price = c.get("sale_price", 0)
            if not sale_price or not isinstance(sale_price, (int, float)) or sale_price <= 0:
                continue
            comp_beds = c.get("bedrooms")
            if property_beds and comp_beds:
                try:
                    if abs(int(comp_beds) - int(property_beds)) > 1:
                        continue
                except (TypeError, ValueError):
                    pass
            candidates.append(c)
        if candidates:
            sqft_filter_relaxed = True

    # ── Step 2: Score candidates by recency + similarity ────────────────────
    def _score(c):
        score = 0
        comp_sqft = c.get("sqft")
        comp_beds = c.get("bedrooms")
        comp_baths = c.get("bathrooms")
        sale_date_raw = c.get("sale_date")

        # Recency
        if sale_date_raw:
            try:
                if isinstance(sale_date_raw, (int, float)):
                    sd = datetime.fromtimestamp(float(sale_date_raw) / 1000)
                else:
                    sd = datetime.fromisoformat(str(sale_date_raw).replace("Z", "+00:00"))
                days_ago = (today - sd.replace(tzinfo=None)).days
                if days_ago <= 180:
                    score += 3
                elif days_ago <= 365:
                    score += 2
                else:
                    score += 1
            except Exception:
                pass

        # Sqft similarity
        if property_sqft and comp_sqft:
            try:
                ratio = abs(float(comp_sqft) - float(property_sqft)) / float(property_sqft)
                if ratio <= 0.10:
                    score += 3
                elif ratio <= 0.25:
                    score += 1
            except (TypeError, ValueError, ZeroDivisionError):
                pass

        # Bed match
        if property_beds and comp_beds:
            try:
                diff = abs(int(comp_beds) - int(property_beds))
                if diff == 0:
                    score += 2
                elif diff == 1:
                    score += 1
            except (TypeError, ValueError):
                pass

        # Bath match
        if property_baths and comp_baths:
            try:
                if abs(float(comp_baths) - float(property_baths)) < 0.6:
                    score += 1
            except (TypeError, ValueError):
                pass

        return score

    scored = sorted(candidates, key=_score, reverse=True)
    selected = scored[:max_comps]

    # ── Step 3: Comp pool quality ────────────────────────────────────────────
    pool_size = len(candidates)
    if pool_size >= 5:
        comp_pool_quality = "STRONG"
    elif pool_size >= 3:
        comp_pool_quality = "ADEQUATE"
    elif pool_size > 0:
        comp_pool_quality = "WEAK"
    else:
        comp_pool_quality = "NO_DATA"

    if not selected:
        return {
            "arv": None, "comp_count": pool_size, "comps_used": 0,
            "avg_price_sqft": None, "comp_avg_price": None,
            "comp_pool_quality": comp_pool_quality,
        }

    # ── Step 4: Compute ARV from selected comps ──────────────────────────────
    # ── Step 4: Weighted ARV — top comps carry 2x weight ────────────────────
    # Top top_weight_count comps get weight=2, the rest get weight=1.
    # This means top 5 drive the ARV while extras act as a refinement buffer.
    ranked_comps = []
    weighted_prices = []
    weighted_psf    = []

    for rank, c in enumerate(selected):
        is_top = rank < top_weight_count
        weight = 2 if is_top else 1
        price  = c.get("sale_price")
        sqft   = c.get("sqft")
        beds   = c.get("bedrooms")
        baths  = c.get("bathrooms")

        # Weighted price and PSF
        if price and isinstance(price, (int, float)) and price > 0:
            weighted_prices.extend([price] * weight)
            if sqft and sqft > 0:
                weighted_psf.extend([price / sqft] * weight)

        # Format sale date for dashboard display
        sale_date_raw = c.get("sale_date")
        sale_date_str = ""
        if sale_date_raw:
            try:
                from datetime import datetime as _dt
                if isinstance(sale_date_raw, (int, float)):
                    sd = _dt.fromtimestamp(float(sale_date_raw) / 1000)
                else:
                    sd = _dt.fromisoformat(str(sale_date_raw).replace("Z", "+00:00"))
                sale_date_str = sd.strftime("%b %Y")
            except Exception:
                sale_date_str = str(sale_date_raw)[:7]

        ranked_comps.append({
            "address":    c.get("address", ""),
            "sale_price": price,
            "sale_date":  sale_date_str,
            "sqft":       sqft,
            "beds":       beds,
            "baths":      baths,
            "year_built": c.get("year_built"),
            "psf":        round(price / sqft, 2) if (price and sqft) else None,
            "weight":     weight,
            "top5":       is_top,
            # Pin coordinates for the dashboard comps map (None on older sources)
            "lat":        c.get("latitude"),
            "lng":        c.get("longitude"),
        })

    avg_price = sum(weighted_prices) / len(weighted_prices) if weighted_prices else None
    avg_psf   = sum(weighted_psf)    / len(weighted_psf)    if weighted_psf    else None

    # Use PSF × sqft for residential ARV; refuse to manufacture a number when sqft unknown.
    if property_sqft and avg_psf:
        arv = round(property_sqft * avg_psf, 2)
    elif property_sqft and avg_price:
        arv = avg_price   # sqft present but no PSF — rough proxy
    else:
        arv = None        # sqft unknown — don't inflate

    # Downgrade quality when sqft filter was relaxed — comps are from
    # differently-sized homes; PSF × subject_sqft is a rough estimate only.
    if sqft_filter_relaxed and comp_pool_quality not in ("NO_DATA",):
        comp_pool_quality = "WEAK"

    return {
        "arv":                arv,
        "comp_count":         pool_size,
        "comps_used":         len(selected),
        "avg_price_sqft":     round(avg_psf, 2) if avg_psf else None,
        "comp_avg_price":     round(avg_price, 2) if avg_price else None,
        "comp_pool_quality":  comp_pool_quality,
        "ranked_comps":       ranked_comps,
        "sqft_filter_relaxed": sqft_filter_relaxed,
    }



# ── Deal score ────────────────────────────────────────────────────────────────
# (The post-guardrail confidence-tier CAPS that rewrite this score live in
#  execution/utils/confidence_tier.py, applied by execution/run_ga_county.py.)

def raw_opportunity_score(roi: Optional[float]) -> float:
    """
    Map ROI → 0–100 raw opportunity score (the EXACT pre-Wave-2 `_score_deal`
    curve, renamed; regression-locked by test_raw_opportunity_score_curve_unchanged):
      Exceptional  80–100   ROI >= 50%
      Top Deal     60–79    ROI 30–49%
      Possible     40–59    ROI 20–29%
      Pass          0–40    ROI 0–19% (breakeven and money-losers score 0)
    """
    if roi is None:
        return 0.0
    if roi >= 50:
        return min(100.0, round(80 + (roi - 50) * 0.4, 1))
    if roi >= 30:
        return round(60 + (roi - 30) * 1.0, 1)
    if roi >= 20:
        return round(40 + (roi - 20) * 2.0, 1)
    # ROI < 20%: map [0,20)→[0,40) and clamp at 0 so a breakeven deal and any
    # money-LOSER score 0 — a negative-ROI deal must never read as a near-miss.
    # (Prior `20 + roi` gave breakeven a 20 and a −15% loser a 5.)
    return max(0.0, round(roi * 2, 1))


# Backward-compatible alias — legacy callers/tests import _score_deal.
_score_deal = raw_opportunity_score


def cap_roi(roi: Optional[float]) -> Optional[float]:
    """Score-curve INPUT cap: min(roi, 150) so a >150% ROI saturates the curve
    deterministically. Distinct from the 200 display clamp on roi_percent."""
    return None if roi is None else min(roi, ROI_SCORE_CAP)
