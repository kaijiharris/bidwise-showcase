"""
Unit tests for the HomeHarvest $0 comps client (no network — scrape mocked).

Locks the defensive contract: HomeHarvest is scraper-class (realtor.com 403
windows are an expected failure mode), so every failure path must return []
and let the chain degrade — never raise into a run. Also locks the canonical
comp mapping and the comp-store write with source tagging.
"""
import pandas as pd
import pytest

import execution.enrichment.homeharvest_comps as hh_mod
from execution.enrichment.homeharvest_comps import HomeHarvestComps
from execution.utils import comps_cache as cs


ROWS = [
    {
        "full_street_line": "12 Harvest Ln", "city": "Decatur", "state": "GA",
        "zip_code": "30030", "sold_price": 315000.0, "list_price": 320000.0,
        "last_sold_date": "2026-05-20", "beds": 3.0, "full_baths": 2.0,
        "sqft": 1700.0, "year_built": 1995.0,
        "latitude": 33.77, "longitude": -84.29,
    },
    {   # no sold price, list_price fallback
        "full_street_line": "34 Fallback Dr", "city": "Decatur", "state": "GA",
        "zip_code": "30030", "sold_price": float("nan"), "list_price": 289000.0,
        "last_sold_date": "2026-04-02", "beds": 4.0, "full_baths": 2.0,
        "sqft": 1900.0, "year_built": 2001.0,
        "latitude": 33.78, "longitude": -84.30,
    },
    {   # third valid row — keeps the pool at the usable-comp floor (3)
        "full_street_line": "56 Third St", "city": "Decatur", "state": "GA",
        "zip_code": "30032", "sold_price": 240000.0, "list_price": 245000.0,
        "last_sold_date": "2026-06-10", "beds": 3.0, "full_baths": 1.0,
        "sqft": 1300.0, "year_built": 1972.0,
        "latitude": 33.74, "longitude": -84.27,
    },
    {   # stray row from a neighboring market — must be filtered out
        "full_street_line": "9 Stray Ct", "city": "Avondale Estates", "state": "GA",
        "zip_code": "30002", "sold_price": 260000.0, "list_price": 260000.0,
        "last_sold_date": "2026-03-15", "beds": 3.0, "full_baths": 2.0,
        "sqft": 1500.0, "year_built": 1980.0,
        "latitude": 33.76, "longitude": -84.26,
    },
    {   # unpriced row — must be dropped
        "full_street_line": "77 NoPrice Way", "city": "Decatur", "state": "GA",
        "zip_code": "30030", "sold_price": float("nan"), "list_price": float("nan"),
        "last_sold_date": "2026-02-01", "beds": 2.0, "full_baths": 1.0,
        "sqft": 900.0, "year_built": 1950.0,
        "latitude": 33.77, "longitude": -84.29,
    },
]


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Isolated store with the tiered policy active."""
    monkeypatch.delenv("COMPS_CACHE_TTL_DAYS", raising=False)
    monkeypatch.setenv("COMP_STORE_DIR", str(tmp_path / "store"))
    monkeypatch.setattr(cs, "LEGACY_CACHE_DIR", tmp_path / "legacy")
    return tmp_path / "store"


@pytest.fixture
def client(monkeypatch):
    """HomeHarvest client with the pip package faked as importable."""
    monkeypatch.setattr(hh_mod, "HOMEHARVEST_AVAILABLE", True)
    return HomeHarvestComps()


def _mock_scrape(monkeypatch, df=None, exc=None):
    calls = {"n": 0}

    def fake_scrape(**kwargs):
        calls["n"] += 1
        if exc:
            raise exc
        return df

    monkeypatch.setattr(hh_mod, "scrape_property", fake_scrape, raising=False)
    return calls


class TestMapping:
    def test_maps_rows_to_canonical_comps(self, store, client, monkeypatch):
        _mock_scrape(monkeypatch, pd.DataFrame(ROWS))
        comps = client.get_sold_properties(city="Decatur", state_code="GA")
        assert len(comps) == 3  # stray-city + unpriced rows dropped
        c = comps[0]
        assert c["address"] == "12 Harvest Ln, Decatur, GA 30030"
        assert c["sale_price"] == 315000.0
        assert c["sale_date"] == "2026-05-20"
        assert (c["bedrooms"], c["bathrooms"], c["sqft"]) == (3.0, 2.0, 1700.0)
        assert c["source"] == "HomeHarvest"
        # list_price stands in when sold_price is NaN
        assert comps[1]["sale_price"] == 289000.0

    def test_bedroom_filter_applies(self, store, client, monkeypatch):
        _mock_scrape(monkeypatch, pd.DataFrame(ROWS))
        comps = client.get_sold_properties(city="Decatur", state_code="GA", bedrooms=3)
        # beds 3, 4 and 3 are all within ±1 of 3 → kept
        assert len(comps) == 3
        comps = client.get_sold_properties(city="Decatur", state_code="GA", bedrooms=5)
        assert [c["bedrooms"] for c in comps] == [4.0]


class TestFailureDegradation:
    def test_scrape_exception_returns_empty_never_raises(self, store, client, monkeypatch):
        _mock_scrape(monkeypatch, exc=RuntimeError("403 Forbidden — WAF window"))
        assert client.get_sold_properties(city="Decatur", state_code="GA") == []

    def test_empty_dataframe_returns_empty(self, store, client, monkeypatch):
        _mock_scrape(monkeypatch, pd.DataFrame())
        assert client.get_sold_properties(city="Decatur", state_code="GA") == []

    def test_init_raises_cleanly_when_package_missing(self, monkeypatch):
        monkeypatch.setattr(hh_mod, "HOMEHARVEST_AVAILABLE", False)
        with pytest.raises(ValueError):
            HomeHarvestComps()


class TestStoreIntegration:
    def test_results_saved_with_homeharvest_source_tag(self, store, client, monkeypatch):
        _mock_scrape(monkeypatch, pd.DataFrame(ROWS))
        client.get_sold_properties(city="Decatur", state_code="GA")
        entry = cs.load_entry("homeharvest", "Decatur", "GA")
        assert entry is not None
        assert entry.source == "homeharvest"
        assert all(c["source"] == "HomeHarvest" for c in entry.items)

    def test_second_call_serves_store_without_scraping(self, store, client, monkeypatch):
        calls = _mock_scrape(monkeypatch, pd.DataFrame(ROWS))
        client.get_sold_properties(city="Decatur", state_code="GA")
        client.get_sold_properties(city="Decatur", state_code="GA")
        assert calls["n"] == 1  # store served the repeat — $0 and no scrape

    def test_empty_results_are_not_cached(self, store, client, monkeypatch):
        calls = _mock_scrape(monkeypatch, pd.DataFrame())
        client.get_sold_properties(city="Decatur", state_code="GA")
        assert cs.load_entry("homeharvest", "Decatur", "GA") is None
