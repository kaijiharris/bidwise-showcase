"""
enrich_qpublic.py
Fetches beds / baths / sqft / year_built for every property in the latest
DeKalb enhanced JSON by scraping DeKalb County's public qPublic portal.

No API cost — this is the free public county assessor portal.

Cloudflare bypass: uses cloudscraper (pip install cloudscraper).
Form-based search: submits parcel ID via the ASP.NET WebForms search form.

Usage:
    python execution/enrich_qpublic.py
"""

import json
import os
import time
import sys
from datetime import datetime
from pathlib import Path

try:
    import cloudscraper
except ImportError:
    print("Installing cloudscraper...")
    os.system(f'"{sys.executable}" -m pip install cloudscraper -q')
    import cloudscraper

from bs4 import BeautifulSoup

ROOT = Path(__file__).parent.parent
RESULTS_DIR = ROOT / '.tmp' / 'dekalb_results'

SEARCH_URL = (
    "https://qpublic.schneidercorp.com/Application.aspx"
    "?AppID=994&PageTypeID=2&PageID=8822"
)

# -------------------------------------------------------------------
# qPublic scraper — DeKalb County GA (AppID=994)
# -------------------------------------------------------------------
def scrape_qpublic_dekalb(scraper_session, parcel_id: str) -> dict:
    """
    Scrapes beds, baths, sqft, year_built from DeKalb County's qPublic portal.
    Uses form POST (parcel search) then follows the Summary tab link.
    Returns a dict with keys: bedrooms, bathrooms, sqft, year_built, property_class
    """
    try:
        # Step 1: Load search page (gets fresh ViewState cookies)
        r = scraper_session.get(SEARCH_URL, timeout=30)
        if r.status_code != 200:
            return {}

        soup = BeautifulSoup(r.text, 'html.parser')
        form_data = {
            inp.get('name', ''): inp.get('value', '') or ''
            for inp in soup.find_all('input')
            if inp.get('name')
        }

        # Step 2: Submit parcel ID search
        form_data['__EVENTTARGET'] = 'ctlBodyPane$ctl02$ctl01$btnSearch'
        form_data['__EVENTARGUMENT'] = ''
        form_data['ctlBodyPane$ctl02$ctl01$txtParcelID'] = parcel_id

        r2 = scraper_session.post(SEARCH_URL, data=form_data, timeout=30)
        if r2.status_code != 200:
            return {}

        soup2 = BeautifulSoup(r2.text, 'html.parser')

        # Step 3: Find and follow Summary tab
        summary_url = None
        for link in soup2.find_all('a', href=True):
            href = link.get('href', '')
            if 'PageTypeID=4' in href and 'Summary' in link.text:
                summary_url = 'https://qpublic.schneidercorp.com' + href
                break

        if not summary_url:
            return {}

        r3 = scraper_session.get(summary_url, timeout=30)
        if r3.status_code != 200:
            return {}

        soup3 = BeautifulSoup(r3.text, 'html.parser')
        data = {}

        # Step 4: Extract from tabular-data-two-column tables
        for table in soup3.find_all('table', class_='tabular-data-two-column'):
            for row in table.find_all('tr'):
                cells = row.find_all('td')
                if len(cells) < 2:
                    continue
                k = cells[0].get_text(strip=True).lower()
                v = cells[1].get_text(strip=True)

                if not v:
                    continue

                if 'property class' in k:
                    data['property_class'] = v

                elif 'year built' in k:
                    try:
                        data['year_built'] = int(v.replace(',', ''))
                    except Exception:
                        pass

                elif 'res sq ft' in k or 'living area' in k or 'heated area' in k:
                    try:
                        data['sqft'] = int(v.replace(',', ''))
                    except Exception:
                        pass

                elif 'bedrooms' in k:
                    try:
                        data['bedrooms'] = int(v)
                    except Exception:
                        pass

                elif 'full bath' in k and 'half' in k:
                    # Format: "2/1" → 2 full + 1 half = 2.5
                    try:
                        parts = v.split('/')
                        full = int(parts[0].strip())
                        half = int(parts[1].strip()) if len(parts) > 1 else 0
                        data['bathrooms'] = full + (0.5 * half)
                    except Exception:
                        pass

                elif 'full bath' in k and 'half' not in k:
                    try:
                        data['bathrooms'] = float(v)
                    except Exception:
                        pass

        return data

    except Exception as e:
        print(f"  [ERR] qpublic scrape failed for {parcel_id}: {e}")
        return {}


# -------------------------------------------------------------------
# Rehab rate recalculation (age-based, same as deterministic_analyzer)
# -------------------------------------------------------------------
def calc_rehab(sqft: int, year_built: int) -> float:
    """sqft * age-based rate + 15% contingency."""
    age = (2026 - year_built) if (year_built and year_built > 1900) else 50
    if age < 20:
        rate = 35
    elif age < 45:
        rate = 55
    else:
        rate = 85
    return round(sqft * rate * 1.15, 2)


# -------------------------------------------------------------------
# Find latest analysis JSON (any prefix, by timestamp in filename)
# -------------------------------------------------------------------
def find_latest_enhanced() -> Path:
    candidates = []
    for pattern in ('dekalb_enriched_*.json', 'dekalb_enhanced_*.json', 'dekalb_deterministic_*.json'):
        candidates.extend(RESULTS_DIR.glob(pattern))
    if not candidates:
        raise FileNotFoundError(f"No analysis JSON found in {RESULTS_DIR}")
    return sorted(candidates)[-1]  # newest by filename (timestamp embedded)


# -------------------------------------------------------------------
# Main
# -------------------------------------------------------------------
def main():
    src = find_latest_enhanced()
    print(f"Source: {src.name}")

    with open(src, encoding='utf-8') as f:
        data = json.load(f)

    properties = data.get('properties', [])
    print(f"Properties to enrich: {len(properties)}")

    scraper_session = cloudscraper.create_scraper()
    enriched_count = 0
    rehab_updated = 0

    for i, prop in enumerate(properties):
        tax_id = prop.get('tax_id', '')
        addr   = prop.get('full_address', f'property_{i}')

        # Skip if already has beds AND sqft
        if prop.get('bedrooms') and prop.get('sqft'):
            print(f"  [{i+1:02d}] {addr[:45][:45]} - already enriched, skipping")
            continue

        print(f"  [{i+1:02d}] Fetching: {tax_id} ({addr[:38]})", end=' ... ', flush=True)
        info = scrape_qpublic_dekalb(scraper_session, tax_id)

        if not info:
            print("no data returned")
            time.sleep(2)
            continue

        changed = []
        for field in ('bedrooms', 'bathrooms', 'sqft', 'year_built'):
            if info.get(field) is not None and prop.get(field) is None:
                prop[field] = info[field]
                changed.append(f"{field}={info[field]}")

        # Also update property_class if available
        if info.get('property_class') and not prop.get('property_class'):
            prop['property_class'] = info['property_class']

        if changed:
            enriched_count += 1
            print(f"[OK] {', '.join(changed)}")
        else:
            got = {k: v for k, v in info.items()}
            print(f"no new fields (got: {got})")

        # Recalculate rehab now that we have real sqft
        sqft = prop.get('sqft')
        yr   = prop.get('year_built')
        if sqft and sqft > 0:
            new_rehab = calc_rehab(sqft, yr)
            old_rehab = prop.get('estimated_rehab', 0) or 0
            if abs(new_rehab - old_rehab) > 500:
                prop['estimated_rehab'] = new_rehab
                age = (2026 - yr) if yr else 50
                rate = 35 if age < 20 else (55 if age < 45 else 85)
                prop['rehab_calculation'] = (
                    f"{sqft:,} sqft x ${rate}/sqft "
                    f"(age {age}yr) x 1.15 contingency = ${new_rehab:,.0f}"
                )
                rehab_updated += 1

        # Politeness delay
        time.sleep(1.5)

    print(f"\nEnriched: {enriched_count}/{len(properties)} properties")
    print(f"Rehab recalculated: {rehab_updated} properties")

    # Save as enriched (takes priority in generate_ui_data.py)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    out_path = RESULTS_DIR / f'dekalb_enriched_{ts}.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"\nSaved: {out_path.name}")

    # Auto-regenerate ui/data.js
    print("\nRegenerating ui/data.js ...")
    gen_script = ROOT / 'execution' / 'generate_ui_data.py'
    os.system(f'"{sys.executable}" "{gen_script}"')

    print("\nDone. Refresh ui/index.html to see updated results.")


if __name__ == '__main__':
    main()
