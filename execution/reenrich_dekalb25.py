"""
reenrich_dekalb25.py
====================
Re-enriches the existing 25-property DeKalb analysis with:
  1. ArcGIS physical specs (sqft, beds, baths, year_built) — FREE, instant
  2. Size-matched ARV using existing cached comps (no Apify calls by default)
     - Filter comps to ±25% of subject sqft → median(sale_price/sqft) × subject_sqft
     - Expand to ±40% if < 3 comps. If still < 3, use all comps (flag LOW confidence)
  3. Age-based rehab estimate (sqft × rate + 10% contingency)
  4. Full all-in cost model
  5. [RETRY MODE] --refetch flag: re-pulls Apify comps for properties with 0 comps

Usage:
    python execution/reenrich_dekalb25.py              # ArcGIS + cached comps only
    python execution/reenrich_dekalb25.py --refetch    # + re-fetch Apify for 0-comp props

Input:  .tmp/dekalb_results/dekalb_enriched_*.json  (latest enriched)
        OR .tmp/dekalb_results/dekalb_enhanced_*.json (if no enriched file yet)
Output: .tmp/dekalb_results/dekalb_enriched_<timestamp>.json
        ui/data.js (regenerated automatically)

--- ERROR LOG & SOLUTIONS ---

BUG A – Wrong comp price field
  Problem: c.get('price') always None; Apify stores as 'sale_price'
  Fix: c.get('sale_price') or c.get('price')
  Where: all comp processing loops

BUG B – Flat city-wide ARV (not property-specific)
  Problem: All properties got same median price regardless of sqft
  Fix: Filter comps to ±25% subject sqft → median($/sqft) × subject_sqft
       Expand to ±40% if < 3 comps; use all comps if still < 3 (LOW confidence)

BUG C – Incomplete all-in cost
  Problem: all_in = tax_due + rehab only; missing ~$4,600–$8,000 per deal
  Fix: Full model = purchase + rehab + closing(3%) + title(0.5%) + transfer($2/$1k GA)
       + inspection($500) + recording($250) + quiet_title($3,500) + carrying(12mo)

BUG D – Rehab without sqft
  Problem: Gemini guessing rehab from no physical data
  Fix: sqft × age-rate + 10% contingency first; Gemini cross-checks only
    >2005: $20/sqft (light);  1981–2005: $35/sqft (standard);  ≤1980: $50/sqft (heavy)
    Fallback if no sqft: 20% of ARV

BUG E – Zip 30360 returns 0 raw Apify items
  Problem: Zillow Apify actor returns empty dataset for zip code queries
  Fix: ZIP_TO_CITY fallback dict — retry with city name if zip returns 0
    30360 → 'Dunwoody';  30340/30341 → 'Chamblee';  30338 → 'Dunwoody'

BUG F – 7 properties have 0 comps in cached dataset (discovered 2026-03-20)
  Problem: Original enhanced pipeline (dekalb_enhanced_20260320_012508.json) fetched
    comps keyed by parcel ID (used_for_property). 7 parcels are absent from that index,
    meaning their Apify run returned 0 results — likely due to Bug E (zip returned 0)
    combined with inconsistent city/zip assignment in the original pipeline.
    Affected parcels: 06 249 03 006, 06 277 01 055, 06 278 05 008, 06 279 04 027,
                      06 280 05 012, 06 280 06 012, 06 280 06 030
  Fix: --refetch mode detects 0-comp non-vacant properties, determines city name via
    ZIP_TO_CITY (from assessor address zip) or PARCEL_DISTRICT_CITY fallback, then
    re-pulls Apify comps tagged with used_for_property = tax_id.

BUG G – generate_ui_data.py hardcoded beds/baths/sqft/yr as null (discovered 2026-03-20)
  Problem: generate_ui_data.py always wrote beds:null, baths:null, sqft:null, yr:null
    even when enriched JSON had these fields populated.
  Fix: Read from p.get('sqft'), p.get('beds')/p.get('bedrooms'), etc.
    Also fixed find_latest_enhanced() to prioritise dekalb_enriched_* over dekalb_enhanced_*.

BUG H – generate_ui_data.py didn't pick up enriched files (discovered 2026-03-20)
  Problem: find_latest_enhanced() only searched for dekalb_enhanced_* pattern;
    dekalb_enriched_* files were never read by the dashboard generator.
  Fix: Updated search order: dekalb_enriched_* → dekalb_enhanced_* → dekalb_deterministic_*
"""

import sys, re, json, time, requests
from datetime import datetime
from pathlib import Path
from statistics import median

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import dotenv
dotenv.load_dotenv(ROOT / '.env')

# ── Constants ─────────────────────────────────────────────────────────────────

# GA zip codes → city names for Apify queries (zip codes that return 0 from Apify)
# Use city name instead of zip when calling ApifyZillowComps.get_sold_properties()
ZIP_TO_CITY = {
    '30360': 'Dunwoody',
    '30338': 'Dunwoody',
    '30340': 'Chamblee',
    '30341': 'Chamblee',
    '30033': 'Decatur',
    '30035': 'Decatur',
    '30032': 'Decatur',
    '30030': 'Decatur',
    '30316': 'Atlanta',
    '30317': 'Atlanta',
}

# DeKalb parcel district prefix → city name fallback (when no zip available)
# Format: first 5 digits of tax_id stripped (e.g. "06249" → district 249)
PARCEL_DISTRICT_CITY = {
    '249': 'Dunwoody',
    '250': 'Dunwoody',
    '277': 'Dunwoody',
    '278': 'Dunwoody',
    '279': 'Dunwoody',
    '280': 'Dunwoody',
    '252': 'Doraville',
    '253': 'Doraville',
    '254': 'Doraville',
    '233': 'Decatur',
    '234': 'Decatur',
    '235': 'Decatur',
}

# ── ArcGIS ────────────────────────────────────────────────────────────────────
ARCGIS_URL = (
    "https://services2.arcgis.com/IxVN2oUE9EYLSnPE/arcgis/rest/services"
    "/PARCEL_TAX_JOIN/FeatureServer/0/query"
)
ARCGIS_FIELDS = ",".join([
    "PARCELID", "SFLA", "RMBED", "FIXBATH", "FIXHALF",
    "YRBLT", "TOTAPR1", "assessed_value", "Appraised_value",
    "CLASSDSCRP", "USEDSCRP", "SITEADDRESS", "BLDGAREA", "RESFLRAREA",
])


def _normalize_to_spaced(parcel_id: str) -> str:
    """Convert any parcel ID format to the 2+3+2+3 spaced form required by ArcGIS."""
    digits = re.sub(r'\D', '', parcel_id)
    if len(digits) != 10:
        return parcel_id
    return f"{digits[0:2]} {digits[2:5]} {digits[5:7]} {digits[7:10]}"


def arcgis_lookup(parcel_id: str) -> dict:
    """Query DeKalb ArcGIS PARCEL_TAX_JOIN for physical property specs. FREE."""
    spaced = _normalize_to_spaced(parcel_id)
    params = {
        "where": f"PARCELID='{spaced}'",
        "outFields": ARCGIS_FIELDS,
        "returnGeometry": "false",
        "f": "json",
    }
    try:
        r = requests.get(ARCGIS_URL, params=params, timeout=20)
        r.raise_for_status()
        features = r.json().get("features", [])
        if not features:
            return {}
        attrs = features[0].get("attributes", {})
        full_baths = attrs.get("FIXBATH") or 0
        half_baths = attrs.get("FIXHALF") or 0
        baths = (full_baths + half_baths * 0.5) if (full_baths or half_baths) else None
        sqft = attrs.get("SFLA") or attrs.get("RESFLRAREA") or attrs.get("BLDGAREA")
        sqft = int(sqft) if sqft and sqft > 0 else None
        beds = attrs.get("RMBED")
        beds = int(beds) if beds and beds > 0 else None
        yr = attrs.get("YRBLT")
        yr = int(yr) if yr and yr > 1800 else None
        appraised = attrs.get("Appraised_value") or attrs.get("TOTAPR1")
        assessed = attrs.get("assessed_value")
        prop_class = attrs.get("CLASSDSCRP") or attrs.get("USEDSCRP")
        site_addr = attrs.get("SITEADDRESS")
        if baths == 0:
            baths = None
        return {
            "sqft": sqft, "beds": beds, "baths": baths, "year_built": yr,
            "appraised_value": float(appraised) if appraised else None,
            "assessed_value": float(assessed) if assessed else None,
            "property_class": prop_class,
            "assessor_address": site_addr,
        }
    except Exception as e:
        print(f"  ArcGIS error for {parcel_id}: {e}")
        return {}


# ── ARV: size-matched ─────────────────────────────────────────────────────────
def compute_arv(comps: list, subject_sqft: int, appraised_value: float = None):
    """
    Returns (arv, method_str, confidence, comp_count_used).
    Uses size-matched $/sqft method. Falls back to flat median if no sqft on comps.
    """
    priced = [c for c in comps if c.get('sale_price') and c.get('sale_price') > 0]

    if not priced:
        return None, 'no comps', 'NONE', 0

    if not subject_sqft:
        prices = [c['sale_price'] for c in priced]
        arv = round(median(prices), 2)
        return arv, f'median of {len(prices)} comps (no subject sqft)', 'LOW', len(prices)

    def ppsf_comps(tolerance):
        lo = subject_sqft * (1 - tolerance)
        hi = subject_sqft * (1 + tolerance)
        return [c for c in priced if c.get('sqft') and lo <= c['sqft'] <= hi]

    matched = ppsf_comps(0.25)
    conf = 'HIGH'
    tol_used = 0.25

    if len(matched) < 3:
        matched = ppsf_comps(0.40)
        tol_used = 0.40
        conf = 'MEDIUM'

    if len(matched) < 3:
        matched = [c for c in priced if c.get('sqft')]
        conf = 'LOW'
        tol_used = None

    if not matched:
        prices = [c['sale_price'] for c in priced]
        arv = round(median(prices), 2)
        return arv, f'flat median (comps lack sqft), {len(prices)} comps', 'LOW', len(prices)

    ppsf_vals = [c['sale_price'] / c['sqft'] for c in matched]
    med_ppsf = median(ppsf_vals)
    arv = round(med_ppsf * subject_sqft, 2)

    tol_str = f'±{int(tol_used*100)}%' if tol_used else 'all sqft comps'
    method = (
        f"ppsf ${med_ppsf:.0f} × {subject_sqft:,}sqft "
        f"({len(matched)} comps {tol_str})"
    )

    if appraised_value and arv < appraised_value:
        arv = appraised_value
        method += f' [floored at appraised ${appraised_value:,.0f}]'

    if appraised_value and arv > appraised_value * 3:
        conf = 'SUSPECT_HIGH'

    return arv, method, conf, len(matched)


# ── Rehab ─────────────────────────────────────────────────────────────────────
def compute_rehab(sqft: int, year_built: int, arv: float, is_vacant: bool) -> tuple:
    """
    Age-based rehab rate + 10% contingency.
    Tax deed properties assumed distressed regardless of age.
    Rates:  >2005 → $20/sqft (light cosmetic)
            1981-2005 → $35/sqft (standard)
            ≤1980 → $50/sqft (heavy — pre-1980 likely needs systems + cosmetic)
    """
    if is_vacant:
        return 0, 'vacant lot — no rehab'
    if sqft and year_built:
        age = 2026 - year_built
        if age < 21:      rate = 20
        elif age <= 45:   rate = 35
        else:             rate = 50
        cost = round(sqft * rate * 1.10, 2)
        return cost, f'{sqft:,}sqft × ${rate}/sqft × 1.10 contingency (built {year_built}, age {age}yr)'
    elif arv:
        cost = round(arv * 0.20, 2)
        return cost, '20% of ARV (no sqft/year data)'
    return 25000.0, 'flat estimate (no property data available)'


# ── All-in cost ───────────────────────────────────────────────────────────────
def compute_all_in(tax_due: float, rehab: float, sqft: int, arv: float) -> tuple:
    """
    Full GA tax deed all-in cost model.
    Includes all transaction costs and 12-month carrying period.
    (Quiet title takes 3-6mo; then 3-6mo to sell = 12mo total.)
    """
    closing     = round(tax_due * 0.030, 2)    # Attorney, escrow, title search
    title       = round(tax_due * 0.005, 2)    # Title insurance (critical for tax deeds)
    transfer    = round((tax_due / 1000) * 2.0, 2)  # GA: $2/$1,000 (state + county)
    inspection  = 500.0
    recording   = 250.0
    quiet_title = 3500.0                        # Required for marketable title in GA

    # 12-month carrying (3-6mo quiet title + 3-6mo marketing)
    insurance   = round((sqft * 0.45 / 12) * 12, 2) if sqft else 540.0
    utilities   = 200 * 12                      # $200/month vacant property utilities
    security    = 150 * 12                      # Vacant security + lawn care
    prop_tax    = round(arv * 0.010, 2) if arv else 0  # ~1% annual property tax on ARV
    carrying    = insurance + utilities + security + prop_tax

    total = (tax_due + rehab + closing + title + transfer
             + inspection + recording + quiet_title + carrying)
    breakdown = (
        f"${tax_due:,.0f} purchase + ${rehab:,.0f} rehab + "
        f"${closing + title + transfer:,.0f} transaction costs + "
        f"${quiet_title:,.0f} quiet title + ${carrying:,.0f} carrying (12mo)"
    )
    return round(total, 2), breakdown


# ── Vacant lot detection ──────────────────────────────────────────────────────
def is_vacant_lot(prop: dict, specs: dict) -> bool:
    """
    Returns True if the property appears to be a vacant lot with no structure.
    Uses ArcGIS null SFLA + property class + appraised value as signals.
    """
    if specs.get('sqft'):
        return False  # Has sqft → has a structure
    pt = str(prop.get('property_type', '')).lower()
    if any(t in pt for t in ('vacant', 'land', 'lot')):
        return True
    prop_class = str(specs.get('property_class') or '').upper()
    if any(c in prop_class for c in ('VACANT', 'LAND', 'LOT', 'UNDEVELOPED')):
        return True
    # Very low appraised value with no structure data = likely lot
    appr = specs.get('appraised_value')
    if appr and appr < 50000:
        return True
    return False


# ── City name for Apify retry ─────────────────────────────────────────────────
def determine_city_for_comps(prop: dict, specs: dict) -> str:
    """
    Determine the best city name string to pass to ApifyZillowComps.get_sold_properties().

    Priority:
      1. Extract zip from ArcGIS SITEADDRESS → ZIP_TO_CITY
      2. Extract zip from pdf address string → ZIP_TO_CITY
      3. Parcel district (digits 2-4 of tax_id) → PARCEL_DISTRICT_CITY
      4. Default: 'Dunwoody' (most DeKalb 06-2XX parcels are Dunwoody area)
    """
    # 1. ArcGIS assessor address (most reliable — includes full USPS address)
    assessor_addr = specs.get('assessor_address') or ''
    zip_match = re.search(r'\b(3\d{4})\b', assessor_addr)
    if zip_match:
        z = zip_match.group(1)
        if z in ZIP_TO_CITY:
            return ZIP_TO_CITY[z]

    # 2. PDF address string
    pdf_addr = prop.get('full_address') or ''
    zip_match = re.search(r'\b(3\d{4})\b', pdf_addr)
    if zip_match:
        z = zip_match.group(1)
        if z in ZIP_TO_CITY:
            return ZIP_TO_CITY[z]

    # 3. Parcel district mapping
    tax_id = re.sub(r'\D', '', prop.get('tax_id') or '')
    if len(tax_id) >= 5:
        district = tax_id[2:5]  # e.g. "249", "277", "280"
        if district in PARCEL_DISTRICT_CITY:
            return PARCEL_DISTRICT_CITY[district]

    # 4. Default (almost all DeKalb 06-2XX parcels are Dunwoody)
    return 'Dunwoody'


# ── Apify comp fetch with retry ───────────────────────────────────────────────
def fetch_comps_retry(prop: dict, specs: dict, apify) -> list:
    """
    Fetch comps from Apify for a property with 0 existing comps.
    Uses city name (not zip) to avoid the ZIP → 0 results bug (Bug E).
    Tags each comp with used_for_property and used_for_address.
    Returns list of comp dicts (empty list on failure).
    """
    city = determine_city_for_comps(prop, specs)
    pid = prop.get('tax_id', '')
    addr = prop.get('full_address', '')
    print(f"    [retry] fetching Apify comps for {pid} via city='{city}'...")

    try:
        raw_comps = apify.get_sold_properties(
            city=city,
            state_code='GA',
            limit=70,
        )
        if not raw_comps:
            print(f"    [retry] WARN: Apify returned 0 comps for '{city}'")
            return []

        # Tag comps with the property they were fetched for
        tagged = []
        for c in raw_comps:
            c_copy = dict(c)
            c_copy['used_for_property'] = pid
            c_copy['used_for_address'] = addr
            c_copy['source'] = f'apify_retry_{city}'
            tagged.append(c_copy)

        print(f"    [retry] OK: {len(tagged)} comps for '{city}' tagged to {pid}")
        return tagged

    except Exception as e:
        print(f"    [retry] ERROR fetching comps for {pid}: {e}")
        return []


# ── Build/update property record ──────────────────────────────────────────────
def build_property_record(prop: dict, specs: dict, prop_comps: list) -> dict:
    """
    Given a property, its ArcGIS specs, and its comp list,
    compute ARV / rehab / all-in / ROI / max-bid and return updated record.
    """
    tax_due    = float(prop.get('tax_due') or 0)
    sqft       = specs.get('sqft')
    yr         = specs.get('year_built')
    appraised  = specs.get('appraised_value')
    vacant     = is_vacant_lot(prop, specs)
    prop_type  = 'Vacant Land' if vacant else prop.get('property_type', 'Residential')

    # ARV
    if vacant:
        arv       = appraised or prop.get('arv')
        arv_method = 'assessor appraised value (vacant lot)'
        arv_conf  = 'MEDIUM' if appraised else 'LOW'
        arv_comps = 0
    else:
        arv, arv_method, arv_conf, arv_comps = compute_arv(prop_comps, sqft, appraised)
        if not arv:
            arv       = prop.get('arv')     # last resort: keep old pipeline value
            arv_method = 'prior pipeline estimate (still no comps available)'
            arv_conf  = 'LOW'

    # Rehab
    rehab, rehab_method = compute_rehab(sqft, yr, arv, vacant)

    # All-in
    all_in, all_in_breakdown = compute_all_in(tax_due, rehab, sqft, arv)

    # Net profit / ROI
    selling_costs = round(arv * 0.07, 2) if arv else 0
    net_profit    = round((arv - selling_costs) - all_in, 2) if arv else 0
    roi_pct       = round((net_profit / all_in * 100), 2) if all_in > 0 else 0

    # Max bid (GA 65% rule — conservative for tax deeds with title risk)
    if arv:
        quiet_title = 3500.0
        carrying = 200 * 12 + 150 * 12 + (round(arv * 0.01, 2) if arv else 0)
        max_bid = max(
            round((arv * 0.65) - rehab - quiet_title - carrying, 2),
            tax_due
        )
    else:
        max_bid = tax_due

    # Deal score (70% ROI weight + 30% risk weight)
    if not arv:
        deal_score = 0
    else:
        if roi_pct >= 50:   roi_pts = 70
        elif roi_pct >= 30: roi_pts = int(50 + (roi_pct - 30) * 1.0)
        elif roi_pct >= 20: roi_pts = int(30 + (roi_pct - 20) * 2.0)
        elif roi_pct > 0:   roi_pts = int(roi_pct * 1.5)
        else:               roi_pts = 0
        risk_str = str(prop.get('risk_score', ''))
        risk_pts = 30 if risk_str in ('None', '', 'null') else 15
        deal_score = min(100, roi_pts + risk_pts)

    p_out = dict(prop)
    p_out.update({
        'sqft':              sqft,
        'beds':              specs.get('beds'),
        'baths':             specs.get('baths'),
        'year_built':        yr,
        'appraised_value':   appraised,
        'property_class':    specs.get('property_class'),
        'assessor_address':  specs.get('assessor_address'),
        'property_type':     prop_type,
        'arv':               arv,
        'arv_method':        arv_method,
        'arv_confidence':    arv_conf,
        'arv_comp_count':    arv_comps,
        'estimated_rehab':   rehab,
        'rehab_method':      rehab_method,
        'all_in_cost':       all_in,
        'all_in_breakdown':  all_in_breakdown,
        'net_profit':        net_profit,
        'roi_percent':       roi_pct,
        'deal_score':        deal_score,
        'recommended_max_bid': max_bid,
    })
    return p_out


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    refetch_mode = '--refetch' in sys.argv
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    # ── Load source JSON ──────────────────────────────────────────────────────
    results_dir = ROOT / '.tmp' / 'dekalb_results'
    for pattern in ('dekalb_enriched_*.json', 'dekalb_enhanced_*.json',
                    'dekalb_deterministic_*.json'):
        jsons = sorted(results_dir.glob(pattern))
        if jsons:
            break
    if not jsons:
        print("ERROR: no analysis JSON found in .tmp/dekalb_results/")
        return

    src = jsons[-1]
    print(f"\n{'='*65}")
    print(f"  {'RE-ENRICHING (+ REFETCH)' if refetch_mode else 'RE-ENRICHING'}: {src.name}")
    print(f"{'='*65}\n")

    with open(src, encoding='utf-8') as f:
        data = json.load(f)

    properties  = data.get('properties', data if isinstance(data, list) else [])
    comparables = data.get('comparables', [])

    # Index comps by tax_id (parcel ID)
    comps_by_prop: dict[str, list] = {}
    for c in comparables:
        key = c.get('used_for_property') or ''
        if key:
            comps_by_prop.setdefault(key, []).append(c)

    print(f"Loaded {len(properties)} properties, {len(comparables)} comps "
          f"({len(comps_by_prop)} properties have comps)\n")

    # ── Phase 1: ArcGIS enrichment + compute from cached comps ───────────────
    enriched = []
    specs_cache: dict[str, dict] = {}

    for i, prop in enumerate(properties):
        pid  = prop.get('tax_id', '')
        addr = prop.get('full_address', 'Unknown')
        print(f"[{i+1:02d}] {pid}  {addr}")

        specs = arcgis_lookup(pid)
        specs_cache[pid] = specs
        time.sleep(0.2)

        prop_comps = comps_by_prop.get(pid, [])
        record = build_property_record(prop, specs, prop_comps)
        enriched.append(record)

        arv_str = f'${record["arv"]:,.0f}' if record.get('arv') else 'N/A'
        bid_str = f'${record["recommended_max_bid"]:,.0f}' if record.get('recommended_max_bid') else 'N/A'
        print(f"       sqft={record.get('sqft')}  beds={record.get('beds')}  "
              f"baths={record.get('baths')}  yr={record.get('year_built')}  "
              f"ARV={arv_str} [{record.get('arv_confidence','?')}]  "
              f"ROI={record.get('roi_percent',0):.0f}%  BID_MAX={bid_str}")
        if record.get('property_type') == 'Vacant Land':
            print(f"       ** VACANT LOT — lot value {arv_str}")

    # ── Phase 2: Retry — Apify re-fetch for 0-comp non-vacant properties ─────
    if refetch_mode:
        needs_refetch = [
            p for p in enriched
            if p.get('arv_comp_count', 0) == 0
            and p.get('property_type') != 'Vacant Land'
        ]
        if needs_refetch:
            print(f"\n{'='*65}")
            print(f"  RETRY PHASE: {len(needs_refetch)} properties need fresh Apify comps")
            print(f"{'='*65}\n")

            try:
                from execution.enrichment.apify_comps import ApifyZillowComps
                apify = ApifyZillowComps()
            except Exception as e:
                print(f"  ERROR: Cannot initialise Apify client: {e}")
                apify = None

            if apify:
                new_comps_total = 0
                retry_results: dict[str, list] = {}

                for p in needs_refetch:
                    pid  = p.get('tax_id', '')
                    specs = specs_cache.get(pid, {})
                    new_comps = fetch_comps_retry(p, specs, apify)
                    if new_comps:
                        retry_results[pid] = new_comps
                        new_comps_total += len(new_comps)
                        comparables.extend(new_comps)
                        # Update index
                        comps_by_prop.setdefault(pid, []).extend(new_comps)

                print(f"\n  Retry fetched {new_comps_total} new comps "
                      f"across {len(retry_results)} properties\n")

                # Re-compute ARV for properties that now have comps
                for i, p in enumerate(enriched):
                    pid = p.get('tax_id', '')
                    if pid in retry_results:
                        specs = specs_cache.get(pid, {})
                        prop_comps = comps_by_prop.get(pid, [])
                        updated = build_property_record(p, specs, prop_comps)
                        enriched[i] = updated

                        arv_str = f'${updated["arv"]:,.0f}' if updated.get('arv') else 'N/A'
                        bid_str = f'${updated["recommended_max_bid"]:,.0f}' if updated.get('recommended_max_bid') else 'N/A'
                        print(f"  UPDATED {pid}  {p.get('full_address','')}")
                        print(f"    ARV={arv_str} [{updated.get('arv_confidence','?')}]  "
                              f"comps_used={updated.get('arv_comp_count',0)}  "
                              f"ROI={updated.get('roi_percent',0):.0f}%  BID_MAX={bid_str}")
        else:
            print("\n  No properties need comp retry (all have comps or are vacant lots).")
    else:
        zero_comp_props = [
            p for p in enriched
            if p.get('arv_comp_count', 0) == 0
            and p.get('property_type') != 'Vacant Land'
        ]
        if zero_comp_props:
            print(f"\n  NOTE: {len(zero_comp_props)} properties still have 0 comps.")
            print(f"  Run with --refetch to re-pull Apify comps for these:")
            for p in zero_comp_props:
                print(f"    {p.get('tax_id'):20s}  {p.get('full_address','')}")

    # ── Save enriched JSON ────────────────────────────────────────────────────
    out_json = results_dir / f'dekalb_enriched_{ts}.json'
    out_data = {
        'properties':       enriched,
        'comparables':      comparables,
        'analysis_date':    ts[:8],
        'total_properties': len(enriched),
        'total_comps':      len(comparables),
        'refetch_mode':     refetch_mode,
    }
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(out_data, f, indent=2, default=str)
    print(f"\n  Saved: {out_json.name}")

    # ── Regenerate ui/data.js ─────────────────────────────────────────────────
    print("  Regenerating ui/data.js ...")
    import importlib.util
    gen_path = ROOT / 'execution' / 'generate_ui_data.py'
    spec_obj = importlib.util.spec_from_file_location('gen_ui', gen_path)
    gen = importlib.util.module_from_spec(spec_obj)
    spec_obj.loader.exec_module(gen)
    gen.main()

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*65}")
    print("  ENRICHMENT SUMMARY")
    print(f"{'='*65}")
    with_sqft   = sum(1 for p in enriched if p.get('sqft'))
    with_arv    = sum(1 for p in enriched if p.get('arv'))
    high_conf   = sum(1 for p in enriched if p.get('arv_confidence') == 'HIGH')
    no_comps    = sum(1 for p in enriched
                      if p.get('arv_comp_count', 0) == 0
                      and p.get('property_type') != 'Vacant Land')
    profitable  = sum(1 for p in enriched if (p.get('roi_percent') or 0) >= 30)
    print(f"  Properties with ArcGIS sqft data:  {with_sqft}/{len(enriched)}")
    print(f"  Properties with ARV:               {with_arv}/{len(enriched)}")
    print(f"  HIGH confidence ARVs:              {high_conf}/{len(enriched)}")
    print(f"  Still 0 comps (non-vacant):        {no_comps}/{len(enriched)}")
    print(f"  Profitable deals (ROI >= 30%):     {profitable}/{len(enriched)}")

    top5 = sorted(enriched, key=lambda x: x.get('roi_percent') or 0, reverse=True)[:5]
    print("\n  Top 5 by ROI:")
    for p in top5:
        arv_str = f'${p.get("arv", 0):>10,.0f}' if p.get('arv') else '          N/A'
        bid_str = f'${p.get("recommended_max_bid", 0):>10,.0f}' if p.get('recommended_max_bid') else '          N/A'
        print(f"    {p.get('full_address', '?'):35s}  "
              f"ARV={arv_str}  "
              f"ROI={p.get('roi_percent', 0):>7.1f}%  "
              f"BID_MAX={bid_str}")
    print()


if __name__ == '__main__':
    main()
