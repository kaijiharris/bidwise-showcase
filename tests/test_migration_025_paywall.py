"""Static guards for migration 025 (paywall-bypass close).

The 2026-07-17 database review found that any active subscriber could read
unmasked financials straight from PostgREST: visible_properties selected r.*
with `locked` merely advisory, and the security_invoker chain (004/014) forced
table-level SELECT on `properties` for every caller of the _safe view.
Migration 025 collapses the two views into one masked definer view and closes
the direct-table surface.

These tests parse the migration SQL as text — no database required — and pin
the security contract into CI so a later migration or edit cannot silently
regress it. (Migration-number uniqueness itself is enforced separately by
scripts/check_migration_numbers.py in CI.)
"""
import re
from pathlib import Path

import pytest

MIGRATIONS_DIR = Path(__file__).parent.parent / "supabase" / "migrations"

# Every financial column the tier paywall sells. Each must be NULLed on locked
# rows inside the view body.
MASKED_FINANCIAL_COLUMNS = [
    "tax_due",
    "arv",
    "rehab_cost",
    "all_in_cost",
    "net_profit",
    "roi_pct",
    "max_bid",
    "risk_score",
    "crime_score",
    "flood_zone",
    "comp_count",
    "arv_confidence",
    "roi_if_redeemed_year1_pct",
    "roi_if_deed_matures",
    "analysis_notes",
]

# Trust / operational signals that must stay visible on locked rows.
# auction_status + removed_at are the 025 LOW-finding fix: without them the
# dashboard's Supabase path defaults every row to 'active' and the
# "Removed — unlock refunded" badge can never fire.
ALWAYS_VISIBLE_COLUMNS = [
    "score_tier",
    "is_no_bid",
    "no_bid_reason",
    "estimate_only",
    "auction_status",
    "removed_at",
]

# Columns web/app/api/export/route.ts selects by name from the view. If one
# disappears from the view, every export 400s.
EXPORT_ROUTE_COLUMNS = [
    "id", "parcel_id", "county", "address", "city", "state", "zip",
    "property_type", "beds", "baths", "sqft", "year_built", "lot_size",
    "auction_date", "min_bid", "deal_score", "tax_due", "arv", "rehab_cost",
    "all_in_cost", "net_profit", "roi_pct", "max_bid", "risk_score",
    "crime_score", "flood_zone", "comp_count", "arv_confidence", "batch_id",
    "locked",
]


@pytest.fixture(scope="module")
def migration_025_text() -> str:
    """Full text of the (single) 025 migration file."""
    matches = sorted(MIGRATIONS_DIR.glob("025_*.sql"))
    assert len(matches) == 1, (
        f"expected exactly one 025_*.sql migration, found "
        f"{[m.name for m in matches]}"
    )
    return matches[0].read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def migration_025_sql(migration_025_text: str) -> str:
    """Migration text with `--` comments stripped (header/rollback prose
    mentions the old objects, which would false-positive the negative
    assertions below)."""
    return "\n".join(
        line.split("--", 1)[0] for line in migration_025_text.splitlines()
    )


def test_unmasked_base_view_dropped_and_never_recreated(migration_025_sql: str) -> None:
    assert re.search(
        r"DROP VIEW IF EXISTS public\.visible_properties\s*;", migration_025_sql
    ), "025 must drop the unmasked visible_properties view"
    # (?!_safe) so the legitimate CREATE of visible_properties_safe passes.
    assert not re.search(
        r"CREATE\s+(OR REPLACE\s+)?VIEW\s+(public\.)?visible_properties(?!_safe)",
        migration_025_sql,
    ), "the unmasked base view must not come back"
    assert not re.search(
        r"GRANT\s+SELECT\s+ON\s+public\.visible_properties\s+TO",
        migration_025_sql,
    ), "no grant may reference the dropped base view"


def test_safe_view_is_definer_with_security_barrier(migration_025_sql: str) -> None:
    assert re.search(
        r"CREATE VIEW public\.visible_properties_safe\s*"
        r"WITH \(security_invoker = off, security_barrier = on\)",
        migration_025_sql,
    ), "visible_properties_safe must be a definer view with security_barrier"
    # A regression to invoker semantics silently re-requires table-level
    # SELECT on properties for every caller — the exact hole 025 closes.
    assert not re.search(
        r"security_invoker\s*=\s*(on|true)", migration_025_sql
    ), "025 must never set security_invoker back on"


def test_every_financial_column_masked_when_locked(migration_025_sql: str) -> None:
    for col in MASKED_FINANCIAL_COLUMNS:
        pattern = (
            rf"CASE WHEN v\.locked THEN NULL ELSE v\.{col}\s+END AS {col}\b"
        )
        assert re.search(pattern, migration_025_sql), (
            f"financial column {col!r} must be NULLed on locked rows"
        )


def test_operational_columns_stay_visible_when_locked(migration_025_sql: str) -> None:
    for col in ALWAYS_VISIBLE_COLUMNS:
        assert re.search(rf"v\.{col}\b", migration_025_sql), (
            f"column {col!r} missing from the view entirely"
        )
        assert not re.search(
            rf"CASE WHEN v\.locked THEN NULL ELSE v\.{col}\b", migration_025_sql
        ), f"operational column {col!r} must not be masked on locked rows"


def test_direct_table_surface_closed(migration_025_sql: str) -> None:
    assert re.search(
        r'DROP POLICY IF EXISTS "Subscribers see published properties"'
        r"\s+ON public\.properties",
        migration_025_sql,
    ), "the tier-blind subscriber SELECT policy must be dropped"
    assert re.search(
        r"REVOKE ALL ON public\.properties FROM anon, authenticated",
        migration_025_sql,
    ), "client roles must lose ALL table privileges on properties (not just SELECT)"
    assert not re.search(
        r"GRANT\s+(ALL|SELECT)\s+ON\s+public\.properties\b", migration_025_sql
    ), "025 must not re-grant the properties table to anyone"


def test_safe_view_grants_pinned(migration_025_sql: str) -> None:
    assert re.search(
        r"REVOKE ALL ON public\.visible_properties_safe FROM PUBLIC, anon, authenticated",
        migration_025_sql,
    ), "default-privilege auto-grants on the new view must be cleared"
    assert re.search(
        r"GRANT SELECT ON public\.visible_properties_safe TO authenticated",
        migration_025_sql,
    ), "authenticated keeps SELECT on the masked view"


def test_export_route_columns_survive(migration_025_sql: str) -> None:
    for col in EXPORT_ROUTE_COLUMNS:
        assert re.search(rf"v\.{col}\b", migration_025_sql), (
            f"web/app/api/export/route.ts selects {col!r} by name; "
            "dropping it from the view breaks every CSV export"
        )
