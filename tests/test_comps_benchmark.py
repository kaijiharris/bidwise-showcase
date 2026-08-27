"""
Unit tests for the pure metric functions in execution/benchmark_comps_sources.py.

The benchmark justifies the comps fallback chain, so the measuring instrument
itself must be trustworthy: address joining, date parsing, and pool scoring
are locked here with synthetic comps. No network, no API keys.
"""
from datetime import datetime

from execution.benchmark_comps_sources import (
    _norm_addr_key,
    _parse_sale_date,
    address_overlaps,
    pool_metrics,
)


class TestNormAddrKey:
    def test_joins_on_street_and_zip_despite_formatting(self):
        a = _norm_addr_key("905 Strawberry Dr, Ellenwood, GA 30294")
        b = _norm_addr_key("905  Strawberry Dr., Ellenwood GA 30294-1234")
        assert a == b == "905 STRAWBERRY DR|30294"

    def test_different_streets_do_not_collide(self):
        assert _norm_addr_key("1 Main St, Decatur, GA 30030") != \
               _norm_addr_key("2 Main St, Decatur, GA 30030")

    def test_garbage_returns_none(self):
        assert _norm_addr_key(None) is None
        assert _norm_addr_key("") is None
        assert _norm_addr_key(", , ") is None


class TestParseSaleDate:
    def test_epoch_ms_epoch_s_and_iso_agree(self):
        iso = _parse_sale_date("2026-07-01T00:00:00.000Z")
        assert iso is not None and (iso.year, iso.month, iso.day) == (2026, 7, 1)
        ms = _parse_sale_date(1782964800000)   # 2026-07-01/02 (tz-dependent)
        s = _parse_sale_date(1782964800)
        assert ms == s and ms.year == 2026 and ms.month == 7

    def test_unparseable_returns_none(self):
        assert _parse_sale_date(None) is None
        assert _parse_sale_date("not-a-date") is None


class TestPoolMetrics:
    def test_scores_pool_with_medians_and_engine_arv(self):
        now = datetime(2026, 7, 4)
        comps = [
            {"address": "1 A St, Decatur, GA 30030", "sale_price": 300000, "sqft": 1500,
             "bedrooms": 3, "bathrooms": 2, "sale_date": "2026-06-04T00:00:00Z"},
            {"address": "2 B St, Decatur, GA 30030", "sale_price": 330000, "sqft": 1500,
             "bedrooms": 3, "bathrooms": 2, "sale_date": "2026-05-04T00:00:00Z"},
            {"address": "3 C St, Decatur, GA 30030", "sale_price": 360000, "sqft": 1500,
             "bedrooms": 3, "bathrooms": 2, "sale_date": "2026-04-04T00:00:00Z"},
        ]
        m = pool_metrics(comps, now=now)
        assert m["n_comps"] == 3
        assert m["pct_with_price"] == m["pct_with_sqft"] == 100.0
        assert m["median_price"] == 330000
        assert m["median_ppsf"] == 220.0             # 330000 / 1500
        assert m["median_age_days"] == 61            # the 2026-05-04 comp
        assert m["engine_arv"] is not None           # real engine ran
        assert m["engine_pool_quality"] != "NO_DATA"

    def test_empty_pool_scores_safely(self):
        m = pool_metrics([])
        assert m["n_comps"] == 0
        assert m["median_price"] is None
        assert m["engine_arv"] is None
        assert m["engine_pool_quality"] == "NO_DATA"


class TestAddressOverlaps:
    def test_matches_same_address_and_computes_delta(self):
        sold = [{"address": "1 Main St, Decatur, GA 30030", "sale_price": 300000}]
        listed = [
            {"address": "1 Main St., Decatur GA 30030", "sale_price": 309000},
            {"address": "9 Other Rd, Decatur, GA 30030", "sale_price": 500000},
        ]
        matches = address_overlaps(sold, listed)
        assert len(matches) == 1
        assert matches[0]["delta_pct"] == 3.0        # (309000-300000)/300000

    def test_no_overlap_returns_empty(self):
        assert address_overlaps(
            [{"address": "1 A St, X, GA 30030", "sale_price": 1}],
            [{"address": "2 B St, X, GA 30030", "sale_price": 1}],
        ) == []
