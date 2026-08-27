"""
Clayton County Tax Sale PDF Parser
====================================
Parses Clayton County GA tax-sale list PDFs published at
https://publicaccess.claytoncountyga.gov/content/PDF/{month}_{year}_tax_sale.pdf

PDF layout (verified on the July + August 2026 lists):
  A 6-column table where cells WRAP onto continuation lines:
      Date | Parcel#/Name | Location | Years | Fair Market Value | Cry-Out Bid
  e.g.
      07/07/2026 05176A D012 /LOREDO 10341 CANYON TRL 2024,2025 253,500 10,727.16
      GORGE
  The owner name (after "/") and even the street address can spill onto the
  next line(s), interleaved — so this parser assigns every word to a column by
  x-coordinate instead of using line regexes.

Column x0 boundaries (points, measured 2026-07-02; both PDFs identical):
      date < 100 <= parcel/owner < 203 <= location < 332 <= years < 410 <= FMV < 500 <= bid

Semantics:
  - tax_due   = Cry-Out Bid (the opening bid — total taxes/fees owed)
  - fmv_pdf   = county Fair Market Value printed on the list; also stored as
                appraised_value so the pipeline's assessor-appraisal ARV fallback
                works even when ArcGIS can't match a suffixed parcel id.
  - city/zip are NOT printed on the PDF. They are batch-fetched from the county
    ArcGIS parcel layer (one query per ~50 parcels); on network failure city=''
    and the pipeline falls back to the county default city.

Output:
  1. .tmp/clayton_results/clayton_parsed_{YYYYMMDD}_{ts}.json — one file per
     sale date (pipeline input; run_ga_county auto-selects latest by mtime, and
     files are written soonest-auction-last so the default pick is the next sale).
  2. .tmp/clayton_properties.json — combined list across all parsed sale dates
     (directive-standard schema: parcel_id / address / city / tax_due + extras).

Run:
    python execution/parse_clayton.py                    # both known 2026 PDFs
    python execution/parse_clayton.py path/to/sale.pdf   # local PDF(s)
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import pdfplumber
import requests

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ClaytonParser")

KNOWN_PDF_URLS = [
    "https://publicaccess.claytoncountyga.gov/content/PDF/july_2026_tax_sale.pdf",
    "https://publicaccess.claytoncountyga.gov/content/PDF/august_2026_tax_sale.pdf",
]

PDF_CACHE_DIR = Path(".tmp/clayton")
OUTPUT_DIR = Path(".tmp/clayton_results")
COMBINED_OUTPUT = Path(".tmp/clayton_properties.json")

ARCGIS_QUERY_URL = (
    "https://gis.claytoncountyga.gov/server/rest/services"
    "/TaxAssessor/Parcels/MapServer/0/query"
)

DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")

# Multi-year strings ("2022,2023,2024,2025", "2022,2023-2024,2025") are centered
# under the Years header, so long ones START left of the years column boundary
# and would otherwise bin into the location column. Two+ joined years can never
# be a house number, so this reassignment is unambiguous.
YEARS_TOKEN_RE = re.compile(r"^(19|20)\d{2}([,-](19|20)\d{2})+,?$")

# Column assignment by word x0 (see module docstring for measurement notes).
COLUMN_BOUNDS = [
    ("date", 0, 100),
    ("parcel_owner", 100, 203),
    ("location", 203, 332),
    ("years", 332, 410),
    ("fmv", 410, 500),
    ("bid", 500, 10_000),
]

LINE_TOP_TOLERANCE = 3.0  # points — words within this vertical distance = same line


def _is_header_line(joined_text: str) -> bool:
    """
    Page title/header lines. Must be filtered because a record open at a page
    break would otherwise absorb the next page's header words into its cells
    (e.g. 'Cry-Out'/'Bid' landing in the bid column corrupts the amount).
    Signatures are exact/distinctive so owner-name continuation lines
    (e.g. 'CLAYTON HOLDINGS LLC') are never skipped.
    """
    if joined_text == "Clayton County Tax Sale Information":
        return True
    if joined_text.startswith("The following Parcels"):
        return True
    words = joined_text.split()
    return "Cry-Out" in words or "Parcel#/Name" in words


def _column_for(x0: float) -> Optional[str]:
    for name, lo, hi in COLUMN_BOUNDS:
        if lo <= x0 < hi:
            return name
    return None


def _to_amount(tokens: List[str]) -> Optional[float]:
    """['253,500'] → 253500.0 — None when not a clean number."""
    raw = "".join(tokens).replace(",", "").replace("$", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _group_lines(words: List[dict]) -> List[List[dict]]:
    """Cluster pdfplumber words into visual lines by their 'top' coordinate."""
    lines: List[List[dict]] = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(word["top"] - lines[-1][0]["top"]) <= LINE_TOP_TOLERANCE:
            lines[-1].append(word)
        else:
            lines.append([word])
    return lines


def _finalize_record(cells: Dict[str, List[str]]) -> Optional[Dict]:
    """Convert accumulated column cells into a property record."""
    date_raw = cells["date"][0] if cells["date"] else ""
    try:
        auction_date = datetime.strptime(date_raw, "%m/%d/%Y").strftime("%Y-%m-%d")
    except ValueError:
        logger.warning(f"Skipping row with bad date {date_raw!r}: {cells}")
        return None

    # Parcel id = tokens before the first "/..." token; owner = the rest.
    parcel_tokens: List[str] = []
    owner_tokens: List[str] = []
    seen_owner = False
    for token in cells["parcel_owner"]:
        if not seen_owner and token.startswith("/"):
            seen_owner = True
            token = token[1:]
        if seen_owner:
            if token:
                owner_tokens.append(token)
        else:
            parcel_tokens.append(token)

    parcel_id = " ".join(parcel_tokens).strip()
    owner = " ".join(owner_tokens).strip()
    address = " ".join(cells["location"]).strip()
    years = re.sub(r",+", ",", ",".join(cells["years"])).strip(",")
    fmv = _to_amount(cells["fmv"])
    tax_due = _to_amount(cells["bid"])

    if not parcel_id or tax_due is None:
        logger.warning(f"Skipping incomplete row: parcel={parcel_id!r} bid={cells['bid']}")
        return None

    raw_text = " ".join(
        [date_raw, parcel_id, f"/{owner}" if owner else "", address, years,
         str(fmv or ""), str(tax_due)]
    )
    return {
        "county": "Clayton",
        "tax_id": parcel_id,
        "parcel_id": parcel_id,
        "owner_name": owner,
        "full_address": address,
        "address": address,
        "city": "",          # filled by ArcGIS batch lookup below
        "zip_code": "",
        "tax_due": tax_due,
        "min_bid": tax_due,  # cry-out bid IS the minimum opening bid
        "fmv_pdf": fmv,
        "appraised_value": fmv,  # county FMV; ArcGIS overrides on exact match
        "tax_years": years,
        "auction_date": auction_date,
        "source": "clayton_pdf",
        "raw_text": re.sub(r"\s+", " ", raw_text).strip(),
    }


def parse_pdf(pdf_path: Path) -> List[Dict]:
    """Parse one Clayton tax-sale PDF into property records."""
    records: List[Dict] = []
    cells: Optional[Dict[str, List[str]]] = None

    with pdfplumber.open(pdf_path) as pdf:
        logger.info(f"{pdf_path.name}: {len(pdf.pages)} pages")
        for page in pdf.pages:
            for line in _group_lines(page.extract_words()):
                if _is_header_line(" ".join(w["text"] for w in line)):
                    continue
                by_col: Dict[str, List[str]] = {}
                for word in line:
                    col = _column_for(word["x0"])
                    if col == "location" and YEARS_TOKEN_RE.match(word["text"]):
                        col = "years"
                    if col:
                        by_col.setdefault(col, []).append(word["text"])

                starts_record = bool(
                    by_col.get("date") and DATE_RE.match(by_col["date"][0])
                )
                if starts_record:
                    if cells:
                        rec = _finalize_record(cells)
                        if rec:
                            records.append(rec)
                    cells = {name: [] for name, _, _ in COLUMN_BOUNDS}
                if cells is None:
                    continue  # header/title lines before the first data row
                for name, _, _ in COLUMN_BOUNDS:
                    cells[name].extend(by_col.get(name, []))

    if cells:
        rec = _finalize_record(cells)
        if rec:
            records.append(rec)

    logger.info(f"{pdf_path.name}: parsed {len(records)} properties")
    return records


# ── City / ZIP batch lookup (ArcGIS) ─────────────────────────────────────────

def _batch_site_info(parcel_ids: List[str]) -> Dict[str, Dict[str, str]]:
    """
    One query per ~50 parcels: PARCELID IN (...) → {pid: {city, zip}}.
    Returns {} on failure — callers must tolerate missing entries.
    """
    info: Dict[str, Dict[str, str]] = {}
    chunk_size = 50
    for i in range(0, len(parcel_ids), chunk_size):
        chunk = parcel_ids[i : i + chunk_size]
        id_list = ",".join("'" + p.replace("'", "''") + "'" for p in chunk)
        try:
            resp = requests.get(
                ARCGIS_QUERY_URL,
                params={
                    "where": f"PARCELID IN ({id_list})",
                    "outFields": "PARCELID,SITECITY,SITEZIP5",
                    "returnGeometry": "false",
                    "f": "json",
                },
                timeout=30,
            )
            resp.raise_for_status()
            for feat in resp.json().get("features", []):
                a = feat.get("attributes", {})
                pid = (a.get("PARCELID") or "").strip()
                if pid:
                    info[pid] = {
                        "city": (a.get("SITECITY") or "").strip().title(),
                        "zip": (a.get("SITEZIP5") or "").strip(),
                    }
        except Exception as e:
            logger.warning(f"ArcGIS city lookup failed for chunk {i//chunk_size}: {e}")
    return info


def _base_pin(pid: str) -> str:
    """'06070 091002Y' → '06070 091002'; '12114C A002 O04' → '12114C A002'."""
    tokens = pid.split(" ")
    if len(tokens) > 2:
        return " ".join(tokens[:2])
    return " ".join(tokens[:-1] + [re.sub(r"(?<=\d)[A-Z]+$", "", tokens[-1])])


def fill_cities(records: List[Dict]) -> None:
    """Populate city/zip_code in-place from the county parcel layer."""
    ids = sorted({r["tax_id"] for r in records})
    info = _batch_site_info(ids)

    # Suffixed ids that missed: retry with their base parcel (same street = same city).
    missing = [pid for pid in ids if pid not in info]
    base_map = {pid: _base_pin(pid) for pid in missing if _base_pin(pid) != pid}
    if base_map:
        base_info = _batch_site_info(sorted(set(base_map.values())))
        for pid, base in base_map.items():
            if base in base_info:
                info[pid] = base_info[base]

    filled = 0
    for rec in records:
        site = info.get(rec["tax_id"])
        if site:
            rec["city"] = site["city"]
            rec["zip_code"] = site["zip"]
            filled += 1
    logger.info(f"City/ZIP filled for {filled}/{len(records)} properties")


# ── Download / IO ─────────────────────────────────────────────────────────────

def download_pdf(url: str) -> Optional[Path]:
    PDF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    save_path = PDF_CACHE_DIR / url.rsplit("/", 1)[-1]
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


def main(pdf_args: List[str]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if pdf_args:
        paths = [Path(p) for p in pdf_args]
        bad = [p for p in paths if not p.exists()]
        if bad:
            logger.error(f"PDF(s) not found: {bad}")
            sys.exit(1)
    else:
        paths = [p for p in (download_pdf(u) for u in KNOWN_PDF_URLS) if p]
        if not paths:
            logger.error("No PDFs downloaded — provide local paths as arguments.")
            sys.exit(1)

    all_records: List[Dict] = []
    for path in paths:
        all_records.extend(parse_pdf(path))

    if not all_records:
        logger.error("No properties extracted — check PDF format and parser")
        sys.exit(1)

    fill_cities(all_records)

    # Per-sale-date pipeline files, soonest auction written LAST so
    # run_ga_county's latest-by-mtime auto-selection picks the next sale.
    by_date: Dict[str, List[Dict]] = {}
    for rec in all_records:
        by_date.setdefault(rec["auction_date"], []).append(rec)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    for sale_date in sorted(by_date, reverse=True):
        out = OUTPUT_DIR / f"clayton_parsed_{sale_date.replace('-', '')}_{timestamp}.json"
        with open(out, "w") as f:
            json.dump(by_date[sale_date], f, indent=2)
        logger.info(f"Saved {len(by_date[sale_date])} properties ({sale_date}) -> {out}")

    # Combined directive-standard output.
    with open(COMBINED_OUTPUT, "w") as f:
        json.dump(all_records, f, indent=2)
    logger.info(f"Saved combined {len(all_records)} properties -> {COMBINED_OUTPUT}")

    print("\n" + "=" * 60)
    print(f"CLAYTON PARSE COMPLETE — {len(all_records)} properties")
    print("=" * 60)
    for sale_date in sorted(by_date):
        cities: Dict[str, int] = {}
        for rec in by_date[sale_date]:
            key = rec["city"] or "(unknown)"
            cities[key] = cities.get(key, 0) + 1
        city_summary = ", ".join(f"{c}: {n}" for c, n in sorted(cities.items(), key=lambda x: -x[1]))
        print(f"  {sale_date}  {len(by_date[sale_date]):>3} properties   [{city_summary}]")
    print(f"\nCombined output: {COMBINED_OUTPUT}")
    print("=" * 60)


if __name__ == "__main__":
    main(sys.argv[1:])
