"""Tests for execution/parse_fulton.py's pure parsing core.

Fixture: tests/fixtures/fulton_ocr_aug4.txt — the REAL OCR output captured from
the Aug-4-2026 Fulton levy-sale PDF during the 2026-07-19 spike (pages 1–5 from
the plain 300-dpi OCR pass; page 6 from the THRESHOLDED pass, because that is
what the production pipeline always feeds tesseract and only the thresholded
image recovers the JUDICIAL FORECLOSURE banner). No network, no OCR tools —
these tests exercise text → records only.
"""
import json
from pathlib import Path

import pytest

from execution.parse_fulton import (
    PARCEL_RE,
    build_records,
    canonical_parcel,
    collapse_check_digit_variants,
    extract_sale_date,
    normalize_ocr_text,
    parse_pdf_pages,
    parse_pdf_text,
    parse_rows,
    split_sections,
)

FIXTURE = Path(__file__).parent / "fixtures" / "fulton_ocr_aug4.txt"
# Dual-pass fixture: [{"raw": ..., "thresh": ...}] per page, both passes real
# tesseract output captured from the Aug-4-2026 PDF (2026-07-19/20 spikes).
PAGES_FIXTURE = Path(__file__).parent / "fixtures" / "fulton_ocr_aug4_pages.json"

# The 9 judicial-foreclosure parcels on the Aug-4 list (rows after the banner),
# as printed — these must NEVER appear in the tax output.
JUDICIAL_PARCELS = {
    "13-0133-LL-394-1",
    "14-0212-0006-006-6",
    "17-0111-0005-377-7",
    "17-0038-LL-176-9",
    "07-0500-0143-096-6",
    "17-0023-0003-129-1",
    "17-0035-LL-513-6",
    "17-0048-0003-336-3",
    "14-0184-0001-053-7",
}


@pytest.fixture(scope="module")
def ocr_text() -> str:
    return FIXTURE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def parsed(ocr_text):
    """(tax_records, judicial_records, auction_date) for the real fixture."""
    return parse_pdf_text(ocr_text, None)


def test_sale_date_extracted_from_page_one(ocr_text):
    assert extract_sale_date(ocr_text) == "2026-08-04"


def test_date_override_wins(ocr_text):
    _, _, date = parse_pdf_text(ocr_text, "2026-09-01")
    assert date == "2026-09-01"


def test_judicial_split_yields_exactly_nine_judicial_rows(parsed):
    _, judicial, _ = parsed
    assert {r["parcel_id"] for r in judicial} == JUDICIAL_PARCELS


def test_tax_section_volume_matches_spike_measurement(parsed):
    tax, _, _ = parsed
    # Spike measured 142 unique parcels incl. judicial → ~133 tax. OCR noise
    # tolerance: never fewer than 125, and never a judicial leak.
    assert len(tax) >= 125
    assert not JUDICIAL_PARCELS & {r["parcel_id"] for r in tax}


def test_known_tax_rows_parse_with_address_and_sale_id(parsed):
    tax, _, _ = parsed
    by_parcel = {r["parcel_id"]: r for r in tax}
    row = by_parcel["11-0161-0079-075-0"]
    assert row["sale_id"] == "0826-57091"
    assert row["address"] == "465 NORTH PINE DR"
    assert row["auction_date"] == "2026-08-04"


def test_district_letter_and_O_misread_normalized(parsed):
    tax, _, _ = parsed
    parcels = {r["parcel_id"] for r in tax}
    # Printed as 'O9F-0400-0038-254-0' in the raw OCR (letter O) — must land
    # canonically under district 09F.
    assert "09F-0400-0038-254-0" in parcels
    assert not any(p.startswith("O") for p in parcels)


def test_land_lot_LL_parcels_canonicalized(parsed):
    tax, _, _ = parsed
    parcels = {r["parcel_id"] for r in tax}
    # Printed '13 -0097- LL-169-1' (loose spacing) on the list.
    assert "13-0097-LL-169-1" in parcels


def test_orphaned_sale_number_rows_still_parse(parsed):
    _, judicial, _ = parsed
    # '17-0035-LL-513-6 901 ABERNATHY RD, UNIT 3290' OCRs with its sale number
    # on a separate line — the parcel row must survive with sale_id=None.
    row = next(r for r in judicial if r["parcel_id"] == "17-0035-LL-513-6")
    assert row["sale_id"] is None
    assert "ABERNATHY" in row["address"]


def test_missing_banner_refuses_to_publish(ocr_text):
    tax_only = split_sections(normalize_ocr_text(ocr_text))[0]
    with pytest.raises(RuntimeError, match="DO NOT PUBLISH"):
        parse_pdf_text(tax_only, None)


def test_split_sections_returns_none_not_empty_when_banner_absent():
    tax, judicial = split_sections("0826-11111 14 -0001-0001-001-1 1 MAIN ST")
    assert judicial is None
    assert "MAIN ST" in tax


def test_parse_rows_dedupes_and_skips_headers():
    text = (
        "SALE NUMBER TAX PARCEL ID SITUS\n"
        "0826-11111 14 -0001-0001-001-1 1 MAIN ST\n"
        "0826-11111 14 -0001-0001-001-1 1 MAIN ST\n"
    )
    rows = parse_rows(text)
    assert len(rows) == 1
    assert rows[0]["parcel_id"] == "14-0001-0001-001-1"


def test_records_schema_matches_directive_standard(parsed):
    tax, _, _ = parsed
    rec = tax[0]
    for key in ("county", "tax_id", "parcel_id", "address", "city", "tax_due",
                "min_bid", "auction_date", "source", "raw_text"):
        assert key in rec
    assert rec["county"] == "Fulton"
    assert rec["tax_due"] is None  # Fulton lists print no amounts
    assert rec["source"] == "fulton_sheriff_pdf"


def test_parcel_regex_tolerates_spacing_variants():
    for raw, want in [
        ("11 -0161-0079-075-0", "11-0161-0079-075-0"),
        ("09F-3602-0130-116-8", "09F-3602-0130-116-8"),
        ("13 -0097- LL-169-1", "13-0097-LL-169-1"),
        ("17-0038-LL-176-9", "17-0038-LL-176-9"),
    ]:
        m = PARCEL_RE.search(raw)
        assert m, raw
        assert canonical_parcel(m) == want


def test_normalize_only_touches_district_position():
    assert normalize_ocr_text("O9F-0400-0038-254-0") == "09F-0400-0038-254-0"
    # Letter O elsewhere (addresses, words) must be untouched.
    assert normalize_ocr_text("465 NORTH PINE DR") == "465 NORTH PINE DR"
    assert normalize_ocr_text("OCGA O.C.G.A.") == "OCGA O.C.G.A."


def test_build_records_carries_sale_id_and_raw_text():
    rows = [{"sale_id": "0826-57091", "parcel_id": "11-0161-0079-075-0",
             "address": "465 NORTH PINE DR",
             "raw_text": "0826-57091 11 -0161-0079-075-0 465 NORTH PINE DR"}]
    recs = build_records(rows, "2026-08-04")
    assert recs[0]["sale_id"] == "0826-57091"
    assert recs[0]["raw_text"].startswith("0826-57091")


# ── Dual-pass (production path) ──────────────────────────────────────────────

@pytest.fixture(scope="module")
def dual_parsed():
    pages = [
        (p["raw"], p["thresh"])
        for p in json.loads(PAGES_FIXTURE.read_text(encoding="utf-8"))
    ]
    return parse_pdf_pages(pages, None)


def test_dual_pass_recovers_threshold_destroyed_rows(dual_parsed):
    tax, _, date = dual_parsed
    assert date == "2026-08-04"
    parcels = {r["parcel_id"] for r in tax}
    # Measured on this PDF: thresh-only = 126, raw adds back the destroyed
    # rows → union must clear 140. Known thresh-lost parcels must be present.
    assert len(tax) >= 140
    assert "14F-0143-LL-100-2" in parcels
    assert "09F-0400-0038-254-0" in parcels


def test_dual_pass_judicial_set_still_exact(dual_parsed):
    _, judicial, _ = dual_parsed
    assert {r["parcel_id"] for r in judicial} == JUDICIAL_PARCELS


def test_dual_pass_no_judicial_leak_into_tax(dual_parsed):
    tax, _, _ = dual_parsed
    tax_prefixes = {r["parcel_id"].rsplit("-", 1)[0] for r in tax}
    judicial_prefixes = {p.rsplit("-", 1)[0] for p in JUDICIAL_PARCELS}
    assert not tax_prefixes & judicial_prefixes


def test_dual_pass_collapses_check_digit_disagreements(dual_parsed):
    tax, _, _ = dual_parsed
    # Raw pass reads 07-3607-0067-012-1, thresh pass 07-3607-0067-012-4 for
    # the same address — exactly one survives, and it's the raw reading.
    variants = [r for r in tax if r["parcel_id"].startswith("07-3607-0067-012")]
    assert len(variants) == 1
    assert variants[0]["parcel_id"] == "07-3607-0067-012-1"


def test_collapse_dedupes_on_prefix_keeping_first_row():
    # Same prefix = same physical parcel (check digit is derived), even when a
    # degraded pass lost the address — only the first (raw-pass) row survives.
    rows = [
        {"sale_id": None, "parcel_id": "14-0001-0001-001-1", "address": "1 MAIN ST",
         "raw_text": "a"},
        {"sale_id": None, "parcel_id": "14-0001-0001-001-9", "address": "",
         "raw_text": "b"},
        {"sale_id": None, "parcel_id": "14-0002-0001-001-9", "address": "2 OAK AVE",
         "raw_text": "c"},
    ]
    collapsed = collapse_check_digit_variants(rows)
    assert [r["raw_text"] for r in collapsed] == ["a", "c"]
