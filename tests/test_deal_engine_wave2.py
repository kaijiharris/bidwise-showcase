"""
Wave 2 regression tests — roi_percent display clamp on the live engine
(execution/utils/ga_deal_calculator.py).

The score-curve and ROI-cap surface (raw_opportunity_score, cap_roi,
ROI_SCORE_CAP, ROI_SANITY_CEILING) is locked directly in
tests/test_ga_deal_calculator.py; this file pins the one behavioral emit-time
clamp that a parcel-level metrics run must enforce.

Pure financial math — no API keys / network required.
"""
import execution.utils.ga_deal_calculator as ga


class TestGaRoiPercentClampedAtEmit:
    def test_ga_emit_clamps_over_200(self):
        # A residential parcel whose post-rehab ROI exceeds 200 must emit <=200.
        # tiny tax_due + big spread -> raw ROI well over 200.
        prop = {"tax_due": 200, "sqft": 1500, "year_built": 1990}
        m = ga.calculate_deal_metrics(prop, arv=300000, comp_count=8)
        if m["roi_percent"] is not None:
            assert m["roi_percent"] <= 200.0
