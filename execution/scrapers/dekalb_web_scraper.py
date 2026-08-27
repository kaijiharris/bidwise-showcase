"""
DeKalb County Tax Sale Web Scraper
====================================
Scrapes the official tax sale listing from the DeKalb publicaccess portal
(publicaccess.dekalbtaxga.gov, legacy publicaccess.dekalbtax.org fallback)
and outputs a parsed JSON file compatible with run_ga_county.py.

Usage:
    python execution/scrapers/dekalb_web_scraper.py
    python execution/scrapers/dekalb_web_scraper.py --output .tmp/dekalb_results/custom_name.json
    python execution/scrapers/dekalb_web_scraper.py --dry-run   # print records without saving
"""

import re
import json
import logging
import argparse
import requests
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("DekalbWebScraper")

# DeKalb migrated dekalbtax.org -> dekalbtaxga.gov (July 2026). The new site's
# own listing link targets publicaccess.dekalbtaxga.gov (no DNS at migration
# time) while the legacy host 503'd. Try the county's forward direction first,
# fall back to the legacy host in case it recovers first.
TAX_SALE_URLS = [
    "https://publicaccess.dekalbtaxga.gov/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
    "https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
]
OUTPUT_DIR   = Path(".tmp/dekalb_results")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _parse_date(raw: str) -> Optional[str]:
    """Convert '05-MAY-2026' → '2026-05-05'. Returns None if unparseable."""
    raw = raw.strip()
    if not raw:
        return None
    for fmt in ("%d-%b-%Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw


def _parse_currency(raw: str) -> Optional[float]:
    """Convert '$4,258.85' → 4258.85. Returns None if unparseable."""
    cleaned = re.sub(r"[^\d.]", "", raw.strip())
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def fetch_listing(urls: Optional[List[str]] = None, retries: int = 3) -> str:
    """Fetch the tax sale page HTML, trying each URL in order with retries."""
    candidates = urls if urls else TAX_SALE_URLS
    last_error: Optional[Exception] = None
    for url in candidates:
        for attempt in range(1, retries + 1):
            try:
                logger.info(f"Fetching {url} (attempt {attempt})")
                resp = requests.get(url, headers=HEADERS, timeout=30)
                resp.raise_for_status()
                if url != candidates[0]:
                    logger.warning(f"Primary URL failed; listing served from fallback {url}")
                return resp.text
            except requests.RequestException as e:
                logger.warning(f"Attempt {attempt} failed: {e}")
                last_error = e
    raise RuntimeError(f"All {len(candidates)} DeKalb listing URLs failed") from last_error


def parse_table(html: str) -> List[Dict]:
    """Parse the tax sale HTML table into a list of property dicts."""
    soup = BeautifulSoup(html, "html.parser")

    # Detect maintenance page — table may still be present even during maintenance
    maintenance = soup.find(string=re.compile(r"currently unavailable", re.I))
    if maintenance:
        logger.warning("Site shows maintenance message — proceeding with whatever data is present")

    # Find all tables and pick the one with tax sale data (has 'Parcel' header)
    table = None
    for t in soup.find_all("table"):
        headers_text = " ".join(th.get_text(strip=True) for th in t.find_all("th")).lower()
        if "parcel" in headers_text or "tax sale" in headers_text:
            table = t
            break

    if table is None:
        logger.error("Could not find tax sale table in page HTML")
        return []

    # Build column index from <th> elements
    header_cells = table.find_all("th")
    col_names = [th.get_text(strip=True).lower().replace(" ", "_") for th in header_cells]
    logger.info(f"Columns detected: {col_names}")

    properties: List[Dict] = []
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if not cells:
            continue  # skip header row

        # Build a raw dict keyed by column name
        raw: Dict[str, str] = {}
        for i, cell in enumerate(cells):
            key = col_names[i] if i < len(col_names) else f"col_{i}"
            raw[key] = cell.get_text(strip=True)

        # Map to the canonical format expected by run_ga_county
        tax_sale_date_raw = (
            raw.get("tax_sale_date") or raw.get("sale_date") or ""
        )
        auction_date = _parse_date(tax_sale_date_raw)

        parcel_id = (
            raw.get("parcel_id") or raw.get("parcel") or ""
        ).strip()

        address = (
            raw.get("address") or raw.get("situs_address") or ""
        ).strip()

        owner = (
            raw.get("owner") or raw.get("owner_name") or ""
        ).strip()

        defendant = (
            raw.get("defendant") or ""
        ).strip().replace("\r\n", " / ").replace("\n", " / ")

        tax_sale_id = (
            raw.get("tax_sale_id") or raw.get("sale_id") or ""
        ).strip()

        levy_type = (
            raw.get("levy_type") or ""
        ).strip()

        tax_due_raw = (
            raw.get("total_tax_due") or raw.get("tax_due") or raw.get("amount_due") or ""
        )
        tax_due = _parse_currency(tax_due_raw)

        if not parcel_id:
            continue  # skip malformed rows

        prop = {
            "county":        "DeKalb",
            "tax_id":        parcel_id,
            "full_address":  address,
            "zip_code":      None,   # not provided by the web listing
            "owner":         owner,
            "defendant":     defendant,
            "tax_sale_id":   tax_sale_id,
            "auction_date":  auction_date,
            "levy_type":     levy_type,
            "tax_due":       tax_due,
            "source":        "dekalb_web",
            "raw_text":      " ".join(raw.values()),
        }
        properties.append(prop)

    return properties


def save_results(properties: List[Dict], output_path: Optional[Path] = None) -> Path:
    """Save parsed properties to JSON. Returns the path written."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if output_path is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = OUTPUT_DIR / f"dekalb_parsed_web_{timestamp}.json"

    with open(output_path, "w") as f:
        json.dump(properties, f, indent=2)

    logger.info(f"Saved {len(properties)} properties → {output_path}")
    return output_path


def scrape(output_path: Optional[Path] = None, dry_run: bool = False):
    """Full pipeline: fetch → parse → save.

    Returns:
        (properties, saved_path) — saved_path is None on dry run or error.
    """
    html = fetch_listing()
    properties = parse_table(html)

    if not properties:
        logger.error("No properties parsed — check HTML structure or maintenance status")
        return [], None

    # Summarize by auction date
    dates = {}
    for p in properties:
        d = p.get("auction_date") or "unknown"
        dates[d] = dates.get(d, 0) + 1
    for d, count in sorted(dates.items()):
        logger.info(f"  Auction {d}: {count} properties")

    if dry_run:
        print(json.dumps(properties[:3], indent=2))
        logger.info(f"Dry run — {len(properties)} properties parsed, not saved")
        return properties, None

    saved = save_results(properties, output_path)
    return properties, saved


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape DeKalb County tax sale listing")
    parser.add_argument("--output", default=None, help="Output JSON path")
    parser.add_argument("--dry-run", action="store_true", help="Print sample without saving")
    args = parser.parse_args()

    out = Path(args.output) if args.output else None
    _, saved = scrape(output_path=out, dry_run=args.dry_run)
    if saved:
        print(f"\nSaved → {saved}")
