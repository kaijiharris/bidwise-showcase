"""
DeKalb County Tax Sale PDF Parser
===================================
Downloads the current tax sale list (or uses a manually placed PDF),
parses it, and saves structured property records to JSON.

Download sources (tried in order; new dekalbtaxga.gov domain first, legacy
dekalbtax.org hosts as fallbacks after the July 2026 county migration):
  1. publicaccess HTML table (scraped directly)
  2. county tax-sales page — any listing PDF found there
  3. Manual placement: .tmp/dekalb_pdfs/dekalb_tax_list.pdf

Output format:
  [{county, tax_id, full_address, zip_code, tax_due, source, raw_text}, ...]

Run:
    python execution/parse_dekalb_improved.py
    # → .tmp/dekalb_results/dekalb_parsed_YYYYMMDDHHMMSS.json

    # or provide PDF manually:
    python execution/parse_dekalb_improved.py path/to/dekalb.pdf
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
logger = logging.getLogger("DeKalbParser")

OUTPUT_DIR = Path(".tmp/dekalb_results")
MANUAL_PDF = Path(".tmp/dekalb_pdfs/dekalb_tax_list.pdf")

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# DeKalb parcel ID: "06 280 06 039" (2+3+2+3 digits with spaces)
ID_PATTERN         = re.compile(r'\b(\d{2}\s+\d{3}\s+\d{2}\s+\d{3})\b')
GRAND_TOTAL_PAT    = re.compile(r'GRAND\s+TOTAL\s+DUE\s+([\d,]+\.?\d*)', re.IGNORECASE)
ZIP_PATTERN        = re.compile(r'\b(3\d{4})\b')
MONEY_PAT          = re.compile(r'\$?([\d,]+\.\d{2})')


# ── Auto-download: publicaccess HTML table ────────────────────────────────────

def _fetch_portal_table() -> Optional[List[Dict]]:
    """
    Attempt to scrape the tax sale listing directly from the DeKalb publicaccess portal.
    The portal is a Tyler Technologies system; the listing is an HTML table.
    Returns a list of property dicts if successful, None if unavailable.
    """
    # New-domain URLs first: DeKalb migrated dekalbtax.org -> dekalbtaxga.gov
    # (July 2026); legacy hosts kept as fallbacks in case they recover first.
    listing_urls = [
        "https://publicaccess.dekalbtaxga.gov/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
        "https://publicaccess.dekalbtaxga.gov/content/search/tax_sale_listing.html",
        "https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
        "https://publicaccess.dekalbtax.org/content/search/tax_sale_listing.html",
    ]

    for url in listing_urls:
        try:
            logger.info(f"Checking portal: {url}")
            # Proper TLS verification (was verify=False). DeKalb serves a valid cert.
            resp = requests.get(url, headers=HEADERS, timeout=20)
            if resp.status_code != 200:
                logger.warning(f"  Portal returned {resp.status_code}")
                continue

            # Check for maintenance notice
            if 'unavailable due to maintenance' in resp.text.lower():
                logger.warning("  Portal is in maintenance — skipping HTML scrape")
                return None

            soup = BeautifulSoup(resp.text, 'html.parser')
            table = soup.find('table')
            if not table:
                logger.warning("  No table found in portal response")
                continue

            properties = []
            rows = table.find_all('tr')
            headers_row = [th.get_text(strip=True).upper() for th in rows[0].find_all(['th', 'td'])]
            logger.info(f"  Portal table headers: {headers_row}")

            for row in rows[1:]:
                cells = [td.get_text(strip=True) for td in row.find_all('td')]
                if len(cells) < 2:
                    continue

                # Try to map cells to fields based on header names
                def _cell(keywords):
                    for kw in keywords:
                        for i, h in enumerate(headers_row):
                            if kw in h and i < len(cells):
                                return cells[i]
                    return cells[0] if cells else ''

                parcel_id  = _cell(['PARCEL', 'PIN', 'ACCOUNT'])
                address    = _cell(['ADDRESS', 'SITUS', 'LOCATION'])
                tax_due_s  = _cell(['AMOUNT', 'TOTAL', 'DUE', 'BID'])
                zip_code   = ''

                if not parcel_id:
                    continue

                # Normalize parcel ID
                digits = re.sub(r'\D', '', parcel_id)
                if len(digits) == 10:
                    parcel_id = f"{digits[0:2]} {digits[2:5]} {digits[5:7]} {digits[7:10]}"

                try:
                    tax_due = float(re.sub(r'[^\d.]', '', tax_due_s)) if tax_due_s else None
                except ValueError:
                    tax_due = None

                if tax_due is None or tax_due <= 0:
                    continue

                zip_m    = ZIP_PATTERN.search(address)
                zip_code = zip_m.group(1) if zip_m else ''

                properties.append({
                    'county':       'DeKalb',
                    'tax_id':       parcel_id,
                    'full_address': address,
                    'zip_code':     zip_code,
                    'tax_due':      tax_due,
                    'source':       'dekalb_portal_html',
                    'raw_text':     ' '.join(cells),
                })

            if properties:
                logger.info(f"  Portal HTML: extracted {len(properties)} properties")
                return properties

        except Exception as e:
            logger.warning(f"  Portal scrape error: {e}")

    return None


def _find_pdf_on_site() -> Optional[str]:
    """Check the county tax-sales pages for any downloadable listing PDF."""
    # New domain first (dekalbtax.org -> dekalbtaxga.gov, July 2026); each
    # entry pairs the page with the base used to absolutize relative hrefs.
    site_pages = [
        ("https://dekalbtaxga.gov/property-tax/tax-sales/", "https://dekalbtaxga.gov"),
        ("https://dekalbtax.org/property-tax/tax-sales/", "https://dekalbtax.org"),
    ]
    for page_url, base in site_pages:
        try:
            resp = requests.get(page_url, headers=HEADERS, timeout=20)
            if resp.status_code != 200:
                continue

            soup = BeautifulSoup(resp.text, 'html.parser')
            for link in soup.find_all('a'):
                href = link.get('href', '')
                text = link.get_text().strip().lower()
                if not href:
                    continue
                if href.startswith('/'):
                    href = base + href

                is_pdf  = '.pdf' in href.lower()
                is_list = any(kw in text or kw in href.lower()
                              for kw in ['list', 'sale list', 'properties', 'auction list'])
                is_not_flyer = 'flyer' not in text and 'condition' not in text and 'form' not in text

                if is_pdf and is_list and is_not_flyer:
                    logger.info(f"Found listing PDF on {page_url}: {href}")
                    return href

        except Exception as e:
            logger.warning(f"{page_url} scrape error: {e}")

    return None


def _download_pdf(url: str, save_path: Path) -> Optional[Path]:
    """Download a PDF to save_path."""
    save_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        # Proper TLS verification (was verify=False).
        resp = requests.get(url, headers=HEADERS, stream=True, timeout=120)
        resp.raise_for_status()
        with open(save_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        logger.info(f"Downloaded: {save_path} ({save_path.stat().st_size:,} bytes)")
        return save_path
    except Exception as e:
        logger.error(f"Download failed: {e}")
        return None


# ── PDF parser ────────────────────────────────────────────────────────────────

def parse_dekalb_pdf(pdf_path: str, limit: int = 0) -> List[Dict]:
    """
    Parse DeKalb tax deed PDF.

    PDF format per property:
      Line 1: <parcel_id>  <address>  <zip>  TAX DISTRICT <code>
      Line 2+: Owner details, amounts
      Final: GRAND TOTAL DUE $xxx.xx

    Args:
        pdf_path: Path to the PDF file
        limit: Max properties to return (0 = no limit, process all)
    """
    properties = []

    with pdfplumber.open(pdf_path) as pdf:
        logger.info(f"PDF: {len(pdf.pages)} pages")
        current_property = None

        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text:
                continue

            for line in text.split('\n'):
                if 'RUN DATE' in line or line.strip().startswith('Page '):
                    continue

                id_match = ID_PATTERN.search(line)
                if id_match:
                    if current_property and current_property.get('tax_due'):
                        properties.append(current_property)
                        if limit and len(properties) >= limit:
                            logger.info(f"Reached limit of {limit}")
                            return properties

                    parcel_id  = id_match.group(1)
                    after_id   = line[id_match.end():].strip()
                    zip_match  = ZIP_PATTERN.search(after_id)

                    if zip_match:
                        address  = after_id[:zip_match.start()].strip()
                        zip_code = zip_match.group(1)
                    else:
                        address  = after_id.split('TAX DISTRICT')[0].strip()
                        zip_code = ''

                    current_property = {
                        'county':       'DeKalb',
                        'tax_id':       parcel_id,
                        'full_address': address,
                        'zip_code':     zip_code,
                        'source':       'dekalb_pdf',
                        'raw_text':     line.strip(),
                    }

                elif current_property and 'GRAND TOTAL DUE' in line.upper():
                    m = GRAND_TOTAL_PAT.search(line)
                    if m:
                        try:
                            current_property['tax_due'] = float(m.group(1).replace(',', ''))
                        except ValueError:
                            pass

        if current_property and current_property.get('tax_due'):
            properties.append(current_property)

    logger.info(f"Parsed {len(properties)} properties from PDF")
    return properties


# ── Entry point ───────────────────────────────────────────────────────────────

def main(pdf_path_arg: Optional[str] = None) -> str:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    properties = []

    if pdf_path_arg:
        # Manual PDF provided as argument
        path = Path(pdf_path_arg)
        if not path.exists():
            logger.error(f"PDF not found: {pdf_path_arg}")
            sys.exit(1)
        logger.info(f"Using provided PDF: {path}")
        properties = parse_dekalb_pdf(str(path))

    else:
        # Step 1: Try portal HTML scrape
        logger.info("Step 1: Attempting portal HTML scrape...")
        properties = _fetch_portal_table() or []

        # Step 2: Try PDF on dekalbtax.org
        if not properties:
            logger.info("Step 2: Searching dekalbtax.org for listing PDF...")
            pdf_url = _find_pdf_on_site()
            if pdf_url:
                today     = datetime.now().strftime('%Y%m%d')
                save_path = Path(f".tmp/dekalb_pdfs/dekalb_tax_sale_{today}.pdf")
                pdf_file  = _download_pdf(pdf_url, save_path)
                if pdf_file:
                    properties = parse_dekalb_pdf(str(pdf_file))

        # Step 3: Fall back to manually placed PDF
        if not properties:
            if MANUAL_PDF.exists():
                logger.info(f"Step 3: Using manually placed PDF: {MANUAL_PDF}")
                properties = parse_dekalb_pdf(str(MANUAL_PDF))
            else:
                logger.error(
                    "No data source available.\n"
                    f"  Portal: unavailable (maintenance or no table)\n"
                    f"  dekalbtax.org: no listing PDF found\n"
                    f"  Manual PDF: not found at {MANUAL_PDF}\n\n"
                    "Please download the DeKalb tax sale listing PDF and place it at:\n"
                    f"  {MANUAL_PDF}"
                )
                sys.exit(1)

    if not properties:
        logger.error("No properties extracted")
        sys.exit(1)

    timestamp   = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = OUTPUT_DIR / f"dekalb_parsed_{timestamp}.json"
    with open(output_path, 'w') as f:
        json.dump(properties, f, indent=2)

    logger.info(f"Saved {len(properties)} properties → {output_path}")

    # Summary
    sources = {}
    for p in properties:
        s = p.get('source', 'unknown')
        sources[s] = sources.get(s, 0) + 1

    print("\n" + "="*60)
    print(f"DEKALB PARSE COMPLETE — {len(properties)} properties")
    print("="*60)
    print("Sources:")
    for src, count in sources.items():
        print(f"  {src:<35} {count}")
    print(f"\nOutput: {output_path}")
    print("="*60)

    return str(output_path)


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    main(arg)
