"""
Enhanced DeKalb County Analysis - World-Class Real Estate Investment Analysis

Features:
- Property classification (residential/commercial/vacant lot)
- Detailed calculation transparency
- Visual Excel formatting
- Comparable properties analysis
- Market research backed decisions
- Professional presentation
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
logger = logging.getLogger("EnhancedDeKalb")

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
            'investment_viability': 'Low - Land deals require development expertise'
        }

    # Very low tax usually means vacant or minimal structure
    if tax_due < 500:
        return {
            'property_type': 'Likely Vacant Lot',
            'classification_reason': f'Very low tax due (${tax_due:.2f}) suggests minimal/no structure',
            'investment_viability': 'Low - Verify structure exists before bidding'
        }

    # Residential indicators (most tax deed properties)
    residential_indicators = ['DR', 'DRIVE', 'ST', 'STREET', 'AVE', 'AVENUE', 'CT', 'COURT',
                             'LN', 'LANE', 'WAY', 'CIR', 'CIRCLE', 'PL', 'PLACE', 'RD', 'ROAD']
    if any(ind in address for ind in residential_indicators):
        return {
            'property_type': 'Residential',
            'classification_reason': 'Standard street address format',
            'investment_viability': 'High - Standard residential flip opportunity'
        }

    # Commercial indicators
    commercial_keywords = ['PLAZA', 'CENTER', 'BUILDING', 'OFFICE', 'SUITE', 'INDUSTRIAL']
    if any(kw in address or kw in raw_text for kw in commercial_keywords):
        return {
            'property_type': 'Commercial',
            'classification_reason': 'Commercial property keywords in address',
            'investment_viability': 'Medium - Requires commercial real estate expertise'
        }

    # Default to residential for standard addresses
    return {
        'property_type': 'Residential (Assumed)',
        'classification_reason': 'Standard property with moderate tax amount',
        'investment_viability': 'Medium - Verify property type before bidding'
    }

def extract_city_from_address(full_address: str, raw_text: str) -> str:
    """Extract city name from address or raw text"""
    common_cities = [
        'ATLANTA', 'DECATUR', 'DORAVILLE', 'DUNWOODY',
        'CHAMBLEE', 'STONE MOUNTAIN', 'LITHONIA', 'CLARKSTON',
        'AVONDALE ESTATES', 'PINE LAKE', 'TUCKER'
    ]

    search_text = (full_address + ' ' + raw_text).upper()
    for city in common_cities:
        if city in search_text:
            return city.title()

    return 'Decatur'  # Default to county seat

def analyze_comp_quality(comps: List[Dict], property: Dict) -> Dict:
    """
    Analyze the quality of comparable properties.

    Good comps must:
    1. Be within 12 months (24 months max for small markets)
    2. Similar size (within 30% if sqft known)
    3. Same general area (within 5 miles ideally)
    4. Similar bed/bath count (within 1)
    5. Similar property type
    6. Recent sales (newer = better)
    """
    if not comps:
        return {
            'comp_quality_score': 0,
            'comp_quality_rating': 'No Comps',
            'comp_quality_notes': 'No comparable sales found - cannot estimate ARV'
        }

    # Calculate quality metrics
    comp_count = len(comps)

    # Check date recency (prefer last 6 months)
    from datetime import datetime, timedelta
    recent_count = 0
    for comp in comps:
        if comp.get('sale_date'):
            try:
                if isinstance(comp['sale_date'], (int, float)):
                    sale_date = datetime.fromtimestamp(comp['sale_date'] / 1000)
                else:
                    sale_date = comp['sale_date']

                if sale_date > datetime.now() - timedelta(days=180):
                    recent_count += 1
            except:
                pass

    recency_score = (recent_count / comp_count) * 30 if comp_count > 0 else 0

    # Check price variance (lower = better)
    prices = [c.get('sale_price', 0) for c in comps if c.get('sale_price')]
    if prices:
        avg_price = sum(prices) / len(prices)
        variance = max(prices) - min(prices)
        variance_pct = (variance / avg_price) * 100 if avg_price > 0 else 100
        variance_score = max(0, 30 - (variance_pct / 10))  # Lower variance = higher score
    else:
        variance_score = 0
        variance_pct = 0

    # Comp count score
    count_score = min(40, comp_count * 4)  # Max 40 points for 10+ comps

    # Total quality score (0-100)
    quality_score = recency_score + variance_score + count_score

    # Rating
    if quality_score >= 80:
        rating = 'Excellent'
        notes = f'{comp_count} recent comps with low variance ({variance_pct:.0f}%) - High confidence in ARV'
    elif quality_score >= 60:
        rating = 'Good'
        notes = f'{comp_count} comps with moderate variance ({variance_pct:.0f}%) - Good confidence in ARV'
    elif quality_score >= 40:
        rating = 'Fair'
        notes = f'{comp_count} comps but higher variance ({variance_pct:.0f}%) or older data - Medium confidence'
    elif quality_score >= 20:
        rating = 'Poor'
        notes = f'Limited comps ({comp_count}) with high variance - Low confidence in ARV estimate'
    else:
        rating = 'Very Poor'
        notes = f'Insufficient comp data - ARV estimate unreliable'

    return {
        'comp_quality_score': round(quality_score, 1),
        'comp_quality_rating': rating,
        'comp_quality_notes': notes,
        'comp_count': comp_count,
        'recent_comps_6mo': recent_count,
        'price_variance_pct': round(variance_pct, 1)
    }

def calculate_detailed_arv(comps: List[Dict], property: Dict) -> Dict:
    """
    Calculate ARV with full transparency on methodology.

    Method:
    1. Filter comps by quality criteria
    2. Calculate average sale price
    3. Calculate price per sqft (if available)
    4. Apply conservative adjustments
    5. Document calculation steps
    """
    if not comps:
        return {
            'arv': None,
            'arv_calculation': 'No comps available',
            'arv_confidence': 'None',
            'arv_method': 'N/A',
            'avg_comp_price': None,
            'avg_price_sqft': None
        }

    # Step 1: Get all comp prices
    prices = [c.get('sale_price', 0) for c in comps if c.get('sale_price') and c.get('sale_price') > 0]

    if not prices:
        return {
            'arv': None,
            'arv_calculation': 'Comps found but no valid sale prices',
            'arv_confidence': 'None',
            'arv_method': 'N/A',
            'avg_comp_price': None,
            'avg_price_sqft': None
        }

    # Step 2: Calculate average
    avg_price = sum(prices) / len(prices)

    # Step 3: Calculate price per sqft if available
    price_sqft_values = []
    for c in comps:
        if c.get('sale_price') and c.get('sqft') and c['sale_price'] > 0 and c['sqft'] > 0:
            price_sqft_values.append(c['sale_price'] / c['sqft'])

    avg_price_sqft = sum(price_sqft_values) / len(price_sqft_values) if price_sqft_values else None

    # Step 4: Use average price as ARV (conservative approach)
    arv = avg_price

    # Step 5: Determine confidence based on comp quality
    comp_count = len(comps)
    if comp_count >= 5:
        confidence = 'High'
    elif comp_count >= 3:
        confidence = 'Medium'
    else:
        confidence = 'Low'

    # Step 6: Document calculation
    calculation_steps = f"Average of {len(prices)} comp sales: ${avg_price:,.0f}"
    if avg_price_sqft:
        calculation_steps += f" | Avg $/sqft: ${avg_price_sqft:.0f}"

    method = f"Simple average of {len(prices)} comparable sales"

    return {
        'arv': arv,
        'arv_calculation': calculation_steps,
        'arv_confidence': confidence,
        'arv_method': method,
        'avg_comp_price': avg_price,
        'avg_price_sqft': avg_price_sqft
    }

def calculate_investment_metrics(property: Dict, arv: float) -> Dict:
    """
    Calculate all investment metrics with full transparency.

    Includes:
    - Minimum bid (tax_due)
    - Rehab costs (20% of ARV - industry standard for unknowns)
    - Closing costs (5% of purchase or $5k minimum)
    - All-in cost
    - Net profit (ARV - All-in)
    - ROI percentage
    - Deal score (0-100)
    """
    tax_due = property.get('tax_due', 0)

    # Minimum bid = tax due (auction starting price)
    min_bid = tax_due
    min_bid_calc = f"Tax owed to county: ${tax_due:,.2f}"

    # Rehab costs (conservative 20% of ARV)
    if arv:
        rehab_cost = arv * 0.20
        rehab_calc = f"20% of ARV (${arv:,.0f} × 0.20) = ${rehab_cost:,.2f}"
        rehab_notes = "Conservative estimate: 20% of ARV for cosmetic rehab + unknowns"
    else:
        rehab_cost = 0
        rehab_calc = "ARV unknown - cannot estimate"
        rehab_notes = "Requires property inspection"

    # Closing costs (5% or $5k min)
    closing_cost_pct = min_bid * 0.05
    closing_costs = max(closing_cost_pct, 5000)
    closing_calc = f"Max of 5% of bid (${closing_cost_pct:,.2f}) or $5,000 minimum = ${closing_costs:,.2f}"
    closing_notes = "Includes: Title insurance, recording fees, transfer taxes, attorney fees"

    # All-in cost
    all_in = min_bid + rehab_cost + closing_costs
    all_in_calc = f"${min_bid:,.2f} (bid) + ${rehab_cost:,.2f} (rehab) + ${closing_costs:,.2f} (closing) = ${all_in:,.2f}"

    # Profit and ROI
    if arv:
        net_profit = arv - all_in
        profit_calc = f"${arv:,.0f} (ARV) - ${all_in:,.2f} (all-in) = ${net_profit:,.2f}"

        if all_in > 0:
            roi = (net_profit / all_in) * 100
            roi_calc = f"(${net_profit:,.2f} / ${all_in:,.2f}) × 100 = {roi:.1f}%"
        else:
            roi = 0
            roi_calc = "Cannot calculate (division by zero)"
    else:
        net_profit = None
        profit_calc = "ARV unknown - cannot calculate"
        roi = None
        roi_calc = "ARV unknown - cannot calculate"

    # Deal score (0-100)
    if roi is not None and roi > 0:
        # Score based on ROI tiers
        if roi >= 50:
            deal_score = 100
            deal_rating = "Excellent Deal"
        elif roi >= 30:
            deal_score = 80
            deal_rating = "Great Deal"
        elif roi >= 20:
            deal_score = 60
            deal_rating = "Good Deal"
        elif roi >= 10:
            deal_score = 40
            deal_rating = "Fair Deal"
        else:
            deal_score = 20
            deal_rating = "Marginal Deal"
    else:
        deal_score = 0
        deal_rating = "Cannot Evaluate"

    return {
        'min_bid': min_bid,
        'min_bid_calculation': min_bid_calc,
        'estimated_rehab': rehab_cost,
        'rehab_calculation': rehab_calc,
        'rehab_notes': rehab_notes,
        'closing_costs': closing_costs,
        'closing_calculation': closing_calc,
        'closing_notes': closing_notes,
        'all_in_cost': all_in,
        'all_in_calculation': all_in_calc,
        'net_profit': net_profit,
        'profit_calculation': profit_calc,
        'roi_percent': roi,
        'roi_calculation': roi_calc,
        'deal_score': deal_score,
        'deal_rating': deal_rating
    }

def analyze_properties_enhanced(properties: List[Dict], apify_client) -> tuple[List[Dict], List[Dict]]:
    """
    Enhanced analysis with full property classification and market research.

    Returns:
        (analyzed_properties, all_comps)
    """
    results = []
    all_comps = []
    city_cache = {}

    for i, prop in enumerate(properties):
        logger.info(f"Analyzing {i+1}/{len(properties)}: {prop['tax_id']}")

        # Step 1: Classify property type
        classification = classify_property_type(prop)
        logger.info(f"  Classification: {classification['property_type']}")

        # Step 2: Extract city
        city = extract_city_from_address(
            prop.get('full_address', ''),
            prop.get('raw_text', '')
        )

        # Step 3: Fetch comps (skip for vacant lots)
        if 'vacant' in classification['property_type'].lower():
            logger.info(f"  Skipping comps for vacant lot")
            comps = []
        else:
            # Use cache if available
            if city not in city_cache:
                try:
                    logger.info(f"  Fetching comps for {city}, GA...")
                    comps = apify_client.get_sold_properties(
                        city=city,
                        state_code='GA',
                        limit=10
                    )
                    city_cache[city] = comps
                    logger.info(f"  Found {len(comps)} comps in {city}")
                except Exception as e:
                    logger.error(f"  Apify error: {e}")
                    city_cache[city] = []
                    comps = []
            else:
                comps = city_cache[city]
                logger.info(f"  Using cached comps for {city} ({len(comps)} comps)")

        # Step 4: Analyze comp quality
        comp_analysis = analyze_comp_quality(comps, prop)

        # Step 5: Calculate ARV
        arv_data = calculate_detailed_arv(comps, prop)

        # Step 6: Calculate investment metrics
        metrics = calculate_investment_metrics(prop, arv_data['arv'])

        # Step 7: Add comps to master list with reference
        for comp in comps:
            comp_with_ref = comp.copy()
            comp_with_ref['used_for_property'] = prop['tax_id']
            comp_with_ref['used_for_address'] = prop.get('full_address', '')
            all_comps.append(comp_with_ref)

        # Step 8: Compile result
        result = {
            **prop,
            'city': city,
            **classification,
            **comp_analysis,
            **arv_data,
            **metrics,
            'analysis_timestamp': datetime.now().isoformat()
        }

        results.append(result)

    return results, all_comps

def create_professional_workbook(
    properties: List[Dict],
    comps: List[Dict],
    output_file: str
):
    """
    Create a professionally formatted multi-sheet Excel workbook.

    Sheets:
    1. Property Analysis - Main results
    2. Comparable Sales - All comps used
    3. Methodology - How analysis works
    4. Deal Evaluation Guide - How to read the data
    """
    logger.info(f"Creating professional workbook: {output_file}")

    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # Remove default sheet

    # Define styles
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=11)
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    good_fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
    fair_fill = PatternFill(start_color="FFEB9C", end_color="FFEB9C", fill_type="solid")
    poor_fill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")

    # Sheet 1: Property Analysis
    ws1 = wb.create_sheet("Property Analysis")

    # Column definitions with explanations
    columns = [
        ('tax_id', 'Tax Parcel ID'),
        ('full_address', 'Property Address'),
        ('city', 'City'),
        ('zip_code', 'Zip Code'),
        ('property_type', 'Property Type'),
        ('classification_reason', 'Classification Reason'),
        ('tax_due', 'Tax Due'),
        ('min_bid', 'Minimum Bid'),
        ('min_bid_calculation', 'Min Bid Calculation'),
        ('arv', 'ARV (After Repair Value)'),
        ('arv_calculation', 'ARV Calculation'),
        ('arv_confidence', 'ARV Confidence'),
        ('comp_count', '# of Comps'),
        ('comp_quality_rating', 'Comp Quality'),
        ('comp_quality_notes', 'Comp Quality Notes'),
        ('estimated_rehab', 'Est. Rehab Cost'),
        ('rehab_calculation', 'Rehab Calculation'),
        ('closing_costs', 'Closing Costs'),
        ('closing_calculation', 'Closing Calculation'),
        ('all_in_cost', 'All-In Cost'),
        ('all_in_calculation', 'All-In Calculation'),
        ('net_profit', 'Net Profit'),
        ('profit_calculation', 'Profit Calculation'),
        ('roi_percent', 'ROI %'),
        ('roi_calculation', 'ROI Calculation'),
        ('deal_score', 'Deal Score (0-100)'),
        ('deal_rating', 'Deal Rating'),
        ('investment_viability', 'Investment Viability')
    ]

    # Write headers
    for col_idx, (field, header) in enumerate(columns, 1):
        cell = ws1.cell(row=1, column=col_idx, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment

    # Write data
    for row_idx, prop in enumerate(properties, 2):
        for col_idx, (field, _) in enumerate(columns, 1):
            value = prop.get(field, '')
            cell = ws1.cell(row=row_idx, column=col_idx, value=value)

            # Apply conditional formatting
            if field == 'deal_score':
                if isinstance(value, (int, float)):
                    if value >= 80:
                        cell.fill = good_fill
                    elif value >= 60:
                        cell.fill = fair_fill
                    elif value > 0:
                        cell.fill = poor_fill

            # Format numbers
            if field in ['tax_due', 'min_bid', 'arv', 'estimated_rehab', 'closing_costs',
                        'all_in_cost', 'net_profit']:
                if isinstance(value, (int, float)):
                    cell.number_format = '$#,##0.00'
            elif field in ['roi_percent']:
                if isinstance(value, (int, float)):
                    cell.number_format = '0.00"%"'

    # Auto-size columns
    for column_cells in ws1.columns:
        length = max(len(str(cell.value or '')) for cell in column_cells)
        ws1.column_dimensions[column_cells[0].column_letter].width = min(length + 2, 50)

    # Sheet 2: Comparable Sales
    if comps:
        ws2 = wb.create_sheet("Comparable Sales")

        comp_columns = [
            ('used_for_property', 'Used For Property'),
            ('used_for_address', 'Used For Address'),
            ('address', 'Comp Address'),
            ('sale_price', 'Sale Price'),
            ('sale_date', 'Sale Date'),
            ('bedrooms', 'Beds'),
            ('bathrooms', 'Baths'),
            ('sqft', 'Square Feet'),
            ('year_built', 'Year Built'),
            ('source', 'Data Source')
        ]

        # Write headers
        for col_idx, (field, header) in enumerate(comp_columns, 1):
            cell = ws2.cell(row=1, column=col_idx, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = header_alignment

        # Write comp data
        for row_idx, comp in enumerate(comps, 2):
            for col_idx, (field, _) in enumerate(comp_columns, 1):
                value = comp.get(field, '')

                # Format sale date
                if field == 'sale_date' and isinstance(value, (int, float)):
                    try:
                        value = datetime.fromtimestamp(value / 1000).strftime('%Y-%m-%d')
                    except:
                        pass

                cell = ws2.cell(row=row_idx, column=col_idx, value=value)

                # Format currency
                if field == 'sale_price' and isinstance(value, (int, float)):
                    cell.number_format = '$#,##0'

        # Auto-size columns
        for column_cells in ws2.columns:
            length = max(len(str(cell.value or '')) for cell in column_cells)
            ws2.column_dimensions[column_cells[0].column_letter].width = min(length + 2, 40)

    # Sheet 3: Methodology
    create_methodology_sheet(wb)

    # Sheet 4: Deal Evaluation Guide
    create_evaluation_guide(wb)

    # Save workbook
    wb.save(output_file)
    logger.info(f"Professional workbook created: {output_file}")

def create_methodology_sheet(wb):
    """Create methodology documentation sheet"""
    ws = wb.create_sheet("Methodology")

    methodology = [
        ("COMPARABLE SALES METHODOLOGY", ""),
        ("", ""),
        ("What Makes a Good Comparable Property?", ""),
        ("1. Location", "Within same city/neighborhood (ideally within 5 miles)"),
        ("2. Sold Date", "Sold within last 12 months (24 months for small markets)"),
        ("3. Property Size", "Within 30% of subject property square footage"),
        ("4. Bed/Bath Count", "Within 1 bedroom/bathroom of subject property"),
        ("5. Property Type", "Same property type (SFR, condo, townhouse, etc.)"),
        ("6. Sale Type", "Arms-length transaction (not foreclosure, short sale, etc.)"),
        ("7. Condition", "Similar condition when sold"),
        ("", ""),
        ("ARV CALCULATION METHOD", ""),
        ("Method Used", "Simple average of comparable sales"),
        ("Why This Method?", "Conservative approach - doesn't overestimate value"),
        ("Formula", "ARV = Sum of comp sale prices / Number of comps"),
        ("Alternative Methods", "Price per sqft, adjusted sales comparison, hedonic pricing"),
        ("Our Choice Rationale", "Simple average is conservative and doesn't require property inspection"),
        ("", ""),
        ("REHAB COST ESTIMATION", ""),
        ("Standard Estimate", "20% of ARV"),
        ("Why 20%?", "Industry standard for cosmetic rehab + contingency for unknowns"),
        ("Includes", "Paint, flooring, kitchen/bath updates, minor repairs"),
        ("Excludes", "Structural repairs, additions, luxury upgrades"),
        ("Recommendation", "Always get professional inspection before bidding"),
        ("", ""),
        ("CLOSING COSTS BREAKDOWN", ""),
        ("Percentage", "5% of purchase price or $5,000 minimum"),
        ("Includes", "Title insurance, recording fees, transfer taxes, attorney fees"),
        ("Note", "Actual costs vary by county and transaction"),
        ("", ""),
        ("DEAL SCORE CRITERIA (0-100)", ""),
        ("100 points", "ROI >= 50% - Excellent Deal"),
        ("80 points", "ROI >= 30% - Great Deal"),
        ("60 points", "ROI >= 20% - Good Deal"),
        ("40 points", "ROI >= 10% - Fair Deal"),
        ("20 points", "ROI < 10% - Marginal Deal"),
        ("0 points", "Insufficient data or negative ROI"),
        ("", ""),
        ("RISK FACTORS TO CONSIDER", ""),
        ("1. Title Issues", "Tax deeds may have liens, easements, or ownership disputes"),
        ("2. Property Condition", "No inspection - could have hidden damage"),
        ("3. Market Changes", "Comps are historical - market may have shifted"),
        ("4. Rehab Overruns", "20% estimate may not cover all needed repairs"),
        ("5. Holding Costs", "Property taxes, insurance, utilities during rehab"),
        ("6. Selling Costs", "Realtor commission (6%), closing costs"),
        ("", ""),
        ("RECOMMENDED DUE DILIGENCE", ""),
        ("Before Bidding", "1. Drive by property, 2. Check county records, 3. Title search"),
        ("After Winning", "1. Professional inspection, 2. Contractor estimates, 3. Title insurance"),
        ("During Rehab", "1. Permits as needed, 2. Quality inspections, 3. Budget tracking"),
    ]

    # Write methodology
    for row_idx, (item, description) in enumerate(methodology, 1):
        ws.cell(row=row_idx, column=1, value=item)
        ws.cell(row=row_idx, column=2, value=description)

        # Make section headers bold
        if item.isupper() and len(item) > 5:
            ws.cell(row=row_idx, column=1).font = Font(bold=True, size=12)

    # Format columns
    ws.column_dimensions['A'].width = 35
    ws.column_dimensions['B'].width = 80

def create_evaluation_guide(wb):
    """Create deal evaluation guide"""
    ws = wb.create_sheet("Deal Evaluation Guide")

    guide = [
        ("HOW TO READ THIS ANALYSIS", ""),
        ("", ""),
        ("Step 1: Check Property Type", ""),
        ("Residential", "Best for flipping - standard market, easy to sell"),
        ("Commercial", "Requires expertise - different financing, longer hold times"),
        ("Vacant Lot", "Avoid unless you're a developer - no immediate flip potential"),
        ("", ""),
        ("Step 2: Review Comp Quality", ""),
        ("Excellent (80-100)", "High confidence - ARV is reliable"),
        ("Good (60-79)", "Moderate confidence - ARV is reasonable"),
        ("Fair (40-59)", "Low confidence - verify ARV with agent"),
        ("Poor (20-39)", "Very low confidence - do your own research"),
        ("Very Poor (0-19)", "No confidence - ignore ARV estimate"),
        ("", ""),
        ("Step 3: Evaluate ROI", ""),
        (">50% ROI", "Excellent deal - strong bid potential"),
        ("30-50% ROI", "Great deal - competitive bidding expected"),
        ("20-30% ROI", "Good deal - acceptable profit margin"),
        ("10-20% ROI", "Fair deal - tight margins, higher risk"),
        ("<10% ROI", "Marginal - likely not worth the risk"),
        ("", ""),
        ("Step 4: Understand The Calculations", ""),
        ("Min Bid Calculation", "Shows the starting auction price (tax owed)"),
        ("ARV Calculation", "Shows how property value was estimated"),
        ("Rehab Calculation", "Shows repair cost estimate (20% of ARV)"),
        ("All-In Calculation", "Shows total investment (bid + rehab + closing)"),
        ("Profit Calculation", "Shows expected profit (ARV - All-In)"),
        ("ROI Calculation", "Shows return on investment percentage"),
        ("", ""),
        ("Step 5: Red Flags to Watch For", ""),
        ("Very Low Tax Due (<$500)", "Likely vacant lot or tear-down"),
        ("No Comps Found", "Cannot estimate value - very risky"),
        ("High Price Variance in Comps", "Unstable market - ARV unreliable"),
        ("Low Comp Quality Score", "Data is weak - do independent research"),
        ("ROI Too Good to Be True (>200%)", "Double-check everything - likely data error"),
        ("", ""),
        ("Step 6: Next Steps for Good Deals", ""),
        ("1. Drive By", "View property exterior, check neighborhood"),
        ("2. County Records", "Verify ownership, check for liens"),
        ("3. Agent Opinion", "Get local realtor's ARV estimate"),
        ("4. Auction Rules", "Understand deposit, closing timeline, terms"),
        ("5. Set Max Bid", "Never exceed your calculated profit margin"),
        ("6. Attend Auction", "Bid strategically, don't get emotional"),
        ("", ""),
        ("DISCLAIMER", ""),
        ("", "This analysis is for informational purposes only. Not financial advice."),
        ("", "Always conduct your own due diligence before investing."),
        ("", "Tax deed investing carries significant risks including title issues,"),
        ("", "property condition unknowns, and market volatility."),
        ("", "Consult with real estate professionals and attorneys."),
    ]

    # Write guide
    for row_idx, (item, description) in enumerate(guide, 1):
        ws.cell(row=row_idx, column=1, value=item)
        ws.cell(row=row_idx, column=2, value=description)

        # Make section headers bold
        if item.isupper() and len(item) > 5:
            ws.cell(row=row_idx, column=1).font = Font(bold=True, size=12, color="1F4E78")

    # Format columns
    ws.column_dimensions['A'].width = 35
    ws.column_dimensions['B'].width = 80

def main(input_file: str):
    """Main execution"""
    logger.info(f"Loading properties from {input_file}")
    with open(input_file, 'r') as f:
        properties = json.load(f)

    logger.info(f"Loaded {len(properties)} properties")

    # Check for Apify key
    apify_key = os.getenv('APIFY_API_KEY') or os.getenv('APIFY_API_TOKEN')
    if not apify_key:
        logger.error("APIFY_API_KEY not found in environment")
        return

    # Initialize Apify client
    logger.info("Initializing Apify client...")
    apify = ApifyZillowComps()

    # Enhanced analysis
    logger.info("Starting enhanced analysis...")
    analyzed_properties, all_comps = analyze_properties_enhanced(properties, apify)

    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # JSON output
    json_output = f".tmp/dekalb_results/dekalb_enhanced_{timestamp}.json"
    with open(json_output, 'w') as f:
        json.dump({
            'properties': analyzed_properties,
            'comparables': all_comps,
            'analysis_date': datetime.now().isoformat(),
            'total_properties': len(analyzed_properties),
            'total_comps': len(all_comps)
        }, f, indent=2)
    logger.info(f"Saved JSON: {json_output}")

    # Professional Excel output
    excel_output = f".tmp/dekalb_results/dekalb_enhanced_{timestamp}.xlsx"
    create_professional_workbook(analyzed_properties, all_comps, excel_output)

    # Summary
    print("\n" + "="*80)
    print("ENHANCED ANALYSIS COMPLETE")
    print("="*80)
    print(f"Properties Analyzed: {len(analyzed_properties)}")
    print(f"Comparable Sales: {len(all_comps)}")

    residential = [p for p in analyzed_properties if 'residential' in p.get('property_type', '').lower()]
    vacant = [p for p in analyzed_properties if 'vacant' in p.get('property_type', '').lower()]
    commercial = [p for p in analyzed_properties if 'commercial' in p.get('property_type', '').lower()]

    print(f"\nProperty Types:")
    print(f"  Residential: {len(residential)}")
    print(f"  Vacant Lots: {len(vacant)}")
    print(f"  Commercial: {len(commercial)}")

    excellent_deals = [p for p in analyzed_properties if p.get('deal_score', 0) >= 80]
    good_deals = [p for p in analyzed_properties if 60 <= p.get('deal_score', 0) < 80]

    print(f"\nDeal Quality:")
    print(f"  Excellent Deals (Score 80+): {len(excellent_deals)}")
    print(f"  Good Deals (Score 60-79): {len(good_deals)}")

    print(f"\nOutput Files:")
    print(f"  Excel: {excel_output}")
    print(f"  JSON: {json_output}")
    print("="*80)

if __name__ == "__main__":
    input_file = ".tmp/dekalb_sample_25_with_amounts.json"
    main(input_file)
