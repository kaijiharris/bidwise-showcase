"""
Unfiltered DeKalb County Property Analysis

Creates a complete, unfiltered pool of properties with full enrichment data.
Users apply their own investment criteria to filter the results.

This system:
- Analyzes ALL properties (no filtering)
- Gets actual property details (beds/baths/sqft/year) when available
- Calculates as-is price (wholesale value)
- Estimates rehab costs
- Documents all calculations transparently
- Lets users filter by their own criteria: Min ROI, strategy, max rehab, etc.
"""
import os
import sys
import json
import logging
import pandas as pd
import dotenv
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils.dataframe import dataframe_to_rows

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from execution.enrichment.apify_comps import ApifyZillowComps

# Load Environment
env_path = Path(__file__).parent.parent / '.env'
dotenv.load_dotenv(dotenv_path=env_path)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("UnfilteredDeKalb")


def classify_property_type(prop: Dict) -> Dict:
    """
    Classify property as residential, commercial, or vacant lot.

    Criteria:
    - Vacant Lot: No structure, land only, very low tax amounts
    - Residential: Single family, condo, townhouse (1-4 units)
    - Commercial: Office, retail, industrial, multi-family (5+ units)
    """
    tax_due = prop.get('tax_due', 0)
    address = prop.get('full_address', '').upper()
    raw_text = prop.get('raw_text', '').upper()

    # Vacant lot indicators
    vacant_keywords = ['LOT', 'LAND', 'ACRE', 'TRACT', 'PARCEL']
    if any(kw in address or kw in raw_text for kw in vacant_keywords):
        return {
            'property_type': 'Vacant Lot',
            'classification_reason': 'Address/description contains lot/land keywords',
            'notes': 'Land deals - verify if fits your investment strategy'
        }

    # Very low tax usually means vacant or minimal structure
    if tax_due < 500:
        return {
            'property_type': 'Likely Vacant Lot',
            'classification_reason': f'Very low tax due (${tax_due:.2f}) suggests minimal/no structure',
            'notes': 'Verify structure exists before bidding'
        }

    # Residential indicators (most tax deed properties)
    residential_indicators = ['DR', 'DRIVE', 'ST', 'STREET', 'AVE', 'AVENUE', 'CT', 'COURT',
                             'LN', 'LANE', 'WAY', 'CIR', 'CIRCLE', 'PL', 'PLACE', 'RD', 'ROAD']
    if any(ind in address for ind in residential_indicators):
        return {
            'property_type': 'Residential',
            'classification_reason': 'Standard street address format',
            'notes': 'Standard residential property'
        }

    # Commercial indicators
    commercial_keywords = ['PLAZA', 'CENTER', 'BUILDING', 'OFFICE', 'SUITE', 'INDUSTRIAL']
    if any(kw in address or kw in raw_text for kw in commercial_keywords):
        return {
            'property_type': 'Commercial',
            'classification_reason': 'Commercial property keywords in address',
            'notes': 'Requires commercial real estate expertise'
        }

    # Default to residential for standard addresses
    return {
        'property_type': 'Residential (Assumed)',
        'classification_reason': 'Standard property with moderate tax amount',
        'notes': 'Verify property type before bidding'
    }


def extract_city_from_address(full_address: str, raw_text: str) -> str:
    """Extract city name from address or raw text"""
    common_cities = [
        'ATLANTA', 'DECATUR', 'DORAVILLE', 'DUNWOODY',
        'CHAMBLEE', 'STONE MOUNTAIN', 'LITHONIA', 'CLARKSTON',
        'AVONDALE ESTATES', 'PINE LAKE', 'TUCKER'
    ]

    search_text = f"{full_address} {raw_text}".upper()
    for city in common_cities:
        if city in search_text:
            return city.title()

    return "Decatur"  # Default


def search_property_on_zillow(apify_client, address: str, city: str) -> Optional[Dict]:
    """
    Search for specific property on Zillow to get actual details.
    Returns property data or None if not found.
    """
    from apify_client import ApifyClient

    search_address = f"{address}, {city}, GA"
    logger.info(f"Searching Zillow for property details: {search_address}")

    actor_id = "igolaizola/zillow-scraper-ppe"
    operations = ["sold", "buy"]

    for operation in operations:
        try:
            run_input = {
                "location": search_address,
                "operation": operation,
                "maxItems": 5,
            }

            run = apify_client.actor(actor_id).call(run_input=run_input, timeout_secs=60)
            items = list(apify_client.dataset(run["defaultDatasetId"]).iterate_items())

            if not items:
                continue

            # Try to find exact address match
            for item in items:
                item_address = item.get('address', {})
                if isinstance(item_address, dict):
                    item_street = item_address.get('streetAddress', '').upper()
                    if address.upper() in item_street:
                        # Extract property details
                        return {
                            'bedrooms': item.get('bedrooms'),
                            'bathrooms': item.get('bathrooms'),
                            'livingArea': item.get('livingArea'),
                            'yearBuilt': item.get('yearBuilt'),
                            'propertyType': item.get('propertyType', 'Unknown'),
                            'data_source': f'Zillow ({operation})',
                            'data_quality': 'verified'
                        }

        except Exception as e:
            logger.warning(f"Zillow search failed for {operation}: {e}")
            continue

    return None


def estimate_from_comps(comps: List[Dict]) -> Dict:
    """Estimate property details from comparable properties"""
    if not comps:
        return {
            'bedrooms': None,
            'bathrooms': None,
            'livingArea': None,
            'yearBuilt': None,
            'data_quality': 'unavailable'
        }

    # Calculate medians
    sqfts = [c.get('sqft', 0) for c in comps if c.get('sqft')]
    beds = [c.get('bedrooms', 0) for c in comps if c.get('bedrooms')]
    baths = [c.get('bathrooms', 0) for c in comps if c.get('bathrooms')]
    years = [c.get('year_built', 0) for c in comps if c.get('year_built')]

    def safe_median(values):
        if not values:
            return None
        sorted_vals = sorted(values)
        mid = len(sorted_vals) // 2
        if len(sorted_vals) % 2 == 0:
            return (sorted_vals[mid - 1] + sorted_vals[mid]) / 2
        return sorted_vals[mid]

    return {
        'bedrooms': int(safe_median(beds)) if beds else None,
        'bathrooms': round(safe_median(baths), 1) if baths else None,
        'livingArea': int(safe_median(sqfts)) if sqfts else None,
        'yearBuilt': int(safe_median(years)) if years else None,
        'data_source': 'Estimated from comps',
        'data_quality': 'estimated'
    }


def calculate_as_is_price(arv: Optional[float], data_quality: str,
                           rehab_cost: float = None, is_high_risk: bool = False) -> Dict:
    """
    Calculate as-is price (wholesale value for immediate sale).

    UNIFORM FORMULA (same for every property):
      As-Is = ARV × 0.70 − Rehab_Cost      (standard)
      As-Is = ARV × 0.65 − Rehab_Cost      (high-risk properties)
      Floor: never negative; min = 0

    This is the MAO (Maximum Allowable Offer) formula — what a cash investor
    would pay TODAY without doing any rehab work.
    """
    if not arv or arv <= 0:
        return {
            'as_is_price': None,
            'as_is_formula': 'ARV × 70% − Rehab',
            'as_is_confidence': 'unavailable',
            'as_is_explanation': 'Cannot calculate without ARV'
        }

    rehab = rehab_cost or 0.0
    pct = 0.65 if is_high_risk else 0.70
    as_is_price = max(arv * pct - rehab, 0)

    confidence = 'medium' if data_quality == 'verified' else 'low'

    return {
        'as_is_price': round(as_is_price, 2),
        'as_is_formula': f'${arv:,.0f} × {pct:.0%} − ${rehab:,.0f} rehab = ${as_is_price:,.0f}',
        'as_is_confidence': confidence,
        'as_is_explanation': f'{pct:.0%} of ARV minus rehab cost — immediate cash sale value (MAO formula)'
    }


def calculate_rehab_cost(sqft: Optional[float], arv: Optional[float], property_type: str) -> Dict:
    """
    Calculate estimated rehab costs.

    Method 1: Square footage based ($35/sqft standard rehab)
    Method 2: ARV percentage (20% for unknowns)
    """
    if property_type in ['Vacant Lot', 'Likely Vacant Lot']:
        return {
            'rehab_cost': 0,
            'rehab_formula': 'N/A - Vacant lot',
            'rehab_confidence': 'high',
            'rehab_scope': 'No rehab needed (land only)'
        }

    # Method 1: Sqft-based (preferred)
    if sqft and sqft > 0:
        cost_per_sqft = 35  # Standard rehab rate
        base_cost = sqft * cost_per_sqft
        contingency = base_cost * 0.10
        total_cost = base_cost + contingency

        return {
            'rehab_cost': total_cost,
            'rehab_formula': f'{sqft:,.0f} sqft × $35/sqft + 10% contingency = ${total_cost:,.0f}',
            'rehab_confidence': 'medium',
            'rehab_scope': 'Standard rehab: paint, flooring, kitchen/bath updates, HVAC service, minor repairs'
        }

    # Method 2: ARV percentage (fallback)
    if arv and arv > 0:
        total_cost = arv * 0.20

        return {
            'rehab_cost': total_cost,
            'rehab_formula': f'${arv:,.0f} × 20% = ${total_cost:,.0f}',
            'rehab_confidence': 'low',
            'rehab_scope': 'Estimated at 20% of ARV (industry average for cosmetic flip)'
        }

    return {
        'rehab_cost': None,
        'rehab_formula': 'Unknown',
        'rehab_confidence': 'unavailable',
        'rehab_scope': 'Cannot estimate without property size or ARV'
    }


def analyze_comp_quality(comps: List[Dict], property: Dict) -> Dict:
    """
    Analyze the quality of comparable sales data.

    Scoring (0-100):
    - Recency (30pts): Recent sales are more reliable
    - Variance (30pts): Low variance = consistent market
    - Count (40pts): More comps = higher confidence
    """
    if not comps:
        return {
            'comp_count': 0,
            'comp_quality_score': 0,
            'comp_quality_rating': 'Very Poor',
            'arv_confidence': 'very low'
        }

    comp_count = len(comps)

    # Calculate score components
    # 1. Recency Score (0-30 points)
    recent_comps = sum(1 for c in comps if c.get('days_since_sale', 999) <= 180)
    recency_score = (recent_comps / comp_count) * 30

    # 2. Variance Score (0-30 points)
    prices = [c.get('sale_price', 0) for c in comps if c.get('sale_price')]
    if prices:
        avg_price = sum(prices) / len(prices)
        max_price = max(prices)
        min_price = min(prices)
        variance_pct = ((max_price - min_price) / avg_price * 100) if avg_price > 0 else 100
        variance_score = max(0, 30 - (variance_pct / 10))
    else:
        variance_score = 0

    # 3. Count Score (0-40 points)
    count_score = min(40, comp_count * 4)

    # Total Score
    total_score = recency_score + variance_score + count_score

    # Quality Rating
    if total_score >= 80:
        rating = 'Excellent'
        confidence = 'high'
    elif total_score >= 60:
        rating = 'Good'
        confidence = 'medium'
    elif total_score >= 40:
        rating = 'Fair'
        confidence = 'low'
    elif total_score >= 20:
        rating = 'Poor'
        confidence = 'very low'
    else:
        rating = 'Very Poor'
        confidence = 'very low'

    return {
        'comp_count': comp_count,
        'comp_quality_score': round(total_score, 1),
        'comp_quality_rating': rating,
        'arv_confidence': confidence,
        'price_variance_pct': round(variance_pct, 1) if prices else None
    }


def analyze_property(prop: Dict, apify_comps: ApifyZillowComps, apify_client) -> Dict:
    """
    Complete property analysis with enrichment.

    Returns all data for user to filter by their own criteria.
    """
    logger.info(f"\nAnalyzing: {prop.get('parcel_id')} - {prop.get('full_address')}")

    # Property classification
    classification = classify_property_type(prop)

    # Extract city
    city = extract_city_from_address(prop.get('full_address', ''), prop.get('raw_text', ''))

    # Get comparable sales
    logger.info(f"Fetching comps for {city}...")
    comps = apify_comps.get_sold_properties(city=city, state_code='GA', limit=10)
    logger.info(f"Found {len(comps)} comps")

    # Analyze comp quality
    comp_analysis = analyze_comp_quality(comps, prop)

    # Calculate ARV from comps
    if comps:
        prices = [c.get('sale_price', 0) for c in comps if c.get('sale_price')]
        avg_arv = sum(prices) / len(prices) if prices else None
        min_arv = min(prices) if prices else None
        max_arv = max(prices) if prices else None

        arv_formula = f"Average of {len(prices)} sold comps: ${avg_arv:,.0f}" if avg_arv else "No comps available"
    else:
        avg_arv = None
        min_arv = None
        max_arv = None
        arv_formula = "No comps available"

    # Try to get actual property details from Zillow
    logger.info("Searching for property details on Zillow...")
    property_details = search_property_on_zillow(apify_client, prop.get('full_address', ''), city)

    # If not found, estimate from comps
    if not property_details:
        logger.info("Property not found on Zillow, estimating from comps...")
        property_details = estimate_from_comps(comps)

    sqft = property_details.get('livingArea')
    beds = property_details.get('bedrooms')
    baths = property_details.get('bathrooms')
    year_built = property_details.get('yearBuilt')
    data_quality = property_details.get('data_quality', 'unavailable')

    # Calculate as-is price
    as_is_data = calculate_as_is_price(avg_arv, data_quality)

    # Calculate rehab costs
    rehab_data = calculate_rehab_cost(sqft, avg_arv, classification['property_type'])

    # Calculate all-in cost
    tax_due = prop.get('tax_due', 0)
    rehab_cost = rehab_data.get('rehab_cost', 0) or 0
    all_in_cost = tax_due + rehab_cost
    all_in_formula = f"${tax_due:,.0f} (tax) + ${rehab_cost:,.0f} (rehab) = ${all_in_cost:,.0f}"

    # Calculate potential profit and ROI
    as_is_price = as_is_data.get('as_is_price')
    if avg_arv and avg_arv > 0:
        potential_profit = avg_arv - all_in_cost
        roi = (potential_profit / all_in_cost * 100) if all_in_cost > 0 else 0
        roi_formula = f"(${avg_arv:,.0f} - ${all_in_cost:,.0f}) / ${all_in_cost:,.0f} = {roi:.1f}%"
    else:
        potential_profit = None
        roi = None
        roi_formula = "Cannot calculate without ARV"

    # Compile result
    result = {
        # Property Info
        'parcel_id': prop.get('parcel_id'),
        'address': prop.get('full_address'),
        'city': city,
        'property_type': classification['property_type'],
        'classification_reason': classification['classification_reason'],

        # Property Details
        'bedrooms': beds,
        'bathrooms': baths,
        'sqft': sqft,
        'year_built': year_built,
        'data_quality': data_quality,
        'data_source': property_details.get('data_source', 'Unknown'),

        # Costs
        'tax_due': tax_due,
        'rehab_cost': rehab_cost,
        'rehab_formula': rehab_data.get('rehab_formula'),
        'rehab_scope': rehab_data.get('rehab_scope'),
        'all_in_cost': all_in_cost,
        'all_in_formula': all_in_formula,

        # Values
        'arv': avg_arv,
        'arv_min': min_arv,
        'arv_max': max_arv,
        'arv_formula': arv_formula,
        'arv_confidence': comp_analysis['arv_confidence'],

        'as_is_price': as_is_price,
        'as_is_formula': as_is_data.get('as_is_formula'),
        'as_is_explanation': as_is_data.get('as_is_explanation'),

        # Returns
        'potential_profit': potential_profit,
        'roi_percent': roi,
        'roi_formula': roi_formula,

        # Comp Quality
        'comp_count': comp_analysis['comp_count'],
        'comp_quality_score': comp_analysis['comp_quality_score'],
        'comp_quality_rating': comp_analysis['comp_quality_rating'],
        'price_variance_pct': comp_analysis.get('price_variance_pct'),

        # Notes
        'notes': classification.get('notes', ''),

        # Raw
        'raw_text': prop.get('raw_text', '')
    }

    # Add comps to separate list
    return result, comps


def run_analysis(input_file: str, limit: int = 25):
    """
    Run complete unfiltered analysis on DeKalb properties.

    Args:
        input_file: Path to parsed properties JSON
        limit: Number of properties to analyze (0 = all)
    """
    logger.info("=" * 80)
    logger.info("UNFILTERED DEKALB COUNTY PROPERTY ANALYSIS")
    logger.info("Creating complete dataset for user-discretionary filtering")
    logger.info("=" * 80)

    # Load properties
    logger.info(f"Loading properties from: {input_file}")
    with open(input_file, 'r') as f:
        properties = json.load(f)

    if limit > 0:
        properties = properties[:limit]
        logger.info(f"Analyzing first {limit} properties")
    else:
        logger.info(f"Analyzing all {len(properties)} properties")

    # Initialize services
    apify_key = os.getenv('APIFY_API_KEY')
    if not apify_key:
        raise ValueError("APIFY_API_KEY not found in environment")

    apify_comps = ApifyZillowComps()  # Reads API key from environment

    from apify_client import ApifyClient
    apify_client = ApifyClient(apify_key)

    # Analyze each property
    results = []
    all_comps = []

    for idx, prop in enumerate(properties, 1):
        logger.info(f"\n{'='*60}")
        logger.info(f"Property {idx}/{len(properties)}")

        try:
            result, comps = analyze_property(prop, apify_comps, apify_client)
            results.append(result)

            # Tag comps with property ID
            for comp in comps:
                comp['for_property'] = result['parcel_id']
            all_comps.extend(comps)

            logger.info(f"✓ Analysis complete")
            logger.info(f"  Type: {result['property_type']}")
            logger.info(f"  ARV: ${result['arv']:,.0f}" if result['arv'] else "  ARV: N/A")
            logger.info(f"  ROI: {result['roi_percent']:.1f}%" if result['roi_percent'] else "  ROI: N/A")
            logger.info(f"  Data Quality: {result['data_quality']}")

        except Exception as e:
            logger.error(f"Error analyzing property: {e}", exc_info=True)
            continue

    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = Path('.tmp/dekalb_results')
    output_dir.mkdir(parents=True, exist_ok=True)

    # JSON output
    json_file = output_dir / f'dekalb_unfiltered_{timestamp}.json'
    with open(json_file, 'w') as f:
        json.dump({
            'analysis_date': datetime.now().isoformat(),
            'total_properties': len(results),
            'properties': results,
            'comps': all_comps
        }, f, indent=2)
    logger.info(f"\n✓ JSON saved: {json_file}")

    # Excel output
    excel_file = output_dir / f'dekalb_unfiltered_{timestamp}.xlsx'
    create_unfiltered_workbook(results, all_comps, str(excel_file))
    logger.info(f"✓ Excel saved: {excel_file}")

    # Summary
    logger.info("\n" + "=" * 80)
    logger.info("ANALYSIS COMPLETE")
    logger.info("=" * 80)
    logger.info(f"Total Properties Analyzed: {len(results)}")

    property_types = {}
    for r in results:
        ptype = r['property_type']
        property_types[ptype] = property_types.get(ptype, 0) + 1

    logger.info("\nProperty Types:")
    for ptype, count in property_types.items():
        logger.info(f"  {ptype}: {count}")

    data_quality = {}
    for r in results:
        dq = r['data_quality']
        data_quality[dq] = data_quality.get(dq, 0) + 1

    logger.info("\nData Quality:")
    for dq, count in data_quality.items():
        logger.info(f"  {dq}: {count}")

    logger.info(f"\nTotal Comps Found: {len(all_comps)}")
    logger.info(f"\nUse Excel to filter by your own criteria:")
    logger.info(f"  - Min ROI threshold")
    logger.info(f"  - Property type preference")
    logger.info(f"  - Max rehab budget")
    logger.info(f"  - Investment strategy")
    logger.info(f"  - Data quality requirements")

    return results, all_comps


def create_unfiltered_workbook(properties: List[Dict], comps: List[Dict], output_file: str):
    """
    Create Excel workbook with unfiltered property data.

    User applies their own filtering criteria.
    """
    logger.info(f"Creating unfiltered workbook: {output_file}")

    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # Remove default sheet

    # Sheet 1: All Properties (Unfiltered)
    ws1 = wb.create_sheet("All Properties", 0)

    # Define columns
    columns = [
        'parcel_id', 'address', 'city', 'property_type',
        'bedrooms', 'bathrooms', 'sqft', 'year_built',
        'tax_due', 'rehab_cost', 'all_in_cost',
        'arv', 'arv_min', 'arv_max',
        'as_is_price', 'potential_profit', 'roi_percent',
        'comp_count', 'comp_quality_score', 'comp_quality_rating',
        'data_quality', 'arv_confidence',
        'arv_formula', 'rehab_formula', 'as_is_formula', 'roi_formula',
        'notes'
    ]

    # Write headers
    for col_idx, col_name in enumerate(columns, 1):
        cell = ws1.cell(row=1, column=col_idx)
        cell.value = col_name.replace('_', ' ').title()
        cell.font = Font(bold=True, size=11)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        cell.font = Font(bold=True, color="FFFFFF", size=11)
        cell.alignment = Alignment(horizontal='center', vertical='center')

    # Write data
    for row_idx, prop in enumerate(properties, 2):
        for col_idx, col_name in enumerate(columns, 1):
            value = prop.get(col_name)
            cell = ws1.cell(row=row_idx, column=col_idx)
            cell.value = value

            # Format numbers
            if col_name in ['tax_due', 'rehab_cost', 'all_in_cost', 'arv', 'arv_min', 'arv_max',
                          'as_is_price', 'potential_profit']:
                if isinstance(value, (int, float)):
                    cell.number_format = '$#,##0'
            elif col_name == 'roi_percent':
                if isinstance(value, (int, float)):
                    cell.number_format = '0.0"%"'
            elif col_name in ['sqft', 'year_built', 'bedrooms']:
                if isinstance(value, (int, float)):
                    cell.number_format = '0'
            elif col_name == 'bathrooms':
                if isinstance(value, (int, float)):
                    cell.number_format = '0.0'

    # Auto-adjust column widths
    for column_cells in ws1.columns:
        length = max(len(str(cell.value or '')) for cell in column_cells)
        ws1.column_dimensions[column_cells[0].column_letter].width = min(length + 2, 50)

    # Freeze header row
    ws1.freeze_panes = 'A2'

    # Sheet 2: Comparable Sales
    ws2 = wb.create_sheet("Comparable Sales")

    comp_columns = ['for_property', 'address', 'city', 'sale_price', 'bedrooms',
                   'bathrooms', 'sqft', 'year_built', 'sale_date', 'days_since_sale']

    for col_idx, col_name in enumerate(comp_columns, 1):
        cell = ws2.cell(row=1, column=col_idx)
        cell.value = col_name.replace('_', ' ').title()
        cell.font = Font(bold=True, size=11)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        cell.font = Font(bold=True, color="FFFFFF", size=11)

    for row_idx, comp in enumerate(comps, 2):
        for col_idx, col_name in enumerate(comp_columns, 1):
            value = comp.get(col_name)
            cell = ws2.cell(row=row_idx, column=col_idx)
            cell.value = value

            if col_name == 'sale_price':
                if isinstance(value, (int, float)):
                    cell.number_format = '$#,##0'

    for column_cells in ws2.columns:
        length = max(len(str(cell.value or '')) for cell in column_cells)
        ws2.column_dimensions[column_cells[0].column_letter].width = min(length + 2, 40)

    ws2.freeze_panes = 'A2'

    # Sheet 3: Methodology & Filtering Guide
    create_filtering_methodology_sheet(wb)

    # Sheet 4: Calculation Reference
    create_calculation_reference_sheet(wb)

    # Save
    wb.save(output_file)
    logger.info(f"✓ Workbook created with {len(properties)} properties")


def create_filtering_methodology_sheet(wb):
    """
    Create methodology sheet explaining calculations and filtering approach.

    Key difference from previous version: Does NOT prescribe ROI thresholds.
    Instead, explains calculations and lets user apply their own criteria.
    """
    ws = wb.create_sheet("Methodology & Filtering")

    methodology = [
        ("UNFILTERED PROPERTY POOL", ""),
        ("", ""),
        ("What This Dataset Contains", ""),
        ("All properties analyzed", "No filtering applied - complete pool"),
        ("Complete property data", "Beds/baths/sqft/year when available"),
        ("Market research backed", "ARV from actual comparable sales"),
        ("Transparent calculations", "Every number documented with formula"),
        ("Data quality indicators", "'verified' = actual data, 'estimated' = from comps, 'unavailable' = missing"),
        ("", ""),
        ("", ""),
        ("YOUR INVESTMENT CRITERIA (Apply Your Own Filters)", ""),
        ("", ""),
        ("This is YOUR decision - filter the data based on:", ""),
        ("Min ROI", "What return do you need? 20%? 30%? 50%+?"),
        ("Investment Strategy", "Fix & flip? Wholesale? Buy & hold?"),
        ("Max Rehab Budget", "Can you handle $50k rehab? Or only cosmetic?"),
        ("Property Type", "Residential only? Or commercial too?"),
        ("Data Quality", "Require 'verified' data? Or okay with estimates?"),
        ("ARV Confidence", "Need 'high' confidence comps? Or accept 'medium'?"),
        ("Location", "Which cities fit your target area?"),
        ("Max All-In Cost", "What's your total budget cap?"),
        ("Min Comp Quality Score", "Require score > 60? Or accept lower?"),
        ("", ""),
        ("HOW TO USE THIS DATA:", ""),
        ("1. Review all properties", "Scroll through complete dataset"),
        ("2. Apply Excel filters", "Use built-in filters on column headers"),
        ("3. Sort by your priorities", "Sort by ROI, property type, data quality, etc."),
        ("4. Export your shortlist", "Copy filtered results to new sheet"),
        ("5. Do deeper due diligence", "Drive by, verify details, get contractor bids"),
        ("", ""),
        ("", ""),
        ("CALCULATION METHODS", ""),
        ("", ""),
        ("After Repair Value (ARV)", ""),
        ("Method", "Average sale price of comparable properties"),
        ("Data Source", "Zillow sold properties in same city (last 12 months)"),
        ("Formula", "ARV = Average of comp sale prices"),
        ("Quality Factors", "Recency of sales, price variance, number of comps"),
        ("", ""),
        ("Rehab Cost Estimation", ""),
        ("Method 1 (Preferred)", "Square footage based: sqft × $35/sqft + 10% contingency"),
        ("Method 2 (Fallback)", "ARV percentage: 20% of ARV (if sqft unknown)"),
        ("Standard Rehab Includes", "Paint, flooring, kitchen/bath updates, HVAC service, minor repairs"),
        ("Note", "Get contractor bids for accurate estimates on specific properties"),
        ("", ""),
        ("As-Is Price (Wholesale Value)", ""),
        ("Method", "65% of ARV (industry standard for tax deeds)"),
        ("Purpose", "Immediate cash sale value without repairs"),
        ("Use Case", "Downside protection - minimum viable sale price"),
        ("Formula", "As-Is Price = ARV × 0.65"),
        ("", ""),
        ("Return on Investment (ROI)", ""),
        ("Formula", "(ARV - All-In Cost) / All-In Cost × 100%"),
        ("All-In Cost", "Tax Due + Rehab Cost"),
        ("Note", "This is POTENTIAL profit assuming successful flip at ARV"),
        ("Reality Check", "Subtract holding costs, selling costs (6-8%), unexpected repairs"),
        ("", ""),
        ("Comp Quality Score (0-100)", ""),
        ("Recency (30pts)", "More points for recent sales (last 6 months)"),
        ("Variance (30pts)", "Low price variance = consistent market"),
        ("Count (40pts)", "More comps = higher confidence (4pts each, max 10 comps)"),
        ("80-100 = Excellent", "High confidence in ARV"),
        ("60-79 = Good", "Moderate confidence"),
        ("40-59 = Fair", "Low confidence - verify independently"),
        ("<40 = Poor/Very Poor", "Insufficient data - high risk"),
        ("", ""),
        ("", ""),
        ("DATA QUALITY INDICATORS", ""),
        ("", ""),
        ("'verified'", "Actual property data found on Zillow - most reliable"),
        ("'estimated'", "Calculated from comparable properties - reasonable guess"),
        ("'unavailable'", "No data available - requires manual research"),
        ("", ""),
        ("", ""),
        ("RISK FACTORS TO CONSIDER", ""),
        ("", ""),
        ("Low Comp Count (<3)", "Insufficient data - ARV unreliable"),
        ("High Price Variance (>30%)", "Inconsistent market - use lower ARV estimate"),
        ("Old Comps (>12 months)", "Market may have shifted - verify current values"),
        ("'estimated' Data Quality", "Property details are guesses - verify before bidding"),
        ("Vacant Lots", "Different investment model - development expertise required"),
        ("ROI Too High (>200%)", "Likely data error or missing information - double check"),
        ("", ""),
        ("", ""),
        ("RECOMMENDED DUE DILIGENCE STEPS", ""),
        ("", ""),
        ("Before Bidding", ""),
        ("1. Drive by property", "Confirm it exists, check condition, assess neighborhood"),
        ("2. Verify property details", "DeKalb Tax Assessor website - confirm beds/baths/sqft"),
        ("3. Check recent sales", "Any sales in last 30 days? Market shifting?"),
        ("4. Review comp locations", "Are comps from same quality neighborhood?"),
        ("5. Conservative ARV estimate", "Use lower end of comp range, not average"),
        ("", ""),
        ("After Winning Auction", ""),
        ("1. Professional inspection", "Verify condition and rehab scope"),
        ("2. Contractor bids", "Get 3 bids for accurate rehab costs"),
        ("3. Update ARV with realtor", "Market may have changed since analysis"),
        ("4. Re-calculate numbers", "Ensure deal still works with actual costs"),
        ("", ""),
        ("", ""),
        ("EXAMPLE FILTERING SCENARIOS", ""),
        ("", ""),
        ("Conservative Investor", ""),
        ("ROI > 30%", ""),
        ("Data Quality = 'verified'", ""),
        ("Comp Quality Score > 70", ""),
        ("Property Type = 'Residential'", ""),
        ("Max Rehab < $75,000", ""),
        ("", ""),
        ("Aggressive Wholesaler", ""),
        ("ROI > 20%", ""),
        ("Property Type = Any residential", ""),
        ("Data Quality = Any", "(will verify manually)"),
        ("Focus on As-Is Price", "(not ARV)"),
        ("Max All-In Cost < $200,000", ""),
        ("", ""),
        ("Land Developer", ""),
        ("Property Type = 'Vacant Lot'", ""),
        ("Tax Due < $10,000", ""),
        ("Location = Specific high-growth cities", ""),
        ("", ""),
        ("", ""),
        ("IMPORTANT DISCLAIMERS", ""),
        ("", ""),
        ("1. Estimates are not guarantees", "ARV based on comps, actual value may differ"),
        ("2. Rehab costs are estimates", "Get contractor bids for accuracy"),
        ("3. Tax deed properties are AS-IS", "No inspection, unknown condition"),
        ("4. Right of redemption may apply", "Former owner may reclaim property"),
        ("5. Title issues possible", "May need quiet title action (legal fees)"),
        ("6. Hidden costs exist", "Liens, violations, demolition orders, environmental"),
        ("7. Market can shift", "ARV based on past sales, future unclear"),
        ("8. Professional advice recommended", "Consult real estate attorney and CPA"),
    ]

    row = 1
    for item, description in methodology:
        cell_a = ws.cell(row=row, column=1)
        cell_b = ws.cell(row=row, column=2)

        cell_a.value = item
        cell_b.value = description

        # Style headers
        if item and not description:
            cell_a.font = Font(bold=True, size=14, color="FFFFFF")
            cell_a.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
            cell_a.alignment = Alignment(horizontal='left', vertical='center')
        # Style sub-headers
        elif item and item[0].isupper() and len(item.split()) <= 4 and "(" not in item:
            cell_a.font = Font(bold=True, size=11)
            cell_a.fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")

        row += 1

    # Set column widths
    ws.column_dimensions['A'].width = 35
    ws.column_dimensions['B'].width = 80


def create_calculation_reference_sheet(wb):
    """Quick reference sheet for calculations"""
    ws = wb.create_sheet("Calculation Reference")

    formulas = [
        ("QUICK CALCULATION REFERENCE", ""),
        ("", ""),
        ("ARV (After Repair Value)", "Average of comparable sold properties in same city"),
        ("", "= Sum of comp sale prices / Number of comps"),
        ("", ""),
        ("Rehab Cost (Method 1)", "Square footage based"),
        ("", "= (Sqft × $35/sqft) × 1.10"),
        ("", "Includes 10% contingency"),
        ("", ""),
        ("Rehab Cost (Method 2)", "ARV percentage (if sqft unknown)"),
        ("", "= ARV × 20%"),
        ("", ""),
        ("As-Is Price", "Immediate cash sale value (wholesale)"),
        ("", "= ARV × 65%"),
        ("", "Industry standard for tax deeds"),
        ("", ""),
        ("All-In Cost", "Total investment required"),
        ("", "= Tax Due + Rehab Cost"),
        ("", ""),
        ("Potential Profit", "Expected profit at ARV"),
        ("", "= ARV - All-In Cost"),
        ("", ""),
        ("ROI (Return on Investment)", "Percentage return"),
        ("", "= (Potential Profit / All-In Cost) × 100%"),
        ("", "= ((ARV - All-In Cost) / All-In Cost) × 100%"),
        ("", ""),
        ("Comp Quality Score", "0-100 score for data confidence"),
        ("", "= Recency Score (30pts) + Variance Score (30pts) + Count Score (40pts)"),
        ("", ""),
        ("Recency Score", "= (Recent comps / Total comps) × 30"),
        ("", "Recent = sold within last 6 months"),
        ("", ""),
        ("Variance Score", "= max(0, 30 - (Price Variance % / 10))"),
        ("", "Price Variance % = ((Max - Min) / Avg) × 100"),
        ("", ""),
        ("Count Score", "= min(40, Comp Count × 4)"),
        ("", "Each comp = 4 points, max 10 comps"),
        ("", ""),
        ("", ""),
        ("INDUSTRY STANDARDS", ""),
        ("", ""),
        ("70% Rule (Standard)", "Max Purchase = (ARV × 70%) - Repairs"),
        ("", "Used for retail flips with financing"),
        ("", ""),
        ("65% Rule (Tax Deeds)", "As-Is Price = ARV × 65%"),
        ("", "More conservative for unknown condition"),
        ("", ""),
        ("Rehab Cost per Sqft", ""),
        ("Cosmetic: $15-25/sqft", "Paint, flooring, appliances"),
        ("Standard: $25-40/sqft", "Kitchen/bath updates, HVAC service"),
        ("Heavy: $40-60/sqft", "Structural repairs, major systems"),
        ("Gut: $60-100+/sqft", "Complete rebuild interior"),
        ("", ""),
        ("Holding Costs", "~1% of ARV per month"),
        ("", "Insurance, utilities, taxes, interest"),
        ("", ""),
        ("Selling Costs", "6-8% of sale price"),
        ("", "Realtor commission, closing costs"),
        ("", ""),
        ("Min ROI Targets (Industry)", ""),
        ("Experienced investors", "20-30% minimum"),
        ("Beginner investors", "30-40% minimum (more cushion)"),
        ("Wholesale deals", "10-15% (quick flip to investor)"),
    ]

    row = 1
    for item, description in formulas:
        cell_a = ws.cell(row=row, column=1)
        cell_b = ws.cell(row=row, column=2)

        cell_a.value = item
        cell_b.value = description

        # Style headers
        if item and not description and item.isupper():
            cell_a.font = Font(bold=True, size=14, color="FFFFFF")
            cell_a.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        # Style formulas (lines starting with =)
        elif description and description.startswith('='):
            cell_b.font = Font(name='Courier New', size=10)
            cell_b.fill = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid")
        # Style sub-headers
        elif item and not description and not item.startswith('='):
            cell_a.font = Font(bold=True, size=11)
            cell_a.fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")

        row += 1

    ws.column_dimensions['A'].width = 30
    ws.column_dimensions['B'].width = 70


if __name__ == '__main__':
    # Parse arguments
    import argparse
    parser = argparse.ArgumentParser(description='Unfiltered DeKalb County Property Analysis')
    parser.add_argument('--input', default='.tmp/dekalb_sample_25.json',
                       help='Input JSON file with parsed properties')
    parser.add_argument('--limit', type=int, default=25,
                       help='Number of properties to analyze (0 = all)')

    args = parser.parse_args()

    # Run analysis
    results, comps = run_analysis(args.input, args.limit)

    logger.info("\n✓ Complete! Review the Excel file to filter by your own criteria.")
