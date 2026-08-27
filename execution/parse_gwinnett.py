"""
Gwinnett County Tax Sale PDF Parser
=====================================
Downloads the current tax sale list from gwinnetttaxcommissioner.com,
parses it, and saves structured property records to JSON.

2026 format (single-line per property):
  PIN OwnerName SitusAddress AmountDue
  e.g. R4299 033 IGWE-SIMMS ANGELA 4440 HIDDEN STREAM DR 19401.45

Legacy format (two-line):
  Line i:   ADDRESS          TAX_AMOUNT
  Line i+1: PARCEL_ID        OWNER_NAME

Output format:
  [{county, tax_id, owner_name, full_address, zip_code, tax_due, source, raw_text}, ...]

Run:
    python execution/parse_gwinnett.py
    # → .tmp/gwinnett_results/gwinnett_parsed_YYYYMMDDHHMMSS.json

    # or provide PDF manually:
    python execution/parse_gwinnett.py path/to/gwinnett.pdf
"""

import re
import json
import sys
import logging
import requests
import pdfplumber
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("GwinnettParser")

BASE_URL      = "https://www.gwinnetttaxcommissioner.com"
TAX_SALE_PAGE = f"{BASE_URL}/property-tax/delinquent_tax/tax-liens-tax-sales"
OUTPUT_DIR    = Path(".tmp/gwinnett_results")

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# Gwinnett PIN: R4299 033  or  R4299 033D  (R + 4digits + space + 3digits + optional letter)
PIN_PATTERN  = re.compile(r'^(R\d{4}\s+\d{3}[A-Z]?)\s+(.+)$')

# Dollar amount at end of line (handles $24,593.54 and 19401.45)
AMOUNT_END   = re.compile(r'\$?([\d,]+\.\d{2})\s*$')

# Legacy: any money amount anywhere
MONEY_PATTERN = re.compile(r'(\d{1,3}(?:,\d{3})*\.\d{2})')

# Legacy: parcel ID anywhere
PARCEL_LEGACY = re.compile(r'\b(R?\d{4,5}[\s-]?\d{3})\b')

ZIP_PATTERN  = re.compile(r'\b(3\d{4})\b')

STREET_SUFFIX = (
    r'(?:BLVD|BOULEVARD|PKWY|PARKWAY|PKW|HWY|HIGHWAY|'
    r'STREET|AVENUE|DRIVE|COURT|PLACE|TRAIL|CIRCLE|POINT|TERRACE|CROSSING|RIDGE|WALK|TRACE|'
    r'ST|AVE|DR|CT|LN|RD|WAY|CIR|PL|TRL|PT|XING|TER|LANE|ROAD|RUN|DOWNS)'
)

# Matches a house-number-anchored address ending with a street suffix (at EOL of middle text).
# Uses a full-string match (^...$) so we can drive from rightmost digit position.
ADDR_ANCHORED = re.compile(
    r'^(\d+\s+(?:\S+\s+)*?' + STREET_SUFFIX + r')\s*$',
    re.IGNORECASE
)

# Same but allows no leading house number (for vacant lots: "INWOOD TRL")
ADDR_SUFFIX_ONLY = re.compile(
    r'^(.+\s+' + STREET_SUFFIX + r')\s*$',
    re.IGNORECASE
)

GWINNETT_CITIES = [
    'LAWRENCEVILLE', 'DULUTH', 'NORCROSS', 'BUFORD', 'SNELLVILLE',
    'LILBURN', 'LOGANVILLE', 'AUBURN', 'DACULA', 'GRAYSON',
    'SUGAR HILL', 'SUWANEE', 'PEACHTREE CORNERS', 'BERKLEY LAKE',
    'BRASELTON', 'REST HAVEN', 'MOUNTAIN PARK', 'CENTERVILLE',
]

SKIP_LINES = {
    'OWNERNAME', 'SITUS', 'AMOUNT DUE', 'GWINNETT', 'TAX COMMISSIONER',
    'TUESDAY', 'DELINQUENT', 'TAX SALE', 'PROPERTY ADDRESS', 'TOTAL DUE', 'PAGE',
    'MONDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
}
# Note: 'PIN' intentionally excluded — it substring-matches "PINE" in addresses.


def find_pdf_url() -> Optional[str]:
    """Scrape gwinnetttaxcommissioner.com for the latest tax sale PDF."""
    try:
        logger.info(f"Searching for PDF at {TAX_SALE_PAGE}")
        # Proper TLS verification (was verify=False).
        resp = requests.get(TAX_SALE_PAGE, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        candidates = []
        for link in soup.find_all('a'):
            href = link.get('href', '')
            text = link.get_text().strip().lower()
            if not href:
                continue
            if href.startswith('/'):
                href = BASE_URL + href

            is_list   = ('list' in text or 'list' in href.lower())
            is_sale   = ('tax sale' in text or 'tax-sale' in href.lower())
            no_result = 'result' not in text and 'result' not in href.lower()

            if is_list and is_sale and no_result:
                if '?download' not in href:
                    href += '?download=true'
                candidates.append((1, text, href))
                logger.info(f"  Candidate (P1): {text!r} → {href}")
            elif '/documents/' in href and 'tax-sale' in href.lower() and no_result:
                if '?download' not in href:
                    href += '?download=true'
                candidates.append((2, text, href))
                logger.info(f"  Candidate (P2): {text!r} → {href}")

        if not candidates:
            logger.error("No tax sale PDF links found")
            return None

        candidates.sort(key=lambda x: x[0])
        logger.info(f"Using PDF: {candidates[0][2]}")
        return candidates[0][2]

    except Exception as e:
        logger.error(f"Error finding PDF URL: {e}")
        return None


def download_pdf(url: str) -> Optional[Path]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename  = f"gwinnett_tax_sale_{datetime.now().strftime('%Y%m%d')}.pdf"
    save_path = OUTPUT_DIR / filename

    if save_path.exists():
        logger.info(f"Using cached PDF: {save_path}")
        return save_path

    try:
        logger.info(f"Downloading {url}")
        # Proper TLS verification (was verify=False).
        resp = requests.get(url, headers=HEADERS, stream=True, timeout=60)
        resp.raise_for_status()
        with open(save_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        logger.info(f"Downloaded: {save_path} ({save_path.stat().st_size:,} bytes)")
        return save_path
    except Exception as e:
        logger.error(f"Download failed: {e}")
        return None


def extract_city(text: str) -> str:
    upper = text.upper()
    for city in GWINNETT_CITIES:
        if city in upper:
            return city.title()
    return 'Lawrenceville'


def _split_owner_address(middle: str) -> tuple[str, str]:
    """
    Given the text between the PIN and the amount, split into (owner_name, address).

    Strategy: find the rightmost house-number-to-suffix pattern.
    Everything before it is the owner name; the match itself is the address.

    e.g. "IGWE-SIMMS ANGELA 4440 HIDDEN STREAM DR"
         → owner="IGWE-SIMMS ANGELA", address="4440 HIDDEN STREAM DR"

    e.g. "2346 LAWRENCEVILLE LLC 2346 LAWRENCEVILLE HWY"
         → owner="2346 LAWRENCEVILLE LLC", address="2346 LAWRENCEVILLE HWY"

    If no house number found (vacant lot with only a street name):
         → owner="", address=middle
    """
    # Scan digit positions from right — find the rightmost one that starts a valid address
    for dm in reversed(list(re.finditer(r'\d+', middle))):
        candidate = middle[dm.start():]
        if ADDR_ANCHORED.match(candidate):
            owner = middle[:dm.start()].strip().rstrip(',').strip()
            return owner, candidate.strip()

    # No house number (vacant lot) — check for bare suffix match
    m = ADDR_SUFFIX_ONLY.match(middle)
    if m:
        return '', m.group(1).strip()

    return '', middle.strip()


def _address_plausible(text: str) -> bool:
    """True when text looks like a street address (anchored or suffix-only)."""
    return bool(ADDR_ANCHORED.match(text) or ADDR_SUFFIX_ONLY.match(text))


def _parse_new_format(lines: List[str]) -> List[Dict]:
    """
    Parse 2026 single-line format:
        R4299 033  IGWE-SIMMS ANGELA  4440 HIDDEN STREAM DR  19401.45

    The 2026-08 PDF switches back to legacy TWO-LINE rows for its tail section
    (found 2026-07-04: 11 rows silently dropped + 2 parsed with the owner name
    as the address). Both legacy variants are handled inline:
        variant A:  ADDRESS $AMOUNT      <- previous line
                    PIN OWNER            <- this line (no amount)
        variant B:  ADDRESS              <- previous line (no amount)
                    PIN OWNER $AMOUNT    <- this line (middle has no address)
    """
    properties = []
    seen_ids   = set()
    prev_line  = ''   # last non-PIN, non-header line (candidate legacy address)

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Skip header/title lines
        if any(kw in line.upper() for kw in SKIP_LINES):
            prev_line = ''
            continue

        pin_m = PIN_PATTERN.match(line)
        if not pin_m:
            prev_line = line
            continue

        pin    = pin_m.group(1).strip()
        rest   = pin_m.group(2).strip()

        amt_m = AMOUNT_END.search(rest)
        owner = address = ''
        tax_due = None

        if amt_m:
            try:
                tax_due = float(amt_m.group(1).replace(',', ''))
            except ValueError:
                tax_due = None

        if tax_due is not None and tax_due > 0:
            middle = rest[:amt_m.start()].strip()
            owner, address = _split_owner_address(middle)
            if not address:
                address = middle
            if not _address_plausible(address):
                # Legacy variant B: 'PIN OWNER $AMOUNT' here, street address on
                # the previous (amount-less) line.
                if prev_line and not AMOUNT_END.search(prev_line) and _address_plausible(prev_line):
                    owner, address = middle, prev_line
        else:
            # Legacy variant A: previous line is 'ADDRESS $AMOUNT', this line
            # is 'PIN OWNER'.
            prev_amt = AMOUNT_END.search(prev_line) if prev_line else None
            if prev_amt:
                try:
                    val = float(prev_amt.group(1).replace(',', ''))
                except ValueError:
                    val = None
                if val and val > 0:
                    tax_due = val
                    address = prev_line[:prev_amt.start()].strip()
                    owner   = rest

        prev_line = ''  # a PIN line always consumes/invalidates the lookbehind

        if tax_due is None or tax_due <= 0:
            continue

        if pin in seen_ids:
            continue
        seen_ids.add(pin)

        zip_m    = ZIP_PATTERN.search(address)
        zip_code = zip_m.group(1) if zip_m else ''

        properties.append({
            'county':       'Gwinnett',
            'tax_id':       pin,
            'owner_name':   owner,
            'full_address': address,
            'zip_code':     zip_code,
            'city':         extract_city(address + ' ' + owner),
            'tax_due':      tax_due,
            'source':       'gwinnett_pdf',
            'raw_text':     line,
        })

    return properties


def _parse_legacy_format(lines: List[str]) -> List[Dict]:
    """
    Parse legacy two-line format:
        Line i:   ADDRESS    TAX_AMOUNT
        Line i+1: PARCEL_ID  OWNER_NAME
    """
    properties = []
    seen_ids   = set()
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        if not line or any(kw in line.upper() for kw in SKIP_LINES):
            i += 1
            continue

        # Look ahead for parcel ID on next non-empty line
        next_line = ''
        next_idx  = i + 1
        while next_idx < len(lines) and not lines[next_idx].strip():
            next_idx += 1
        if next_idx < len(lines):
            next_line = lines[next_idx].strip()

        parcel_m = PARCEL_LEGACY.search(next_line)
        if parcel_m:
            raw_id = parcel_m.group(1).strip()
            if raw_id in seen_ids:
                i += 1
                continue
            seen_ids.add(raw_id)

            money_matches = MONEY_PATTERN.findall(line)
            tax_due = None
            if money_matches:
                try:
                    val = float(money_matches[-1].replace(',', ''))
                    if val > 100:
                        tax_due = val
                except ValueError:
                    pass

            address_line = line
            if money_matches:
                last_amt = money_matches[-1]
                idx = address_line.rfind(last_amt)
                if idx > 0:
                    address_line = address_line[:idx].strip()

            full_address = address_line.strip().rstrip(',').strip()
            zip_m        = ZIP_PATTERN.search(full_address)
            zip_code     = zip_m.group(1) if zip_m else ''
            if zip_code:
                full_address = full_address.replace(zip_code, '').strip()

            if full_address and tax_due:
                properties.append({
                    'county':       'Gwinnett',
                    'tax_id':       raw_id,
                    'owner_name':   '',
                    'full_address': full_address,
                    'zip_code':     zip_code,
                    'city':         extract_city(full_address + ' ' + next_line),
                    'tax_due':      tax_due,
                    'source':       'gwinnett_pdf',
                    'raw_text':     f"{line} | {next_line}",
                })

            i = next_idx + 1
        else:
            i += 1

    return properties


def parse_pdf(pdf_path: Path) -> List[Dict]:
    """Auto-detect PDF format and parse accordingly."""
    all_lines = []

    try:
        with pdfplumber.open(pdf_path) as pdf:
            logger.info(f"PDF has {len(pdf.pages)} pages")
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    all_lines.extend(text.split('\n'))
    except Exception as e:
        logger.error(f"PDF read error: {e}")
        import traceback
        traceback.print_exc()
        return []

    # Detect format: count how many lines start with R\d{4}
    pin_start_count = sum(1 for l in all_lines if PIN_PATTERN.match(l.strip()))
    logger.info(f"Lines starting with PIN pattern: {pin_start_count}")

    if pin_start_count >= 3:
        logger.info("Detected 2026 single-line format")
        props = _parse_new_format(all_lines)
    else:
        logger.info("Detected legacy two-line format")
        props = _parse_legacy_format(all_lines)

    if not props and pin_start_count < 3:
        logger.info("Legacy format returned 0 — retrying with new format")
        props = _parse_new_format(all_lines)

    # Automated reconciliation (was a manual directive step): every PIN-anchored
    # line in the PDF must yield a record, else the publish is incomplete.
    if len(props) < pin_start_count:
        logger.warning(
            f"RECONCILE: parsed {len(props)} of {pin_start_count} PIN lines in the PDF — "
            f"rows are being dropped; investigate before publishing this cycle"
        )

    logger.info(f"Parsed {len(props)} properties")
    return props


def main(pdf_path_arg: Optional[str] = None) -> str:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if pdf_path_arg:
        path = Path(pdf_path_arg)
        if not path.exists():
            logger.error(f"PDF not found: {pdf_path_arg}")
            sys.exit(1)
        logger.info(f"Using provided PDF: {path}")
    else:
        url = find_pdf_url()
        if not url:
            logger.error("Could not find PDF URL. Provide one manually.")
            sys.exit(1)
        path = download_pdf(url)
        if not path:
            sys.exit(1)

    properties = parse_pdf(path)

    if not properties:
        logger.error("No properties extracted — check PDF format and parser")
        sys.exit(1)

    timestamp   = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = OUTPUT_DIR / f"gwinnett_parsed_{timestamp}.json"
    with open(output_path, 'w') as f:
        json.dump(properties, f, indent=2)

    logger.info(f"Saved {len(properties)} properties → {output_path}")

    cities = {}
    for p in properties:
        c = p.get('city', 'Unknown')
        cities[c] = cities.get(c, 0) + 1

    print("\n" + "="*60)
    print(f"GWINNETT PARSE COMPLETE — {len(properties)} properties")
    print("="*60)
    for city, count in sorted(cities.items(), key=lambda x: -x[1]):
        print(f"  {city:<25} {count}")
    print(f"\nOutput: {output_path}")
    print("="*60)

    return str(output_path)


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    main(arg)
