"""map_property contract: pipeline guardrail/trust signals must reach Supabase.

Regression suite for the data-contract gap where deal_score / roi_pct flowed to
the `properties` table but the screening signals (is_no_bid, no_bid_reason,
estimate_only, score_tier, analysis_notes) and the redemption dual-ROI
(roi_if_redeemed_year1_pct / roi_if_deed_matures) were silently dropped.
Consumers (Flutter feed, web dashboard Supabase path) read those columns to
suppress NO-BID and estimate-only parcels — a NULL there must mean "pipeline
never screened this row", never "screened and passed" (migrations 020 + 022).

Pure mapping tests — no network, no Supabase credentials required.
"""
import os

# push_to_supabase validates env at import time (sys.exit(1) when missing).
# These tests never touch the network, so dummy values are fine — but they must
# be set BEFORE the module import below. setdefault keeps real .env values.
os.environ.setdefault("SUPABASE_URL", "https://test-project.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from execution.push_to_supabase import map_property  # noqa: E402

BATCH_ID = "00000000-0000-0000-0000-000000000000"


def _land_no_bid_raw() -> dict:
    """Shape mirrors a real Clayton land parcel from web/data/clayton.json:
    estimate_only land that the guardrail also screened out (flood zone)."""
    return {
        "tax_id": "13-1234-05-006",
        "full_address": "0 SOMEWHERE RD, Jonesboro, GA 30236",
        "city": "Jonesboro",
        "zip_code": "30236",
        "property_type": "Land",
        "tax_due": 5000.0,
        "deal_score": 0.0,
        "roi_percent": -63.2,
        "estimate_only": True,
        "is_no_bid": True,
        "no_bid_reason": "flood zone",
        "score_tier": None,
        "analysis_notes": "Vacant land — heuristic value only | flood zone",
        "roi_if_redeemed_year1_pct": 20.0,
        "roi_if_deed_matures": 41.7,
        "arv_confidence": "MEDIUM",
    }


class TestGuardrailFieldMapping:
    def test_no_bid_and_estimate_only_flags_reach_payload(self):
        mapped = map_property(_land_no_bid_raw(), "clayton", BATCH_ID)
        assert mapped["is_no_bid"] is True
        assert mapped["no_bid_reason"] == "flood zone"
        assert mapped["estimate_only"] is True

    def test_score_tier_and_analysis_notes_mapped(self):
        raw = {
            **_land_no_bid_raw(),
            "is_no_bid": False,
            "no_bid_reason": None,
            "score_tier": "PROMISING",
        }
        mapped = map_property(raw, "clayton", BATCH_ID)
        assert mapped["score_tier"] == "PROMISING"
        assert mapped["analysis_notes"].startswith("Vacant land")
        assert mapped["is_no_bid"] is False
        assert mapped["no_bid_reason"] is None

    def test_redemption_dual_roi_mapped_as_floats(self):
        mapped = map_property(_land_no_bid_raw(), "clayton", BATCH_ID)
        assert mapped["roi_if_redeemed_year1_pct"] == 20.0
        assert mapped["roi_if_deed_matures"] == 41.7

    def test_legacy_rows_map_to_none_not_false(self):
        # Pre-guardrail archives lack the flags entirely — the upsert must
        # write NULL ("unknown"), never a fabricated False/True.
        legacy = {"tax_id": "15-001-01-001", "address": "1 LEGACY LN", "tax_due": 1000}
        mapped = map_property(legacy, "dekalb", BATCH_ID)
        assert mapped["is_no_bid"] is None
        assert mapped["estimate_only"] is None
        assert mapped["no_bid_reason"] is None
        assert mapped["score_tier"] is None
        assert mapped["analysis_notes"] is None
        assert mapped["roi_if_redeemed_year1_pct"] is None
        assert mapped["roi_if_deed_matures"] is None

    def test_blank_strings_normalise_to_null(self):
        # Several pipeline scripts stamp analysis_notes='' — store NULL, not
        # empty strings, so SQL/PostgREST "is null" filters stay meaningful.
        raw = {**_land_no_bid_raw(), "analysis_notes": "   ", "no_bid_reason": ""}
        mapped = map_property(raw, "clayton", BATCH_ID)
        assert mapped["analysis_notes"] is None
        assert mapped["no_bid_reason"] is None

    def test_numeric_flags_coerce_to_strict_booleans(self):
        # Some archives serialise flags as 0/1 — the columns are BOOLEAN.
        raw = {**_land_no_bid_raw(), "is_no_bid": 1, "estimate_only": 0}
        mapped = map_property(raw, "clayton", BATCH_ID)
        assert mapped["is_no_bid"] is True
        assert mapped["estimate_only"] is False

    def test_garbage_roi_if_values_map_to_none(self):
        raw = {**_land_no_bid_raw(), "roi_if_redeemed_year1_pct": "n/a"}
        mapped = map_property(raw, "clayton", BATCH_ID)
        assert mapped["roi_if_redeemed_year1_pct"] is None


class TestExistingBehaviourPins:
    def test_missing_parcel_id_still_skips_record(self):
        assert map_property({"address": "nowhere"}, "cobb", BATCH_ID) == {}

    def test_batch_stays_unpublished_on_push(self):
        mapped = map_property(_land_no_bid_raw(), "clayton", BATCH_ID)
        assert mapped["published"] is False
        assert mapped["batch_id"] == BATCH_ID


class TestCanonicalCountyCasing:
    """county must match the exact strings clients filter with (county=eq.X):
    web DashboardClient COUNTIES, mobile filter chips, run_ga_county
    display_name. str.title() broke DeKalb -> 'Dekalb' and hid every pushed
    row from those queries."""

    def test_dekalb_keeps_interior_capital(self):
        mapped = map_property(_land_no_bid_raw(), "dekalb", BATCH_ID)
        assert mapped["county"] == "DeKalb"

    def test_plain_counties_title_case(self):
        assert map_property(_land_no_bid_raw(), "gwinnett", BATCH_ID)["county"] == "Gwinnett"
        assert map_property(_land_no_bid_raw(), "cobb", BATCH_ID)["county"] == "Cobb"

    def test_canonical_county_helper_is_case_insensitive(self):
        from execution.push_to_supabase import canonical_county

        assert canonical_county("DEKALB") == "DeKalb"
        assert canonical_county("dekalb") == "DeKalb"
        # Unknown future county falls back to title-case.
        assert canonical_county("fulton") == "Fulton"
