#!/usr/bin/env python3
"""Fail when supabase/migrations/ has duplicate or malformed numeric prefixes.

Why: in 2026-07 two parallel branches each merged migrations numbered 016 and
020 (016_qr_affiliates_and_vendors vs 016_tax_sale_snapshot_source_ref;
020_deal_engine_confidence_fields vs 020_tax_sale_monitor_runs). Duplicate
prefixes make apply order ambiguous and would choke `supabase db push`. The
duplicates were renumbered to 023/024 on 2026-07-17; this guard keeps the
mistake from recurring. Every migration must be NNN_description.sql with a
unique three-digit prefix. Stdlib-only. Exit 0 = clean, exit 1 = violations.
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
PREFIX_RE = re.compile(r"^(\d{3})_")


def main() -> int:
    sql_files = sorted(path.name for path in MIGRATIONS_DIR.glob("*.sql"))
    if not sql_files:
        print(f"ERROR: no .sql files found in {MIGRATIONS_DIR}", file=sys.stderr)
        return 1

    by_prefix = defaultdict(list)
    malformed = []
    for name in sql_files:
        match = PREFIX_RE.match(name)
        if match is None:
            malformed.append(name)
        else:
            by_prefix[match.group(1)].append(name)

    duplicates = {p: names for p, names in by_prefix.items() if len(names) > 1}
    for name in malformed:
        print(f"MALFORMED: {name} (expected NNN_description.sql)", file=sys.stderr)
    for prefix, names in sorted(duplicates.items()):
        print(f"DUPLICATE prefix {prefix}: {', '.join(names)}", file=sys.stderr)
    if malformed or duplicates:
        return 1

    print(f"OK: {len(sql_files)} migrations, prefixes unique and well-formed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
