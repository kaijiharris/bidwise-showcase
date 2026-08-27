"""
DeKalb County Final Pipeline v2 – Fast Edition
================================================
Strategy (avoids 60s-per-property Apify lookups):
  1. Parse PDF → 25+ properties (parcel_id, pdf_address, tax_due)
  2. ONE Apify sold-comps pull per unique zip/district (cached)
  3. Gemini analysis per property (uses pdf_address + tax_due + nearby comps)
  4. Format Faribault-style 5-sheet Excel

Beds/baths/sqft are labelled N/A where Zillow lookup is unavailable.
Deal analysis is still complete with ARV/max_bid/risk_flags from Gemini.
"""

import os, re, sys, json, time
import pdfplumber
import pandas as pd
import requests
from bs4 import BeautifulSoup
import dotenv
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
dotenv.load_dotenv(ROOT / '.env')

from execution.comprehensive_property_enrichment import PropertyEnrichmentEngine

OUT_DIR = ROOT / 'DeKalb_Analysis_Results'
OUT_DIR.mkdir(exist_ok=True)

RUN_TS   = datetime.now().strftime('%Y%m%d_%H%M%S')
ERR_LOG  = []
ITER_LOG = []

def err(stage, pid, exc, detail=''):
    e = {'stage': stage, 'parcel': pid, 'error': type(exc).__name__,
         'message': str(exc)[:300], 'detail': detail, 'ts': datetime.now().isoformat()}
    ERR_LOG.append(e)
    print(f"  ✗ [{stage}] {pid}: {exc}")

def note(pid, step, msg):
    ITER_LOG.append({'parcel': pid, 'step': step, 'result': str(msg)[:200],
                     'ts': datetime.now().isoformat()})
    print(f"  → [{step}] {pid}: {msg}")

def scrape_qpublic_dekalb(parcel_id: str) -> dict:
    url = f"https://qpublic.schneidercorp.com/Application.aspx?AppID=943&LayerID=17706&PageTypeID=4&PageID=8484&Q={parcel_id}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code != 200: return {}
        soup = BeautifulSoup(resp.text, 'html.parser')
        data = {'source_url': url}
        for table in soup.find_all('table', class_='DataletData'):
            for row in table.find_all('tr'):
                cells = row.find_all('td')
                if len(cells) >= 2:
                    k, v = cells[0].get_text(strip=True).lower(), cells[1].get_text(strip=True)
                    if 'property class' in k: data['property_class'] = v
                    elif 'location address' in k or 'physical address' in k: data['full_address'] = v
                    elif 'bedrooms' in k or 'beds' in k:
                        try: data['beds'] = int(v)
                        except: pass
                    elif 'bathrooms' in k or 'baths' in k:
                        try: data['baths'] = float(v)
                        except: pass
                    elif 'square feet' in k or 'living area' in k:
                        try: data['sqft'] = int(v.replace(',', ''))
                        except: pass
                    elif 'year built' in k:
                        try: data['year_built'] = int(v)
                        except: pass
        return data
    except Exception as e:
        err('qpublic', parcel_id, e)
        return {}

# ── STEP 1: PDF Parser ──────────────────────────────────────────────────────
def parse_pdf(pdf_path: str) -> list:
    print(f"\n{'='*65}\nSTEP 1 – Parse PDF\n{'='*65}")
    props = []
    cur   = {}
    with pdfplumber.open(pdf_path) as pdf:
        total = min(50, len(pdf.pages))
        print(f"  Pages: {total} (limited for speed)")
        for i in range(total):
            try:
                text = pdf.pages[i].extract_text(layout=True)
            except Exception:
                continue
            if not text:
                continue
            for line in text.split('\n'):
                # Parcel header
                m = re.match(
                    r'^\s*(\d{2}\s\d{3}\s\d{2}\s\d{3})\s+(.+?)(?:\s{3,}|$)', line)
                if m:
                    raw_addr = m.group(2).strip()
                    # Drop trailing "TAX DISTRICT:…" junk
                    raw_addr = re.sub(r'\s+TAX DISTRICT.*', '', raw_addr).strip()
                    cur = {'parcel_id': m.group(1).replace(' ', ''),
                           'pdf_address': raw_addr}
                # Grand Total
                t = re.search(r'GRAND TOTAL DUE\s+([\d,]+\.\d{2})', line)
                if t and cur.get('parcel_id'):
                    cur['tax_due'] = float(t.group(1).replace(',', ''))
                    props.append(dict(cur))
                    cur = {}
    print(f"  Extracted {len(props)} parcels")
    return props

# ── STEP 2: Batch sold comps (one pull per zip, cached) ────────────────────
_comp_cache: dict = {}

def fetch_comps(zip_code: str, apify) -> list:
    if zip_code in _comp_cache:
        return _comp_cache[zip_code]
    print(f"  Fetching sold comps for {zip_code}…")
    try:
        # Use zip code directly as location string – Zillow recognises it
        comps = apify.get_sold_properties(city=zip_code, state_code='GA', limit=20)
        _comp_cache[zip_code] = comps
        print(f"  Cached {len(comps)} comps for {zip_code}")
    except Exception as e:
        err('comps', zip_code, e)
        _comp_cache[zip_code] = []
    return _comp_cache[zip_code]

# ── STEP 3: Gemini analysis ────────────────────────────────────────────────
def analyse(prop: dict, comps: list, analyzer) -> dict:
    comp_prices = [c.get('sale_price') or c.get('price') for c in comps
                   if c.get('sale_price') or c.get('price')]
    zest = prop.get('zestimate')
    
    market_val = zest
    if not market_val and comp_prices:
        market_val = sum(comp_prices) / len(comp_prices)
        
    payload = {
        'county'    : 'DeKalb',
        'tax_id'    : prop['parcel_id'],
        'tax_due'   : prop['tax_due'],
        'street_name': prop.get('pdf_address', ''),
        'property_type': prop.get('property_type'),
        'market_value_estimate': market_val,
        'low_value_estimate': min(comp_prices) if comp_prices else None,
        'high_value_estimate': max(comp_prices) if comp_prices else None
    }
    try:
        r = analyzer.analyze_property(payload)
        prop['max_bid']        = r.recommended_max_bid
        prop['arv']            = r.arv
        prop['repair_cost']    = r.repair_cost_estimate
        prop['as_is_value']    = r.as_is_value
        prop['risk_flags']     = ', '.join(r.risk_flags) if r.risk_flags else 'None'
        prop['strategy_notes'] = r.strategy_notes or ''
        prop['analysis_notes'] = r.analysis_notes or ''
        note(prop['parcel_id'], 'Gemini',
             f"max_bid={r.recommended_max_bid}  arv={r.arv}  risk={r.risk_flags}")
    except Exception as e:
        err('gemini', prop['parcel_id'], e)
        prop['max_bid']        = round(prop['tax_due'] * 1.5, 2)
        prop['arv']            = None
        prop['repair_cost']    = None
        prop['as_is_value']    = None
        prop['risk_flags']     = 'ANALYSIS_FAILED'
        prop['strategy_notes'] = ''
        prop['analysis_notes'] = f'Gemini error: {str(e)[:120]}'
    return prop

# ── STEP 4: Build Excel ────────────────────────────────────────────────────
from execution.export.spreadsheet_generator import SpreadsheetGenerator

def build_excel(props: list, all_comps: list, out_file: str) -> str:
    mapped_props = []
    for p in props:
        def g(*keys, d=None):
            for k in keys:
                v = p.get(k)
                if v is not None and v != '': return v
            return d

        tax_due  = g('tax_due', d=0)
        max_bid  = g('max_bid', d=0) or 0
        arv      = g('arv', d=0) or 0
        sqft_val = g('sqft') or 0
        yr_built = g('year_built') or 0

        # ── REHAB COST ────────────────────────────────────────────────────────
        # If Gemini didn't provide an estimate, compute deterministically.
        # Tax deed properties are abandoned/neglected — use elevated rates.
        repair_cost = g('repair_cost', d=0) or 0
        if repair_cost == 0:
            if sqft_val > 0:
                age = (2026 - yr_built) if yr_built > 1900 else 50
                if age < 20:
                    rate = 35    # Post-2005: cosmetic but still distressed
                elif age < 45:
                    rate = 55    # 1980-2005: standard rehab
                else:
                    rate = 85    # Pre-1980: heavy rehab
                repair_cost = round(sqft_val * rate * 1.15, 2)  # +15% contingency
            elif arv > 0:
                repair_cost = round(arv * 0.20, 2)  # 20% of ARV fallback
            else:
                repair_cost = 25000.0  # Conservative flat estimate

        # ── ALL-IN COST (GA Tax Deed methodology) ─────────────────────────────
        # Buying transaction costs (applied to purchase price = tax_due)
        closing_costs    = round(tax_due * 0.030, 2)   # Attorney, escrow, title search
        title_insurance  = round(tax_due * 0.005, 2)   # Title insurance (critical for tax deeds)
        transfer_tax     = round((tax_due / 1000) * 2.0, 2)  # GA: $2/$1,000 (state + county)
        recording_fees   = 250.0
        inspection_cost  = 500.0

        # GA-specific: quiet title action is REQUIRED for marketable title before resale
        quiet_title_cost = 3500.0  # Attorney fees; can range $2k-$5k

        # Carrying costs — 12 months (3-6 quiet title + 3-6 marketing/closing)
        insurance_hold   = round((sqft_val * 0.45 / 12) * 12, 2) if sqft_val else 540.0
        utilities_hold   = 200 * 12                     # $200/month
        security_hold    = 150 * 12                     # Vacant property security + lawn care
        prop_tax_hold    = round((arv * 0.010 / 12) * 12, 2) if arv else 0  # ~1% annual tax
        carrying_total   = insurance_hold + utilities_hold + security_hold + prop_tax_hold

        all_in_cost = (
            tax_due + repair_cost
            + closing_costs + title_insurance + transfer_tax + recording_fees + inspection_cost
            + quiet_title_cost
            + carrying_total
        )

        # ── AS-IS VALUE (uniform formula — same for every property) ───────────
        # "What would another investor pay for this property TODAY, without doing
        #  any rehab?" = the 70% rule applied from the buyer's perspective.
        #
        # Formula: As-Is = ARV × 0.70 − Rehab_Cost
        #   → High-risk (title/location issues): ARV × 0.65 − Rehab_Cost
        #   → Land/vacant: ARV × 0.20 (lot value — no rehab deducted)
        #   → Floor: max(As-Is, tax_due)
        #
        # This is the industry-standard MAO (Maximum Allowable Offer) formula.
        # It is intentionally excluded from all_in_cost — it's a reference value,
        # not a cost. It shows your immediate equity margin above what you paid.
        prop_type_lower = str(g('property_type', d='')).lower()
        is_land = prop_type_lower in ('land', 'lot', 'vacant', 'vacant land', 'vacant lot')

        if arv > 0:
            if is_land:
                as_is_val = round(arv * 0.20, 2)
            elif is_high_risk:
                as_is_val = round(arv * 0.65 - repair_cost, 2)
            else:
                as_is_val = round(arv * 0.70 - repair_cost, 2)
            as_is_val = max(as_is_val, tax_due)  # Floor at opening bid
        else:
            as_is_val = None

        # ── NET PROFIT & ROI (include selling costs) ──────────────────────────
        # Selling: 6% agent commission + 1% seller closing = 7% of ARV
        selling_costs = round(arv * 0.07, 2) if arv else 0
        net_proceeds  = arv - selling_costs if arv else 0
        net_profit    = round(net_proceeds - all_in_cost, 2) if arv else 0
        roi_pct       = round((net_profit / all_in_cost * 100), 2) if all_in_cost > 0 else 0

        # ── 70% RULE MAX BID (industry standard for fix-and-flip) ─────────────
        # GA tax deeds: use 65% of ARV (lower due to title risk + unknown condition).
        # Formula: max_purchase_price = (ARV × 0.65) − rehab − quiet_title − carrying
        if arv > 0:
            seventy_pct_max = max(
                round((arv * 0.65) - repair_cost - quiet_title_cost - carrying_total, 2),
                tax_due
            )
        else:
            seventy_pct_max = tax_due

        # Use lower of Gemini's max_bid and the 70% rule max
        effective_max_bid = min(max_bid, seventy_pct_max) if max_bid > 0 else seventy_pct_max

        # ── RISK FLAGS & DEAL SCORE ───────────────────────────────────────────
        risk_str   = str(g('risk_flags', d='Unknown'))
        is_failed  = 'FAILED' in risk_str
        is_high_risk = any(f in risk_str for f in [
            'QUESTIONABLE_LOCATION', 'LANDLOCKED', 'STREET_THROUGH_PARCEL', 'SPECIAL_DISTRICT'
        ])

        # Bid recommendation
        if is_failed or not arv:
            bid_recommendation = 'PASS — NO DATA'
        elif roi_pct >= 30 and not is_high_risk:
            bid_recommendation = f'BID — MAX ${effective_max_bid:,.0f}'
        elif roi_pct >= 20:
            bid_recommendation = 'POSSIBLE — VERIFY DATA'
        else:
            bid_recommendation = 'PASS — ROI TOO LOW'

        # Deal score (0-100): 70% weight ROI, 30% weight risk
        if is_failed:
            deal_score_val = 0
            composite_risk_val = 100
        else:
            if roi_pct >= 50:
                roi_pts = 70
            elif roi_pct >= 30:
                roi_pts = int(50 + (roi_pct - 30) * 1.0)   # 50-70
            elif roi_pct >= 20:
                roi_pts = int(30 + (roi_pct - 20) * 2.0)   # 30-50
            elif roi_pct > 0:
                roi_pts = int(roi_pct * 1.5)                # 0-30
            else:
                roi_pts = 0
            risk_pts = 0 if is_high_risk else (30 if risk_str in ('None', 'RESIDENTIAL', '') else 15)
            deal_score_val  = min(100, roi_pts + risk_pts)
            composite_risk_val = 80 if is_high_risk else (25 if roi_pct >= 30 else 50)

        mapped_props.append({
            'address': g('full_address', 'pdf_address', d='Unknown'),
            'city': 'DeKalb County',
            'parcel_id': g('parcel_id'),
            'property_type': g('property_type', d='Residential'),
            'bedrooms': g('beds'),
            'bathrooms': g('baths'),
            'sqft': sqft_val or None,
            'year_built': yr_built or None,
            'taxes_owed': tax_due,
            'minimum_bid': tax_due,
            'max_bid': effective_max_bid,
            'bid_recommendation': bid_recommendation,
            'as_is_price': as_is_val,
            'arv': arv or None,
            'rehab_cost': repair_cost,
            'all_in_cost': round(all_in_cost, 2),
            'net_profit': net_profit,
            'roi_pct': roi_pct,
            'deal_score': deal_score_val,
            'composite_risk_score': composite_risk_val,
            'best_comp_address': '',
            'best_comp_price': 0,
            'best_comp_beds': '',
            'best_comp_baths': '',
            'source_url': g('source_url', d=''),
            'risk_flags': risk_str,
            'strategy_notes': g('strategy_notes', d=''),
            'analysis_notes': g('analysis_notes', d=''),
            'filter_violations_note': 'Violates target ROI thresholds' if 0 < roi_pct < 20 else ''
        })

    all_deals = mapped_props
    # Top deals: ROI >= 30% (after selling costs) AND low-to-medium risk
    top_deals = [p for p in mapped_props if p['roi_pct'] >= 30.0 and p['composite_risk_score'] < 60]
    # Exceptional: ROI >= 50% (outstanding return even after all costs)
    exceptional_deals = [p for p in mapped_props
                         if p['roi_pct'] >= 50.0 and p not in top_deals]

    generator = SpreadsheetGenerator(output_dir=str(Path(out_file).parent))
    
    query_params = {
        'State': 'GA',
        'County': 'DeKalb',
        'Strategy': 'flip',
        'Max Budget': '$n/a',
        'Min ROI': '30.0%',
        'Max Risk Score': 60
    }
    
    filename = Path(out_file).name
    generator.generate(
        top_deals=top_deals,
        exceptional_deals=exceptional_deals,
        all_deals=all_deals,
        query_params=query_params,
        filename=filename,
        all_comps=all_comps
    )
    
    # Save errors/iterations using pandas as they are unique to this pipeline
    df_errs = pd.DataFrame(ERR_LOG)
    df_iter = pd.DataFrame(ITER_LOG)
    with pd.ExcelWriter(out_file, engine='openpyxl', mode='a', if_sheet_exists='replace') as w:
        if not df_errs.empty: df_errs.to_excel(w, sheet_name='Errors', index=False)
        if not df_iter.empty: df_iter.to_excel(w, sheet_name='Iterations', index=False)
        
    print(f"\n  ✓ Saved Faribault-style Excel: {out_file} ({len(mapped_props)} properties)")
    return out_file

# ── MAIN ──────────────────────────────────────────────────────────────────
def main():
    print("\n" + "="*65)
    print("  DEKALB – FINAL PIPELINE v2 (FAST)")
    print("  Timestamp:", RUN_TS)
    print("="*65)

    sys.path.insert(0, str(ROOT))
    from execution.enrichment.apify_comps import ApifyZillowComps
    from execution.analysis.tax_deed_analyzer import TaxDeedAnalyzer
    from execution.comprehensive_property_enrichment import PropertyEnrichmentEngine

    apify_key  = os.getenv('APIFY_API_KEY')
    gemini_key = os.getenv('GEMINI_API_KEY')

    if not apify_key or not gemini_key:
        print("Missing API keys in .env")
        return

    apify = ApifyZillowComps()
    engine = PropertyEnrichmentEngine(apify_key, gemini_key)
    analyzer = TaxDeedAnalyzer(gemini_key)

    # 1 – PDF
    raw = parse_pdf(str(ROOT / '.tmp/dekalb_pdfs/dekalb_tax_list.pdf'))

    # Pre-fetch comps for the first few zip codes we encounter (reused across properties)
    print(f"\n{'='*65}\nSTEP 2 – Pre-fetch sold comps (unique zips)\n{'='*65}")
    UNIQUE_ZIPS = set()
    for item in raw[:60]:
        z = re.search(r'\b3\d{4}\b', item.get('pdf_address', ''))
        if z:
            UNIQUE_ZIPS.add(z.group(0))
    # Limit to first 3 unique zips to contain API cost
    for zip_code in list(UNIQUE_ZIPS)[:3]:
        fetch_comps(zip_code, apify)

    # 2+3+4 – Enrich & analyse
    print(f"\n{'='*65}\nSTEP 3 – Gemini Analysis (25 properties)\n{'='*65}")
    complete: list = []
    all_comps: list = []

    for item in raw:
        if len(complete) >= 25:
            break

        pid  = item['parcel_id']
        addr = item.get('pdf_address', '')
        if not addr:
            continue

        prop = dict(item)

        # Clean address: remove stray digits after the zip code
        zip_m = re.search(r'\b3\d{4}\b', addr)
        clean_addr = addr[:zip_m.end()] if zip_m else addr

        # Zillow Search for target property details (Bypasses QPublic Cloudflare)
        print(f"\n[{len(complete)+1}/25]  {pid}  |  {clean_addr}  |  tax_due=${item['tax_due']:,.2f}")
        zdata = engine.search_property_on_zillow(clean_addr, "", "GA")
        if zdata and zdata.get('success'):
            prop['beds']       = zdata.get('bedrooms')
            prop['baths']      = zdata.get('bathrooms')
            prop['sqft']       = zdata.get('sqft')
            prop['year_built'] = zdata.get('year_built')
            prop['zestimate']  = zdata.get('zestimate')
            prop['property_type'] = zdata.get('property_type')
            print(f"  ✓ Zillow Data: {prop['beds']}bd / {prop['baths']}ba, {prop['sqft']}sqft, {prop['property_type']}")
        else:
            print("  ✗ Zillow Search Failed, fields will be N/A")

        # Get comps for this property's zip
        zip_m = re.search(r'\b3\d{4}\b', addr)
        comps = fetch_comps(zip_m.group(0), apify) if zip_m else []
        
        for c in comps:
            c['source_parcel'] = pid
        all_comps.extend(comps)

        # Gemini
        prop = analyse(prop, comps, analyzer)
        complete.append(prop)
        time.sleep(0.3)

    # 5 – Excel
    print(f"\n{'='*65}\nSTEP 5 – Building Excel\n{'='*65}")
    out_file = str(OUT_DIR / f'DeKalb_25_FINAL_{RUN_TS}.xlsx')
    build_excel(complete, all_comps, out_file)

    # Persist logs
    (OUT_DIR / f'errors_{RUN_TS}.json'    ).write_text(json.dumps(ERR_LOG,  indent=2))
    (OUT_DIR / f'iterations_{RUN_TS}.json').write_text(json.dumps(ITER_LOG, indent=2))

    print("\n" + "="*65)
    print("  DONE")
    print(f"  Properties : {len(complete)}")
    print(f"  Comps      : {len(set(c.get('address','') for c in all_comps))}")
    print(f"  Errors     : {len(ERR_LOG)}")
    print(f"  Output     : {out_file}")
    print("="*65)

if __name__ == '__main__':
    main()
