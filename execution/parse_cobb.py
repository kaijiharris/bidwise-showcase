"""
Cobb County Tax Sale PDF Parser
==================================
Downloads the current tax sale list from cobbtax.org,
parses it, and saves structured property records to JSON.

Supports both text-based and scanned (image) PDFs:
  - Text PDFs: pdfplumber state machine parser
  - Scanned PDFs: pypdfium2 image render → Gemini OCR extraction

Output format (same schema as DeKalb + zoning_code):
  [{county, tax_id, full_address, zip_code, city, tax_due,
    owner_name, zoning_code, source, raw_text}, ...]

Run:
    python execution/parse_cobb.py
    # → .tmp/cobb_results/cobb_parsed_YYYYMMDDHHMMSS.json
"""

import re
import io
import os
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
logger = logging.getLogger("CobbParser")

BASE_URL      = "https://www.cobbtax.org"
ALT_BASES     = ["https://cobbtax.gov", "https://www.cobbtax.gov"]
TAX_SALE_PAGE = f"{BASE_URL}/property-tax/tax-sales"
OUTPUT_DIR    = Path(".tmp/cobb_results")

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# Cobb parcel ID: "17-0252-0008-048-0"
PARCEL_PATTERN = re.compile(r'\b(\d{2}[-\s]\d{4}[-\s]\d{4}[-\s]\d{3}[-\s]\d)\b')
MONEY_PATTERN  = re.compile(r'\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)')
ZIP_PATTERN    = re.compile(r'\b(3\d{4})\b')

COBB_CITIES = [
    'MARIETTA', 'SMYRNA', 'KENNESAW', 'ACWORTH', 'POWDER SPRINGS',
    'AUSTELL', 'MABLETON', 'VININGS', 'FAIR OAKS', 'CLARKDALE',
    'DALLAS', 'DOUGLASVILLE',
]


# ── URL Discovery ─────────────────────────────────────────────────────────────

def find_pdf_url() -> Optional[str]:
    """Scrape cobbtax.org to find the current tax sale PDF."""
    urls_to_try = [TAX_SALE_PAGE] + [f"{b}/property-tax/tax-sales" for b in ALT_BASES]

    for url in urls_to_try:
        try:
            logger.info(f"Searching for PDF at {url}")
            # Proper TLS verification (was verify=False).
            resp = requests.get(url, headers=HEADERS, timeout=30)
            if resp.status_code != 200:
                continue

            soup = BeautifulSoup(resp.text, 'html.parser')
            candidates = []

            for link in soup.find_all('a'):
                href = link.get('href', '')
                text = link.get_text().strip().lower()
                if not href:
                    continue

                # Resolve relative URLs
                if href.startswith('/'):
                    href = BASE_URL + href
                elif not href.startswith('http'):
                    continue

                is_pdf      = '.pdf' in href.lower() or 'pdf' in href.lower()
                is_tax_list = any(kw in text or kw in href.lower()
                                  for kw in ['tax sale', 'tax-sale', 'levy', 'sale list'])
                is_result   = 'result' in text or 'result' in href.lower()

                if is_pdf and is_tax_list and not is_result:
                    # Prefer current/upcoming month
                    now   = datetime.now()
                    month = now.strftime("%B").lower()
                    nxt   = datetime(now.year, (now.month % 12) + 1, 1).strftime("%B").lower()
                    priority = 1 if (month in text or nxt in text or
                                     month in href.lower() or nxt in href.lower()) else 2
                    candidates.append((priority, text, href))
                    logger.info(f"  Candidate (p{priority}): {text!r} → {href}")

            if candidates:
                candidates.sort(key=lambda x: x[0])
                logger.info(f"Using: {candidates[0][2]}")
                return candidates[0][2]

        except Exception as e:
            logger.warning(f"Error at {url}: {e}")

    logger.error("Could not find PDF URL on cobbtax.org")
    return None


def download_pdf(url: str) -> Optional[Path]:
    """Download the PDF to the output directory."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename  = f"cobb_tax_sale_{datetime.now().strftime('%Y%m%d')}.pdf"
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def extract_city(text: str) -> str:
    upper = text.upper()
    for city in COBB_CITIES:
        if city in upper:
            return city.title()
    return 'Marietta'


def normalize_parcel_id(raw: str) -> str:
    """Normalize Cobb parcel ID to dash-separated form as printed on the PDF.

    Stores the ID exactly as OCR/text extracted it (e.g. '17-0253-0-037-0').
    The ArcGIS numeric form is derived at query time — see CobbArcGISEnricher.
    """
    parts = [p for p in re.split(r'[-\s]+', raw.strip()) if p.isdigit()]
    if len(parts) >= 5:
        return f"{parts[0]}-{parts[1]}-{parts[2]}-{parts[3]}-{parts[4]}"
    return raw.strip()


def _extract_zip(text: str) -> str:
    m = ZIP_PATTERN.search(text)
    return m.group(1) if m else ''


# ── Parser: text-based PDF ────────────────────────────────────────────────────

def _text_parse(pdf_path: Path) -> List[Dict]:
    """
    State-machine parser for text-based Cobb PDFs.
    Parcel ID line anchors a block; address and amount extracted from block.
    Also attempts to extract zoning code from lines near the parcel block.
    """
    properties = []
    seen_ids   = set()

    # Zoning code pattern: R-20, LB, GC, I-1, RA-4, etc.
    ZONING_PAT = re.compile(
        r'\b(R-\d{1,2}|RA-\d|RT|LB|LS|GC|SC|HB|OI|MSP|I-\d|A-\d|CONS|TND|LRD|NRC|CRC|RRC|MHP)\b',
        re.IGNORECASE,
    )

    try:
        with pdfplumber.open(pdf_path) as pdf:
            logger.info(f"PDF: {len(pdf.pages)} pages")
            all_lines = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    all_lines.extend(text.split('\n'))

        current_id    = None
        current_block = []

        def process_block(parcel_id: str, block: List[str]) -> Optional[Dict]:
            combined = ' '.join(block)

            # Dollar amount
            tax_due = None
            for m in reversed(MONEY_PATTERN.findall(combined)):
                try:
                    val = float(m.replace(',', ''))
                    if val > 500:
                        tax_due = val
                        break
                except ValueError:
                    pass

            # Address
            full_address = ''
            for line in block:
                line = line.strip()
                if PARCEL_PATTERN.search(line):
                    continue
                if re.match(r'^\d{1,6}\s+[A-Z]', line, re.IGNORECASE):
                    for m in MONEY_PATTERN.findall(line):
                        try:
                            if float(m.replace(',', '')) > 100:
                                idx = line.rfind(m)
                                if idx > 5:
                                    line = line[:idx].strip()
                        except ValueError:
                            pass
                    full_address = line.strip().rstrip(',')
                    break

            if not full_address:
                for line in block:
                    line = line.strip()
                    if line and not PARCEL_PATTERN.search(line) and len(line) > 5:
                        full_address = line
                        break

            # Zoning code
            zoning_code = ''
            zm = ZONING_PAT.search(combined)
            if zm:
                zoning_code = zm.group(1).upper()

            # Owner name (first non-parcel, non-address, non-money line)
            owner_name = ''
            for line in block:
                line = line.strip()
                if (not PARCEL_PATTERN.search(line)
                        and not re.match(r'^\d{1,6}\s+[A-Z]', line, re.IGNORECASE)
                        and not MONEY_PATTERN.search(line)
                        and len(line) > 3
                        and line != full_address):
                    owner_name = line
                    break

            if not full_address or not tax_due:
                return None

            zip_code = _extract_zip(full_address)
            city     = extract_city(combined)

            return {
                'county':       'Cobb',
                'tax_id':       normalize_parcel_id(parcel_id),
                'full_address': full_address,
                'zip_code':     zip_code,
                'city':         city,
                'tax_due':      tax_due,
                'owner_name':   owner_name,
                'zoning_code':  zoning_code,
                'source':       'cobb_pdf_text',
                'raw_text':     combined[:300],
            }

        skip_headers = {'COBB COUNTY', 'TAX SALE', 'PAGE', 'SHERIFF', 'PARCEL',
                        'AMOUNT DUE', 'PROPERTY ADDRESS', 'OPENING BID', 'ZONING'}

        for line in all_lines:
            line = line.strip()
            if not line or any(kw in line.upper() for kw in skip_headers):
                continue

            parcel_match = PARCEL_PATTERN.search(line)
            if parcel_match:
                if current_id and current_block:
                    prop = process_block(current_id, current_block)
                    if prop and current_id not in seen_ids:
                        seen_ids.add(current_id)
                        properties.append(prop)
                current_id    = parcel_match.group(1)
                current_block = [line]
            elif current_id:
                current_block.append(line)

        if current_id and current_block:
            prop = process_block(current_id, current_block)
            if prop and current_id not in seen_ids:
                properties.append(prop)

    except Exception as e:
        logger.error(f"Text parse error: {e}")

    return properties


# ── Parser: scanned PDF via Gemini OCR ───────────────────────────────────────

def _ocr_parse(pdf_path: Path) -> List[Dict]:
    """
    For image-based (scanned) PDFs:
      pypdfium2 renders each page → Gemini extracts the table as JSON.
    """
    try:
        import pypdfium2 as pdfium
        import google.generativeai as genai
    except ImportError as e:
        logger.error(f"Missing dependency for OCR: {e}")
        return []

    gemini_key = os.getenv('GEMINI_API_KEY')
    if not gemini_key:
        # Try to load from .env
        env_path = Path(__file__).parent.parent / '.env'
        if env_path.exists():
            with open(env_path) as f:
                for line in f:
                    if line.startswith('GEMINI_API_KEY='):
                        gemini_key = line.split('=', 1)[1].strip()
                        break

    if not gemini_key:
        logger.error("GEMINI_API_KEY not found — cannot OCR scan")
        return []

    genai.configure(api_key=gemini_key)
    model = genai.GenerativeModel('gemini-2.5-flash')

    properties = []
    seen_ids   = set()

    try:
        doc = pdfium.PdfDocument(str(pdf_path))
        logger.info(f"OCR mode: rendering {len(doc)} page(s) via pypdfium2")

        for page_num in range(len(doc)):
            page   = doc[page_num]
            bitmap = page.render(scale=2.0)   # 2× for better OCR accuracy
            pil_img = bitmap.to_pil()

            img_bytes = io.BytesIO()
            pil_img.save(img_bytes, format='PNG')
            img_bytes.seek(0)

            prompt = """This is a Cobb County, GA tax sale list image.
Extract ALL property records visible in this image.

Return ONLY a valid JSON array. Each element must have:
{
  "parcel_id": "17-0252-0008-048-0",
  "owner_name": "SMITH JOHN",
  "address": "123 MAIN ST, MARIETTA, GA 30060",
  "starting_bid": 12345.67,
  "zoning_code": "R-20"
}

Rules:
- Include every row from the table
- starting_bid must be a number (no $ sign, no commas)
- zoning_code is typically R-20, R-15, LB, GC, OI, I-1, A-1, etc.
- If a field is missing, use null
- Return ONLY the JSON array with no markdown fences or explanation
"""
            logger.info(f"  Sending page {page_num+1} to Gemini for OCR...")
            response = model.generate_content([
                prompt,
                {'mime_type': 'image/png', 'data': img_bytes.getvalue()},
            ])

            text = response.text.strip()
            text = re.sub(r'^```json\s*', '', text)
            text = re.sub(r'\s*```$', '', text)

            try:
                records = json.loads(text)
            except json.JSONDecodeError as e:
                logger.error(f"  Gemini returned invalid JSON on page {page_num+1}: {e}")
                logger.debug(f"  Raw response: {text[:500]}")
                continue

            logger.info(f"  Page {page_num+1}: Gemini extracted {len(records)} records")

            for rec in records:
                raw_pid = str(rec.get('parcel_id') or '')
                if not raw_pid or not rec.get('starting_bid'):
                    continue

                tax_id = normalize_parcel_id(raw_pid)
                if tax_id in seen_ids:
                    continue
                seen_ids.add(tax_id)

                address     = str(rec.get('address') or '').strip()
                zoning_code = str(rec.get('zoning_code') or '').strip().upper()

                properties.append({
                    'county':       'Cobb',
                    'tax_id':       tax_id,
                    'full_address': address,
                    'zip_code':     _extract_zip(address),
                    'city':         extract_city(address + ' ' + str(rec.get('owner_name') or '')),
                    'tax_due':      float(rec['starting_bid']),
                    'owner_name':   str(rec.get('owner_name') or '').strip(),
                    'zoning_code':  zoning_code,
                    'source':       'cobb_pdf_ocr',
                    'raw_text':     f"{rec.get('owner_name','')} {address} {zoning_code}"[:300],
                })

    except Exception as e:
        logger.error(f"OCR parse error: {e}")
        import traceback
        traceback.print_exc()

    logger.info(f"OCR extracted {len(properties)} properties total")
    return properties


# ── Main parse dispatcher ─────────────────────────────────────────────────────

def parse_pdf(pdf_path: Path) -> List[Dict]:
    """Try text extraction first; fall back to Gemini OCR for scanned PDFs."""
    properties = _text_parse(pdf_path)
    if properties:
        logger.info(f"Text parser succeeded: {len(properties)} properties")
        return properties

    logger.info("Text parser returned 0 properties — PDF is likely scanned. Switching to Gemini OCR.")
    return _ocr_parse(pdf_path)


# ── Entry point ───────────────────────────────────────────────────────────────

def main(pdf_path: Optional[str] = None) -> str:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if pdf_path:
        path = Path(pdf_path)
        if not path.exists():
            logger.error(f"PDF not found: {pdf_path}")
            sys.exit(1)
    else:
        url = find_pdf_url()
        if not url:
            logger.error("Could not find PDF. Provide path manually: parse_cobb.py <path>")
            sys.exit(1)
        path = download_pdf(url)
        if not path:
            sys.exit(1)

    properties = parse_pdf(path)

    if not properties:
        logger.error("No properties extracted — check PDF format and parser logic")
        sys.exit(1)

    timestamp   = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = OUTPUT_DIR / f"cobb_parsed_{timestamp}.json"
    with open(output_path, 'w') as f:
        json.dump(properties, f, indent=2)

    logger.info(f"Saved {len(properties)} properties → {output_path}")

    cities   = {}
    zonings  = {}
    for p in properties:
        c = p.get('city', 'Unknown')
        z = p.get('zoning_code') or 'Unknown'
        cities[c]  = cities.get(c, 0) + 1
        zonings[z] = zonings.get(z, 0) + 1

    print("\n" + "="*60)
    print(f"COBB PARSE COMPLETE — {len(properties)} properties")
    print("="*60)
    print("Cities:")
    for city, count in sorted(cities.items(), key=lambda x: -x[1]):
        print(f"  {city:<25} {count}")
    print("\nTop Zoning Codes:")
    for z, count in sorted(zonings.items(), key=lambda x: -x[1])[:10]:
        print(f"  {z:<15} {count}")
    print(f"\nOutput: {output_path}")
    print("="*60)

    return str(output_path)


if __name__ == "__main__":
    pdf_arg = sys.argv[1] if len(sys.argv) > 1 else None
    main(pdf_arg)
