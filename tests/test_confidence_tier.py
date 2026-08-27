"""
Confidence-tier calibration — Wave 2 second net on the deal engine.

Ground truth is the same Cobb 2026-07-07 reality the NO-BID guardrail was
calibrated on (brands/bidwise/cobb-july-parcels-manual.json). Wave 1 stopped the
$185k landlocked-commercial bid. Wave 2 adds a CONFIDENCE tier on the SURVIVORS:
a thin-comp parcel (comp_count<=1, Sandtown-class) can still slip a five-figure
bid through the guardrail on a single fluke comp; ESTIMATE_ONLY nulls that bid;
LOW/MEDIUM cap the score; HIGH (well-comped) is preserved byte-for-byte.

These fixtures mirror the REAL pipeline metrics-dict shapes (verified against
.tmp/cobb_results/cobb_deterministic_*.json), NOT hand-constructed profiles.

Pure financial math — no API keys / network required.
"""
import pytest

from execution.utils.confidence_tier import (
    GA_ASSESSMENT_RATIO,
    ROI_SANITY_CEILING,
    apply_confidence_tier,
    assessor_implied_fmv,
    comp_dispersion_cod,
    grade_confidence,
)
from execution.utils.ga_deal_calculator import raw_opportunity_score
from execution.utils.nobid_guardrail import apply_guardrail


def _comps(*prices):
    return [{"sale_price": p} for p in prices]


# ── tests_first[] — the 7 authoritative spec cases ─────────────────────────────

def test_estimate_only_nulls_bid_and_score():
    # comp_count<=1 (Sandtown-class) -> ESTIMATE_ONLY -> deal_score 0, bids nulled.
    prop = {"comp_count": 1, "ranked_comps": _comps(120000)}
    metrics = {"is_no_bid": False, "roi_percent": 45.0, "deal_score": 100.0,
               "max_bid": 30000.0, "recommended_max_bid": 30000.0, "comp_count": 1}
    out = apply_confidence_tier(prop, metrics)
    assert out["arv_confidence"] == "ESTIMATE_ONLY"
    assert out["deal_score"] == 0.0
    assert out["max_bid"] is None
    assert out["recommended_max_bid"] is None


def test_cod_over_20_three_comps_is_low():
    # COD>20 with comp_count==3 -> falls through HIGH and MEDIUM -> LOW.
    comps = _comps(100000, 200000, 400000)  # wide dispersion -> COD well over 20
    cod = comp_dispersion_cod(comps)
    assert cod is not None and cod > 20
    assert grade_confidence(3, cod, "ADEQUATE") == "LOW"


def test_assessor_implied_fmv_ratio():
    assert assessor_implied_fmv({"assessed_value": 100000}) == 250000.0
    assert assessor_implied_fmv({"assessed_value": 100000}) == 100000 / GA_ASSESSMENT_RATIO
    assert assessor_implied_fmv({"beds": 3}) is None


def test_roi_percent_clamped_at_200():
    # runner-path authoritative clamp: 778.3 -> 200.0 on a non-NO-BID parcel.
    prop = {"comp_count": 8, "ranked_comps": _comps(400000, 410000, 420000, 405000,
                                                     415000, 408000, 412000, 402000)}
    metrics = {"is_no_bid": False, "roi_percent": 778.3, "deal_score": 0.0,
               "max_bid": 44300.0, "recommended_max_bid": 44300.0, "comp_count": 8,
               "comp_pool_quality": "STRONG"}
    out = apply_confidence_tier(prop, metrics)
    assert out["roi_percent"] == ROI_SANITY_CEILING == 200.0


def test_is_no_bid_short_circuit_untouched():
    # NO-BID passes through EQUAL — never resurrected.
    metrics = {"is_no_bid": True, "max_bid": None, "recommended_max_bid": None,
               "deal_score": 0.0, "no_bid_reason": "small lot — uneconomic to build",
               "roi_percent": None, "comp_count": 25}
    prop = {"comp_count": 25, "ranked_comps": _comps(100000, 110000, 120000)}
    out = apply_confidence_tier(prop, metrics)
    assert out == metrics
    assert out["is_no_bid"] is True
    assert out["max_bid"] is None


def test_comp_count_one_never_verified():
    # any ROI (incl. 300%) with comp_count==1 -> ESTIMATE_ONLY: never trusted —
    # score zeroed, bids nulled.
    prop = {"comp_count": 1, "ranked_comps": _comps(150000)}
    metrics = {"is_no_bid": False, "roi_percent": 300.0, "deal_score": 100.0,
               "max_bid": 5000.0, "recommended_max_bid": 5000.0, "comp_count": 1}
    out = apply_confidence_tier(prop, metrics)
    assert out["arv_confidence"] == "ESTIMATE_ONLY"
    assert out["deal_score"] == 0.0
    assert out["max_bid"] is None


def test_wave1_preservation_high_parcel_keeps_bid():
    # well-comped HIGH fixture -> recommended_max_bid + redemption fields identical;
    # deal_score == raw_opportunity_score(capped roi) (HIGH keeps).
    comps = _comps(400000, 410000, 415000, 405000, 420000, 408000, 412000, 402000)
    prop = {"comp_count": 8, "ranked_comps": comps, "property_type": "SFR",
            "assessed_value": 135212.0}
    metrics = {"is_no_bid": False, "roi_percent": 100.2, "deal_score": 100.0,
               "max_bid": 189899.67, "recommended_max_bid": 189899.67,
               "comp_count": 8, "comp_pool_quality": "STRONG",
               "as_is_source": "county_appraised", "as_is_value": 338030.0,
               "roi_if_redeemed_year1_pct": 20.0, "roi_if_deed_matures": 100.2,
               "roi_if_deed_matures_annualized": 55.0,
               "redemption": {"scenario": "example"}}
    out = apply_confidence_tier(prop, metrics)
    assert out["arv_confidence"] == "HIGH"
    assert out["recommended_max_bid"] == 189899.67
    assert out["max_bid"] == 189899.67
    assert out["roi_if_redeemed_year1_pct"] == 20.0
    # roi_if_deed_matures is NOT clamped (only roi_percent is)
    assert out["roi_if_deed_matures"] == 100.2
    assert out["redemption"] == {"scenario": "example"}
    # HIGH keeps deal_score = raw_opportunity_score(capped roi). roi 100.2 -> cap 150 no-op -> curve.
    assert out["deal_score"] == raw_opportunity_score(min(100.2, 150.0))


# ── comp_dispersion_cod (IAAO COD) ─────────────────────────────────────────────

class TestCompDispersionCod:
    def test_none_when_fewer_than_two_prices(self):
        assert comp_dispersion_cod(None) is None
        assert comp_dispersion_cod([]) is None
        assert comp_dispersion_cod(_comps(100000)) is None

    def test_zero_cod_for_identical_prices(self):
        assert comp_dispersion_cod(_comps(200000, 200000, 200000)) == 0.0

    def test_tight_cluster_low_cod(self):
        cod = comp_dispersion_cod(_comps(400000, 410000, 415000, 405000, 420000))
        assert cod is not None and cod <= 15

    def test_ignores_non_numeric_prices(self):
        # only two usable -> still computes; junk skipped.
        cod = comp_dispersion_cod([{"sale_price": None}, {"sale_price": 100000},
                                   {"sale_price": "x"}, {"sale_price": 100000}])
        assert cod == 0.0


# ── grade_confidence branch coverage ───────────────────────────────────────────

class TestGradeConfidence:
    def test_estimate_only_when_comp_count_none_or_le_1(self):
        assert grade_confidence(None, 5.0, "STRONG") == "ESTIMATE_ONLY"
        assert grade_confidence(0, 5.0, "STRONG") == "ESTIMATE_ONLY"
        assert grade_confidence(1, 5.0, "STRONG") == "ESTIMATE_ONLY"

    def test_high_requires_5_comps_low_cod_strong_pool(self):
        assert grade_confidence(5, 10.0, "STRONG") == "HIGH"
        assert grade_confidence(6, 15.0, "ADEQUATE") == "HIGH"

    def test_not_high_when_cod_too_wide(self):
        assert grade_confidence(5, 16.0, "STRONG") != "HIGH"

    def test_not_high_when_pool_weak(self):
        assert grade_confidence(5, 10.0, "WEAK") != "HIGH"

    def test_medium_band(self):
        assert grade_confidence(3, 18.0, "ADEQUATE") == "MEDIUM"
        assert grade_confidence(4, None, "WEAK") == "MEDIUM"

    def test_low_when_cod_over_20_with_3_comps(self):
        assert grade_confidence(3, 25.0, "ADEQUATE") == "LOW"

    def test_low_when_2_comps(self):
        assert grade_confidence(2, 5.0, "STRONG") == "LOW"


# ── apply_confidence_tier: tier rewrite + immutability ─────────────────────────

class TestApplyConfidenceTier:
    def test_does_not_mutate_inputs(self):
        prop = {"comp_count": 1, "ranked_comps": _comps(120000)}
        metrics = {"is_no_bid": False, "roi_percent": 45.0, "deal_score": 100.0,
                   "max_bid": 30000.0, "recommended_max_bid": 30000.0, "comp_count": 1}
        apply_confidence_tier(prop, metrics)
        assert metrics["max_bid"] == 30000.0
        assert metrics["deal_score"] == 100.0
        assert "arv_confidence" not in metrics

    def test_medium_caps_score_at_80(self):
        # comp_count 3, moderate cod, ADEQUATE -> MEDIUM -> score min(base, 80).
        prop = {"comp_count": 3, "ranked_comps": _comps(300000, 310000, 305000),
                "comp_pool_quality": "ADEQUATE"}
        metrics = {"is_no_bid": False, "roi_percent": 120.0, "deal_score": 100.0,
                   "max_bid": 50000.0, "recommended_max_bid": 50000.0,
                   "comp_count": 3, "comp_pool_quality": "ADEQUATE"}
        out = apply_confidence_tier(prop, metrics)
        assert out["arv_confidence"] == "MEDIUM"
        assert out["deal_score"] <= 80.0

    def test_low_blend_never_raises_bid(self):
        # LOW tier assessor blend is guarded with min() — can only lower a bid.
        prop = {"comp_count": 3, "ranked_comps": _comps(100000, 200000, 400000),
                "assessed_value": 500000.0}  # assessor FMV 1.25M > bid
        metrics = {"is_no_bid": False, "roi_percent": 40.0, "deal_score": 60.0,
                   "max_bid": 30000.0, "recommended_max_bid": 30000.0,
                   "comp_count": 3, "comp_pool_quality": "ADEQUATE"}
        out = apply_confidence_tier(prop, metrics)
        assert out["arv_confidence"] == "LOW"
        assert out["deal_score"] <= 50.0
        assert out["max_bid"] <= 30000.0  # never raised above original ceiling
        assert out["recommended_max_bid"] == out["max_bid"]


# ── Land-model estimate_only contract (land never ranks — PR #16) ──────────────

class TestLandEstimateOnlyNeverResurrected:
    """
    calculate_land_metrics hard-sets deal_score=0.0 + estimate_only=True on
    Vacant Land (directive contract: specialist evaluation required; land never
    ranks until an acreage-aware model lands). Regression ground truth: the
    Clayton 2026-08-04 run published 3 land parcels (12180D A013 / 13168C C006 /
    13246C D064) at deal_score 50 / 80 / 72.6 because the tier rewrite
    re-derived the score from the heuristic land roi_percent. estimate_only
    metrics must keep the model's score/bid verbatim — tier annotation fields
    (arv_confidence / comp_cod / assessor_implied_fmv) still get set.
    """

    @staticmethod
    def _land_metrics(**over):
        # Mirrors the calculate_land_metrics output shape as the runner feeds it
        # in (comp_count injected by run_ga_county.py before the guardrail).
        base = {"is_no_bid": False, "estimate_only": True, "deal_score": 0.0,
                "arv": None, "land_value": 48000.0, "min_bid": 2200.0,
                "max_bid": 12000.0, "recommended_max_bid": 12000.0,
                "roi_percent": 42.6, "comp_count": 5}
        return {**base, **over}

    def test_high_tier_keeps_zero_score(self):
        # 5 tight comps + STRONG pool -> HIGH tier; the buggy rewrite scored
        # raw_opportunity_score(42.6) = 72.6 (the published 13246C D064 value).
        prop = {"property_type": "Vacant Land", "comp_count": 5,
                "ranked_comps": _comps(80000, 82000, 81000, 79000, 83000),
                "comp_pool_quality": "STRONG", "assessed_value": 20000.0}
        out = apply_confidence_tier(prop, self._land_metrics())
        assert out["arv_confidence"] == "HIGH"
        assert out["deal_score"] == 0.0
        assert out["estimate_only"] is True

    def test_medium_tier_keeps_zero_score(self):
        # 3 moderate comps -> MEDIUM tier; the buggy rewrite gave min(base, 80)
        # = 80 (the published 13168C C006 value).
        prop = {"property_type": "Vacant Land", "comp_count": 3,
                "ranked_comps": _comps(90000, 100000, 95000),
                "comp_pool_quality": "ADEQUATE"}
        out = apply_confidence_tier(
            prop, self._land_metrics(comp_count=3, roi_percent=120.0))
        assert out["arv_confidence"] == "MEDIUM"
        assert out["deal_score"] == 0.0

    def test_low_tier_keeps_zero_score_and_land_bid(self):
        # 3 wide comps (COD>20) -> LOW tier; the buggy rewrite gave min(base,
        # 50) = 50 (the published 12180D A013 value) AND assessor-blended the
        # land bid. The land model's own max_bid must survive untouched.
        prop = {"property_type": "Vacant Land", "comp_count": 3,
                "ranked_comps": _comps(100000, 200000, 400000),
                "comp_pool_quality": "ADEQUATE", "assessed_value": 4000.0}
        out = apply_confidence_tier(
            prop, self._land_metrics(comp_count=3, roi_percent=40.0))
        assert out["arv_confidence"] == "LOW"
        assert out["deal_score"] == 0.0
        assert out["max_bid"] == 12000.0
        assert out["recommended_max_bid"] == 12000.0

    def test_estimate_only_tier_keeps_land_bid_floor(self):
        # Comp-less land grades ESTIMATE_ONLY, but the land model already set
        # its bid (tax-due floor) and score 0.0 — the residential thin-comp
        # rewrite must not null a land bid or stamp its value_range message.
        prop = {"property_type": "Vacant Land", "comp_count": 0,
                "ranked_comps": []}
        out = apply_confidence_tier(
            prop, self._land_metrics(comp_count=0, roi_percent=None,
                                     max_bid=2200.0,
                                     recommended_max_bid=2200.0))
        assert out["arv_confidence"] == "ESTIMATE_ONLY"
        assert out["deal_score"] == 0.0
        assert out["max_bid"] == 2200.0
        assert "value_range" not in out

    def test_thin_comp_heuristic_land_bid_survives_unranked(self):
        # Deliberate layering decision: land with NO county appraisal and one
        # fluke comp gets a last-resort heuristic bid (labeled in
        # land_value_source by the land model). The land model owns land bid
        # semantics — the tier layer must not null it; deal_score 0.0 +
        # estimate_only already keep the record out of every ranking, and the
        # ESTIMATE_ONLY badge flags it for the operator.
        prop = {"property_type": "Vacant Land", "comp_count": 1,
                "ranked_comps": _comps(150000)}
        out = apply_confidence_tier(
            prop, self._land_metrics(
                comp_count=1, roi_percent=200.0, land_value=30000.0,
                max_bid=9500.0, recommended_max_bid=9500.0))
        assert out["arv_confidence"] == "ESTIMATE_ONLY"
        assert out["deal_score"] == 0.0
        assert out["estimate_only"] is True
        assert out["max_bid"] == 9500.0
        assert out["recommended_max_bid"] == 9500.0

    def test_tier_annotations_still_set(self):
        # The guard skips only the score/bid rewrite — the confidence
        # annotations still land on the record for operator transparency.
        prop = {"property_type": "Vacant Land", "comp_count": 5,
                "ranked_comps": _comps(80000, 82000, 81000, 79000, 83000),
                "comp_pool_quality": "STRONG", "assessed_value": 20000.0}
        out = apply_confidence_tier(prop, self._land_metrics())
        assert out["arv_confidence"] == "HIGH"
        assert out["comp_cod"] is not None
        assert out["assessor_implied_fmv"] == 50000.0


# ── Guardrail score_penalty survives the tier rewrite (2026-07-16 audit) ───────

class TestFloodplainPenaltySurvivesTier:
    """
    apply_guardrail penalizes an improved floodplain parcel's deal_score by 15
    and records score_penalty=15.0. Regression ground truth (2026-07-16 scoring
    audit): the tier rewrite recomputed deal_score from roi_percent, silently
    discarding the penalty for every bid-able parcel. The penalty must be
    re-applied AFTER the tier cap (so it stays visible on capped MEDIUM/LOW
    scores too) and floor at 0.
    """

    @staticmethod
    def _flood_metrics(**over):
        # Mirrors apply_guardrail output for an improved flood-zone survivor:
        # deal_score already penalized in place, score_penalty recorded.
        base = {"is_no_bid": False, "floodplain": True, "score_penalty": 15.0,
                "roi_percent": 100.2, "deal_score": 85.0, "max_bid": 72000.0,
                "recommended_max_bid": 72000.0, "comp_count": 8,
                "comp_pool_quality": "STRONG"}
        return {**base, **over}

    def test_high_tier_applies_penalty(self):
        # HIGH keeps base (raw(100.2)=100.0) then deducts 15 -> 85.0.
        comps = _comps(400000, 410000, 415000, 405000, 420000, 408000, 412000,
                       402000)
        prop = {"comp_count": 8, "ranked_comps": comps,
                "comp_pool_quality": "STRONG"}
        out = apply_confidence_tier(prop, self._flood_metrics())
        assert out["arv_confidence"] == "HIGH"
        assert out["deal_score"] == 85.0
        assert out["max_bid"] == 72000.0  # penalty touches score only

    def test_medium_tier_penalty_survives_the_cap(self):
        # raw(120)=100 -> MEDIUM cap 80 -> minus 15 -> 65. Applying the penalty
        # BEFORE the cap would let the cap absorb it (min(85, 80) = 80).
        prop = {"comp_count": 3, "ranked_comps": _comps(90000, 100000, 95000),
                "comp_pool_quality": "ADEQUATE"}
        out = apply_confidence_tier(
            prop, self._flood_metrics(comp_count=3, roi_percent=120.0,
                                      deal_score=85.0))
        assert out["arv_confidence"] == "MEDIUM"
        assert out["deal_score"] == 65.0

    def test_low_tier_penalty_survives_the_cap(self):
        # raw(40)=70 -> LOW cap 50 -> minus 15 -> 35.
        prop = {"comp_count": 3, "ranked_comps": _comps(100000, 200000, 400000),
                "comp_pool_quality": "ADEQUATE"}
        out = apply_confidence_tier(
            prop, self._flood_metrics(comp_count=3, roi_percent=40.0,
                                      deal_score=55.0))
        assert out["arv_confidence"] == "LOW"
        assert out["deal_score"] == 35.0

    def test_penalty_floors_at_zero(self):
        # raw(5)=10 -> MEDIUM min(10, 80)=10 -> minus 15 -> floored at 0.0.
        prop = {"comp_count": 3, "ranked_comps": _comps(90000, 100000, 95000),
                "comp_pool_quality": "ADEQUATE"}
        out = apply_confidence_tier(
            prop, self._flood_metrics(comp_count=3, roi_percent=5.0,
                                      deal_score=0.0))
        assert out["arv_confidence"] == "MEDIUM"
        assert out["deal_score"] == 0.0

    def test_estimate_only_tier_still_nulls_regardless_of_penalty(self):
        # Thin-comp flood parcel: ESTIMATE_ONLY handling unchanged by penalty.
        prop = {"comp_count": 1, "ranked_comps": _comps(150000)}
        out = apply_confidence_tier(
            prop, self._flood_metrics(comp_count=1, roi_percent=45.0,
                                      deal_score=30.0))
        assert out["arv_confidence"] == "ESTIMATE_ONLY"
        assert out["deal_score"] == 0.0
        assert out["max_bid"] is None

    def test_end_to_end_guardrail_then_tier_deducts_exactly_once(self):
        # The real run_ga_county wiring: apply_guardrail output feeds
        # apply_confidence_tier directly. Locks the score_penalty field
        # contract between the two modules — a double-subtraction would give
        # 70.0, a dropped penalty 100.0; only one deduction is correct.
        comps = _comps(400000, 410000, 415000, 405000, 420000, 408000, 412000,
                       402000)
        prop = {"property_type": "SFR", "property_class": "R3", "sqft": 1063,
                "flood_risk": "High", "comp_count": 8, "ranked_comps": comps,
                "comp_pool_quality": "STRONG"}
        metrics = {"arv": 283080.0, "net_profit": 150060.0,
                   "roi_percent": 100.2, "deal_score": 100.0,
                   "max_bid": 72000.0, "buildable_flag": None, "comp_count": 8,
                   "comp_pool_quality": "STRONG"}
        out = apply_confidence_tier(prop, apply_guardrail(prop, metrics))
        assert out["arv_confidence"] == "HIGH"
        assert out["floodplain"] is True
        assert out["deal_score"] == 85.0  # raw(100.2)=100.0 − 15, applied once
        assert out["max_bid"] == 72000.0
