"""
NO-BID disqualification guardrail — financial-safety tests.

Ground truth is the human analyst's verdicts on the Cobb 2026-07-07 tax-sale list
(brands/bidwise/cobb-july-parcels-manual.json): 9 parcels "NO BID" (LandLocked /
Unbuildable / Small lot / Flood Zone) and 14 "BID".

IMPORTANT — these fixtures mirror the REAL pipeline output field shapes (verified
by running run_ga_county.py on the manual Cobb list),
NOT hand-constructed profiles. In the real output, vacant land is routed to the
land model and comes back with a county-appraisal-based `land_value` even at
comp_count=0 (so "land_value is None" alone does NOT catch the $185k Sandtown
case); a "RESIDENTIAL VACANT" land_use string can still be routed SFR with a valid
ARV (95 Woods Dr — a human BID). The guardrail is calibrated to those realities.

Pure financial math — no API keys / network required.
"""
import pytest

from execution.utils.nobid_guardrail import (
    FLOODPLAIN_IMPROVED_SCORE_PENALTY,
    REASON_COMMERCIAL_NO_COMPS,
    REASON_FLOOD_ZONE,
    REASON_NO_LAND_VALUE,
    REASON_SMALL_LOT,
    SMALL_LOT_FLOOR_SQFT,
    apply_guardrail,
    evaluate_disqualifiers,
    is_vacant_land,
)


def _run(prop, metrics):
    return apply_guardrail(prop, metrics)


# ── The 9 human NO-BID parcels (real field shapes) ─────────────────────────────

class TestHumanNoBidParcels:
    def test_1490_sandtown_commercial_no_comps_is_killed(self):
        # THE headline: Vacant Land, property_class C3 (commercial), comp_count 0,
        # but land_value 296540 from the county appraisal. Buggy run: $185,051 @
        # 1414%. The commercial-no-comps rule (NOT the land_value==None rule) fires.
        prop = {"full_address": "1490 SANDTOWN RD", "property_type": "Vacant Land",
                "property_class": "C3", "zoning_code": "OI", "land_use": "VACANT COMMERCIAL LAND",
                "lot_size_sf": 35998, "comp_count": 0}
        metrics = {"arv": None, "net_profit": 257572.2, "land_value": 296540.0,
                   "max_bid": 185051.0, "deal_score": 0.0, "comp_count": 0}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is True
        assert r["no_bid_reason"] == REASON_COMMERCIAL_NO_COMPS
        assert r["recommended_max_bid"] is None
        assert r["max_bid"] is None
        assert r["deal_score"] == 0.0
        assert r["buildable_flag"] is False

    def test_1926_roswell_commercial_no_comps_is_killed(self):
        prop = {"full_address": "1926 ROSWELL RD", "property_type": "Vacant Land",
                "property_class": "C4", "land_use": "VACANT COMMERCIAL LAND",
                "flood_risk": "High", "lot_size_sf": 63162, "comp_count": 0}
        metrics = {"arv": None, "net_profit": 71176.0, "land_value": 86490.0,
                   "max_bid": 48518.0, "deal_score": 0.0, "comp_count": 0}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is True
        assert r["no_bid_reason"] == REASON_COMMERCIAL_NO_COMPS
        assert r["recommended_max_bid"] is None

    def test_898_canton_commercial_no_comps_is_killed(self):
        prop = {"full_address": "898 CANTON RD", "property_type": "Vacant Land",
                "property_class": "C3", "comp_count": 0}
        metrics = {"arv": None, "net_profit": -6014.0, "land_value": 2350.0,
                   "max_bid": 0, "deal_score": 0.0, "comp_count": 0}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is True
        assert r["no_bid_reason"] == REASON_COMMERCIAL_NO_COMPS

    def test_150_chert_commercial_no_comps_is_killed(self):
        # Unbuildable per human; C3 vacant land, 0 comps → commercial-no-comps.
        prop = {"full_address": "150 CHERT RD", "property_type": "Vacant Land",
                "property_class": "C3", "land_use": "VACANT LAND", "lot_size_sf": 741,
                "comp_count": 0}
        metrics = {"arv": None, "net_profit": -7068.0, "land_value": 1240.0,
                   "max_bid": None, "deal_score": 0.0, "comp_count": 0}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is True
        assert r["no_bid_reason"] == REASON_COMMERCIAL_NO_COMPS

    def test_511_tower_small_lot_is_killed(self):
        # Landlocked per human; residential vacant, 4,182 sq ft < floor → small-lot.
        prop = {"full_address": "511 TOWER RD", "property_type": "Vacant Land",
                "property_class": "R3", "land_use": "RESIDENTIAL VACANT",
                "lot_size_sf": 4182, "comp_count": 25}
        metrics = {"arv": None, "net_profit": 18404.0, "land_value": 28770.0,
                   "max_bid": 11000.5, "deal_score": 0.0, "comp_count": 25}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is True
        assert r["no_bid_reason"] == REASON_SMALL_LOT
        assert r["recommended_max_bid"] is None

    def test_337_old_clay_small_lot_is_killed(self):
        prop = {"full_address": "337 OLD CLAY ST", "property_type": "Vacant Land",
                "property_class": "R3", "land_use": "RESIDENTIAL VACANT",
                "lot_size_sf": 4356, "comp_count": 25}
        metrics = {"arv": None, "net_profit": -6240.0, "land_value": 2160.0,
                   "max_bid": None, "deal_score": 0.0, "comp_count": 25}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is True
        assert r["no_bid_reason"] == REASON_SMALL_LOT

    def test_1015_beech_small_lot_is_killed(self):
        prop = {"full_address": "1015 BEECH ST", "property_type": "Vacant Land",
                "property_class": "R3", "land_use": "RESIDENTIAL VACANT",
                "lot_size_sf": 4356, "comp_count": 25}
        metrics = {"arv": None, "net_profit": -2275.0, "land_value": 6560.0,
                   "max_bid": None, "deal_score": 0.0, "comp_count": 25}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is True
        assert r["no_bid_reason"] == REASON_SMALL_LOT

    @pytest.mark.parametrize("addr,prop,metrics", [
        ("532 WALLACE RD",
         {"property_type": "Vacant Land", "property_class": "R3",
          "land_use": "RESIDENTIAL VACANT", "lot_size_sf": 6072, "comp_count": 25},
         {"arv": None, "net_profit": 70562.0, "land_value": 85000.0,
          "max_bid": 47550.0, "deal_score": 0.0, "comp_count": 25}),
        ("510 TOWER RD",
         {"property_type": "SFR", "property_class": "R3",
          "land_use": "RESIDENTIAL VACANT", "lot_size_sf": 9365, "comp_count": 3},
         {"arv": 63920.0, "net_profit": -71795.0, "land_value": None,
          "max_bid": None, "deal_score": 0.0, "comp_count": 3}),
    ])
    def test_landlocked_but_valued_is_the_documented_gap(self, addr, prop, metrics):
        # HONEST LIMITATION: these are human NO-BID (LandLocked) but in our data
        # they are residential lots with comps/valuation — indistinguishable from a
        # buildable comped lot. Landlock has no field. The guardrail does NOT catch
        # them and must not pretend to.
        r = _run(prop, metrics)
        assert r["is_no_bid"] is False  # documented gap, not a false pass

    def test_seven_of_nine_nobid_caught(self):
        # Roll-up matching the real pipeline: 7 of 9 human NO-BIDs disqualified;
        # 2 (532 Wallace, 510 Tower) are the landlock gap.
        catchable = [
            ({"property_type": "Vacant Land", "property_class": "C3", "comp_count": 0},
             {"land_value": 296540.0, "net_profit": 257572.2, "comp_count": 0}),      # Sandtown
            ({"property_type": "Vacant Land", "property_class": "C4", "comp_count": 0},
             {"land_value": 86490.0, "net_profit": 71176.0, "comp_count": 0}),        # Roswell
            ({"property_type": "Vacant Land", "property_class": "C3", "comp_count": 0},
             {"land_value": 2350.0, "net_profit": -6014.0, "comp_count": 0}),         # Canton
            ({"property_type": "Vacant Land", "property_class": "C3", "comp_count": 0},
             {"land_value": 1240.0, "net_profit": -7068.0, "comp_count": 0}),         # Chert
            ({"property_type": "Vacant Land", "property_class": "R3",
              "lot_size_sf": 4182, "comp_count": 25},
             {"land_value": 28770.0, "net_profit": 18404.0, "comp_count": 25}),       # 511 Tower
            ({"property_type": "Vacant Land", "property_class": "R3",
              "lot_size_sf": 4356, "comp_count": 25},
             {"land_value": 2160.0, "net_profit": -6240.0, "comp_count": 25}),        # 337 Old Clay
            ({"property_type": "Vacant Land", "property_class": "R3",
              "lot_size_sf": 4356, "comp_count": 25},
             {"land_value": 6560.0, "net_profit": -2275.0, "comp_count": 25}),        # 1015 Beech
        ]
        killed = sum(1 for prop, metrics in catchable if _run(prop, metrics)["is_no_bid"])
        assert killed == 7


# ── The 14 human BID parcels must NOT be disqualified ──────────────────────────

class TestHumanBidParcelsNotOverFired:
    def test_95_woods_sfr_with_arv_still_bids(self):
        # THE over-fire fix: land_use says "RESIDENTIAL VACANT" but the pipeline
        # routed it SFR with a valid $125k ARV. Must NOT be screened as raw land.
        prop = {"full_address": "95 WOODS DR", "property_type": "SFR",
                "property_class": "R3", "land_use": "RESIDENTIAL VACANT",
                "sqft": 630, "lot_size_sf": 9048, "comp_count": 1}
        metrics = {"arv": 125000.0, "net_profit": 46027.5, "land_value": None,
                   "max_bid": 11967.5, "deal_score": 86.2, "comp_count": 1}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is False
        assert r["recommended_max_bid"] is not None
        assert r["recommended_max_bid"] > 0

    def test_405_edwards_vacant_lot_with_land_value_bids(self):
        prop = {"full_address": "405 EDWARDS DR", "property_type": "Vacant Land",
                "property_class": "R3", "land_use": "RESIDENTIAL VACANT",
                "lot_size_sf": 4700, "comp_count": 25}
        metrics = {"arv": None, "net_profit": 65929.0, "land_value": 80000.0,
                   "max_bid": 44300.0, "deal_score": 0.0, "comp_count": 25}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is False
        assert r["recommended_max_bid"] == 44300.0
        assert r["buildable_flag"] is True

    def test_improved_residential_bids_still_get_a_bid(self):
        cases = [
            ("170 MATHEWS CIR", 1595, 358898.83, 168520.66, 69672.99),
            ("875 SOARING CIR", 2565, 546503.0, 335985.0, 185290.0),
            ("856 RICHARD ST", 1967, 410876.9, 180992.0, 67095.74),
            ("1584 ARDEN DR", 1971, 410358.71, 180219.0, 66367.91),
        ]
        for addr, sqft, arv, net, bid in cases:
            prop = {"full_address": addr, "property_type": "SFR",
                    "property_class": "R3", "sqft": sqft, "comp_count": 8}
            metrics = {"arv": arv, "net_profit": net, "max_bid": bid,
                       "deal_score": 100.0, "comp_count": 8, "buildable_flag": True}
            r = _run(prop, metrics)
            assert r["is_no_bid"] is False, f"{addr} wrongly disqualified"
            assert r["recommended_max_bid"] == bid

    def test_610_franklin_commercial_bids_at_acquisition_cost(self):
        # Commercial (not vacant land) — routed to the commercial model, bids at
        # tax_due only. Guardrail must not touch it (property_type Commercial).
        prop = {"full_address": "610 FRANKLIN GATEWAY", "property_type": "Commercial",
                "property_class": "C4", "comp_count": 0}
        metrics = {"arv": None, "net_profit": None, "land_value": None,
                   "max_bid": 12444.0, "deal_score": 0.0, "comp_count": 0}
        r = _run(prop, metrics)
        assert r["is_no_bid"] is False
        assert r["recommended_max_bid"] == 12444.0

    def test_no_over_fire_across_all_14_bids(self):
        bids = [
            ({"property_type": "Vacant Land", "property_class": "R3",
              "lot_size_sf": 4700, "comp_count": 25},
             {"land_value": 80000.0, "net_profit": 65929.0, "max_bid": 44300.0, "comp_count": 25}),
            ({"property_type": "Commercial", "property_class": "I3", "comp_count": 0},
             {"land_value": None, "net_profit": None, "max_bid": 40.0, "comp_count": 0}),
            ({"property_type": "SFR", "property_class": "R3", "sqft": 630,
              "land_use": "RESIDENTIAL VACANT", "comp_count": 1},
             {"arv": 125000.0, "net_profit": 46027.5, "max_bid": 11967.5, "comp_count": 1}),
        ]
        improved_arvs = [358898.83, 320840.0, 410876.9, 283080.0, 299920.0, 184210.0,
                         336115.11, 236970.0, 546503.0, 410358.71]
        for arv in improved_arvs:
            bids.append(({"property_type": "SFR", "property_class": "R3", "sqft": 1500,
                          "comp_count": 5},
                         {"arv": arv, "net_profit": arv * 0.4, "max_bid": arv * 0.2,
                          "comp_count": 5}))
        over_fired = [prop.get("full_address", prop.get("property_type"))
                      for prop, metrics in bids if _run(prop, metrics)["is_no_bid"]]
        assert over_fired == [], f"over-fired on: {over_fired}"


# ── Direct unit tests on the disqualification function ─────────────────────────

class TestDisqualifierUnit:
    def test_commercial_vacant_no_comps_disqualified(self):
        prop = {"property_type": "Vacant Land", "property_class": "C3", "comp_count": 0}
        metrics = {"land_value": 200000, "net_profit": 50000, "comp_count": 0}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason == REASON_COMMERCIAL_NO_COMPS

    def test_commercial_vacant_WITH_comps_is_not_disqualified_by_rule1(self):
        prop = {"property_type": "Vacant Land", "property_class": "C3",
                "lot_size_sf": 50000, "comp_count": 12}
        metrics = {"land_value": 200000, "net_profit": 50000, "comp_count": 12}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason is None

    def test_bare_C_class_code_is_not_treated_as_commercial(self):
        # A truncated/garbage property_class of exactly "C" (no digit) must NOT
        # trip the commercial-no-comps rule. It falls through to rule 2/4.
        prop = {"property_type": "Vacant Land", "property_class": "C",
                "lot_size_sf": 50000, "comp_count": 0}
        metrics = {"land_value": 40000, "net_profit": 10000, "comp_count": 0}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason != REASON_COMMERCIAL_NO_COMPS  # not disqualified by rule 1

    def test_vacant_land_no_valuation_disqualified(self):
        prop = {"property_type": "Vacant Land", "property_class": "R3",
                "lot_size_sf": 20000, "comp_count": 25}
        metrics = {"arv": None, "net_profit": None, "land_value": None, "comp_count": 25}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason == REASON_NO_LAND_VALUE

    def test_vacant_land_small_lot_disqualified(self):
        prop = {"property_type": "Vacant Land", "property_class": "R3",
                "lot_size_sf": 3000, "comp_count": 25}
        metrics = {"land_value": 40000, "net_profit": 10000, "comp_count": 25}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason == REASON_SMALL_LOT

    def test_vacant_land_at_floor_is_ok(self):
        prop = {"property_type": "Vacant Land", "property_class": "R3",
                "lot_size_sf": SMALL_LOT_FLOOR_SQFT, "comp_count": 25}
        metrics = {"land_value": 40000, "net_profit": 10000, "comp_count": 25}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason is None

    def test_vacant_land_in_floodplain_disqualified(self):
        prop = {"property_type": "Vacant Land", "property_class": "R3",
                "lot_size_sf": 50000, "flood_risk": "High", "comp_count": 25}
        metrics = {"land_value": 20000, "net_profit": 8000, "comp_count": 25}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason == REASON_FLOOD_ZONE

    def test_vacant_land_floodplain_via_floodplain_field(self):
        prop = {"property_type": "Vacant Land", "property_class": "R3",
                "lot_size_sf": 50000, "floodplain": "YES", "comp_count": 25}
        metrics = {"land_value": 20000, "net_profit": 8000, "comp_count": 25}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason == REASON_FLOOD_ZONE

    def test_improved_residential_in_flood_is_not_disqualified(self):
        prop = {"property_type": "SFR", "property_class": "R3", "sqft": 1063,
                "flood_risk": "High", "comp_count": 5}
        metrics = {"arv": 283080.0, "net_profit": 150060.0, "max_bid": 72394.0,
                   "deal_score": 90.0, "comp_count": 5}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason is None

    def test_improved_residential_with_comps_passes(self):
        prop = {"property_type": "SFR", "property_class": "R3", "sqft": 1595, "comp_count": 8}
        metrics = {"arv": 358898.83, "net_profit": 168520.0, "max_bid": 69672.99,
                   "deal_score": 100.0, "comp_count": 8}
        reason, _ = evaluate_disqualifiers(prop, metrics)
        assert reason is None


# ── apply_guardrail: field-level contract ──────────────────────────────────────

class TestApplyGuardrailContract:
    def test_disqualify_nulls_bid_and_sets_banner_fields(self):
        prop = {"property_type": "Vacant Land", "property_class": "C3", "comp_count": 0}
        metrics = {"land_value": 296540.0, "max_bid": 185051.0, "deal_score": 0.0,
                   "net_profit": 257572.2, "buildable_flag": True, "comp_count": 0}
        out = apply_guardrail(prop, metrics)
        assert out["recommended_max_bid"] is None
        assert out["max_bid"] is None
        assert out["deal_score"] == 0.0
        assert out["buildable_flag"] is False
        assert out["is_no_bid"] is True
        assert out["recommendation"] == "NO BID"
        assert out["no_bid_reason"] == REASON_COMMERCIAL_NO_COMPS

    def test_apply_guardrail_does_not_mutate_inputs(self):
        prop = {"property_type": "Vacant Land", "property_class": "C3", "comp_count": 0}
        metrics = {"land_value": 296540.0, "max_bid": 185051.0, "deal_score": 0.0, "comp_count": 0}
        apply_guardrail(prop, metrics)
        assert metrics["max_bid"] == 185051.0
        assert "is_no_bid" not in metrics
        assert prop["property_type"] == "Vacant Land"

    def test_passing_vacant_land_gets_buildable_true(self):
        prop = {"property_type": "Vacant Land", "property_class": "R3",
                "lot_size_sf": 9048, "comp_count": 25}
        metrics = {"land_value": 26000, "net_profit": 12000, "max_bid": 12000,
                   "deal_score": 0.0, "buildable_flag": None, "comp_count": 25}
        out = apply_guardrail(prop, metrics)
        assert out["is_no_bid"] is False
        assert out["buildable_flag"] is True
        assert out["max_bid"] == 12000
        assert out["recommended_max_bid"] == 12000

    def test_improved_flood_parcel_penalized_not_killed(self):
        prop = {"property_type": "SFR", "property_class": "R3", "sqft": 1063,
                "flood_risk": "High", "comp_count": 5}
        metrics = {"arv": 283080.0, "net_profit": 150060.0, "max_bid": 72000,
                   "deal_score": 90.0, "buildable_flag": None, "comp_count": 5}
        out = apply_guardrail(prop, metrics)
        assert out["is_no_bid"] is False
        assert out["floodplain"] is True
        assert out["deal_score"] == 90.0 - FLOODPLAIN_IMPROVED_SCORE_PENALTY
        assert out["max_bid"] == 72000  # bid preserved — a house in a flood zone can still be a deal

    def test_improved_flood_parcel_records_score_penalty(self):
        # The confidence tier recomputes deal_score from ROI, so the -15 applied
        # to deal_score above would vanish downstream without a carried field —
        # score_penalty is how the deduction survives (re-applied post-cap by
        # apply_confidence_tier).
        prop = {"property_type": "SFR", "property_class": "R3", "sqft": 1063,
                "flood_risk": "High", "comp_count": 5}
        metrics = {"arv": 283080.0, "net_profit": 150060.0, "max_bid": 72000,
                   "deal_score": 90.0, "buildable_flag": None, "comp_count": 5}
        out = apply_guardrail(prop, metrics)
        assert out["score_penalty"] == FLOODPLAIN_IMPROVED_SCORE_PENALTY

    def test_non_flood_parcel_has_no_score_penalty(self):
        prop = {"property_type": "SFR", "property_class": "R3", "sqft": 1200,
                "comp_count": 5}
        metrics = {"arv": 200000.0, "net_profit": 90000.0, "max_bid": 60000,
                   "deal_score": 80.0, "buildable_flag": None, "comp_count": 5}
        out = apply_guardrail(prop, metrics)
        assert "score_penalty" not in out


# ── downstream wiring: secondary-assessment reset must respect NO-BID ──────────

class TestSecondaryAssessmentRespectsNoBid:
    def test_no_bid_parcel_is_not_re_bid_by_secondary_rules(self):
        from execution.run_ga_county import _apply_secondary_assessment_rules

        base = {"tax_id": "10130 0630", "tax_due": 152, "arv": 300000,
                "deal_score": 90.0, "max_bid": 100000, "recommended_max_bid": 100000}
        nobid_secondary = {"tax_id": "10130 0630Y", "tax_due": 5000,
                           "is_no_bid": True, "recommendation": "NO BID",
                           "no_bid_reason": REASON_SMALL_LOT,
                           "max_bid": None, "recommended_max_bid": None, "deal_score": 0.0}
        results = _apply_secondary_assessment_rules([base, nobid_secondary])
        sec = next(r for r in results if r["tax_id"] == "10130 0630Y")
        assert sec["is_no_bid"] is True
        assert sec["max_bid"] is None
        assert sec["recommended_max_bid"] is None
        assert sec["no_bid_reason"] == REASON_SMALL_LOT

    def test_non_disqualified_secondary_still_falls_back_to_tax_due(self):
        from execution.run_ga_county import _apply_secondary_assessment_rules

        base = {"tax_id": "10130 0630", "tax_due": 152, "arv": 300000,
                "deal_score": 90.0, "max_bid": 100000, "recommended_max_bid": 100000}
        secondary = {"tax_id": "10130 0630Y", "tax_due": 1736.30, "arv": 300000,
                     "max_bid": 100000, "recommended_max_bid": 100000}
        results = _apply_secondary_assessment_rules([base, secondary])
        sec = next(r for r in results if r["tax_id"] == "10130 0630Y")
        assert sec["max_bid"] == 1736.30
        assert sec["recommended_max_bid"] == 1736.30


# ── is_vacant_land classifier (routing-aware) ──────────────────────────────────

class TestIsVacantLand:
    @pytest.mark.parametrize("prop,metrics", [
        ({"property_type": "Vacant Land"}, None),
        ({"property_type": "Land"}, None),
        ({"property_class": "R3", "land_use": "RESIDENTIAL VACANT"}, {}),
        ({"sqft": 0, "beds": None}, {}),
    ])
    def test_recognizes_vacant_land(self, prop, metrics):
        assert is_vacant_land(prop, metrics) is True

    @pytest.mark.parametrize("prop,metrics", [
        ({"property_type": "SFR", "sqft": 1595}, None),
        ({"property_type": "Commercial"}, None),
        ({"property_type": "Multi-Family"}, None),
        # THE key case: land_use says vacant, but routed SFR with a valid ARV.
        ({"property_type": "SFR", "land_use": "RESIDENTIAL VACANT", "sqft": 630},
         {"arv": 125000.0, "net_profit": 46027.5}),
        ({"property_class": "R3"}, {"arv": 300000.0}),
    ])
    def test_rejects_improved_or_valued_property(self, prop, metrics):
        assert is_vacant_land(prop, metrics) is False
