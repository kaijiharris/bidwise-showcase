"""
generate_ui_data.py
Reads the latest DeKalb enhanced JSON analysis output and writes ui/data.js
so the dashboard displays real pipeline results instead of hardcoded mock data.

Usage:
    python execution/generate_ui_data.py
"""

import json
import os
import glob
from datetime import datetime, timezone

# ── Find latest enhanced results file ─────────────────────────────────────────
RESULTS_DIR = os.path.join(os.path.dirname(__file__), '..', '.tmp', 'dekalb_results')
OUT_PATH    = os.path.join(os.path.dirname(__file__), '..', 'ui', 'data.js')

def find_latest_enhanced():
    # Priority: enriched (ArcGIS + size-matched ARV) > enhanced > deterministic
    for pattern in ('dekalb_enriched_*.json', 'dekalb_enhanced_*.json', 'dekalb_deterministic_*.json'):
        files = sorted(glob.glob(os.path.join(RESULTS_DIR, pattern)))
        if files:
            return files[-1]  # newest by filename sort (timestamps in name)
    raise FileNotFoundError(f"No analysis JSON found in {RESULTS_DIR}")

# ── Date formatting ────────────────────────────────────────────────────────────
def fmt_sale_date(raw):
    if not raw:
        return 'unknown date'
    try:
        # Apify returns epoch milliseconds
        ts = int(raw) / 1000
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        return dt.strftime('%b %Y')
    except (ValueError, TypeError, OSError):
        try:
            # Try as ISO string
            dt = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
            return dt.strftime('%b %Y')
        except Exception:
            return str(raw)[:10]

# ── Property type normalisation ────────────────────────────────────────────────
def normalise_type(raw_type):
    if not raw_type:
        return 'SFR'
    t = raw_type.lower()
    if 'vacant' in t or 'land' in t or 'lot' in t:
        return 'Vacant Land'
    if 'multi' in t or 'duplex' in t or 'triplex' in t:
        return 'Multi-Family'
    if 'commercial' in t or 'retail' in t or 'office' in t:
        return 'Commercial'
    return 'SFR'

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    src = find_latest_enhanced()
    print(f"Reading: {os.path.basename(src)}")

    with open(src, encoding='utf-8') as f:
        raw = json.load(f)

    # Handle both list format and dict format
    if isinstance(raw, dict):
        properties  = raw.get('properties', [])
        comparables = raw.get('comparables', [])
        analysis_date = raw.get('analysis_date', '')
    else:
        properties  = raw
        comparables = []
        analysis_date = ''

    print(f"Properties: {len(properties)}, Comps: {len(comparables)}")

    # ── Build PROPS array ──────────────────────────────────────────────────────
    props_js = []
    for i, p in enumerate(properties):
        prop_type = normalise_type(p.get('property_type') or p.get('propType'))

        # Extra detail strings from real calc fields (shown in drawer)
        arv_calc   = p.get('arv_calculation')   or p.get('arv_method') or ''
        rehab_calc = p.get('rehab_calculation')  or p.get('rehab_method') or ''
        rehab_notes= p.get('rehab_notes')        or ''
        close_calc = p.get('closing_calculation') or ''
        allin_calc = p.get('all_in_calculation')  or p.get('all_in_breakdown') or ''
        profit_calc= p.get('profit_calculation')  or ''
        roi_calc   = p.get('roi_calculation')     or ''
        deal_rating= p.get('deal_rating')         or ''
        arv_conf   = p.get('arv_confidence')      or ''
        comp_qual  = p.get('comp_quality_rating') or ''
        invest_vis = p.get('investment_viability') or ''

        # Physical specs — populated by ArcGIS enrichment
        sqft_val   = p.get('sqft')
        beds_val   = p.get('beds') or p.get('bedrooms')
        baths_val  = p.get('baths') or p.get('bathrooms')
        yr_val     = p.get('year_built')

        obj = {
            'id':        i + 1,
            'propType':  prop_type,
            'addr':      p.get('full_address') or '',
            'city':      p.get('city') or '',
            'zip':       p.get('zip_code') or '',
            'taxId':     p.get('tax_id') or '',
            'taxDue':    round(p.get('tax_due') or 0, 2),
            'arv':       round(p.get('arv') or 0, 2),
            'rehab':     round(p.get('estimated_rehab') or 0, 2),
            'closing':   round(p.get('closing_costs') or 0, 2),
            'allIn':     round(p.get('all_in_cost') or 0, 2),
            'profit':    round(p.get('net_profit') or 0, 2),
            'roi':       round(p.get('roi_percent') or 0, 2),
            'score':     p.get('deal_score') or 0,
            'comps':     p.get('arv_comp_count') or p.get('comp_count') or 0,
            'maxBid':    round(p.get('recommended_max_bid') or 0, 2),
            'arvCalc':   arv_calc,
            'rehabCalc': rehab_calc,
            'rehabNotes':rehab_notes,
            'closeCalc': close_calc,
            'allInCalc': allin_calc,
            'profitCalc':profit_calc,
            'roiCalc':   roi_calc,
            'dealRating':deal_rating,
            'arvConf':   arv_conf,
            'compQual':  comp_qual,
            'investViability': invest_vis,
            # Physical specs from ArcGIS enrichment
            'beds':      int(beds_val) if beds_val else None,
            'baths':     float(baths_val) if baths_val else None,
            'sqft':      int(sqft_val) if sqft_val else None,
            'yr':        int(yr_val) if yr_val else None,
            'rehabKey':  None,
            'risk':      p.get('risk_score') or None,
        }
        props_js.append(obj)

    # ── Build COMPS dict keyed by full_address ────────────────────────────────
    comps_by_addr = {}
    for c in comparables:
        key = c.get('used_for_address') or c.get('used_for_property') or ''
        if not key:
            continue
        sale_price = c.get('sale_price') or 0
        if not sale_price:
            continue  # skip comps with no price

        addr_str  = c.get('address') or 'Unknown address'
        beds      = c.get('bedrooms')
        baths     = c.get('bathrooms')
        sqft      = c.get('sqft')
        yr_built  = c.get('year_built')
        sale_date = fmt_sale_date(c.get('sale_date'))

        detail_parts = []
        if beds or baths:
            detail_parts.append(f"{int(beds) if beds else '?'}bd/{int(baths) if baths else '?'}ba")
        if sqft:
            detail_parts.append(f"{int(sqft):,} sqft")
        if yr_built:
            detail_parts.append(f"built {int(yr_built)}")
        detail_parts.append(f"sold {sale_date}")

        entry = {
            'a': addr_str,
            'd': ' · '.join(detail_parts),
            'p': int(sale_price),
        }
        comps_by_addr.setdefault(key, []).append(entry)

    # ── Serialise to JS ────────────────────────────────────────────────────────
    def to_js_val(v):
        if v is None:
            return 'null'
        if isinstance(v, bool):
            return 'true' if v else 'false'
        if isinstance(v, (int, float)):
            return str(v)
        # Escape string for JS single-quoted literal
        escaped = str(v).replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
        return f"'{escaped}'"

    def obj_to_js(d, indent='  '):
        pairs = []
        for k, v in d.items():
            pairs.append(f"{indent}  {k}: {to_js_val(v)}")
        return '{\n' + ',\n'.join(pairs) + f'\n{indent}}}'

    props_lines = []
    for p in props_js:
        props_lines.append('  ' + obj_to_js(p, indent='  '))

    comps_lines = []
    for addr, items in comps_by_addr.items():
        addr_escaped = addr.replace("'", "\\'")
        items_js = []
        for c in items:
            a_esc = c['a'].replace("'", "\\'")
            d_esc = c['d'].replace("'", "\\'")
            items_js.append(f"    {{a:'{a_esc}', d:'{d_esc}', p:{c['p']}}}")
        comps_lines.append(f"  '{addr_escaped}': [\n" + ',\n'.join(items_js) + '\n  ]')

    analysis_date_str = str(analysis_date)[:10] if analysis_date else 'unknown'

    # A backslash inside an f-string expression is only legal on Python 3.12+;
    # this runs on 3.11, so hoist the joins into locals before the f-string.
    props_block = ',\n'.join(props_lines)
    comps_block = ',\n'.join(comps_lines)

    js_content = f"""// AUTO-GENERATED — do not edit manually.
// Source: {os.path.basename(src)}
// Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
// Analysis date: {analysis_date_str}
// {len(props_js)} properties · {len(comparables)} comps

const DATA_META = {{
  generated: '{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}',
  source: '{os.path.basename(src)}',
  count: {len(props_js)},
  analysisDate: '{analysis_date_str}',
  compsTotal: {len(comparables)}
}};

const PROPS = [
{props_block}
];

// Keyed by full_address (matches PROPS[n].addr)
const COMPS = {{
{comps_block}
}};
"""

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"Written: {OUT_PATH}")
    print(f"  {len(props_js)} properties, {sum(len(v) for v in comps_by_addr.values())} comps across {len(comps_by_addr)} properties")

if __name__ == '__main__':
    main()
