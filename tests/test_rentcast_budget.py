"""Unit tests for the RentCast monthly-call guard (no network)."""
import json
from pathlib import Path

import pytest

from execution.utils import rentcast_budget as rb


@pytest.fixture
def usage(tmp_path, monkeypatch):
    """Point the counter at a temp file with a small limit for fast thresholds."""
    f = tmp_path / "rentcast_usage.json"
    monkeypatch.setenv("RENTCAST_USAGE_FILE", str(f))
    monkeypatch.setenv("RENTCAST_MONTHLY_LIMIT", "10")
    monkeypatch.delenv("RENTCAST_BUDGET_OVERRIDE", raising=False)
    return f


def test_fresh_usage_is_zero(usage):
    u = rb.get_usage()
    assert u.count == 0
    assert u.remaining == 10
    assert u.pct == 0.0


def test_record_call_increments_and_persists(usage):
    rb.record_call()
    rb.record_call()
    assert rb.get_usage().count == 2
    assert json.loads(Path(usage).read_text())["count"] == 2


def test_check_budget_allows_under_threshold(usage):
    rb.record_call()  # 1/10 = 10%
    assert rb.check_budget() is True


def test_check_budget_blocks_at_90_percent(usage):
    for _ in range(9):  # 9/10 = 90%
        rb.record_call()
    assert rb.check_budget() is False


def test_override_forces_past_block(usage, monkeypatch):
    for _ in range(10):  # 10/10 = 100%
        rb.record_call()
    monkeypatch.setenv("RENTCAST_BUDGET_OVERRIDE", "1")
    assert rb.check_budget() is True


def test_stale_month_resets_counter(usage):
    Path(usage).write_text(json.dumps({"month": "2000-01", "count": 99}))
    assert rb.get_usage().count == 0  # prior month ignored → fresh tally


def test_corrupt_file_fails_safe_to_zero(usage):
    Path(usage).write_text("not json {{{")
    assert rb.get_usage().count == 0
    assert rb.check_budget() is True
