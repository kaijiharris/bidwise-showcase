"""
Regression tests for the LIVE GA deal engine — execution/utils/ga_deal_calculator.py.

This is the module imported by the documented pipeline entry point
(execution/run_ga_county.py, per directives/county_analysis_procedure.md). These
tests pin the numbers that actually ship to investors, and lock the two
correctness fixes:
  - rehab fallback when sqft is unknown (conservative median-SFR, not ARV × 0.20 / $0)
  - deal-score floor (breakeven and money-LOSERS score 0, not 20)
Pure financial math — no API keys / network required.
"""
import pytest

from execution.utils.ga_deal_calculator import (
    REHAB_CONTINGENCY,
    REHAB_RATES,
    ROI_SANITY_CEILING,
    ROI_SCORE_CAP,
    _score_deal,
    calculate_arv_from_comps,
    calculate_commercial_metrics,
    calculate_deal_metrics,
    calculate_land_metrics,
    cap_roi,
    estimate_rehab_cost,
    raw_opportunity_score,
)


# ── rehab cost: tiered by age, conservative fallback when sqft unknown ──────────

class TestRehabCost:
    def test_tiered_rates_by_age(self):
        # light (<20yr), medium (20-44yr), heavy (>=45yr), each × 15% contingency
        assert estimate_rehab_cost(None, 2000, 2010) == round(2000 * REHAB_RATES["light"] * REHAB_CONTINGENCY, 2)
        assert estimate_rehab_cost(None, 1500, 1990) == round(1500 * REHAB_RATES["medium"] * REHAB_CONTINGENCY, 2)
        assert estimate_rehab_cost(None, 1000, 1970) == round(1000 * REHAB_RATES["heavy"] * REHAB_CONTINGENCY, 2)

    def test_unknown_year_assumes_heavy(self):
        # no year_built -> age defaults to 50 -> heavy rate
        assert estimate_rehab_cost(None, 1200, None) == round(1200 * REHAB_RATES["heavy"] * REHAB_CONTINGENCY, 2)

    def test_sqft_unknown_uses_conservative_fallback_not_arv_pct(self):
        # THE FIX: sqft unknown -> 1,400 sqft × heavy × contingency = $136,850,
        # regardless of ARV. Never the old `arv × 0.20` and never $0.
        expected = round(1_400 * REHAB_RATES["heavy"] * REHAB_CONTINGENCY, 2)
        assert estimate_rehab_cost(300_000, None, None) == expected      # not 60,000
        assert estimate_rehab_cost(None, None, None) == expected         # not 0
        assert estimate_rehab_cost(1_000_000, 0, 1985) == expected       # sqft 0 == unknown
        assert expected == pytest.approx(136_850.0)

    def test_residential_never_gets_zero_rehab(self):
        assert estimate_rehab_cost(None, None, None) > 0


# ── deal score: breakeven and losers score 0 ───────────────────────────────────

class TestScoreFloor:
    def test_money_losers_and_breakeven_score_zero(self):
        # THE FIX: non-positive ROI -> 0 (was: breakeven=20, -15% loser=5)
        assert _score_deal(-40) == 0.0
        assert _score_deal(-1) == 0.0
        assert _score_deal(0) == 0.0

    def test_pass_band_maps_roi_to_0_40(self):
        assert _score_deal(10) == 20.0
        assert _score_deal(19) == 38.0

    def test_higher_bands_unchanged(self):
        assert _score_deal(20) == 40.0       # Possible floor
        assert _score_deal(30) == 60.0       # Top Deal floor
        assert _score_deal(50) == 80.0       # Exceptional floor
        assert _score_deal(200) == 100.0     # capped
        assert _score_deal(None) == 0.0


# ── residential metrics ────────────────────────────────────────────────────────

class TestResidentialMetrics:
    def test_full_metrics_with_known_sqft(self):
        prop = {"tax_due": 10_000, "sqft": 1500, "year_built": 1990}
        m = calculate_deal_metrics(prop, arv=300_000)
        rehab = round(1500 * REHAB_RATES["medium"] * REHAB_CONTINGENCY, 2)  # 94,875
        assert m["min_bid"] == 10_000
        assert m["estimated_rehab_cost"] == rehab
        # all_in = tax + rehab + (legal 3500 + inspection 500 + carrying 4200)
        assert m["all_in_cost"] == round(10_000 + rehab + 8_200, 2)
        # max_bid: no defensible As-Is anchor here (only an arv-derived fallback) and
        # no comp_count → the segmented posture (2026-07-07) stays CONSERVATIVE on the
        # tax_due floor rather than bidding off the too-low arv×0.65 number.
        assert m["max_bid"] == 10_000
        assert m["as_is_source"] == "arv_derived_fallback"
        assert m["roi_percent"] == pytest.approx(146.7, abs=0.2)
        assert m["deal_score"] == 100.0
        assert m["arv"] == 300_000

    def test_unknown_sqft_lowers_maxbid_vs_buggy_arv_pct(self):
        # With the fix, an unknown-sqft residential gets the conservative 136,850
        # rehab (used by the ROI/flip model). The as-is max_bid stays on the tax_due
        # floor because there is no defensible anchor (arv-derived fallback only) and
        # no comps — the segmented posture never chases a low-data parcel.
        prop = {"tax_due": 10_000, "sqft": None, "year_built": None}
        m = calculate_deal_metrics(prop, arv=300_000)
        assert m["estimated_rehab_cost"] == pytest.approx(136_850.0)
        assert m["max_bid"] == 10_000

    def test_max_bid_floored_at_tax_due(self):
        prop = {"tax_due": 90_000, "sqft": 1500, "year_built": 1990}
        m = calculate_deal_metrics(prop, arv=120_000)  # thin spread -> raw max_bid below tax_due
        assert m["max_bid"] == 90_000

    def test_no_arv_returns_none_profit_and_tax_due_maxbid(self):
        prop = {"tax_due": 12_000, "sqft": 1500, "year_built": 1990}
        m = calculate_deal_metrics(prop, arv=None)
        assert m["roi_percent"] is None
        assert m["net_profit"] is None
        assert m["max_bid"] == 12_000


# ── land + commercial models ───────────────────────────────────────────────────

class TestLandAndCommercial:
    def test_land_uses_20pct_rule_no_rehab(self):
        m = calculate_land_metrics({"tax_due": 5_000}, comp_avg_price=200_000, comp_count=5)
        assert m["arv"] is None
        assert m["estimated_rehab_cost"] == 0
        assert m["land_value"] == round(200_000 * 0.20, 2)   # 40,000
        assert m["land_comp_quality"] == "STRONG"
        assert m["max_bid"] == round(40_000 * 0.65 - 3_500 - 4_200, 2)

    def test_land_no_comps_is_safe(self):
        m = calculate_land_metrics({"tax_due": 5_000}, comp_avg_price=None, comp_count=0)
        assert m["land_value"] is None
        assert m["max_bid"] == 5_000
        assert m["deal_score"] == 0.0

    def test_commercial_is_acquisition_only(self):
        m = calculate_commercial_metrics({"tax_due": 8_000})
        assert m["arv"] is None
        assert m["estimated_rehab_cost"] == 0
        assert m["roi_percent"] is None
        assert m["max_bid"] == 8_000
        assert m["deal_score"] == 0.0


# ── ARV from comps ─────────────────────────────────────────────────────────────

class TestArvFromComps:
    def _comp(self, price, sqft=1500, beds=3):
        return {"sale_price": price, "sqft": sqft, "bedrooms": beds, "sale_date": "2026-03-01"}

    def test_no_comps_returns_none(self):
        out = calculate_arv_from_comps([], property_sqft=1500)
        assert out["arv"] is None
        assert out["comp_count"] == 0
        assert out["comp_pool_quality"] == "NO_DATA"

    def test_weighted_arv_from_similar_comps(self):
        comps = [self._comp(p) for p in (290_000, 300_000, 310_000, 305_000, 295_000)]
        out = calculate_arv_from_comps(comps, property_sqft=1500, property_beds=3)
        assert out["arv"] is not None
        assert 280_000 <= out["arv"] <= 320_000
        assert out["comp_pool_quality"] == "STRONG"

    def test_unknown_subject_sqft_refuses_to_inflate(self):
        comps = [self._comp(p) for p in (290_000, 300_000, 310_000)]
        out = calculate_arv_from_comps(comps, property_sqft=None)
        assert out["arv"] is None


# ── building-quality grade rehab tiers (approved 2026-07-04) ───────────────────

class TestQualityGradeRehab:
    def test_good_grade_overrides_age_to_light(self):
        # 1988 build would be medium ($55) by age; county grade G -> light ($35).
        assert estimate_rehab_cost(None, 6236, 1988, "G") == round(
            6236 * REHAB_RATES["light"] * REHAB_CONTINGENCY, 2
        )

    def test_excellent_grade_is_light_even_when_old(self):
        assert estimate_rehab_cost(None, 1200, 1960, "E") == round(
            1200 * REHAB_RATES["light"] * REHAB_CONTINGENCY, 2
        )

    def test_average_grade_is_medium_even_when_old(self):
        assert estimate_rehab_cost(None, 1200, 1960, "A") == round(
            1200 * REHAB_RATES["medium"] * REHAB_CONTINGENCY, 2
        )

    def test_low_or_unknown_grades_keep_age_based_rate(self):
        for grade in ("F", "L", "V", "", None, "X"):
            assert estimate_rehab_cost(None, 1200, 1960, grade) == round(
                1200 * REHAB_RATES["heavy"] * REHAB_CONTINGENCY, 2
            )

    def test_grade_ignored_when_sqft_unknown(self):
        # conservative 1,400sqft heavy fallback wins regardless of grade
        assert estimate_rehab_cost(None, None, 1990, "G") == pytest.approx(136_850.0)

    def test_deal_metrics_reads_building_quality_from_prop(self):
        prop = {"tax_due": 35_000, "sqft": 6236, "year_built": 1988, "building_quality": "G"}
        m = calculate_deal_metrics(prop, arv=588_600)
        assert m["estimated_rehab_cost"] == round(6236 * REHAB_RATES["light"] * REHAB_CONTINGENCY, 2)
        assert m["roi_percent"] > 0  # was -48% under age-only full-gut
        assert "grade 'G'" in m["rehab_basis"]

    def test_rehab_basis_label_age_path(self):
        prop = {"tax_due": 10_000, "sqft": 1500, "year_built": 1990}
        m = calculate_deal_metrics(prop, arv=300_000)
        assert "age-based" in m["rehab_basis"]


# ── vacant-land buildability screen (data only; dev model is follow-up) ────────

class TestLandBuildability:
    def test_residential_zoning_outside_floodplain_is_candidate(self):
        m = calculate_land_metrics(
            {"tax_due": 5_000, "zoning": "RS180", "floodplain": "NO"},
            comp_avg_price=200_000, comp_count=5,
        )
        assert m["buildable_flag"] == "BUILDABLE_CANDIDATE"
        assert m["zoning"] == "RS180"
        assert m["floodplain"] == "NO"

    def test_floodplain_parcel_is_flagged(self):
        m = calculate_land_metrics(
            {"tax_due": 5_000, "zoning": "R", "floodplain": "YES"},
            comp_avg_price=200_000, comp_count=5,
        )
        assert m["buildable_flag"] == "FLOODPLAIN"

    def test_unknown_zoning_yields_no_flag(self):
        m = calculate_land_metrics({"tax_due": 5_000}, comp_avg_price=200_000, comp_count=5)
        assert m["buildable_flag"] is None


# ── secondary assessment dedup (run_ga_county post-processing) ─────────────────

class TestSecondaryAssessmentRules:
    def test_suffixed_record_defers_to_base_in_same_sale(self):
        from execution.run_ga_county import _apply_secondary_assessment_rules

        base = {"tax_id": "06070 091002", "tax_due": 35_222.85,
                "arv": 588_600, "roi_percent": 85.9, "deal_score": 94.0,
                "max_bid": 290_000, "recommended_max_bid": 290_000}
        suffixed = {"tax_id": "06070 091002Y", "tax_due": 1_736.30,
                    "arv": 588_600, "roi_percent": 85.9, "deal_score": 94.0,
                    "estimated_rehab_cost": 250_999,
                    "max_bid": 290_000, "recommended_max_bid": 290_000}
        results = _apply_secondary_assessment_rules([base, suffixed])

        sec = next(r for r in results if r["tax_id"] == "06070 091002Y")
        pri = next(r for r in results if r["tax_id"] == "06070 091002")
        assert sec["arv"] is None and sec["roi_percent"] is None
        assert sec["deal_score"] == 0.0
        assert sec["estimated_rehab_cost"] == 0
        assert sec["max_bid"] == sec["recommended_max_bid"] == 1_736.30
        assert "SECONDARY ASSESSMENT RECORD" in sec["analysis_notes"]
        # base keeps its analysis and gains a cross-reference note
        assert pri["arv"] == 588_600 and pri["deal_score"] == 94.0
        assert "091002Y" in pri["analysis_notes"]

    def test_suffixed_record_without_base_in_sale_is_untouched(self):
        from execution.run_ga_county import _apply_secondary_assessment_rules

        lone = {"tax_id": "12345 000001X", "tax_due": 2_000, "arv": 100_000,
                "roi_percent": 30.0, "deal_score": 60.0,
                "max_bid": 50_000, "recommended_max_bid": 50_000}
        results = _apply_secondary_assessment_rules([lone])
        assert results[0]["arv"] == 100_000
        assert "analysis_notes" not in results[0]


# ── auction index: land/estimate-only never counts as a top deal ───────────────

class TestAuctionIndexTopDeals:
    def test_land_and_estimate_only_excluded_from_top_deals(self):
        from execution.utils.auction_index import summarize_results

        # Unified public bar (operator decision 2026-07-17): ROI >= 100 with
        # comp-evidenced ARV. Full clause coverage lives in test_top_deals.py.
        results = [
            {"property_type": "SFR", "roi_percent": 150.0,
             "arv_source": "zillow_comps", "comps_used_for_arv": 6},                # counts
            {"property_type": "SFR", "roi_percent": 72.0,
             "arv_source": "zillow_comps", "comps_used_for_arv": 6},                # below 100
            {"property_type": "Vacant Land", "roi_percent": 150.0,
             "estimate_only": True},                                                # land: never
            {"property_type": "Vacant Land", "roi_percent": 45.0},                  # land: never
            {"property_type": "SFR", "roi_percent": 140.0, "estimate_only": True,
             "arv_source": "zillow_comps", "comps_used_for_arv": 6},                # estimate-only
            {"property_type": "Commercial", "roi_percent": None},                   # no ROI
        ]
        type_counts, top_deals = summarize_results(results)
        assert top_deals == 1
        assert type_counts == {"residential": 3, "multi_family": 0,
                               "commercial": 1, "land": 2}


# ── Wave 2: raw_opportunity_score rename + cap_roi ──────────────────────────────

class TestRawOpportunityScoreCurveUnchanged:
    """Regression lock on the _score_deal -> raw_opportunity_score rename."""
    def test_curve_bands_reproduced_exactly(self):
        assert raw_opportunity_score(100.2) == 100.0
        assert raw_opportunity_score(45) == 75.0
        assert raw_opportunity_score(25) == 50.0
        assert raw_opportunity_score(0) == 0.0
        assert raw_opportunity_score(-15) == 0.0
        assert raw_opportunity_score(None) == 0.0

    def test_matches_legacy_alias_across_range(self):
        for roi in (-50, -1, 0, 5, 19.9, 20, 25, 29.9, 30, 45, 49.9, 50, 100, 300):
            assert raw_opportunity_score(roi) == _score_deal(roi)


class TestCapRoi:
    def test_caps_at_150(self):
        assert cap_roi(300.0) == 150.0
        assert cap_roi(150.0) == 150.0
        assert cap_roi(120.0) == 120.0

    def test_none_passthrough(self):
        assert cap_roi(None) is None

    def test_score_input_cap_saturates_curve(self):
        # A 300% ROI, fed through cap_roi, saturates the curve at 100 deterministically.
        assert raw_opportunity_score(cap_roi(300.0)) == 100.0
        assert ROI_SCORE_CAP == 150.0


class TestRoiSanityCeiling:
    def test_library_emit_clamps_roi_percent(self):
        assert ROI_SANITY_CEILING == 200.0
