"""
run_dekalb_reanalysis.py
========================
Fixes four known issues in the existing DeKalb enhanced analysis JSON:

  1. ARV shared across all properties in the same city
     → Now fetches comps BY ZIP CODE (not by city name)
     → Gives each zip its own comp pool → different ARVs per area

  2. Land deals have null ARV / empty values
     → Uses same-zip residential comps × 20% lot-value rule

  3. Beds / baths / sqft / year_built missing for subject properties
     → Calls Apify Zillow property lookup per address

  4. Risk score missing
     → Computed deterministically from comp quality, ARV/tax ratio, deal score

Phases:
  --phase 1   (default) Fix risk + land ARV from EXISTING data — no API cost
  --phase 2   Also re-fetch comps by zip AND look up property details — uses Apify credits

Usage:
  python execution/run_dekalb_reanalysis.py              # phase 1 only (free)
  python execution/run_dekalb_reanalysis.py --phase 2    # full re-analysis (uses Apify)
"""

import sys, json, re, argparse, glob
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import dotenv
dotenv.load_dotenv(ROOT / '.env')

RESULTS_DIR = ROOT / '.tmp' / 'dekalb_results'

# ── Find latest enhanced JSON ──────────────────────────────────────────────────
def find_latest_enhanced():
    patterns = ['dekalb_enhanced_*.json', 'dekalb_deterministic_*.json']
    for p in patterns:
        files = sorted(glob.glob(str(RESULTS_DIR / p)))
        if files:
            return files[-1]
    raise FileNotFoundError(f"No analysis JSON found in {RESULTS_DIR}")

# ── ZIP code helpers ───────────────────────────────────────────────────────────
def extract_zip(prop):
    """Return zip code string, or None."""
    z = prop.get('zip_code')
    if z and re.match(r'3\d{4}', str(z)):
        return str(z)
    # Try to find 5-digit zip in raw_text or address
    for field in ('raw_text', 'full_address'):
        m = re.search(r'\b(3\d{4})\b', prop.get(field, ''))
        if m:
            return m.group(1)
    # DeKalb county fallback: these tax lists are north DeKalb (30360 area)
    if prop.get('county', '').lower() == 'dekalb' or 'DORAVLLE' in prop.get('raw_text', '').upper():
        return '30360'
    return None

def zip_to_city(zip_code):
    """Map DeKalb zip codes to city names for display."""
    mapping = {
        '30030': 'Decatur', '30032': 'Decatur', '30033': 'Decatur', '30034': 'Decatur',
        '30035': 'Decatur', '30036': 'Decatur', '30037': 'Decatur', '30038': 'Lithonia',
        '30058': 'Lithonia', '30083': 'Stone Mountain', '30087': 'Stone Mountain',
        '30088': 'Stone Mountain', '30021': 'Clarkston', '30340': 'Doraville',
        '30341': 'Chamblee', '30360': 'Dunwoody', '30338': 'Dunwoody',
        '30319': 'Atlanta', '30317': 'Atlanta',
    }
    return mapping.get(str(zip_code), 'DeKalb County')

# ── Risk score ─────────────────────────────────────────────────────────────────
def compute_risk(prop):
    """
    Compute a 0-100 risk score from available signals.
    Higher = riskier.
    """
    risk = 0

    # 1. Comp quality (0-30 pts)
    cq = prop.get('comp_quality_score') or 0
    if cq == 0:
        risk += 30   # No comps at all
    elif cq < 50:
        risk += 20
    elif cq < 70:
        risk += 10
    else:
        risk += 0

    # 2. ARV confidence (0-20 pts)
    arv_conf = (prop.get('arv_confidence') or '').lower()
    if arv_conf in ('none', ''):
        risk += 20
    elif arv_conf == 'low':
        risk += 15
    elif arv_conf == 'medium':
        risk += 8
    else:
        risk += 0

    # 3. Tax due vs ARV ratio (0-25 pts)
    # Higher tax / ARV → less margin → higher risk
    arv = prop.get('arv') or 0
    tax = prop.get('tax_due') or 0
    if arv and arv > 0:
        ratio = tax / arv
        if ratio > 0.40:
            risk += 25
        elif ratio > 0.25:
            risk += 15
        elif ratio > 0.12:
            risk += 8
        else:
            risk += 3
    else:
        risk += 25  # No ARV = high risk

    # 4. Price variance in comps (0-15 pts)
    variance = prop.get('price_variance_pct') or 0
    if variance > 100:
        risk += 15
    elif variance > 50:
        risk += 8
    elif variance > 25:
        risk += 4
    else:
        risk += 0

    # 5. Recent comps (0-10 pts)
    recent = prop.get('recent_comps_6mo') or 0
    total_comps = prop.get('comp_count') or 0
    if total_comps == 0:
        risk += 10
    elif recent == 0:
        risk += 7
    elif recent < 3:
        risk += 3

    return min(100, risk)

# ── ARV calculation ────────────────────────────────────────────────────────────
def calc_arv_from_comps(comps):
    """Average sale price of comp list."""
    prices = [c.get('sale_price') for c in comps if c.get('sale_price') and c['sale_price'] > 0]
    if not prices:
        return None, 0, None
    avg = sum(prices) / len(prices)
    # Price/sqft
    psf_vals = [c['sale_price'] / c['sqft'] for c in comps
                if c.get('sale_price') and c.get('sqft') and c['sqft'] > 0]
    avg_psf = sum(psf_vals) / len(psf_vals) if psf_vals else None
    # Variance %
    if len(prices) > 1:
        mx, mn = max(prices), min(prices)
        variance = round((mx - mn) / mn * 100, 1) if mn > 0 else 0
    else:
        variance = 0
    return round(avg, 2), len(prices), round(avg_psf, 2) if avg_psf else None, variance

def recalculate_deal_metrics(prop, new_arv):
    """Recalculate all deal numbers when ARV changes."""
    tax_due = prop.get('tax_due') or 0
    rehab = round(new_arv * 0.20, 2)   # 20% of ARV fallback
    closing = max(round(tax_due * 0.05, 2), 5000)
    all_in = round(tax_due + rehab + closing, 2)
    profit = round(new_arv - all_in, 2)
    roi = round(profit / all_in * 100, 2) if all_in > 0 else None

    score = prop.get('deal_score') or 0
    if roi:
        if roi > 30:
            score = min(100, 50 + int(roi))
        elif roi > 0:
            score = max(0, int(roi) + 20)
        else:
            score = 0

    return {
        'arv': new_arv,
        'arv_calculation': f'Average of {prop.get("comp_count",0)} comp sales: ${new_arv:,.0f}',
        'arv_confidence': 'Medium',
        'arv_method': 'Average of zip-code comp sales',
        'estimated_rehab': rehab,
        'rehab_calculation': f'20% of ARV (${new_arv:,.0f} × 0.20) = ${rehab:,.2f}',
        'closing_costs': closing,
        'closing_calculation': f'Max of 5% of bid or $5,000 minimum = ${closing:,.2f}',
        'all_in_cost': all_in,
        'all_in_calculation': f'${tax_due:,.2f} (bid) + ${rehab:,.2f} (rehab) + ${closing:,.2f} (closing) = ${all_in:,.2f}',
        'net_profit': profit,
        'profit_calculation': f'${new_arv:,.0f} (ARV) - ${all_in:,.2f} (all-in) = ${profit:,.2f}',
        'roi_percent': roi,
        'roi_calculation': f'(${profit:,.2f} / ${all_in:,.2f}) × 100 = {roi:.1f}%' if roi else 'N/A',
        'deal_score': score,
        'deal_rating': ('Excellent Deal' if score >= 90 else 'Good Deal' if score >= 70
                        else 'Fair Deal' if score >= 50 else 'Marginal Deal' if score >= 30
                        else 'Cannot Evaluate'),
    }

# ── Phase 1: Fix risk + land ARV from existing data ───────────────────────────
def phase1(data):
    """
    No API calls. Uses existing comps in the JSON.
    - Computes risk score for all properties
    - Assigns ARV to land properties using same-area residential comps × 20%
    - Fixes city label based on zip code
    """
    print("\n=== PHASE 1: Risk + Land ARV (no API calls) ===")

    properties = data['properties']
    all_comps = data.get('comparables', [])

    # Group existing comps by address
    comps_by_addr = {}
    for c in all_comps:
        key = c.get('used_for_address', '')
        comps_by_addr.setdefault(key, []).append(c)

    # Build a zip → comps map from already-fetched data
    # Use residential comp pool per zip area for land valuation
    zip_arv_pool = {}   # zip_code → list of sale prices
    for prop in properties:
        z = extract_zip(prop)
        arv = prop.get('arv')
        comps = comps_by_addr.get(prop.get('full_address', ''), [])
        if z and comps:
            zip_arv_pool.setdefault(z, []).extend(comps)

    fixed = 0
    for prop in properties:
        z = extract_zip(prop)

        # Fix city based on zip
        if z:
            correct_city = zip_to_city(z)
            if prop.get('city') != correct_city:
                prop['city'] = correct_city

        # Compute risk score
        comps = comps_by_addr.get(prop.get('full_address', ''), [])
        prop['risk_score'] = compute_risk(prop)

        # Fix land ARV: use same-zip residential comps × 20%
        pt = (prop.get('property_type') or '').lower()
        is_land = 'vacant' in pt or 'land' in pt or 'lot' in pt
        if is_land and not prop.get('arv') and z:
            pool = zip_arv_pool.get(z, [])
            if pool:
                arv, cnt, avg_psf, _variance = calc_arv_from_comps(pool)
                if arv:
                    lot_arv = round(arv * 0.20, 2)
                    tax_due = prop.get('tax_due') or 0
                    closing = max(round(tax_due * 0.05, 2), 5000)
                    all_in = round(tax_due + closing, 2)   # no rehab for land
                    profit = round(lot_arv - all_in, 2)
                    roi = round(profit / all_in * 100, 2) if all_in > 0 else None

                    prop.update({
                        'arv': lot_arv,
                        'avg_comp_price': arv,
                        'avg_price_sqft': avg_psf,
                        'comp_count': cnt,
                        'arv_calculation': f'20% × avg residential ARV ${arv:,.0f} (from {cnt} nearby comps) = ${lot_arv:,.0f}',
                        'arv_confidence': 'Low',
                        'arv_method': '20% lot-value rule applied to nearby residential comps',
                        'estimated_rehab': 0,
                        'rehab_calculation': 'Vacant land — no rehab required',
                        'closing_costs': closing,
                        'closing_calculation': f'Max of 5% of bid or $5,000 = ${closing:,.2f}',
                        'all_in_cost': all_in,
                        'all_in_calculation': f'${tax_due:,.2f} (bid) + $0 (rehab) + ${closing:,.2f} (closing) = ${all_in:,.2f}',
                        'net_profit': profit,
                        'profit_calculation': f'${lot_arv:,.0f} (lot ARV) - ${all_in:,.2f} (all-in) = ${profit:,.2f}',
                        'roi_percent': roi,
                        'roi_calculation': f'(${profit:,.2f} / ${all_in:,.2f}) × 100 = {roi:.1f}%' if roi else 'N/A',
                        'deal_score': min(80, max(0, int(roi or 0))),
                        'deal_rating': 'Land Deal',
                        'investment_viability': f'Land deal — lot value estimated at 20% of nearby residential ARV (${arv:,.0f}). Verify zoning before bidding.',
                    })
                    # Tag comps as used for this land property
                    for c in pool[:cnt]:
                        all_comps_for_land = [dict(c) for c in pool[:cnt]]
                        for lc in all_comps_for_land:
                            lc['used_for_address'] = prop['full_address']
                        # Add to comparables if not already present
                        existing_keys = {c.get('used_for_address','') for c in all_comps}
                        if prop['full_address'] not in existing_keys:
                            all_comps.extend(all_comps_for_land)
                    fixed += 1
                    print(f"  [OK] Land ARV set for {prop['full_address']}: ${lot_arv:,.0f} ({cnt} nearby comps x 20%)")
                    continue

        # For non-land with existing ARV, still update risk but leave ARV alone
        if not is_land:
            pass  # risk already set above

    print(f"\n  Phase 1 complete. Fixed {fixed} land properties. Risk scores added to all.")
    data['comparables'] = all_comps
    return data

# ── Phase 2: Re-fetch comps by zip + Zillow property lookup ───────────────────
def phase2(data):
    """
    Uses Apify API credits.
    - Fetches comps BY ZIP CODE (not by city) for better per-area ARV
    - Looks up each property on Zillow for beds/baths/sqft/year_built
    """
    print("\n=== PHASE 2: Per-zip comps + Zillow property lookups (uses Apify credits) ===")

    from execution.enrichment.apify_comps import ApifyZillowComps
    apify = ApifyZillowComps()

    properties = data['properties']

    # ── 2a. Fetch comps per unique ZIP CODE ────────────────────────────────────
    print("\n--- 2a. Fetch comps by zip code ---")
    zip_comps = {}   # zip_code → list of comp dicts

    unique_zips = set()
    for prop in properties:
        z = extract_zip(prop)
        if z:
            unique_zips.add(z)

    print(f"  Unique zip codes: {sorted(unique_zips)}")
    for z in sorted(unique_zips):
        if z in zip_comps:
            continue
        print(f"  Fetching comps for zip {z}, GA...")
        try:
            comps = apify.get_sold_properties(city=z, state_code='GA', limit=15)
            zip_comps[z] = comps
            print(f"    Got {len(comps)} comps for zip {z}")
        except Exception as e:
            print(f"    ERROR for zip {z}: {e}")
            zip_comps[z] = []

    # ── 2b. Per-property Zillow lookup for beds/baths/sqft/year_built ─────────
    print("\n--- 2b. Zillow property lookups ---")
    new_all_comps = []

    for i, prop in enumerate(properties):
        addr = prop.get('full_address', '')
        city = prop.get('city', 'DeKalb County')
        z = extract_zip(prop)

        print(f"  [{i+1}/{len(properties)}] {addr} (zip={z})")

        # Zillow property lookup for beds/baths/sqft/year_built
        if not prop.get('bedrooms'):
            full_lookup_addr = f"{addr}, {city}, GA"
            if z:
                full_lookup_addr = f"{addr}, GA {z}"
            try:
                details = apify.lookup_property(full_lookup_addr)
                if details:
                    if details.get('bedrooms'):
                        prop['bedrooms'] = details['bedrooms']
                        print(f"    [OK] beds={details.get('bedrooms')} baths={details.get('bathrooms')} sqft={details.get('sqft')} yr={details.get('year_built')}")
                    if details.get('bathrooms'):
                        prop['bathrooms'] = details['bathrooms']
                    if details.get('sqft'):
                        prop['sqft'] = details['sqft']
                    if details.get('year_built'):
                        prop['year_built'] = details['year_built']
                else:
                    print(f"    [--] No Zillow result")
            except Exception as e:
                print(f"    [ERR] Zillow lookup failed: {e}")

        # Update ARV using zip-level comps
        if z and zip_comps.get(z):
            comps = zip_comps[z]
            pt = (prop.get('property_type') or '').lower()
            is_land = 'vacant' in pt or 'land' in pt or 'lot' in pt

            if is_land:
                # Land: residential comps × 20%
                arv, cnt, avg_psf, _variance = calc_arv_from_comps(comps)
                if arv:
                    lot_arv = round(arv * 0.20, 2)
                    tax_due = prop.get('tax_due') or 0
                    closing = max(round(tax_due * 0.05, 2), 5000)
                    all_in = round(tax_due + closing, 2)
                    profit = round(lot_arv - all_in, 2)
                    roi = round(profit / all_in * 100, 2) if all_in > 0 else None
                    prop.update({
                        'arv': lot_arv,
                        'avg_comp_price': arv,
                        'comp_count': cnt,
                        'avg_price_sqft': avg_psf,
                        'arv_calculation': f'20% × avg ${arv:,.0f} ({cnt} zip-{z} comps) = ${lot_arv:,.0f}',
                        'arv_confidence': 'Low-Medium',
                        'arv_method': '20% lot-value rule on zip-level residential comps',
                        'estimated_rehab': 0,
                        'rehab_calculation': 'Vacant land — no rehab required',
                        'closing_costs': closing,
                        'all_in_cost': all_in,
                        'net_profit': profit,
                        'roi_percent': roi,
                        'deal_score': min(80, max(0, int(roi or 0))),
                        'deal_rating': 'Land Deal',
                    })
            else:
                # Improved property: use zip-level comps
                sqft = prop.get('sqft')
                arv, cnt, avg_psf, _variance = calc_arv_from_comps(comps)
                if arv:
                    if sqft and avg_psf:
                        prop_arv = round(sqft * avg_psf, 2)
                        arv_method = f'Property sqft ({sqft:,}) × avg $/sqft (${avg_psf:.0f}) = ${prop_arv:,.0f}'
                    else:
                        prop_arv = arv
                        arv_method = f'Average of {cnt} zip-{z} comp sales: ${arv:,.0f}'

                    metrics = recalculate_deal_metrics(prop, prop_arv)
                    metrics['arv_calculation'] = arv_method
                    metrics['avg_comp_price'] = arv
                    metrics['avg_price_sqft'] = avg_psf
                    metrics['comp_count'] = cnt
                    prop.update(metrics)
                    print(f"    ARV updated: ${prop_arv:,.0f} (was ${prop.get('arv', 0):,.0f})")

            # Recompute risk with new data
            prop['risk_score'] = compute_risk(prop)

            # Tag comps as used for this property
            for c in comps:
                nc = dict(c)
                nc['used_for_property'] = prop.get('tax_id', '')
                nc['used_for_address'] = addr
                new_all_comps.append(nc)

    # Only overwrite comparables if we actually got new ones — never wipe with empty
    if new_all_comps:
        data['comparables'] = new_all_comps
        print(f"\n  Phase 2 complete. {len(new_all_comps)} comps stored.")
    else:
        print(f"\n  Phase 2: no new comps retrieved — keeping existing {len(data.get('comparables',[]))} comps.")
    return data

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Re-analyze DeKalb properties with fixes')
    parser.add_argument('--phase', type=int, default=1, choices=[1, 2],
                        help='1 = risk+land only (free), 2 = full re-fetch (uses Apify)')
    args = parser.parse_args()

    src = find_latest_enhanced()
    print(f"Loading: {src}")
    with open(src, encoding='utf-8') as f:
        raw = json.load(f)

    if isinstance(raw, list):
        data = {'properties': raw, 'comparables': [], 'analysis_date': datetime.now().isoformat()}
    else:
        data = raw

    print(f"Loaded {len(data['properties'])} properties, {len(data.get('comparables',[]))} comps")

    data = phase1(data)

    if args.phase >= 2:
        data = phase2(data)

    # Save output
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    out_json = RESULTS_DIR / f'dekalb_enhanced_{ts}.json'
    data['analysis_date'] = datetime.now().isoformat()
    data['total_properties'] = len(data['properties'])
    data['total_comps'] = len(data.get('comparables', []))

    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print(f"\nSaved: {out_json}")

    # Re-generate UI data
    print("\nRegenerating UI data...")
    import subprocess
    result = subprocess.run(
        ['python', str(ROOT / 'execution' / 'generate_ui_data.py')],
        capture_output=True, text=True, cwd=str(ROOT)
    )
    if result.returncode == 0:
        print(result.stdout)
    else:
        print("UI generation error:", result.stderr)

    print("\n=== DONE ===")
    print(f"Phase {args.phase} complete.")
    print(f"Output: {out_json}")
    print("UI data.js regenerated — reload browser to see updated data.")

if __name__ == '__main__':
    main()
