"""
Unit tests for the tiered comp store of record (execution/utils/comps_cache).

Locks the 2026-07-12 recycling policy: comps <=90d reuse freely (FRESH),
91-180d reuse with an age flag (AGED), >180d eligible for refresh (STALE);
a fresh scrape is justified only when no stored pool clears the usable-comp
floor. All disk I/O goes to tmp_path — no network, no real store.
"""
import json
from datetime import datetime, timedelta

import pytest

from execution.utils import comps_cache as cs
from execution.utils.confidence_tier import demote_for_pool_age


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Isolated store dir with the tiered policy active (no TTL override)."""
    monkeypatch.delenv("COMPS_CACHE_TTL_DAYS", raising=False)
    monkeypatch.delenv("COMPS_REFRESH_FLOOR", raising=False)
    monkeypatch.setenv("COMP_STORE_DIR", str(tmp_path / "store"))
    monkeypatch.setattr(cs, "LEGACY_CACHE_DIR", tmp_path / "legacy")
    return tmp_path / "store"


def _comps(n, price=250000):
    return [
        {"address": f"{i} Test St, Decatur, GA", "sale_price": price + i,
         "bedrooms": 3, "bathrooms": 2, "sqft": 1500, "source": "RentCast"}
        for i in range(n)
    ]


def _write(store_dir, source, city, state, items, age_days, tag=None):
    """Write a store entry with a back-dated fetched_at."""
    store_dir.mkdir(parents=True, exist_ok=True)
    slug = f"{city}-{state}".lower().replace(" ", "-")
    (store_dir / f"{source}_{slug}.json").write_text(
        json.dumps({
            "fetched_at": (datetime.now() - timedelta(days=age_days)).isoformat(),
            "source": tag or source,
            "items": items,
        }),
        encoding="utf-8",
    )


# ── Tier boundaries (90 / 180 day edges) ───────────────────────────────────────

class TestTierBoundaries:
    @pytest.mark.parametrize("age,expected", [
        (0, cs.TIER_FRESH),
        (89.9, cs.TIER_FRESH),
        (90.0, cs.TIER_FRESH),      # inclusive: <=90 is fresh
        (90.1, cs.TIER_AGED),
        (179.9, cs.TIER_AGED),
        (180.0, cs.TIER_AGED),      # inclusive: <=180 is still reusable
        (180.1, cs.TIER_STALE),
        (365, cs.TIER_STALE),
    ])
    def test_tier_for_age(self, age, expected):
        assert cs.tier_for_age(age) == expected

    def test_load_entry_reports_fresh_tier(self, store):
        _write(store, "rentcast", "decatur", "ga", _comps(5), age_days=10)
        entry = cs.load_entry("rentcast", "Decatur", "GA")
        assert entry.tier == cs.TIER_FRESH
        assert entry.age_days == 10

    def test_load_entry_reports_aged_tier(self, store):
        _write(store, "rentcast", "decatur", "ga", _comps(5), age_days=120)
        assert cs.load_entry("rentcast", "Decatur", "GA").tier == cs.TIER_AGED

    def test_load_entry_reports_stale_tier(self, store):
        _write(store, "rentcast", "decatur", "ga", _comps(5), age_days=200)
        assert cs.load_entry("rentcast", "Decatur", "GA").tier == cs.TIER_STALE

    def test_stale_pool_is_not_served(self, store):
        _write(store, "rentcast", "decatur", "ga", _comps(5), age_days=200)
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is None

    def test_aged_pool_is_served(self, store):
        _write(store, "rentcast", "decatur", "ga", _comps(5), age_days=120)
        items = cs.load_cached_items("rentcast", "Decatur", "GA")
        assert items is not None and len(items) == 5


# ── Refresh-floor logic ────────────────────────────────────────────────────────

class TestRefreshFloor:
    def test_pool_below_floor_is_not_served(self, store):
        _write(store, "rentcast", "decatur", "ga", _comps(2), age_days=1)
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is None
        assert cs.load_best_entry("Decatur", "GA") is None

    def test_pool_at_floor_is_served(self, store):
        _write(store, "rentcast", "decatur", "ga", _comps(3), age_days=1)
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is not None
        assert cs.load_best_entry("Decatur", "GA") is not None

    def test_unpriced_comps_do_not_count_toward_floor(self, store):
        junk = [{"address": "x", "sale_price": None}] * 5
        _write(store, "rentcast", "decatur", "ga", junk + _comps(2), age_days=1)
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is None

    def test_floor_env_override(self, store, monkeypatch):
        monkeypatch.setenv("COMPS_REFRESH_FLOOR", "5")
        _write(store, "rentcast", "decatur", "ga", _comps(4), age_days=1)
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is None
        monkeypatch.setenv("COMPS_REFRESH_FLOOR", "4")
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is not None

    def test_usable_count_handles_raw_zillow_items(self):
        raw = [
            {"price": 300000},                       # flat
            {"price": {"value": 250000}},            # nested dict
            {"soldPrice": 200000},                   # alternate key
            {"price": 0},                            # zero -> unusable
            {"address": "no price"},                 # missing -> unusable
            "not-a-dict",                            # garbage -> unusable
        ]
        assert cs.usable_comp_count(raw) == 3


# ── Source tagging + best-entry selection ──────────────────────────────────────

class TestSourceTaggingAndSelection:
    def test_save_round_trips_source_tag(self, store):
        cs.save_cached_items("homeharvest", "Decatur", "GA", _comps(4))
        entry = cs.load_entry("homeharvest", "Decatur", "GA")
        assert entry.source == "homeharvest"

    def test_zip_keyed_entry_is_separate_from_city(self, store):
        cs.save_cached_items("apify", "Decatur", "GA", _comps(4))
        assert cs.load_entry("apify", "Decatur", "GA", zip_code="30032") is None
        cs.save_cached_items("apify", "Decatur", "GA", _comps(6), zip_code="30032")
        assert len(cs.load_entry("apify", "Decatur", "GA", zip_code="30032").items) == 6
        assert len(cs.load_entry("apify", "Decatur", "GA").items) == 4

    def test_fresher_tier_wins_regardless_of_source_order(self, store):
        _write(store, "apify", "decatur", "ga", _comps(5), age_days=120)       # aged
        _write(store, "homeharvest", "decatur", "ga", _comps(5), age_days=5)   # fresh
        assert cs.load_best_entry("Decatur", "GA").source == "homeharvest"

    def test_cost_order_breaks_tier_ties(self, store):
        # Both fresh: the already-bought apify pool outranks homeharvest.
        _write(store, "homeharvest", "decatur", "ga", _comps(5), age_days=5)
        _write(store, "apify", "decatur", "ga", _comps(5), age_days=10)
        assert cs.load_best_entry("Decatur", "GA").source == "apify"

    def test_best_entry_skips_stale_and_thin_pools(self, store):
        _write(store, "apify", "decatur", "ga", _comps(9), age_days=200)       # stale
        _write(store, "homeharvest", "decatur", "ga", _comps(2), age_days=5)   # thin
        _write(store, "rentcast", "decatur", "ga", _comps(3), age_days=150)    # aged, ok
        best = cs.load_best_entry("Decatur", "GA")
        assert best.source == "rentcast" and best.tier == cs.TIER_AGED


# ── TTL override + resilience ──────────────────────────────────────────────────

class TestOverridesAndResilience:
    def test_ttl_zero_bypasses_store_entirely(self, store, monkeypatch):
        _write(store, "rentcast", "decatur", "ga", _comps(5), age_days=1)
        monkeypatch.setenv("COMPS_CACHE_TTL_DAYS", "0")
        assert cs.load_entry("rentcast", "Decatur", "GA") is None
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is None
        cs.save_cached_items("rentcast", "Elsewhere", "GA", _comps(5))
        monkeypatch.delenv("COMPS_CACHE_TTL_DAYS")
        assert cs.load_entry("rentcast", "Elsewhere", "GA") is None  # never written

    def test_ttl_override_acts_as_hard_ttl(self, store, monkeypatch):
        _write(store, "rentcast", "decatur", "ga", _comps(5), age_days=6)
        monkeypatch.setenv("COMPS_CACHE_TTL_DAYS", "7")
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is not None
        monkeypatch.setenv("COMPS_CACHE_TTL_DAYS", "5")
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is None

    def test_corrupt_entry_returns_none_never_raises(self, store):
        store.mkdir(parents=True, exist_ok=True)
        (store / "rentcast_decatur-ga.json").write_text("not json {{{", encoding="utf-8")
        assert cs.load_entry("rentcast", "Decatur", "GA") is None
        assert cs.load_cached_items("rentcast", "Decatur", "GA") is None

    def test_legacy_tmp_cache_entry_is_adopted(self, store, tmp_path):
        legacy = tmp_path / "legacy"
        legacy.mkdir(parents=True)
        (legacy / "apify_decatur-ga.json").write_text(
            json.dumps({"fetched_at": datetime.now().isoformat(), "items": _comps(5)}),
            encoding="utf-8",
        )
        entry = cs.load_entry("apify", "Decatur", "GA")
        assert entry is not None and len(entry.items) == 5
        # adopted into the durable store, not just read through
        assert (store / "apify_decatur-ga.json").exists()


# ── Confidence-tier integration (aged pools demote HIGH one notch) ─────────────

class TestAgedPoolConfidenceDemotion:
    @pytest.mark.parametrize("tier,pool_age,expected", [
        ("HIGH", "aged", "MEDIUM"),        # the one demotion the policy makes
        ("HIGH", "fresh", "HIGH"),
        ("HIGH", None, "HIGH"),
        ("MEDIUM", "aged", "MEDIUM"),      # already <= MEDIUM: stands as graded
        ("LOW", "aged", "LOW"),
        ("ESTIMATE_ONLY", "aged", "ESTIMATE_ONLY"),
    ])
    def test_demote_for_pool_age(self, tier, pool_age, expected):
        assert demote_for_pool_age(tier, pool_age) == expected
