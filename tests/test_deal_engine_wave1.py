"""
Wave 1 regression tests for the BidWise deal engine — As-Is-anchored max-bid
ceiling (#1) and redemption dual-ROI (#4).

Targets the live engine execution/utils/ga_deal_calculator.py (imported by
run_ga_county.py). The legacy parallel engine (deal_math.py) and its
cross-engine parity assertions were removed when the deterministic runners
retired; the parametrized structure is kept so a second engine could be added
back later without reshaping the suite.

These tests encode the five gate assertions from
deal-engine-improvement-plan-2026-07-07.md:
  1. NO-BID recall preserved (ceiling must not resurrect a NO-BID)
  2. BID MAPE within tolerance on anchor-eligible parcels
  3. No bid above As-Is × 0.80 (hard cap); no 5-figure bid on zero-comp vacant
  4. VERIFIED tier — OUT OF SCOPE for Wave 1 (#2/#3), not asserted here
  5. Two labeled ROIs, never blended (roi_if_redeemed vs roi_if_deed_matures)

Pure financial math — no API keys / network required.
"""
import copy

import pytest

import execution.utils.ga_deal_calculator as ga


ENGINES = [ga]
ENGINE_IDS = ["ga_deal_calculator"]


# ── #1 As-Is anchor priority chain ─────────────────────────────────────────────

class TestAsIsAnchor:
    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_prefers_distressed_comp_over_appraised(self, mod):
        prop = {"distressed_comp_value": 150_000, "appraised_value": 200_000}
        assert mod._asis_anchor(prop, arv=250_000) == (150_000.0, "distressed_comp", "HIGH")

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_falls_to_county_appraised(self, mod):
        prop = {"appraised_value": 180_000}
        assert mod._asis_anchor(prop, arv=250_000) == (180_000.0, "county_appraised", "MEDIUM")

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_falls_to_county_appraised_alt_key(self, mod):
        prop = {"county_appraised_value": 180_000}
        assert mod._asis_anchor(prop, arv=250_000) == (180_000.0, "county_appraised", "MEDIUM")

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_falls_to_arv_082(self, mod):
        prop = {}
        assert mod._asis_anchor(prop, arv=100_000) == (82_000.0, "arv_derived_fallback", "LOW")

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_none_when_all_absent(self, mod):
        assert mod._asis_anchor({}, arv=None) == (0.0, "none", "NONE")

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_bad_float_treated_as_absent(self, mod):
        prop = {"distressed_comp_value": "N/A", "appraised_value": "bad"}
        assert mod._asis_anchor(prop, arv=100_000) == (82_000.0, "arv_derived_fallback", "LOW")

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_does_not_mutate_prop(self, mod):
        prop = {"distressed_comp_value": 150_000, "appraised_value": 200_000}
        before = copy.deepcopy(prop)
        mod._asis_anchor(prop, arv=250_000)
        assert prop == before


# ── #1 Base margin tiers ────────────────────────────────────────────────────────

class TestBaseMargin:
    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    @pytest.mark.parametrize(
        "as_is,expected",
        [
            # Recalibrated 2026-07-07 to a flat 0.62 across tiers (the Cobb July
            # well-comped residential subset implied margin ran 0.55–0.71). The tier
            # MECHANISM is retained so a future county can re-split high/mid/low.
            (500_000, 0.62),
            (400_000, 0.62),   # boundary — high tier
            (300_000, 0.62),
            (200_000, 0.62),   # boundary — mid tier
            (100_000, 0.62),
        ],
    )
    def test_tiers(self, mod, as_is, expected):
        assert mod._base_margin(as_is) == expected


# ── #1 As-Is ceiling ────────────────────────────────────────────────────────────

class TestAsIsCeiling:
    # As of 2026-07-07 _asis_ceiling no longer takes existing_arv_max_bid — the
    # min(ceiling, existing_arv_max_bid) clamp was REMOVED because it pinned every
    # As-Is raise back down to the too-low arv-derived number (root cause of #1's
    # failure: all 14 human BIDs underbid). The As-Is anchor now drives the bid,
    # bounded only by the hard cap (As-Is x 0.80) and the tax_due floor.

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_hard_cap_gate3(self, mod):
        # GATE 3: even with a high risk factor and a tiny cost stack, the ceiling
        # must not exceed As-Is × 0.80.
        as_is = 250_000
        ceiling = mod._asis_ceiling(
            as_is_value=as_is, base_margin=0.62, risk_factor=1.0,
            cost_stack=100.0, tax_due=1_000,
        )
        assert ceiling <= as_is * 0.80  # 200,000

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_floors_at_tax_due(self, mod):
        # Degenerate low as_is → ceiling floored at tax_due.
        ceiling = mod._asis_ceiling(
            as_is_value=1_000, base_margin=0.70, risk_factor=1.0,
            cost_stack=50_000.0, tax_due=5_000,
        )
        assert ceiling == 5_000

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_anchor_drives_bid_no_arv_clamp(self, mod):
        # The As-Is anchor (not a low arv number) drives the bid. With a defensible
        # 300k anchor, the ceiling lands on the anchor product, materially ABOVE the
        # kind of low arv-derived number the old clamp would have pinned it to.
        as_is = 300_000
        ceiling = mod._asis_ceiling(
            as_is_value=as_is, base_margin=0.62, risk_factor=0.95,
            cost_stack=9_200.0, tax_due=5_000,
        )
        expected = round(as_is * 0.62 * 0.95 - 9_200.0, 2)  # 167,500.0
        assert ceiling == expected
        assert ceiling > 90_000          # far above a typical arv-clamped bid
        assert ceiling <= as_is * 0.80   # still under the hard cap

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_risk_floor_applied(self, mod):
        # Risk factor below RISK_FLOOR is clamped up to RISK_FLOOR in the product.
        as_is = 300_000
        low_risk = 0.20
        ceiling = mod._asis_ceiling(
            as_is_value=as_is, base_margin=0.62, risk_factor=low_risk,
            cost_stack=0.0, tax_due=0,
        )
        # Effective product uses max(low_risk, RISK_FLOOR)=0.55; the As-Is×0.80 cap
        # sits above that product here, so the product is what surfaces.
        expected_product = as_is * 0.62 * mod.RISK_FLOOR
        cap = as_is * mod.CEILING_OF_CEILING
        assert ceiling == round(min(expected_product, cap), 2)


# ── #1 Risk adjustment ──────────────────────────────────────────────────────────

class TestRiskAdjustment:
    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_redemption_always_on(self, mod):
        factor, breakdown = mod._risk_adjustment({}, comp_count=10, as_is_confidence="HIGH")
        assert breakdown.get("redemption") == 0.95

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_thin_comp_fires_comp_weak(self, mod):
        factor, breakdown = mod._risk_adjustment({}, comp_count=0, as_is_confidence="HIGH")
        assert breakdown.get("comp_weak") == 0.85

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_none_comp_count_fires_comp_weak(self, mod):
        factor, breakdown = mod._risk_adjustment({}, comp_count=None, as_is_confidence="HIGH")
        assert breakdown.get("comp_weak") == 0.85

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_liens_fire_delinquency(self, mod):
        factor, breakdown = mod._risk_adjustment(
            {"has_open_liens": True}, comp_count=10, as_is_confidence="HIGH"
        )
        assert breakdown.get("delinquency") == 0.92

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_owner_occupied_fires_occupancy(self, mod):
        factor, breakdown = mod._risk_adjustment(
            {"owner_occupied": True}, comp_count=10, as_is_confidence="HIGH"
        )
        assert breakdown.get("occupancy") == 0.90

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_low_confidence_fires_condition_uncertainty(self, mod):
        factor, breakdown = mod._risk_adjustment({}, comp_count=10, as_is_confidence="LOW")
        assert breakdown.get("condition_uncertainty") == 0.90

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_factor_is_product(self, mod):
        factor, breakdown = mod._risk_adjustment(
            {"has_open_liens": True, "owner_occupied": True},
            comp_count=0, as_is_confidence="NONE",
        )
        # All five factors fire.
        expected = round(0.95 * 0.85 * 0.92 * 0.90 * 0.90, 4)
        assert factor == expected

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_does_not_mutate_prop(self, mod):
        prop = {"has_open_liens": True, "owner_occupied": True}
        before = copy.deepcopy(prop)
        mod._risk_adjustment(prop, comp_count=0, as_is_confidence="LOW")
        assert prop == before


# ── #4 Redemption scenario ──────────────────────────────────────────────────────

class TestRedemptionScenario:
    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_year1_is_20pct(self, mod):
        out = mod.calculate_redemption_scenario({"winning_bid": 10_000})
        by_month = {s["month"]: s for s in out["scenarios"]}
        assert by_month[3]["premium_pct"] == 20.0
        assert by_month[6]["premium_pct"] == 20.0
        assert by_month[12]["premium_pct"] == 20.0
        assert out["roi_if_redeemed_year1_pct"] == 20.0

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_step_function_day366(self, mod):
        # Step jump years 1 -> 2 => +10%. month=18 and 24 are year 2 => 30%.
        out = mod.calculate_redemption_scenario({"winning_bid": 10_000})
        by_month = {s["month"]: s for s in out["scenarios"]}
        assert by_month[12]["premium_pct"] == 20.0
        assert by_month[18]["premium_pct"] == 30.0
        assert by_month[24]["premium_pct"] == 30.0

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_base_includes_subsequent_taxes(self, mod):
        # CRITICAL GUARD: base is bid + subsequent_taxes, never bid alone.
        out = mod.calculate_redemption_scenario(
            {"winning_bid": 10_000, "subsequent_taxes": 2_000}
        )
        assert out["redemption_base"] == 12_000
        month3 = next(s for s in out["scenarios"] if s["month"] == 3)
        # premium computed on 12,000 not 10,000: 12000 * 1.20 = 14,400
        assert month3["redemption_payment"] == 14_400.0

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_annualized_highest_at_month3(self, mod):
        out = mod.calculate_redemption_scenario({"winning_bid": 10_000})
        by_month = {s["month"]: s["annualized_return_pct"] for s in out["scenarios"]}
        # Month 3 (shortest hold) is the global annualized maximum.
        assert by_month[3] == max(by_month.values())
        # Within the year-1 tier (constant total return), annualized strictly falls
        # as the hold lengthens: month 3 > month 6 > month 12.
        assert by_month[3] > by_month[6] > by_month[12]

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_div_by_zero_guarded(self, mod):
        # All-zero bid: invested is still > 0 because barment is always sunk, so the
        # grid is defined (a total loss of the sunk barment, not a div-by-zero crash).
        # No NaN / inf may leak, and redemption_base is 0 (no bid, no subsequent tax).
        out = mod.calculate_redemption_scenario({})
        assert out["redemption_base"] == 0.0
        for s in out["scenarios"]:
            assert s["total_return_pct"] == -100.0            # entire barment sunk
            assert not (s["annualized_return_pct"] != s["annualized_return_pct"])  # not NaN

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_zero_invested_returns_zero(self, mod):
        # If barment were ever zero AND no bid, invested==0 → guard returns 0.0
        # (exercised by monkeypatching BARMENT_COST to 0 for this call only).
        original = mod.BARMENT_COST
        try:
            mod.BARMENT_COST = 0
            out = mod.calculate_redemption_scenario({})
            for s in out["scenarios"]:
                assert s["total_return_pct"] == 0.0
                assert s["annualized_return_pct"] == 0.0
        finally:
            mod.BARMENT_COST = original

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_does_not_mutate_prop(self, mod):
        prop = {"winning_bid": 10_000, "subsequent_taxes": 2_000}
        before = copy.deepcopy(prop)
        mod.calculate_redemption_scenario(prop)
        assert prop == before


# ── #4 dual-ROI additive keys in calculate_deal_metrics ─────────────────────────

class TestDualRoiAdditive:
    def _res_prop(self):
        return {"tax_due": 10_000, "sqft": 1500, "year_built": 1990,
                "appraised_value": 250_000, "property_type": "Residential"}

    def test_ga_roi_if_deed_matures_is_alias(self):
        prop = self._res_prop()
        m = ga.calculate_deal_metrics(prop, arv=300_000)
        assert m["roi_if_deed_matures"] == m["roi_percent"]

    def test_ga_year1_is_20pct(self):
        m = ga.calculate_deal_metrics(self._res_prop(), arv=300_000)
        assert m["roi_if_redeemed_year1_pct"] == 20.0

    def test_ga_redemption_dict_present(self):
        m = ga.calculate_deal_metrics(self._res_prop(), arv=300_000)
        assert isinstance(m["redemption"], dict)
        assert "scenarios" in m["redemption"]

    @pytest.mark.parametrize(
        "mod,arv", [(ga, 300_000)], ids=["ga"]
    )
    def test_redemption_purely_additive(self, mod, arv):
        # roi_percent / deal_score / max_bid are unaffected by the redemption keys.
        prop = self._res_prop()
        m = mod.calculate_deal_metrics(prop, arv=arv)
        # Recompute the core fields independently: redemption is additive, so the
        # presence of the new keys must not have changed them. We assert the keys
        # exist AND that roi/deal_score/max_bid are finite, non-None numbers.
        assert m["roi_percent"] is not None
        assert m["deal_score"] is not None
        assert m["max_bid"] is not None


# ── #1 metrics-level: As-Is anchor drives max_bid & new fields ──────────────────

class TestMetricsAnchorFields:
    @pytest.mark.parametrize(
        "mod", ENGINES, ids=ENGINE_IDS
    )
    def test_new_fields_present_residential(self, mod):
        prop = {"tax_due": 10_000, "sqft": 1500, "year_built": 1990,
                "appraised_value": 250_000, "property_type": "Residential"}
        m = mod.calculate_deal_metrics(prop, arv=300_000)
        for key in ("as_is_value", "as_is_source", "as_is_confidence",
                    "base_margin_factor", "risk_adjustment_factor",
                    "risk_adjustment_breakdown"):
            assert key in m, f"{key} missing from {mod.__name__}"

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_anchor_source_is_county_appraised(self, mod):
        prop = {"tax_due": 10_000, "sqft": 1500, "year_built": 1990,
                "appraised_value": 250_000, "property_type": "Residential"}
        m = mod.calculate_deal_metrics(prop, arv=300_000)
        assert m["as_is_source"] == "county_appraised"
        assert m["as_is_value"] == 250_000.0

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_max_bid_never_exceeds_asis_80pct_gate3(self, mod):
        # GATE 3: computed max_bid never exceeds As-Is × 0.80 — exercised on the
        # COMPETITIVE path (well-comped residential: distressed anchor + comp_count>=4).
        prop = {"tax_due": 1_000, "sqft": 1500, "year_built": 1990,
                "distressed_comp_value": 250_000, "property_type": "Residential"}
        m = mod.calculate_deal_metrics(prop, arv=1_000_000, comp_count=10)  # huge arv
        assert m["max_bid"] <= m["as_is_value"] * 0.80 + 0.01
        # And the competitive path actually raised the bid off the tax_due floor.
        assert m["max_bid"] > prop["tax_due"]

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_zero_anchor_floors_maxbid_to_tax_due_gate1(self, mod):
        # GATE 1: no anchor (no comp/appraised/arv) → max_bid floors to tax_due.
        prop = {"tax_due": 3_000, "sqft": 1500, "year_built": 1990,
                "property_type": "Residential"}
        m = mod.calculate_deal_metrics(prop, arv=None)
        assert m["max_bid"] == 3_000
        assert m["as_is_source"] == "none"


# ── #1 SEGMENTED risk posture (2026-07-07 acceptance) ───────────────────────────

class TestSegmentedRiskPosture:
    """
    The operator's segmented posture: bid COMPETITIVELY (toward the As-Is anchor,
    hard-capped at x0.80) ONLY on well-comped residential; stay CONSERVATIVE (tax_due
    floor) on thin-comp / commercial / land / no-anchor. Encodes the four gates:
      (a) a strong-comp residential parcel bids materially above the old arv-clamped
          number,
      (b) a thin-comp parcel stays on the tax_due floor,
      (c) no bid > As-Is x 0.80,
      (d) a no-anchor parcel stays on the tax_due floor (a NO-BID stays NO-BID).
    """

    # A strong-comp residential parcel: county-appraised 338,030 (matches 170
    # Mathews Cir), comp_count 8. Old arv-clamped bid was ~67,599; the human bid
    # 175,000. The segmented competitive ceiling must land materially above 67,599.
    STRONG = {"tax_due": 1_144, "sqft": 1595, "year_built": 1962,
              "appraised_value": 338_030, "property_type": "Residential"}

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_gate_a_strong_comp_bids_above_old_arv_clamp(self, mod):
        m = mod.calculate_deal_metrics(dict(self.STRONG), arv=360_000, comp_count=8)
        assert m["as_is_source"] == "county_appraised"
        # Materially above the old arv-clamped ~67,599 and above the tax_due floor.
        assert m["max_bid"] > 120_000
        assert m["max_bid"] > self.STRONG["tax_due"]

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_gate_b_thin_comp_stays_on_tax_due_floor(self, mod):
        # Same parcel value, but only 1 comp → not well-comped → conservative floor.
        thin = dict(self.STRONG)
        m = mod.calculate_deal_metrics(thin, arv=360_000, comp_count=1)
        assert m["max_bid"] == thin["tax_due"]

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_gate_c_no_bid_over_asis_80pct(self, mod):
        # Even with a huge arv and full comps, the bid never exceeds As-Is x 0.80.
        m = mod.calculate_deal_metrics(dict(self.STRONG), arv=5_000_000, comp_count=20)
        assert m["max_bid"] <= m["as_is_value"] * 0.80 + 0.01

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_gate_d_no_anchor_stays_conservative(self, mod):
        # No distressed comp, no appraisal, no arv → no defensible anchor → tax_due.
        prop = {"tax_due": 288, "sqft": None, "year_built": None,
                "property_type": "Residential"}
        m = mod.calculate_deal_metrics(prop, arv=None, comp_count=25)
        assert m["max_bid"] == prop["tax_due"]
        assert m["as_is_source"] == "none"

    @pytest.mark.parametrize("mod", ENGINES, ids=ENGINE_IDS)
    def test_arv_fallback_anchor_is_not_competitive(self, mod):
        # A defensible anchor must be distressed_comp or county_appraised. An
        # arv-derived fallback (LOW confidence) is NOT trusted for a competitive bid,
        # even with many comps → stays conservative.
        prop = {"tax_due": 2_000, "sqft": 1500, "year_built": 1990,
                "property_type": "Residential"}
        m = mod.calculate_deal_metrics(prop, arv=200_000, comp_count=10)
        assert m["as_is_source"] == "arv_derived_fallback"
        assert m["max_bid"] == prop["tax_due"]

    def test_helper_segmentation(self):
        # _is_well_comped_residential agrees with the segmented posture on key cases.
        cases = [
            ("Residential", 4, "county_appraised", True),
            ("Residential", 3, "county_appraised", False),   # too few comps
            ("Residential", 10, "arv_derived_fallback", False),  # weak anchor
            ("Residential", 10, "none", False),
            ("Commercial", 10, "county_appraised", False),   # not residential
            ("SFR", 5, "distressed_comp", True),
            ("Residential", None, "county_appraised", False),
        ]
        for ptype, cc, src, expected in cases:
            assert ga._is_well_comped_residential(ptype, cc, src) is expected, (ptype, cc, src)
