"""
Fulton County Sheriff Levy-Sale PDF Parser (OCR-based)
======================================================
Parses Fulton County GA sheriff levy-sale list PDFs — the monthly first-Tuesday
sale lists posted under fultoncountyga.gov/-/media/Departments/Sheriff/Tax-Sales/.
Scope + validated recipe: directives/fulton_onboarding_scope.md (step B).

Unlike every other county, Fulton's PDFs are IMAGE-ONLY scans (zero embedded
fonts), so this parser is an OCR pipeline, not a pdfplumber one:

  1. Rasterize: poppler `pdftoppm -r 300 -png`
  2. OCR every page TWICE with tesseract `--psm 3`:
       raw pass    — best glyph fidelity on the table rows
       thresh pass — Pillow grayscale + hard threshold (v > 160). REQUIRED for
                     sectioning: only the thresholded image recovers the
                     colored `JUDICIAL FORECLOSURE LIENS SALE LIST` banner
                     (yellow); but thresholding also DESTROYS some
                     anti-aliased data rows (Aug-4-2026 list: raw pass reads
                     148 tax parcels, thresh pass alone only 126).
     Rows come from the UNION of both passes; the banner from the thresh pass.
     ⚠ NOT --psm 6: on these bordered tables psm 6 returns ONLY the page
     footer (the segmenter discards the ruled table as a graphic). Validated
     empirically 2026-07-19/20 on the real Aug-4 list.

Layout (verified on the Aug-4-2026 1st posting, 6 pages):
  Rows OCR as single lines `SALEID PARCEL SITUS`, e.g.
      0826-57091 11 -0161-0079-075-0 465 NORTH PINE DR
  Parcel forms: `11 -0161-0079-075-0` (space after district),
  `09F-3602-0130-116-8` (district letter, sometimes OCR'd as `O9F` — letter O),
  `13 -0097- LL-169-1` / `17-0038-LL-176-9` (land-lot `LL` third group).
  In the judicial section the bordered table sometimes scrambles OCR row order,
  orphaning a sale number from its parcel line → sale_id is OPTIONAL per row.

TAX-ONLY GATE (correctness gate — scope risk #1): the document tail is a
separate section headed by the banner `JUDICIAL FORECLOSURE LIENS SALE LIST`.
Rows BEFORE the banner are delinquent TAX liens (what we analyze); rows after
are judicial foreclosures and are EXCLUDED from the pipeline output (written to
a side file for transparency). If the banner is missing the parser refuses to
publish (exit 2) — a missing banner means the threshold step failed and the
sections cannot be told apart.

Semantics vs other counties:
  - The list prints NO amounts: tax_due/min_bid are None (opening bids are
    announced at the sale). Step C (pipeline registration) decides how ROI
    handles that; this parser's contract is parcels + addresses + sale date.
  - No owner, city, or zip on the list either. city='' → county default city
    fallback at pipeline time; the Fulton enricher fills specs from GIS.

Output (mirrors parse_clayton.py):
  1. .tmp/fulton_results/fulton_parsed_{YYYYMMDD}_{ts}.json  — pipeline input
  2. .tmp/fulton_results/fulton_judicial_{ts}.json — excluded rows
  3. .tmp/fulton_properties.json — combined directive-standard list

Run:
    python execution/parse_fulton.py path/to/sale-list.pdf
    python execution/parse_fulton.py https://.../Sheriffs-August-4-2026-...pdf
    python execution/parse_fulton.py sale.pdf --date 2026-08-04   # date override

Tool discovery (exit 2 with instructions when missing):
    pdftoppm:  $FULTON_PDFTOPPM → PATH → .tmp/poppler-24.08.0/Library/bin/
    tesseract: $FULTON_TESSERACT → PATH → C:/Program Files/Tesseract-OCR/
"""

import argparse
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("FultonParser")

PDF_CACHE_DIR = Path(".tmp/fulton")
OUTPUT_DIR = Path(".tmp/fulton_results")
COMBINED_OUTPUT = Path(".tmp/fulton_properties.json")

OCR_DPI = 300
OCR_THRESHOLD = 160  # grayscale cutoff — see module docstring step 2

# ── Pure text parsing (unit-tested against a captured OCR fixture) ───────────

SALE_ID_RE = re.compile(r"\b(\d{4}-\d{5})\b")
# Tolerates OCR spacing around dashes; groups = district / land-district /
# (sub-lot | LL) / lot / check digit.
PARCEL_RE = re.compile(
    r"\b(\d{2}[A-Z]?)\s*-\s*(\d{4})\s*-?\s*(\d{4}|LL)\s*-\s*(\d{3})\s*-\s*(\d)\b"
)
# Full phrase, matched WITHIN ONE LINE (see split_sections). Must not be
# loosened to just "JUDICIAL FORECLOSURE": the page-1 document title ends
# "…DELINQUENT TAX LIENS AND JUDICIAL FORECLOSURE", and matching that would
# classify the whole document as judicial. Only the section banner puts LIENS
# AFTER FORECLOSURE ("JUDICIAL FORECLOSURE LIENS SALE LIST").
JUDICIAL_BANNER_RE = re.compile(r"JUDICIAL\s+FORECLOSURE\s+LIENS", re.IGNORECASE)

MONTHS = {
    "JANUARY": 1, "FEBRUARY": 2, "MARCH": 3, "APRIL": 4, "MAY": 5, "JUNE": 6,
    "JULY": 7, "AUGUST": 8, "SEPTEMBER": 9, "OCTOBER": 10, "NOVEMBER": 11,
    "DECEMBER": 12,
}
SALE_DATE_RE = re.compile(
    r"\b(" + "|".join(MONTHS) + r")\s+(\d{1,2}),?\s+(20\d{2})\b", re.IGNORECASE
)

# Column-header words that survive OCR inside the judicial table.
HEADER_TOKENS = ("SALE NUMBER", "TAX PARCEL ID", "SITUS")


def normalize_ocr_text(text: str) -> str:
    """Fix the one systematic OCR misread seen on real lists: letter 'O' for
    digit '0' at the start of a district group (e.g. 'O9F-0400-…' → '09F-…')."""
    return re.sub(r"\bO(?=\d[A-Z]?\s*-)", "0", text)


def canonical_parcel(match: "re.Match[str]") -> str:
    """('11 ', '0161', '0079', '075', '0') → '11-0161-0079-075-0'."""
    return "-".join(g.strip() for g in match.groups())


def extract_sale_date(text: str) -> Optional[str]:
    """First 'MONTH D, YYYY' in the document → ISO date. Page 1 opens with
    e.g. 'AUGUST 4, 2026, SHERIFF'S LEVY SALE', so first match is the sale."""
    m = SALE_DATE_RE.search(text)
    if not m:
        return None
    month, day, year = MONTHS[m.group(1).upper()], int(m.group(2)), int(m.group(3))
    return f"{year:04d}-{month:02d}-{day:02d}"


def split_sections(text: str) -> Tuple[str, Optional[str]]:
    """(tax_section, judicial_section). judicial=None when the banner is
    absent — callers MUST treat that as a failed run (threshold regression),
    never as 'no judicial rows'. Line-anchored on purpose: a document-spanning
    regex could straddle line breaks and false-positive on title text."""
    lines = text.splitlines(keepends=True)
    for idx, line in enumerate(lines):
        if JUDICIAL_BANNER_RE.search(line):
            return "".join(lines[:idx]), "".join(lines[idx + 1:])
    return text, None


def parse_rows(section_text: str) -> List[Dict]:
    """Extract {sale_id?, parcel_id, address, raw_text} rows from one section.
    Dedupes by parcel id (first occurrence wins)."""
    rows: List[Dict] = []
    seen: set = set()
    for raw_line in section_text.splitlines():
        line = raw_line.strip()
        if not line or any(tok in line.upper() for tok in HEADER_TOKENS):
            continue
        pm = PARCEL_RE.search(line)
        if not pm:
            continue
        parcel = canonical_parcel(pm)
        if parcel in seen:
            continue
        seen.add(parcel)
        sale_m = SALE_ID_RE.search(line[: pm.start()])
        address = re.sub(r"\s+", " ", line[pm.end():]).strip(" .,|:-")
        rows.append(
            {
                "sale_id": sale_m.group(1) if sale_m else None,
                "parcel_id": parcel,
                "address": address,
                "raw_text": re.sub(r"\s+", " ", line),
            }
        )
    return rows


def build_records(rows: List[Dict], auction_date: str) -> List[Dict]:
    """Directive-standard property records (parse_clayton.py schema). Fulton's
    list prints no amounts/owner/city — see module docstring."""
    records = []
    for row in rows:
        records.append(
            {
                "county": "Fulton",
                "tax_id": row["parcel_id"],
                "parcel_id": row["parcel_id"],
                "sale_id": row["sale_id"],
                "owner_name": "",
                "full_address": row["address"],
                "address": row["address"],
                "city": "",       # not printed; enricher/pipeline default fills
                "zip_code": "",
                "tax_due": None,  # not printed on Fulton lists
                "min_bid": None,  # announced at the sale
                "fmv_pdf": None,
                "appraised_value": None,
                "tax_years": "",
                "auction_date": auction_date,
                "source": "fulton_sheriff_pdf",
                "raw_text": row["raw_text"],
            }
        )
    return records


# ── OCR shell (not unit-tested; validated against the real Aug-4 PDF) ────────

def _find_tool(env_var: str, exe_name: str, fallbacks: List[str]) -> Optional[str]:
    override = os.environ.get(env_var)
    if override and Path(override).exists():
        return override
    on_path = shutil.which(exe_name)
    if on_path:
        return on_path
    for candidate in fallbacks:
        if Path(candidate).exists():
            return candidate
    return None


def find_pdftoppm() -> Optional[str]:
    return _find_tool(
        "FULTON_PDFTOPPM",
        "pdftoppm",
        [str(Path(".tmp/poppler-24.08.0/Library/bin/pdftoppm.exe"))],
    )


def find_tesseract() -> Optional[str]:
    return _find_tool(
        "FULTON_TESSERACT",
        "tesseract",
        [r"C:\Program Files\Tesseract-OCR\tesseract.exe"],
    )


def _run_tesseract(tesseract: str, png: Path, out_base: Path) -> str:
    subprocess.run(
        [tesseract, str(png), str(out_base), "--psm", "3"],
        check=True,
        capture_output=True,
    )
    return out_base.with_suffix(".txt").read_text(encoding="utf-8", errors="replace")


def ocr_pdf(pdf_path: Path, pdftoppm: str, tesseract: str) -> List[Tuple[str, str]]:
    """Rasterize, then per page: raw OCR + thresholded OCR — the dual-pass
    input for parse_pdf_pages (see its docstring for why both are needed)."""
    from PIL import Image  # deferred: tests of the pure core don't need Pillow

    with tempfile.TemporaryDirectory(prefix="fulton_ocr_") as tmp:
        tmp_path = Path(tmp)
        subprocess.run(
            [pdftoppm, "-r", str(OCR_DPI), "-png", str(pdf_path), str(tmp_path / "page")],
            check=True,
            capture_output=True,
        )
        page_pngs = sorted(tmp_path.glob("page-*.png"))
        if not page_pngs:
            raise RuntimeError(f"pdftoppm produced no pages for {pdf_path}")
        logger.info(f"{pdf_path.name}: rasterized {len(page_pngs)} pages at {OCR_DPI} dpi")

        pages: List[Tuple[str, str]] = []
        for page_png in page_pngs:
            raw_text = _run_tesseract(tesseract, page_png, tmp_path / (page_png.stem + "_raw"))

            img = Image.open(page_png).convert("L")
            img = img.point(lambda v: 255 if v > OCR_THRESHOLD else 0)
            thresh_png = page_png.with_name(page_png.stem + "_t.png")
            img.save(thresh_png)
            thresh_text = _run_tesseract(
                tesseract, thresh_png, tmp_path / (page_png.stem + "_thresh")
            )
            pages.append((raw_text, thresh_text))
        return pages


# ── Download / IO (parse_clayton.py pattern) ─────────────────────────────────

def download_pdf(url: str) -> Optional[Path]:
    PDF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    save_path = PDF_CACHE_DIR / url.rsplit("/", 1)[-1].split("?")[0]
    if save_path.exists():
        logger.info(f"Using cached PDF: {save_path}")
        return save_path
    try:
        logger.info(f"Downloading {url}")
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        save_path.write_bytes(resp.content)
        logger.info(f"Downloaded: {save_path} ({save_path.stat().st_size:,} bytes)")
        return save_path
    except Exception as e:
        logger.error(f"Download failed for {url}: {e}")
        return None


def collapse_check_digit_variants(rows: List[Dict]) -> List[Dict]:
    """The raw and thresh passes occasionally disagree on a parcel's final
    check digit (and a degraded pass can even lose the address). The check
    digit is DERIVED from the other four groups, so the prefix alone uniquely
    identifies a physical parcel — dedupe on it, keep the FIRST seen (row
    order puts the raw pass first, and raw has the better glyph fidelity)."""
    kept: List[Dict] = []
    seen_keys: set = set()
    for row in rows:
        key = row["parcel_id"].rsplit("-", 1)[0]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        kept.append(row)
    return kept


def parse_pdf_pages(
    pages: List[Tuple[str, str]], date_override: Optional[str]
) -> Tuple[List[Dict], List[Dict], str]:
    """The production entrypoint: per-page (raw_ocr, thresh_ocr) texts →
    (tax_records, judicial_records, auction_date).

    Dual-pass rationale (measured on the real Aug-4-2026 list): the raw pass
    reads 148 tax parcels but cannot see the colored judicial banner; the
    thresh pass recovers the banner but its hard threshold destroys ~22
    anti-aliased data rows (126 parcels alone). So: rows come from the UNION
    of both passes (raw first), the banner from the thresh pass. From the
    banner page onward ONLY the thresh pass is read — the raw pass cannot see
    the banner, so its rows there cannot be safely classified tax-vs-judicial.

    Raises RuntimeError on the two publish-blocking conditions: banner not
    found (threshold regression) and sale date not found.
    """
    pages = [(normalize_ocr_text(raw), normalize_ocr_text(thresh)) for raw, thresh in pages]

    auction_date = date_override or extract_sale_date(
        "\n".join(raw + "\n" + thresh for raw, thresh in pages)
    )
    if not auction_date:
        raise RuntimeError("No sale date found in OCR text — pass --date YYYY-MM-DD")

    banner_page: Optional[int] = None
    pre_banner = post_banner = ""
    for idx, (_, thresh) in enumerate(pages):
        pre, post = split_sections(thresh)
        if post is not None:
            banner_page, pre_banner, post_banner = idx, pre, post
            break
    if banner_page is None:
        raise RuntimeError(
            "JUDICIAL FORECLOSURE banner not found — threshold step likely failed; "
            "tax/judicial sections cannot be separated. DO NOT PUBLISH this run."
        )

    tax_parts: List[str] = []
    for raw, thresh in pages[:banner_page]:
        tax_parts.append(raw)
        tax_parts.append(thresh)
    tax_parts.append(pre_banner)
    judicial_parts = [post_banner] + [thresh for _, thresh in pages[banner_page + 1:]]

    tax_rows = collapse_check_digit_variants(parse_rows("\n".join(tax_parts)))
    judicial_rows = parse_rows("\n".join(judicial_parts))

    # Belt-and-braces: a pass misread must never let a judicial parcel (or its
    # check-digit variant) leak into the tax output.
    judicial_keys = {r["parcel_id"].rsplit("-", 1)[0] for r in judicial_rows}
    tax_rows = [
        r for r in tax_rows if r["parcel_id"].rsplit("-", 1)[0] not in judicial_keys
    ]

    return (
        build_records(tax_rows, auction_date),
        build_records(judicial_rows, auction_date),
        auction_date,
    )


def parse_pdf_text(text: str, date_override: Optional[str]) -> Tuple[List[Dict], List[Dict], str]:
    """Single-pass convenience wrapper (tests, ad-hoc use): treats one combined
    OCR text (pages separated by \\f) as both passes of each page."""
    return parse_pdf_pages([(p, p) for p in text.split("\f")], date_override)


def main(argv: List[str]) -> None:
    ap = argparse.ArgumentParser(description="Parse Fulton sheriff levy-sale PDF(s)")
    ap.add_argument("pdfs", nargs="+", help="Local PDF path(s) or https URL(s)")
    ap.add_argument("--date", help="Sale date override (YYYY-MM-DD)")
    args = ap.parse_args(argv)

    pdftoppm = find_pdftoppm()
    tesseract = find_tesseract()
    if not pdftoppm or not tesseract:
        logger.error(
            "OCR tools missing (pdftoppm=%s, tesseract=%s). Install poppler + "
            "tesseract or set FULTON_PDFTOPPM / FULTON_TESSERACT. "
            "See directives/fulton_onboarding_scope.md step B.",
            pdftoppm, tesseract,
        )
        sys.exit(2)

    paths: List[Path] = []
    for arg in args.pdfs:
        if arg.startswith(("http://", "https://")):
            p = download_pdf(arg)
            if p:
                paths.append(p)
        else:
            p = Path(arg)
            if not p.exists():
                logger.error(f"PDF not found: {p}")
                sys.exit(1)
            paths.append(p)
    if not paths:
        logger.error("No PDFs to parse.")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_tax: List[Dict] = []
    all_judicial: List[Dict] = []
    for path in paths:
        pages = ocr_pdf(path, pdftoppm, tesseract)
        try:
            tax, judicial, sale_date = parse_pdf_pages(pages, args.date)
        except RuntimeError as e:
            logger.error(f"{path.name}: {e}")
            sys.exit(2)
        logger.info(
            f"{path.name}: sale {sale_date} — {len(tax)} tax parcels, "
            f"{len(judicial)} judicial rows EXCLUDED"
        )
        all_tax.extend(tax)
        all_judicial.extend(judicial)

    if not all_tax:
        logger.error("No tax parcels extracted — check the PDF and OCR output.")
        sys.exit(1)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    by_date: Dict[str, List[Dict]] = {}
    for rec in all_tax:
        by_date.setdefault(rec["auction_date"], []).append(rec)
    for sale_date in sorted(by_date, reverse=True):
        out = OUTPUT_DIR / f"fulton_parsed_{sale_date.replace('-', '')}_{timestamp}.json"
        out.write_text(json.dumps(by_date[sale_date], indent=2))
        logger.info(f"Saved {len(by_date[sale_date])} tax parcels ({sale_date}) -> {out}")

    if all_judicial:
        jout = OUTPUT_DIR / f"fulton_judicial_{timestamp}.json"
        jout.write_text(json.dumps(all_judicial, indent=2))
        logger.info(f"Saved {len(all_judicial)} EXCLUDED judicial rows -> {jout}")

    COMBINED_OUTPUT.write_text(json.dumps(all_tax, indent=2))
    logger.info(f"Saved combined {len(all_tax)} properties -> {COMBINED_OUTPUT}")

    print("\n" + "=" * 60)
    print(f"FULTON PARSE COMPLETE — {len(all_tax)} tax parcels")
    print(f"  (judicial rows excluded: {len(all_judicial)})")
    for sale_date in sorted(by_date):
        print(f"  {sale_date}  {len(by_date[sale_date]):>3} parcels")
    print("=" * 60)


if __name__ == "__main__":
    main(sys.argv[1:])
