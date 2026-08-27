"""Shared pytest fixtures for BidWise tests."""
import os
import sys
import tempfile
import warnings
from pathlib import Path

import pytest

# Ensure project root is on the path for all tests
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Disable the comps disk cache for the whole test session — mocked fetches must
# never write real cache files, and cached files must never satisfy a test that
# expects a live-fetch code path (2026-07-05: a mock-data cache file leaked into
# .tmp/comps_cache and broke the quota-error test).
os.environ["COMPS_CACHE_TTL_DAYS"] = "0"

# Redirect the RentCast call counter to a throwaway temp file so the suite's
# mocked fetches never touch the real .api_usage/ tally (2026-07-05), and RESET
# that file at session start: record_call() persists it across pytest runs, so
# the count otherwise accumulates until it crosses the 90% budget block and the
# RentCast fallback tests start getting refusals (observed 2026-07-17 at
# {"month": "2026-07", "count": 45} after repeated local runs; CI never sees it
# because each runner gets a fresh temp dir). Only OUR throwaway default is ever
# deleted — any pre-set RENTCAST_USAGE_FILE with a different value is honored
# untouched.
_RENTCAST_TEST_USAGE_FILE = Path(tempfile.gettempdir()) / "pytest_rentcast_usage.json"
if os.environ.setdefault(
    "RENTCAST_USAGE_FILE", str(_RENTCAST_TEST_USAGE_FILE)
) == str(_RENTCAST_TEST_USAGE_FILE):
    try:
        _RENTCAST_TEST_USAGE_FILE.unlink(missing_ok=True)
    except OSError as e:
        # A transiently locked counter file (concurrent pytest run, AV scan) must
        # not fail collection for the whole session — skipping the reset merely
        # reverts that one run to the old accumulating behavior. Same non-fatal
        # treatment record_call() gives this file.
        warnings.warn(f"could not reset RentCast test counter {_RENTCAST_TEST_USAGE_FILE}: {e}")

# Load .env so API keys are available for integration tests (optional —
# financial-math unit tests do not need it).
try:
    import dotenv

    dotenv.load_dotenv(PROJECT_ROOT / ".env")
except Exception:
    pass


@pytest.fixture
def sfr_property():
    """Single-family residential property with known sqft/year_built.

    year_built=1995 → age 31 yrs → medium rehab rate ($55/sqft).
    """
    return {
        "tax_id": "06-280-06-039",
        "full_address": "3050 BERNAUER TRCE, Dunwoody, GA 30338",
        "tax_due": 15000.0,
        "sqft": 2000,
        "year_built": 1995,
        "appraised_value": 120000,
        "property_type": "Residential",
    }


@pytest.fixture
def sfr_property_no_sqft():
    """Residential property without sqft — forces the conservative rehab fallback."""
    return {
        "tax_id": "06-999-00-001",
        "full_address": "123 UNKNOWN ST, Decatur, GA 30030",
        "tax_due": 8000.0,
        "sqft": None,
        "year_built": None,
        "appraised_value": 0,
        "property_type": "Residential",
    }


@pytest.fixture
def land_property():
    """Vacant land — no structure, no rehab, lot-value valuation."""
    return {
        "tax_id": "06-555-00-007",
        "full_address": "0 BACK LOT RD, Decatur, GA 30032",
        "tax_due": 5000.0,
        "sqft": None,
        "year_built": None,
        "appraised_value": 10000,
        "property_type": "Land",
    }


@pytest.fixture
def commercial_property():
    """Commercial property — must NOT run the residential ROI model."""
    return {
        "tax_id": "06-777-00-003",
        "full_address": "3416 BLACKBURN WAY, Atlanta, GA 30340",
        "tax_due": 25000.0,
        "sqft": 5000,
        "year_built": 1990,
        "appraised_value": 900000,
        "property_type": "Commercial",
    }


@pytest.fixture
def residential_comps():
    """Three same-size residential comps (median ppsf = $150/sqft)."""
    return [
        {"sale_price": 300000, "sqft": 2000, "bedrooms": 3},
        {"sale_price": 320000, "sqft": 2100, "bedrooms": 3},
        {"sale_price": 280000, "sqft": 1900, "bedrooms": 3},
    ]
