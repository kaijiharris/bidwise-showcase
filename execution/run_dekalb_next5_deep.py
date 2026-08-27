"""
DeKalb County – Deep Analysis: Next 5 Properties (26-30)
=========================================================
Accurate, property-specific analysis. Every metric is derived from
the actual specs of the individual property — not market averages.

Data pipeline per property:
  1. PDF parse  → parcel_id, address, tax_due
  2. ArcGIS     → sqft, beds, baths, year_built, appraised_value  (free, official)
  3. Apify comps→ 30 recently sold homes in same zip/city
  4. ARV engine → filters comps to ±25% sqft, median price/sqft × subject sqft
  5. Rehab      → sqft × age-based rate + 10% contingency
  6. All-in cost→ full model (purchase + rehab + closing + title + transfer + carry)
  7. Gemini     → cross-check with comp context, risk flags, bid strategy
  8. Excel      → per-property breakdown with full financial transparency

Bugs fixed vs prior pipeline:
  - Comp price field was 'price' (always None) → now correctly 'sale_price'
  - ARV was city median ($700k flat) → now price/sqft × actual sqft
  - All-in cost omitted ~$4.6k per deal in transaction + carry costs
  - Rehab was Gemini-estimated (no sqft) → now deterministic sqft × rate
  - Addresses truncated in PDF → cleaned + city name fallback added
"""

import os, re, sys, json, time
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pdfplumber
import pandas as pd
import dotenv
from pathlib import Path
from datetime import datetime
from statistics import median

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
dotenv.load_dotenv(ROOT / '.env')

from execution.enrichment.apify_comps import ApifyZillowComps
from execution.analysis.tax_deed_analyzer import TaxDeedAnalyzer
from execution.enrichment.dekalb_arcgis_enrichment import DeKalbArcGISEnricher

OUT_DIR = ROOT / 'DeKalb_Analysis_Results'
OUT_DIR.mkdir(exist_ok=True)

RUN_TS  = datetime.now().strftime('%Y%m%d_%H%M%S')
ERR_LOG  = []
ITER_LOG = []

# Target parcel IDs (properties 31-35)
TARGET_PARCELS = {
    '0630703017', '0630703085', '0630704016',
    '0630705009', '0630708011'
}

# Zip → city fallback (Apify returns 0 for some GA zips; city name works better)
ZIP_TO_CITY = {
    '30360': 'Dunwoody',
    '30340': 'Chamblee',
    '30341': 'Chamblee',
    '30345': 'Tucker',
    '30346': 'Dunwoody',
    '30350': 'Dunwoody',
    '30058': 'Lithonia',
    '30083': 'Stone Mountain',
    '30084': 'Tucker',
    '30088': 'Stone Mountain',
}


def log_err(stage, pid, exc):
    e = {'stage': stage, 'parcel': pid, 'error': type(exc).__name__,
         'message': str(exc)[:400], 'ts': datetime.now().isoformat()}
    ERR_LOG.append(e)
    print(f"  [ERR/{stage}] {pid}: {exc}")


def log_step(pid, step, msg):
    ITER_LOG.append({'parcel': pid, 'step': step, 'result': str(msg)[:300],
                     'ts': datetime.now().isoformat()})
    print(f"  [{step}] {pid}: {msg}")


# ── Step 1: PDF parse ────────────────────────────────────────────────────────
def parse_pdf_targets(pdf_path: str) -> list:
    print(f"\n{'='*65}\nStep 1 – Parse PDF for target parcels\n{'='*65}")
    props, cur = [], {}
    with pdfplumber.open(pdf_path) as pdf:
        for i in range(min(80, len(pdf.pages))):
            try:
                text = pdf.pages[i].extract_text(layout=True)
            except Exception:
                continue
            if not text:
                continue
            for line in text.split('\n'):
                m = re.match(r'^\s*(\d{2}\s\d{3}\s\d{2}\s\d{3})\s+(.+?)(?:\s{3,}|$)', line)
                if m:
                    pid = m.group(1).replace(' ', '')
                    raw_addr = re.sub(r'\s+TAX DISTRICT.*', '', m.group(2)).strip()
                    cur = {'parcel_id': pid, 'pdf_address': raw_addr}
                t = re.search(r'GRAND TOTAL DUE\s+([\d,]+\.\d{2})', line)
                if t and cur.get('parcel_id'):
                    cur['tax_due'] = float(t.group(1).replace(',', ''))
                    if cur['parcel_id'] in TARGET_PARCELS:
                        props.append(dict(cur))
                        print(f"  Found {cur['parcel_id']} | {cur['pdf_address']} | ${cur['tax_due']:,.2f}")
                    cur = {}
    print(f"  {len(props)}/{len(TARGET_PARCELS)} target parcels found")
    return props


# ── Step 2: ArcGIS enrichment (official county assessor data) ───────────────
def enrich_from_arcgis(enricher: DeKalbArcGISEnricher, prop: dict) -> dict:
    """Pull actual sqft/beds/baths/year_built from DeKalb County ArcGIS."""
    pid  = prop['parcel_id']
    addr = prop.get('clean_address', prop.get('pdf_address', ''))
    city = prop.get('city', 'Dunwoody')

    specs = enricher.get_specs(pid, addr, city)
    prop['sqft']            = specs.get('sqft')
    prop['beds']            = specs.get('beds')
    prop['baths']           = specs.get('baths')
    prop['year_built']      = specs.get('year_built')
    prop['assessed_value']  = specs.get('assessed_value')
    prop['appraised_value'] = specs.get('appraised_value')
    prop['property_class']  = specs.get('property_class')
    prop['assessor_address']= specs.get('assessor_address')
    prop['spec_source']     = specs.get('data_source', 'NOT_FOUND')
    prop['spec_confidence'] = specs.get('data_confidence', 'NONE')

    log_step(pid, 'ArcGIS',
             f"sqft={prop['sqft']} beds={prop['beds']} baths={prop['baths']} "
             f"yr={prop['year_built']} appr=${prop.get('appraised_value')} "
             f"src={prop['spec_source']}")

    if prop['sqft']:
        print(f"  Assessor: {prop['beds']}bd/{prop['baths']}ba  "
              f"{prop['sqft']:,}sqft  built {prop['year_built']}  "
              f"appraised=${prop.get('appraised_value'):,}")
    else:
        print(f"  Assessor: no structure data (vacant lot / commercial)  "
              f"appraised=${prop.get('appraised_value')}")
    return prop


# ── Step 3: Comps cache ──────────────────────────────────────────────────────
_comp_cache: dict = {}

def fetch_comps(location: str, apify: ApifyZillowComps) -> list:
    if location in _comp_cache:
        return _comp_cache[location]
    print(f"  Fetching sold comps for '{location}'...")
    try:
        comps = apify.get_sold_properties(city=location, state_code='GA', limit=50)
        if not comps:
            # Zip returned nothing — try city name
            city_fallback = ZIP_TO_CITY.get(location)
            if city_fallback and city_fallback != location:
                print(f"  No results for '{location}', retrying with city '{city_fallback}'...")
                comps = apify.get_sold_properties(city=city_fallback, state_code='GA', limit=50)
        _comp_cache[location] = comps
        print(f"  Cached {len(comps)} comps for '{location}'")
    except Exception as e:
        log_err('comps', location, e)
        _comp_cache[location] = []
    return _comp_cache[location]


# ── Step 4: Property-specific ARV ───────────────────────────────────────────
def compute_property_arv(comps: list, subject_sqft: int | None,
                         appraised_value: float | None = None) -> dict:
    """
    Derive an ARV that is specific to THIS property's size.

    Algorithm:
      1. Extract valid comps (have both sale_price and sqft)
      2. If subject_sqft known:
           a. Filter comps to within ±25% sqft of subject
           b. If fewer than 3 comps, widen to ±40%
           c. If still fewer than 3, use all comps with valid sqft
           d. ARV = median(sale_price / sqft) × subject_sqft
      3. If subject_sqft unknown:
           - ARV = median(sale_price) of all comps — flag as LOW confidence
      4. Validate against assessor appraised_value if available:
           - If ARV < appraised_value, use appraised_value as floor (assessor
             is conservative but not below market)
           - If ARV > 3× appraised_value, flag as suspect (comp quality issue)

    Returns dict with: arv, arv_confidence, arv_method, comp_count_used,
                       median_ppsf, comp_price_range, filter_band_sqft
    """
    # Separate comps with and without sqft
    full_comps = []   # (sale_price, sqft, address)
    price_only = []   # sale_price only

    for c in comps:
        sp = c.get('sale_price') or c.get('price')
        if not sp or not isinstance(sp, (int, float)) or sp <= 0:
            continue
        sqft = c.get('sqft')
        if sqft and isinstance(sqft, (int, float)) and sqft > 0:
            full_comps.append((float(sp), float(sqft), c.get('address', '')))
        else:
            price_only.append(float(sp))

    if not full_comps and not price_only:
        return {
            'arv': appraised_value,
            'arv_confidence': 'VERY_LOW' if appraised_value else 'NONE',
            'arv_method': 'assessor_appraised_value_only' if appraised_value else 'NO_DATA',
            'comp_count_used': 0,
            'median_ppsf': None,
            'comp_price_range': None,
            'filter_band_sqft': None,
        }

    # ── Path A: subject sqft known → use price/sqft method ──────────────────
    if subject_sqft and full_comps:
        result = _arv_by_ppsf(full_comps, subject_sqft, appraised_value)
        return result

    # ── Path B: subject sqft unknown → median comp price ────────────────────
    all_prices = [sp for sp, _, _ in full_comps] + price_only
    arv = round(median(all_prices), 0)
    lo  = round(min(all_prices), 0)
    hi  = round(max(all_prices), 0)

    # Still validate against appraised (floor only)
    if appraised_value and arv < appraised_value:
        arv = appraised_value
        method = 'median_comp_price → raised to assessor_appraised_floor'
    else:
        method = f'median_comp_price ({len(all_prices)} comps, no sqft filter)'

    return {
        'arv': arv,
        'arv_confidence': 'LOW',
        'arv_method': method,
        'comp_count_used': len(all_prices),
        'median_ppsf': None,
        'comp_price_range': f'${lo:,.0f}–${hi:,.0f}',
        'filter_band_sqft': None,
    }


def _arv_by_ppsf(full_comps: list, subject_sqft: float,
                 appraised_value: float | None) -> dict:
    """
    Core price/sqft ARV calculation with tiered sqft filtering.
    full_comps = list of (sale_price, sqft, address)
    """
    def _calc(filtered, band_label):
        ppsf_list = [sp / sqft for sp, sqft, _ in filtered]
        med_ppsf  = median(ppsf_list)
        arv       = round(med_ppsf * subject_sqft, 0)
        prices    = [sp for sp, _, _ in filtered]
        return {
            'arv': arv,
            'arv_confidence': 'HIGH' if len(filtered) >= 5 else 'MEDIUM',
            'arv_method': (f'median_ppsf(${med_ppsf:.0f}) × {subject_sqft:,.0f}sqft '
                           f'| {len(filtered)} comps within {band_label}'),
            'comp_count_used': len(filtered),
            'median_ppsf': round(med_ppsf, 2),
            'comp_price_range': f'${min(prices):,.0f}–${max(prices):,.0f}',
            'filter_band_sqft': band_label,
        }

    # Tier 1: ±25%
    lo25, hi25 = subject_sqft * 0.75, subject_sqft * 1.25
    tier1 = [(sp, sq, a) for sp, sq, a in full_comps if lo25 <= sq <= hi25]
    if len(tier1) >= 3:
        result = _calc(tier1, f'{lo25:,.0f}–{hi25:,.0f}sqft (±25%)')
    else:
        # Tier 2: ±40%
        lo40, hi40 = subject_sqft * 0.60, subject_sqft * 1.40
        tier2 = [(sp, sq, a) for sp, sq, a in full_comps if lo40 <= sq <= hi40]
        if len(tier2) >= 3:
            result = _calc(tier2, f'{lo40:,.0f}–{hi40:,.0f}sqft (±40%)')
        else:
            # Tier 3: all comps with sqft (no size filter)
            result = _calc(full_comps, 'ALL sqft (no size filter, low conf)')
            result['arv_confidence'] = 'LOW'

    # Floor: assessor appraised value (very conservative but not below market)
    if appraised_value and result['arv'] < appraised_value:
        result['arv'] = appraised_value
        result['arv_method'] += ' → raised to assessor_appraised_floor'

    # Sanity check: flag if ARV > 3x appraised (possible comp quality issue)
    if appraised_value and result['arv'] > appraised_value * 3:
        result['arv_confidence'] = 'SUSPECT'
        result['arv_method'] += ' [WARN: ARV > 3x appraised — verify comps]'

    return result


# ── Step 5: Rehab cost ───────────────────────────────────────────────────────
def compute_rehab(sqft: int | None, year_built: int | None,
                  arv: float | None, is_vacant_lot: bool = False) -> tuple:
    """
    Returns (rehab_cost, rehab_note, rehab_confidence).

    Rates (Atlanta metro 2025):
      Built > 2005  → $20/sqft  light cosmetic
      Built 1980–2005→ $35/sqft  standard rehab
      Built < 1980  → $50/sqft  heavy (lead paint, old systems, roof)
    + 10% contingency on all

    Vacant lots get $0 rehab (land only).
    """
    if is_vacant_lot:
        return 0.0, "Vacant lot — no rehab needed", "N/A"

    if sqft and sqft > 0:
        if year_built and year_built > 2005:
            rate, label = 20, 'light'
        elif year_built and year_built < 1980:
            rate, label = 50, 'heavy'
        else:
            rate, label = 35, 'standard'
        base   = sqft * rate
        total  = round(base * 1.10, 2)
        note   = (f"{sqft:,}sqft × ${rate}/sqft ({label}) + 10% contingency = ${total:,.0f}")
        return total, note, 'MEDIUM'

    if arv and arv > 0:
        total = round(arv * 0.20, 2)
        note  = f"20% of ARV (${arv:,.0f}) — sqft unknown = ${total:,.0f}"
        return total, note, 'LOW'

    return 25000.0, "Flat estimate — no sqft or ARV data", 'VERY_LOW'


# ── Step 6: Full all-in cost ─────────────────────────────────────────────────
def compute_all_in(tax_due: float, rehab: float, sqft: int | None) -> dict:
    """
    Georgia tax deed all-in cost model.
    No buyer's premium (live courthouse auction, no premium).

    Transaction costs (one-time):
      Closing costs  : 3.0% of purchase price
      Title insurance: 0.5% (critical for tax deeds — title may have defects)
      GA transfer tax: $2.00 per $1,000 (state $1 + DeKalb county $1)
      Inspection     : $500 flat
      Recording fees : $250 flat

    Carrying costs (6-month hold assumed):
      Utilities      : $200/month
      Insurance      : $0.50/sqft/year prorated × 6 months
    """
    closing  = round(tax_due * 0.030, 2)
    title    = round(tax_due * 0.005, 2)
    transfer = round((tax_due / 1000) * 2.0, 2)
    inspect  = 500.0
    record   = 250.0
    utils    = 200.0 * 6
    insure   = round(((sqft or 1200) * 0.50) / 12 * 6, 2)

    tx_total  = closing + title + transfer + inspect + record
    carry_total = utils + insure
    total     = round(tax_due + rehab + tx_total + carry_total, 2)

    return {
        'all_in_total'       : total,
        'purchase_price'     : tax_due,
        'rehab_cost'         : round(rehab, 2),
        'closing_costs'      : closing,
        'title_insurance'    : title,
        'transfer_tax'       : transfer,
        'inspection_cost'    : inspect,
        'recording_fees'     : record,
        'utilities_6mo'      : utils,
        'insurance_6mo'      : insure,
        'transaction_subtotal': round(tx_total, 2),
        'carrying_subtotal'  : round(carry_total, 2),
    }


# ── Step 7: Gemini cross-check ───────────────────────────────────────────────
def run_gemini(prop: dict, arv_result: dict, analyzer: TaxDeedAnalyzer) -> dict:
    """
    Pass rich property context to Gemini for a strategic cross-check.
    Gemini validates the bid strategy and adds risk flags.
    We pass it our computed ARV (not raw comp data) so it grounds its analysis.
    """
    arv_est = arv_result.get('arv')
    if arv_est:
        ppsf = arv_result.get('median_ppsf')
        comp_stats_str = (
            f"ARV=${arv_est:,.0f} via {arv_result.get('arv_method')}. "
            f"Confidence: {arv_result.get('arv_confidence')}. "
            + (f"Median price/sqft: ${ppsf:.0f}. " if ppsf else "")
            + (f"Comp price range: {arv_result.get('comp_price_range')}." if arv_result.get('comp_price_range') else "")
        )
    else:
        comp_stats_str = "No reliable ARV estimate available."

    appraised = prop.get('appraised_value')
    if appraised:
        comp_stats_str += f" Assessor appraised value: ${appraised:,.0f}."

    sqft = prop.get('sqft')
    beds = prop.get('beds')
    baths = prop.get('baths')
    yr = prop.get('year_built')
    if sqft:
        comp_stats_str += f" Property specs: {beds}bd/{baths}ba {sqft:,}sqft built {yr}."

    payload = {
        'county'               : 'DeKalb',
        'tax_id'               : prop['parcel_id'],
        'tax_due'              : prop['tax_due'],
        'street_name'          : prop.get('clean_address') or prop.get('pdf_address', ''),
        'property_type'        : _classify_type(prop),
        'market_value_estimate': arv_est or appraised,
        'low_value_estimate'   : round(arv_est * 0.90, 0) if arv_est else None,
        'high_value_estimate'  : round(arv_est * 1.10, 0) if arv_est else None,
        'notes_raw'            : comp_stats_str,
        'risk_profile'         : 'conservative',
    }

    try:
        r = analyzer.analyze_property(payload)
        prop['gemini_max_bid']     = r.recommended_max_bid
        prop['gemini_arv']         = r.arv
        prop['gemini_repair_cost'] = r.repair_cost_estimate
        prop['gemini_as_is']       = r.as_is_value
        prop['risk_flags']         = r.risk_flags or []
        prop['strategy_notes']     = r.strategy_notes or ''
        prop['analysis_notes']     = r.analysis_notes or ''
        log_step(prop['parcel_id'], 'Gemini',
                 f"bid={r.recommended_max_bid} arv={r.arv} risk={r.risk_flags}")
    except Exception as e:
        log_err('gemini', prop['parcel_id'], e)
        prop['gemini_max_bid']     = round(prop['tax_due'] * 1.5, 2)
        prop['gemini_arv']         = arv_est
        prop['gemini_repair_cost'] = None
        prop['gemini_as_is']       = None
        prop['risk_flags']         = ['ANALYSIS_FAILED']
        prop['strategy_notes']     = ''
        prop['analysis_notes']     = f'Gemini error: {str(e)[:200]}'
    return prop


def _classify_type(prop: dict) -> str:
    """Classify property type from assessor class + presence of structure."""
    if not prop.get('sqft'):
        # No living area → likely vacant lot
        appraised = prop.get('appraised_value') or 0
        if appraised < 50000:
            return 'land'
    prop_class = (prop.get('property_class') or '').upper()
    if 'R3' in prop_class or 'RESIDENTIAL' in prop_class or 'SINGLE' in prop_class:
        return 'residential'
    if 'COMMERCIAL' in prop_class or 'C1' in prop_class or 'C2' in prop_class:
        return 'commercial'
    return 'residential'  # default


# ── Step 8: Build output row ─────────────────────────────────────────────────
def build_row(prop: dict, arv_result: dict, cost: dict, rehab_note: str,
              rehab_conf: str) -> dict:
    tax_due  = prop['tax_due']
    sqft     = prop.get('sqft')
    our_arv  = arv_result.get('arv') or 0
    all_in   = cost['all_in_total']
    net      = round(our_arv - all_in, 2) if our_arv else 0
    roi_pct  = round((net / all_in) * 100, 1) if all_in > 0 else 0

    # 70% rule: max_bid = (ARV × 0.70) − rehab
    rehab_amt = cost['rehab_cost']
    rule70_bid = round((our_arv * 0.70) - rehab_amt, 0) if our_arv else None

    # Bid recommendation
    if rule70_bid and rule70_bid >= tax_due and roi_pct >= 30:
        bid_rec = f"BID — MAX ${rule70_bid:,.0f}"
    elif roi_pct >= 20:
        bid_rec = "POSSIBLE — VERIFY DATA"
    else:
        bid_rec = "PASS — ROI TOO LOW"

    risk_str = ', '.join(prop.get('risk_flags', [])) or 'None'

    return {
        # Identity
        'parcel_id'           : prop['parcel_id'],
        'address'             : prop.get('assessor_address') or prop.get('clean_address', ''),
        'property_type'       : _classify_type(prop),
        # Assessor specs (from official county data)
        'beds'                : prop.get('beds'),
        'baths'               : prop.get('baths'),
        'sqft'                : sqft,
        'year_built'          : prop.get('year_built'),
        'assessor_appraised'  : prop.get('appraised_value'),
        'assessor_assessed'   : prop.get('assessed_value'),
        'spec_source'         : prop.get('spec_source'),
        'spec_confidence'     : prop.get('spec_confidence'),
        # Comp-derived ARV (property-specific)
        'our_arv'             : our_arv,
        'arv_confidence'      : arv_result.get('arv_confidence'),
        'arv_method'          : arv_result.get('arv_method'),
        'comp_count_used'     : arv_result.get('comp_count_used', 0),
        'median_ppsf'         : arv_result.get('median_ppsf'),
        'comp_price_range'    : arv_result.get('comp_price_range'),
        'sqft_filter_band'    : arv_result.get('filter_band_sqft'),
        # Cost breakdown
        'minimum_bid'         : tax_due,
        'rehab_cost'          : rehab_amt,
        'rehab_note'          : rehab_note,
        'rehab_confidence'    : rehab_conf,
        'closing_costs'       : cost['closing_costs'],
        'title_insurance'     : cost['title_insurance'],
        'transfer_tax'        : cost['transfer_tax'],
        'inspection_cost'     : cost['inspection_cost'],
        'recording_fees'      : cost['recording_fees'],
        'utilities_6mo'       : cost['utilities_6mo'],
        'insurance_6mo'       : cost['insurance_6mo'],
        'all_in_cost'         : all_in,
        # Returns
        'net_profit'          : net,
        'roi_pct'             : roi_pct,
        '70pct_rule_max_bid'  : rule70_bid,
        'bid_recommendation'  : bid_rec,
        # Gemini cross-check
        'gemini_arv'          : prop.get('gemini_arv'),
        'gemini_max_bid'      : prop.get('gemini_max_bid'),
        'gemini_repair_cost'  : prop.get('gemini_repair_cost'),
        'gemini_as_is'        : prop.get('gemini_as_is'),
        # Risk
        'risk_flags'          : risk_str,
        'strategy_notes'      : prop.get('strategy_notes', ''),
        'analysis_notes'      : prop.get('analysis_notes', ''),
        # Meta
        'run_timestamp'       : RUN_TS,
    }


# ── Step 9: Excel ────────────────────────────────────────────────────────────
def write_excel(rows: list, all_comps: list, out_file: str):
    with pd.ExcelWriter(out_file, engine='openpyxl') as w:
        pd.DataFrame(rows).to_excel(w, sheet_name='Properties', index=False)
        if all_comps:
            pd.DataFrame(all_comps).to_excel(w, sheet_name='Comparable_Sales', index=False)
        if ERR_LOG:
            pd.DataFrame(ERR_LOG).to_excel(w, sheet_name='Errors', index=False)
        if ITER_LOG:
            pd.DataFrame(ITER_LOG).to_excel(w, sheet_name='Iterations', index=False)
        # Auto-fit columns
        for sname, ws in w.sheets.items():
            for col in ws.columns:
                max_len = max((len(str(c.value or '')) for c in col), default=10)
                ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 55)
    print(f"\n  Excel written: {out_file}")


# ── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    print("\n" + "="*65)
    print("  DEKALB – DEEP ANALYSIS: Properties 31-35 (Accurate Edition)")
    print("  Timestamp:", RUN_TS)
    print("="*65)

    apify_key  = os.getenv('APIFY_API_KEY')
    gemini_key = os.getenv('GEMINI_API_KEY')
    if not apify_key or not gemini_key:
        print("Missing API keys in .env"); return

    apify    = ApifyZillowComps()
    enricher = DeKalbArcGISEnricher(apify_key, gemini_key)
    analyzer = TaxDeedAnalyzer(gemini_key)

    # 1 – Parse target parcels
    pdf_path  = str(ROOT / '.tmp/dekalb_pdfs/dekalb_tax_list.pdf')
    raw_props = parse_pdf_targets(pdf_path)
    if not raw_props:
        print("No target parcels found"); return

    # 2 – Pre-fetch comps for zip 30360 / Dunwoody (all 5 share this market)
    print(f"\n{'='*65}\nPre-fetching sold comps (Dunwoody / 30360)\n{'='*65}")
    fetch_comps('30360', apify)

    # 3 – Per-property enrichment + analysis
    print(f"\n{'='*65}\nPer-property enrichment + analysis\n{'='*65}")
    output_rows = []
    all_comp_rows = []

    for idx, item in enumerate(raw_props, 1):
        pid  = item['parcel_id']
        addr = item['pdf_address']
        tax  = item['tax_due']

        print(f"\n[{idx}/5]  {pid}  |  {addr}  |  tax=${tax:,.2f}")
        print("  " + "-"*60)

        prop = dict(item)

        # Clean address
        zip_m = re.search(r'\b3\d{4}\b', addr)
        if zip_m:
            prop['clean_address'] = addr[:zip_m.end()].strip()
            prop['zip_code']      = zip_m.group(0)
        else:
            prop['clean_address'] = re.sub(r'\s+\d{1,4}$', '', addr).strip()
            prop['zip_code']      = '30360'
        prop['city'] = ZIP_TO_CITY.get(prop['zip_code'], 'Dunwoody')

        # Step 2: ArcGIS enrichment
        prop = enrich_from_arcgis(enricher, prop)

        # Step 3: Get comps (cached from pre-fetch)
        comps = fetch_comps(prop['zip_code'], apify)
        for c in comps:
            c_copy = dict(c)
            c_copy['source_parcel'] = pid
            all_comp_rows.append(c_copy)
        print(f"  Comps available: {len(comps)}")

        # Step 4: Property-specific ARV
        is_vacant = not prop.get('sqft')
        arv_result = compute_property_arv(
            comps,
            subject_sqft=prop.get('sqft'),
            appraised_value=prop.get('appraised_value'),
        )
        log_step(pid, 'ARV',
                 f"arv=${arv_result.get('arv')}  "
                 f"conf={arv_result.get('arv_confidence')}  "
                 f"method={arv_result.get('arv_method')}")
        if arv_result.get('arv'):
            print(f"  ARV:   ${arv_result['arv']:>10,.0f}  "
                  f"[{arv_result.get('arv_confidence')}]  "
                  f"{arv_result.get('arv_method')}")
        else:
            print("  ARV:   N/A — no comp or assessor data")

        # Step 5: Rehab cost
        rehab, rehab_note, rehab_conf = compute_rehab(
            prop.get('sqft'), prop.get('year_built'),
            arv_result.get('arv'), is_vacant_lot=is_vacant
        )
        prop['rehab_cost'] = rehab
        log_step(pid, 'Rehab', rehab_note)
        print(f"  Rehab: ${rehab:>10,.0f}  [{rehab_note}]")

        # Step 6: All-in cost
        cost = compute_all_in(tax, rehab, prop.get('sqft'))
        log_step(pid, 'AllIn',
                 f"total=${cost['all_in_total']:,.0f}  "
                 f"(tax={tax} + rehab={rehab} + "
                 f"tx={cost['transaction_subtotal']} + carry={cost['carrying_subtotal']})")
        print(f"  All-in:${cost['all_in_total']:>9,.0f}  "
              f"[tax=${tax:,.0f} + rehab=${rehab:,.0f} + "
              f"tx=${cost['transaction_subtotal']:,.0f} + carry=${cost['carrying_subtotal']:,.0f}]")

        # Step 7: Gemini cross-check
        prop = run_gemini(prop, arv_result, analyzer)

        # Net profit summary
        arv_val = arv_result.get('arv') or 0
        if arv_val and cost['all_in_total']:
            net = arv_val - cost['all_in_total']
            roi = (net / cost['all_in_total']) * 100
            print(f"  --> Net profit: ${net:,.0f}  ROI: {roi:.1f}%")

        # Build output row
        row = build_row(prop, arv_result, cost, rehab_note, rehab_conf)
        output_rows.append(row)
        time.sleep(0.4)

    # 4 – Write Excel
    print(f"\n{'='*65}\nWriting Excel output\n{'='*65}")
    out_file = str(OUT_DIR / f'DeKalb_Props31to35_{RUN_TS}.xlsx')
    write_excel(output_rows, all_comp_rows, out_file)

    # 5 – Summary
    print("\n" + "="*65)
    print("  RESULTS SUMMARY")
    print("="*65)
    print(f"  {'PARCEL':<12} {'ADDRESS':<30} {'SQ':<6} {'TAX':>8} {'ARV':>10} "
          f"{'ALL-IN':>10} {'ROI':>7}  RECOMMENDATION")
    print("  " + "-"*100)
    for r in output_rows:
        sq = f"{r['sqft']:,}" if r['sqft'] else "LOT"
        print(f"  {r['parcel_id']:<12} {str(r['address'])[:30]:<30} {sq:<6} "
              f"${r['minimum_bid']:>7,.0f} ${r.get('our_arv') or 0:>9,.0f} "
              f"${r.get('all_in_cost') or 0:>9,.0f} {r.get('roi_pct') or 0:>6.1f}%  "
              f"{r.get('bid_recommendation', '')}")
    print()
    print(f"  Properties:  {len(output_rows)}")
    print(f"  Comps used:  {len(set(c.get('address','') for c in all_comp_rows))}")
    print(f"  Errors:      {len(ERR_LOG)}")
    print(f"  Output:      {out_file}")
    print("="*65)

    (OUT_DIR / f'errors_next5_{RUN_TS}.json').write_text(json.dumps(ERR_LOG, indent=2))
    (OUT_DIR / f'iters_next5_{RUN_TS}.json').write_text(json.dumps(ITER_LOG, indent=2))


if __name__ == '__main__':
    main()
