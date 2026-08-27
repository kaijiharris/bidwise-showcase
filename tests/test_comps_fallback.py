"""
Tests for the Stage-4 comps fallback chain in execution/run_ga_county.py.

Locks the 2026-07-02 incident fix: when the Apify token died, the pipeline
silently produced 0 comps / $0 land values / deal_score 0 and wrote
normal-looking output. Now:
  - Apify error OR 0 comps → ordered fallback chain (RapidAPI if RAPIDAPI_KEY,
    then RentCast if RENTCAST_API_KEY)
  - every property is tagged comp_source: apify | rapidapi | rentcast | none
  - a failed comps fetch marks the run DEGRADED (caller exits 2 and skips
    the dashboard JSON / auction index writes)

Also locks RentCastComps' response-field mapping (camelCase listing fields →
pipeline comp dicts). All clients/HTTP are mocked — no network, no API keys.
"""
import pytest

import execution.run_ga_county as run_ga_county
from execution.run_ga_county import (
    FALLBACK_WINDOW_MONTHS,
    _fetch_comps_with_fallback,
    analyze_properties,
)


APIFY_COMPS = [
    {"address": "1 Apify St, Decatur, GA 30030", "sale_price": 300000,
     "sqft": 2000, "bedrooms": 3, "bathrooms": 2, "source": "Zillow Scraper"},
    {"address": "3 Apify Ave, Decatur, GA 30030", "sale_price": 280000,
     "sqft": 1900, "bedrooms": 3, "bathrooms": 2, "source": "Zillow Scraper"},
]

FALLBACK_COMPS = [
    {"address": "2 Fallback Rd, Decatur, GA 30030", "sale_price": 290000,
     "sqft": 1950, "bedrooms": 3, "bathrooms": 2, "source": "RentCast"},
]


class FakeApify:
    """Mimics ApifyZillowComps.get_sold_properties → (comps, window_months)."""

    def __init__(self, comps=None, window=12, exc=None):
        self.comps = comps if comps is not None else []
        self.window = window
        self.exc = exc
        self.calls = 0

    def get_sold_properties(self, city, state_code, **kwargs):
        self.calls += 1
        if self.exc:
            raise self.exc
        return self.comps, self.window


class FakeFallback:
    """Mimics RapidAPIComps / RentCastComps .get_sold_properties → List[Dict]."""

    def __init__(self, comps=None, exc=None):
        self.comps = comps if comps is not None else []
        self.exc = exc
        self.calls = 0

    def get_sold_properties(self, city, state_code, **kwargs):
        self.calls += 1
        if self.exc:
            raise self.exc
        return self.comps


# ── _fetch_comps_with_fallback ──────────────────────────────────────────────────

class TestFetchCompsWithFallback:
    def test_apify_healthy_no_fallback_call(self):
        fb = FakeFallback(FALLBACK_COMPS)
        comps, window, source, failed, _meta = _fetch_comps_with_fallback(
            "Decatur", "GA", FakeApify(APIFY_COMPS, window=12), [("rentcast", fb)]
        )
        assert (comps, window, source, failed) == (APIFY_COMPS, 12, "apify", False)
        assert fb.calls == 0  # fallback must not burn quota when Apify works

    def test_apify_exception_falls_back(self):
        comps, window, source, failed, _meta = _fetch_comps_with_fallback(
            "Decatur", "GA", FakeApify(exc=RuntimeError("token dead")),
            [("rentcast", FakeFallback(FALLBACK_COMPS))],
        )
        assert (comps, window, source, failed) == (
            FALLBACK_COMPS, FALLBACK_WINDOW_MONTHS, "rentcast", False
        )

    def test_apify_failure_sentinel_falls_back(self):
        # ApifyZillowComps swallows API errors and returns ([], 0) — the
        # exact silent-degradation path from the 2026-07-02 incident.
        comps, window, source, failed, _meta = _fetch_comps_with_fallback(
            "Decatur", "GA", FakeApify([], window=0),
            [("rentcast", FakeFallback(FALLBACK_COMPS))],
        )
        assert (comps, source, failed) == (FALLBACK_COMPS, "rentcast", False)

    def test_chain_order_second_fallback_rescues(self):
        # RapidAPI armed but failing → RentCast (next in chain) rescues.
        rapid = FakeFallback(exc=RuntimeError("quota"))
        rent  = FakeFallback(FALLBACK_COMPS)
        comps, window, source, failed, _meta = _fetch_comps_with_fallback(
            "Decatur", "GA", FakeApify([], window=0),
            [("rapidapi", rapid), ("rentcast", rent)],
        )
        assert (comps, source, failed) == (FALLBACK_COMPS, "rentcast", False)
        assert rapid.calls == 1 and rent.calls == 1

    def test_first_fallback_wins_chain_stops(self):
        rapid = FakeFallback(FALLBACK_COMPS)
        rent  = FakeFallback(FALLBACK_COMPS)
        comps, window, source, failed, _meta = _fetch_comps_with_fallback(
            "Decatur", "GA", FakeApify(exc=RuntimeError("dead")),
            [("rapidapi", rapid), ("rentcast", rent)],
        )
        assert source == "rapidapi"
        assert rent.calls == 0  # chain must stop at the first rescue

    def test_apify_failed_no_fallbacks_is_degraded(self):
        for empty in (None, []):
            comps, window, source, failed, _meta = _fetch_comps_with_fallback(
                "Decatur", "GA", FakeApify(exc=RuntimeError("token dead")), empty
            )
            assert (comps, window, source, failed) == ([], 0, "none", True)

    def test_all_sources_fail_is_degraded(self):
        comps, window, source, failed, _meta = _fetch_comps_with_fallback(
            "Decatur", "GA",
            FakeApify([], window=0),
            [("rapidapi", FakeFallback(exc=RuntimeError("quota"))),
             ("rentcast", FakeFallback([]))],
        )
        assert (comps, source, failed) == ([], "none", True)

    def test_legit_empty_market_is_not_degraded(self):
        # Apify succeeded (window sentinel != 0) but the market has no sales:
        # not a fetch failure, so no per-city degradation.
        comps, window, source, failed, _meta = _fetch_comps_with_fallback(
            "Decatur", "GA", FakeApify([], window=24),
            [("rentcast", FakeFallback([]))],
        )
        assert (comps, source, failed) == ([], "none", False)


# ── analyze_properties: comp_source tagging + degraded detection ───────────────

class FakeEnricher:
    def get_specs(self, tax_id, address, city):
        return {
            "sqft": 1500, "beds": 3, "baths": 2, "year_built": 1990,
            "appraised_value": 150000,
            "data_source": "fake", "data_confidence": "HIGH",
        }


@pytest.fixture(autouse=True)
def fake_enricher(monkeypatch):
    monkeypatch.setattr(run_ga_county, "_load_enricher", lambda key: FakeEnricher())


def _residential_prop():
    return {
        "tax_id": "06-000-00-001",
        "full_address": "123 MAIN ST, Decatur, GA 30030",
        "tax_due": 8000.0,
        "city": "Decatur",
    }


class TestAnalyzePropertiesCompSource:
    def test_apify_healthy_tags_apify(self):
        results, _, degraded = analyze_properties(
            [_residential_prop()], "dekalb", FakeApify(APIFY_COMPS)
        )
        assert results[0]["comp_source"] == "apify"
        assert degraded == []

    def test_apify_dead_fallback_rescues_and_tags_source(self):
        results, _, degraded = analyze_properties(
            [_residential_prop()], "dekalb",
            FakeApify(exc=RuntimeError("token dead")),
            [("rentcast", FakeFallback(FALLBACK_COMPS))],
        )
        assert results[0]["comp_source"] == "rentcast"
        assert results[0]["comp_count"] == len(FALLBACK_COMPS)
        assert degraded == []

    def test_apify_dead_no_fallback_marks_run_degraded(self):
        results, _, degraded = analyze_properties(
            [_residential_prop()], "dekalb",
            FakeApify(exc=RuntimeError("token dead")),
        )
        assert results[0]["comp_source"] == "none"
        assert degraded == ["Decatur"]
        # ARV must fall back to the assessor value, flagged as such
        assert results[0]["arv_source"] == "assessor_appraisal_fallback"

    def test_all_cities_zero_comps_is_degraded_even_without_sentinel(self):
        # Incident signature: every city 0 comps. Apify "succeeded" (window 24)
        # but the whole run is comp-less — must still refuse to publish.
        results, _, degraded = analyze_properties(
            [_residential_prop()], "dekalb", FakeApify([], window=24)
        )
        assert results[0]["comp_source"] == "none"
        assert degraded == ["Decatur"]

    def test_commercial_skips_fetch_and_tags_none(self):
        apify = FakeApify(APIFY_COMPS)
        prop = {**_residential_prop(), "property_type": "Commercial"}
        results, _, degraded = analyze_properties([prop], "dekalb", apify)
        assert results[0]["comp_source"] == "none"
        assert apify.calls == 0
        assert degraded == []  # no fetch attempted → nothing degraded

    def test_city_fetch_is_cached_across_properties(self):
        apify = FakeApify(APIFY_COMPS)
        props = [_residential_prop(), {**_residential_prop(), "tax_id": "06-000-00-002"}]
        results, _, _ = analyze_properties(props, "dekalb", apify)
        assert apify.calls == 1
        assert [r["comp_source"] for r in results] == ["apify", "apify"]


# ── RentCastComps: response-field mapping (HTTP mocked) ─────────────────────────

RENTCAST_LISTING = {
    "formattedAddress": "9 Rent Ct, Decatur, GA 30030",
    "addressLine1": "9 Rent Ct",
    "city": "Decatur", "state": "GA", "zipCode": "30030",
    "price": 310000,
    "status": "Inactive", "listingType": "Standard",
    "listedDate": "2026-03-01T00:00:00.000Z",
    "removedDate": "2026-05-15T00:00:00.000Z",
    "lastSeenDate": "2026-05-14T00:00:00.000Z",
    "daysOnMarket": 75,
    "squareFootage": 1850, "bedrooms": 3, "bathrooms": 2.0,
    "yearBuilt": 1998, "propertyType": "Single Family", "lotSize": 8000,
}


class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


@pytest.fixture
def rentcast_client(monkeypatch):
    monkeypatch.setenv("RENTCAST_API_KEY", "test-key-not-real")
    from execution.enrichment.rentcast_comps import RentCastComps
    return RentCastComps()


class TestRentCastComps:
    def test_maps_camelcase_listing_to_pipeline_comp(self, monkeypatch, rentcast_client):
        monkeypatch.setattr(
            "execution.enrichment.rentcast_comps.requests.get",
            lambda *a, **kw: _FakeResponse(200, [RENTCAST_LISTING]),
        )
        comps = rentcast_client.get_sold_properties(city="Decatur", state_code="GA")
        assert len(comps) == 1
        c = comps[0]
        assert c["address"] == "9 Rent Ct, Decatur, GA 30030"
        assert c["sale_price"] == 310000            # price → sale_price proxy
        assert c["sale_date"] == "2026-05-15T00:00:00.000Z"  # removedDate wins
        assert (c["sqft"], c["bedrooms"], c["bathrooms"]) == (1850, 3, 2.0)
        assert c["year_built"] == 1998
        assert c["source"] == "RentCast"

    def test_drops_listings_without_price(self, monkeypatch, rentcast_client):
        no_price = {**RENTCAST_LISTING, "price": None}
        monkeypatch.setattr(
            "execution.enrichment.rentcast_comps.requests.get",
            lambda *a, **kw: _FakeResponse(200, [no_price, RENTCAST_LISTING]),
        )
        comps = rentcast_client.get_sold_properties(city="Decatur", state_code="GA")
        assert len(comps) == 1

    def test_auth_or_quota_error_returns_empty(self, monkeypatch, rentcast_client):
        monkeypatch.setattr(
            "execution.enrichment.rentcast_comps.requests.get",
            lambda *a, **kw: _FakeResponse(401, {"error": "invalid key"}),
        )
        assert rentcast_client.get_sold_properties(city="Decatur", state_code="GA") == []

    def test_missing_key_raises(self, monkeypatch):
        monkeypatch.delenv("RENTCAST_API_KEY", raising=False)
        from execution.enrichment.rentcast_comps import RentCastComps
        with pytest.raises(ValueError):
            RentCastComps()


# ── 2026-07-12 recycling layer: cost-ordered chain + comp store first ───────────

HH_COMPS = [
    {"address": f"{i} Harvest Ln, Decatur, GA 30030", "sale_price": 250000 + i,
     "sqft": 1600, "bedrooms": 3, "bathrooms": 2, "source": "HomeHarvest"}
    for i in range(4)
]


class TestFreeLayerOrdering:
    """HomeHarvest ($0) must be tried BEFORE any fresh Apify spend."""

    def test_free_layer_serves_before_apify(self):
        apify = FakeApify(APIFY_COMPS)
        hh = FakeFallback(HH_COMPS)
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", apify, None, [("homeharvest", hh)]
        )
        assert source == "homeharvest"
        assert comps == HH_COMPS
        assert apify.calls == 0          # $0 layer served — no paid sweep
        assert failed is False
        assert meta["store_hit"] is False and meta["tier"] == "fresh"

    def test_free_layer_crash_degrades_to_apify(self):
        apify = FakeApify(APIFY_COMPS)
        hh = FakeFallback(exc=RuntimeError("realtor.com 403 storm"))
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", apify, None, [("homeharvest", hh)]
        )
        assert (source, failed) == ("apify", False)
        assert hh.calls == 1 and apify.calls == 1

    def test_free_layer_empty_degrades_to_apify(self):
        apify = FakeApify(APIFY_COMPS)
        hh = FakeFallback([])
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", apify, None, [("homeharvest", hh)]
        )
        assert source == "apify"

    def test_budget_blocked_apify_degrades_to_rentcast(self):
        # ApifyZillowComps returns its ([], 0) sentinel when the budget guard
        # refuses a fresh sweep — the metered fallback must still rescue.
        apify = FakeApify([], window=0)
        hh = FakeFallback([])
        rent = FakeFallback(FALLBACK_COMPS)
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", apify, [("rentcast", rent)], [("homeharvest", hh)]
        )
        assert (comps, source, failed) == (FALLBACK_COMPS, "rentcast", False)

    def test_everything_dry_is_degraded(self):
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", FakeApify([], window=0),
            [("rentcast", FakeFallback([]))],
            [("homeharvest", FakeFallback(exc=RuntimeError("403")))],
        )
        assert (comps, source, failed) == ([], "none", True)


class TestCompStoreFirst:
    """Layer 0: a reusable stored pool costs $0 and short-circuits all clients."""

    @pytest.fixture
    def store(self, tmp_path, monkeypatch):
        from execution.utils import comps_cache as cs
        monkeypatch.delenv("COMPS_CACHE_TTL_DAYS", raising=False)
        monkeypatch.setenv("COMP_STORE_DIR", str(tmp_path / "store"))
        monkeypatch.setattr(cs, "LEGACY_CACHE_DIR", tmp_path / "legacy")
        return tmp_path / "store"

    @staticmethod
    def _write(store_dir, source, items, age_days, city="decatur", state="ga"):
        import json
        from datetime import datetime, timedelta
        store_dir.mkdir(parents=True, exist_ok=True)
        (store_dir / f"{source}_{city}-{state}.json").write_text(
            json.dumps({
                "fetched_at": (datetime.now() - timedelta(days=age_days)).isoformat(),
                "source": source,
                "items": items,
            }),
            encoding="utf-8",
        )

    def test_fresh_stored_pool_serves_without_any_client_call(self, store):
        self._write(store, "homeharvest", HH_COMPS, age_days=10)
        apify = FakeApify(APIFY_COMPS)
        hh = FakeFallback(exc=RuntimeError("must not be called"))
        rent = FakeFallback(exc=RuntimeError("must not be called"))
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", apify, [("rentcast", rent)], [("homeharvest", hh)]
        )
        assert source == "homeharvest"
        assert len(comps) == len(HH_COMPS)
        assert apify.calls == 0 and hh.calls == 0 and rent.calls == 0
        assert meta["store_hit"] is True and meta["tier"] == "fresh"
        assert failed is False

    def test_aged_stored_pool_serves_with_aged_flag(self, store):
        self._write(store, "rentcast", HH_COMPS, age_days=120)
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", FakeApify(APIFY_COMPS), None, None
        )
        assert source == "rentcast"
        assert meta["tier"] == "aged" and meta["age_days"] == 120
        assert meta["store_hit"] is True

    def test_stale_stored_pool_triggers_fresh_fetch(self, store):
        self._write(store, "homeharvest", HH_COMPS, age_days=200)
        apify = FakeApify(APIFY_COMPS)
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", apify, None, None
        )
        assert source == "apify" and apify.calls == 1
        assert meta["store_hit"] is False

    def test_thin_stored_pool_triggers_refresh_floor(self, store):
        self._write(store, "homeharvest", HH_COMPS[:2], age_days=5)  # < floor of 3
        apify = FakeApify(APIFY_COMPS)
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", apify, None, None
        )
        assert source == "apify" and apify.calls == 1

    def test_raw_apify_pool_routes_through_apify_client(self, store):
        raw = [{"price": 300000 + i} for i in range(5)]  # raw Zillow shape
        self._write(store, "apify", raw, age_days=30)
        apify = FakeApify(APIFY_COMPS, window=12)
        comps, window, source, failed, meta = _fetch_comps_with_fallback(
            "Decatur", "GA", apify, None, None
        )
        # The store picks the apify pool; processing runs via the apify client
        # (whose own store read costs nothing).
        assert source == "apify" and apify.calls == 1
        assert comps == APIFY_COMPS and window == 12
        assert meta["store_hit"] is True


class _FakeDataset:
    def iterate_items(self):
        return iter([])


class _FakeActor:
    def __init__(self, captured):
        self._captured = captured

    def call(self, run_input):
        self._captured.update(run_input)
        return {"defaultDatasetId": "ds1"}


class _FakeApifyClientSdk:
    def __init__(self, captured):
        self._captured = captured

    def actor(self, actor_id):
        return _FakeActor(self._captured)

    def dataset(self, dataset_id):
        return _FakeDataset()


class TestApifyPerFetchBudgetGate:
    """A fresh actor sweep re-checks the monthly budget at fetch time."""

    @pytest.fixture
    def apify_client(self, monkeypatch):
        monkeypatch.setenv("APIFY_API_KEY", "test-token-not-real")
        import execution.enrichment.apify_comps as ac
        client = ac.ApifyZillowComps()

        class _Boom:
            def actor(self, *a, **kw):
                raise AssertionError("actor must not run when the budget blocks")

        client.client = _Boom()
        return client

    def test_blocked_budget_refuses_fresh_sweep(self, monkeypatch, apify_client):
        import execution.enrichment.apify_comps as ac
        from execution.utils.apify_budget import BudgetStatus
        monkeypatch.setattr(
            ac, "check_apify_budget",
            lambda *a, **kw: BudgetStatus(False, 47.0, 49.0, 95.9),
        )
        comps, window = apify_client.get_sold_properties(city="Decatur", state_code="GA")
        assert (comps, window) == ([], 0)  # failure sentinel: chain degrades

    def test_ok_budget_runs_actor(self, monkeypatch, apify_client):
        import execution.enrichment.apify_comps as ac
        from execution.utils.apify_budget import BudgetStatus
        monkeypatch.setattr(
            ac, "check_apify_budget",
            lambda *a, **kw: BudgetStatus(True, 10.0, 49.0, 20.4),
        )
        monkeypatch.setenv("APIFY_MAX_ITEMS", "250")
        captured = {}
        apify_client.client = _FakeApifyClientSdk(captured)
        apify_client.get_sold_properties(city="Decatur", state_code="GA")
        assert captured["location"] == "Decatur, GA"
        assert captured["maxItems"] == 250

    def test_zip_scoped_sweep_uses_zip_location_and_smaller_cap(
        self, monkeypatch, apify_client
    ):
        import execution.enrichment.apify_comps as ac
        from execution.utils.apify_budget import BudgetStatus
        monkeypatch.setattr(
            ac, "check_apify_budget",
            lambda *a, **kw: BudgetStatus(True, 10.0, 49.0, 20.4),
        )
        captured = {}
        apify_client.client = _FakeApifyClientSdk(captured)
        apify_client.get_sold_properties(city="Decatur", state_code="GA", zip_code="30032")
        assert captured["location"] == "30032, GA"
        assert captured["maxItems"] == 150  # ZIP sweeps default to the cheaper cap
