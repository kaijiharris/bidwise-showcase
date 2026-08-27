"""Canonical Top-Deals gate: unified ROI >= 100 bar + confidence requirements.

Operator decision 2026-07-17: the public "Top Deal" label requires ROI in
[TOP_DEAL_MIN_ROI, TOP_DEAL_MAX_ROI] on a rankable parcel whose valuation is
evidence-backed — comps-based ARV (not the assessor fallback/guard), at least
TOP_DEAL_MIN_COMPS comps behind it, and not the LOW dispersion tier. Clients
render the pipeline-stamped `top_deal` flag because arv_source is server-only,
so stamp_top_deals() is part of the public contract. Mirrored by
web/lib/topDeals.ts and the mobile feed — keep all three in sync.
"""

from execution.utils.auction_index import summarize_results
from execution.utils.top_deals import (
    POSSIBLE_DEAL_MIN_ROI,
    TOP_DEAL_MAX_ROI,
    TOP_DEAL_MIN_COMPS,
    TOP_DEAL_MIN_ROI,
    is_confident_valuation,
    is_rankable,
    is_top_deal,
    stamp_top_deals,
)


def _sfr(**overrides):
    """A confident, high-ROI residential record; override fields per test."""
    base = {
        "property_type": "SFR",
        "roi_percent": 150.0,
        "estimate_only": False,
        "is_no_bid": False,
        "arv_confidence": "HIGH",
        "arv_source": "zillow_comps",
        "comps_used_for_arv": 6,
        "comp_count": 9,
    }
    return {**base, **overrides}


class TestIsRankable:
    def test_trustworthy_sfr_is_rankable(self):
        assert is_rankable(_sfr()) is True

    def test_missing_roi_not_rankable(self):
        assert is_rankable(_sfr(roi_percent=None)) is False

    def test_estimate_only_not_rankable(self):
        assert is_rankable(_sfr(estimate_only=True)) is False

    def test_no_bid_not_rankable(self):
        assert is_rankable(_sfr(is_no_bid=True)) is False

    def test_estimate_only_arv_tier_not_rankable(self):
        assert is_rankable(_sfr(arv_confidence="ESTIMATE_ONLY")) is False

    def test_vacant_land_not_rankable(self):
        assert is_rankable(_sfr(property_type="Vacant Land")) is False

    def test_legacy_record_without_trust_fields_is_rankable(self):
        # Pre-Wave datasets stay DISPLAYABLE — rankable does not require the
        # confidence evidence, only is_top_deal does.
        assert is_rankable({"property_type": "SFR", "roi_percent": 72.0}) is True


class TestConfidenceGate:
    """is_confident_valuation — the evidence half of the Top-Deal label."""

    def test_assessor_fallback_arv_never_tops(self):
        r = _sfr(arv_source="assessor_appraisal_fallback")
        assert is_rankable(r) is True          # still displayed
        assert is_top_deal(r) is False         # never "Top"

    def test_assessor_arv_guard_never_tops(self):
        # The guard replaced a comps ARV that failed the sanity check — the
        # evidence conflicted, so the parcel cannot carry the confident label.
        assert is_top_deal(_sfr(arv_source="assessor_appraisal_arv_guard")) is False

    def test_thin_comps_never_top(self):
        assert is_top_deal(_sfr(comps_used_for_arv=TOP_DEAL_MIN_COMPS - 1)) is False
        assert is_top_deal(_sfr(comps_used_for_arv=TOP_DEAL_MIN_COMPS)) is True

    def test_comp_count_fallback_when_comps_used_missing(self):
        assert is_top_deal(_sfr(comps_used_for_arv=None, comp_count=5)) is True
        assert is_top_deal(_sfr(comps_used_for_arv=None, comp_count=2)) is False

    def test_low_dispersion_tier_never_tops(self):
        assert is_top_deal(_sfr(arv_confidence="LOW")) is False
        assert is_top_deal(_sfr(arv_confidence="MEDIUM")) is True

    def test_absent_tier_with_comp_evidence_tops(self):
        # Pre-Wave-2 records lack arv_confidence entirely; the comps + source
        # clauses carry the confidence load there.
        assert is_top_deal(_sfr(arv_confidence=None)) is True

    def test_over_clamp_roi_is_an_artifact_never_a_top_deal(self):
        # 482/346%-style values only exist on records predating the Wave-1 A5
        # clamp — "artifacts, not returns".
        assert is_top_deal(_sfr(roi_percent=482.0)) is False
        assert is_top_deal(_sfr(roi_percent=TOP_DEAL_MAX_ROI)) is True

    def test_legacy_record_without_comp_fields_never_tops(self):
        # Confident label REQUIRES evidence — a record with no comp fields at
        # all stays rankable/displayable but can never be "Top".
        legacy = {"property_type": "SFR", "roi_percent": 150.0}
        assert is_rankable(legacy) is True
        assert is_confident_valuation(legacy) is False
        assert is_top_deal(legacy) is False


class TestIsTopDeal:
    def test_public_bar_is_100(self):
        # Pin the operator decision (2026-07-17). Changing this constant is a
        # product decision, not a refactor.
        assert TOP_DEAL_MIN_ROI == 100.0

    def test_threshold_boundary_inclusive(self):
        assert is_top_deal(_sfr(roi_percent=TOP_DEAL_MIN_ROI)) is True
        assert is_top_deal(_sfr(roi_percent=TOP_DEAL_MIN_ROI - 0.1)) is False

    def test_untrustworthy_high_roi_never_a_top_deal(self):
        assert is_top_deal(_sfr(roi_percent=150.0, is_no_bid=True)) is False

    def test_possible_band_bound_below_top_band(self):
        assert POSSIBLE_DEAL_MIN_ROI < TOP_DEAL_MIN_ROI


class TestStampTopDeals:
    def test_stamps_verdicts_and_returns_new_records(self):
        originals = [
            _sfr(),                                          # top
            _sfr(roi_percent=72.0),                          # below the bar
            _sfr(arv_source="assessor_appraisal_fallback"),  # not confident
        ]
        stamped = stamp_top_deals(originals)
        assert [r["top_deal"] for r in stamped] == [True, False, False]
        # Pure: inputs untouched, outputs are new dicts.
        assert all("top_deal" not in r for r in originals)
        assert all(s is not o for s, o in zip(stamped, originals))

    def test_restamping_is_idempotent(self):
        stamped = stamp_top_deals([_sfr()])
        assert [r["top_deal"] for r in stamp_top_deals(stamped)] == [True]


class TestIndexCountUsesConfidentGate:
    """The auction index "{n} Top Deals" badge counts only confident tops."""

    def test_untrustworthy_and_unconfident_parcels_excluded(self):
        results = [
            _sfr(),                                              # counts
            _sfr(roi_percent=72.0),                              # below the 100 bar
            _sfr(roi_percent=482.0),                             # over-clamp artifact
            _sfr(arv_source="assessor_appraisal_arv_guard"),     # conflicted ARV
            _sfr(comps_used_for_arv=1, comp_count=1),            # thin comps
            _sfr(arv_confidence="ESTIMATE_ONLY", deal_score=0.0,
                 max_bid=None, recommended_max_bid=None),        # thin-comp tier
            _sfr(is_no_bid=True, deal_score=0.0,
                 max_bid=None, recommended_max_bid=None),        # guardrail
        ]
        type_counts, top_deals = summarize_results(results)
        assert top_deals == 1
        assert type_counts["residential"] == 7

    def test_land_and_no_roi_still_excluded(self):
        # Regression guard for the original PR #16 exclusions.
        results = [
            {"property_type": "Vacant Land", "roi_percent": 150.0,
             "estimate_only": True},                                   # land: never
            _sfr(estimate_only=True, roi_percent=140.0),               # estimate-only
            {"property_type": "Commercial", "roi_percent": None},      # no ROI
        ]
        type_counts, top_deals = summarize_results(results)
        assert top_deals == 0
        assert type_counts == {"residential": 1, "multi_family": 0,
                               "commercial": 1, "land": 1}
