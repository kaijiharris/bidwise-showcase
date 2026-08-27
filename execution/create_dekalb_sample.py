"""
DeKalb Sample Analysis with Apify Comps - First 25 Properties

Creates a comprehensive Excel workbook with:
1. Sheet: Analyzed Properties (first 25 residential/commercial)
2. Sheet: Comparable Properties (from Apify Zillow)
3. Sheet: Methodology (how analysis works)
4. Error logging throughout
"""

import os
import sys
import json
import logging
import pandas as pd
import dotenv
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

# Add project root
sys.path.insert(0, str(Path(__file__).parent.parent))

from execution.enrichment.apify_comps import ApifyZillowComps

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("DeKalbSampleAnalysis")

# Error tracking
errors_log = []

def log_error(context: str, error: Exception, details: Dict = None):
    """Log error with context for later review"""
    error_entry = {
        'timestamp': datetime.now().isoformat(),
        'context': context,
        'error_type': type(error).__name__,
        'error_message': str(error),
        'details': details or {}
    }
    errors_log.append(error_entry)
    logger.error(f"[{context}] {type(error).__name__}: {error}")

def create_methodology_sheet() -> pd.DataFrame:
    """Create methodology documentation as a DataFrame"""
    methodology = [
        {
            'Section': 'Overview',
            'Topic': 'Purpose',
            'Description': 'This analysis identifies high-value tax deed opportunities in DeKalb County by combining automated property data extraction with AI-powered deal analysis and comparable sales research.'
        },
        {
            'Section': 'Overview',
            'Topic': 'Data Source',
            'Description': 'Properties extracted from DeKalb County Tax Commissioner delinquent property list PDF (2189 pages, 16,968 properties total). Sample focuses on first 25 residential/commercial properties.'
        },
        {
            'Section': 'Data Collection',
            'Topic': 'PDF Parsing',
            'Description': 'Uses pdfplumber to extract tabular data from official county PDF. Regex patterns identify parcel IDs (format: XX XXX XX XXX) and tax amounts.'
        },
        {
            'Section': 'Data Collection',
            'Topic': 'Property Classification',
            'Description': 'Automated classification into: vacant_lot, residential, commercial, industrial, or unknown based on text analysis of raw data. Vacant lots are excluded from detailed analysis.'
        },
        {
            'Section': 'Data Collection',
            'Topic': 'Tax Amount Extraction',
            'Description': 'Multi-pattern extraction: (1) GRAND TOTAL DUE amounts, (2) Dollar amounts in text, (3) Comma-separated numbers. Takes largest amount found as total due.'
        },
        {
            'Section': 'Deal Analysis',
            'Topic': 'Min Bid Calculation',
            'Description': 'Minimum bid = tax_due (auction starting price). This is the absolute floor for bidding at the tax deed auction.'
        },
        {
            'Section': 'Deal Analysis',
            'Topic': 'Max Bid Calculation',
            'Description': 'Maximum bid calculated by Gemini AI based on: (1) Estimated market value, (2) Condition risks, (3) Title risks, (4) Holding costs, (5) Target profit margin (typically 30-40%).'
        },
        {
            'Section': 'Deal Analysis',
            'Topic': 'Risk Assessment',
            'Description': 'AI flags include: TITLE_RISK (liens, ownership issues), CONDITION_UNKNOWN (no inspection), HIGH_DELINQUENCY (multiple years), LOCATION_CONCERN, MARKET_VOLATILITY, VACANT_LOT (auto-flagged)'
        },
        {
            'Section': 'Deal Analysis',
            'Topic': 'AI Model',
            'Description': 'Uses Gemini 2.0 Flash Exp for analysis. Structured JSON output ensures consistent data format. Temperature=0.2 for conservative, reliable recommendations.'
        },
        {
            'Section': 'Comparable Sales',
            'Topic': 'Data Source',
            'Description': 'Apify Zillow Scraper pulls recently sold properties (last 12 months) in the same city/area with similar characteristics (beds, baths, sqft if available).'
        },
        {
            'Section': 'Comparable Sales',
            'Topic': 'Selection Criteria',
            'Description': 'Filters for: (1) Sold within 12 months, (2) Same city, (3) Similar bedrooms/bathrooms (+/- 1), (4) Price range +/- 30% of estimated value, (5) Up to 10 most recent comps'
        },
        {
            'Section': 'Comparable Sales',
            'Topic': 'Cost',
            'Description': 'Apify costs ~$0.90 per 1000 results. City-level caching means one search covers all properties in that city, reducing duplicate API calls.'
        },
        {
            'Section': 'Low Hanging Fruit',
            'Topic': 'High Equity Opportunities',
            'Description': 'Properties where tax_due is significantly lower than market value (30%+ equity). These offer immediate profit potential with lower risk.'
        },
        {
            'Section': 'Low Hanging Fruit',
            'Topic': 'Short Delinquency',
            'Description': 'Properties with 1-2 years delinquency vs 4-5+ years. Less risk of hidden liens or title issues. Owners may still maintain property.'
        },
        {
            'Section': 'Low Hanging Fruit',
            'Topic': 'Clear Title Indicators',
            'Description': 'Single owner, no complex entity structures, no bankruptcy flags in notes. Easier to complete acquisition.'
        },
        {
            'Section': 'Missed Opportunities',
            'Topic': 'Incomplete Comps',
            'Description': 'Some properties lack good comparable sales data due to: (1) Unclear addresses in PDF, (2) Rural/unique locations, (3) Commercial properties (fewer sales data)'
        },
        {
            'Section': 'Missed Opportunities',
            'Topic': 'Address Parsing',
            'Description': 'PDF format makes full address extraction difficult. Some properties only have partial addresses, limiting comp accuracy. Manual verification recommended.'
        },
        {
            'Section': 'Missed Opportunities',
            'Topic': 'Condition Assessment',
            'Description': 'No physical inspection data available. All values are estimates. Properties may have hidden damage, code violations, or structural issues not reflected in comps.'
        },
        {
            'Section': 'Process Improvements',
            'Topic': 'Better PDF Parsing',
            'Description': 'Current parser extracts data line-by-line. Table-aware extraction could better preserve address/owner/amount relationships from the PDF columns.'
        },
        {
            'Section': 'Process Improvements',
            'Topic': 'County GIS Integration',
            'Description': 'DeKalb County GIS/tax assessor API could provide: full addresses, property details (sqft, beds/baths), assessment values, and ownership history directly.'
        },
        {
            'Section': 'Process Improvements',
            'Topic': 'Batch Processing',
            'Description': 'Current sample is 25 properties. Full county analysis (16,968 properties) would require: API rate limiting, error recovery, progress checkpointing, and ~20-30 hours processing time.'
        }
    ]
    
    return pd.DataFrame(methodology)

def get_sample_properties(input_file: str, limit: int = 25) -> pd.DataFrame:
    """Get first N residential/commercial properties from enhanced analysis"""
    logger.info(f"Loading properties from {input_file}")
    df = pd.read_excel(input_file)
    
    # Filter for residential/commercial properties with tax_due
    analyzable = df[
        (df['property_type'].isin(['residential', 'commercial', 'unknown'])) &
        (df['tax_due'].notna())
    ].head(limit)
    
    logger.info(f"Selected {len(analyzable)} properties for sample analysis")
    return analyzable

def fetch_comps_for_properties(properties_df: pd.DataFrame, apify_client) -> List[Dict]:
    """Fetch comparable sales for each property"""
    all_comps = []
    
    for idx, row in properties_df.iterrows():
        try:
            tax_id = row['tax_id']
            logger.info(f"Fetching comps for {tax_id}")
            
            # Extract city from raw_text or use fallback
            # DeKalb has many cities: Decatur, Atlanta, Doraville, Dunwoody, etc.
            city = extract_city_from_raw_text(row.get('raw_text', ''))
            
            if not city:
                logger.warning(f"No city found for {tax_id}, skipping comps")
                continue
            
            # Fetch comps
            comps = apify_client.get_sold_properties(
                city=city,
                state_code='GA',
                limit=10
            )
            
            # Add reference to source property
            for comp in comps:
                comp['source_tax_id'] = tax_id
                comp['source_city'] = city
                all_comps.append(comp)
            
            logger.info(f"Found {len(comps)} comps for {tax_id} in {city}")
            
        except Exception as e:
            log_error(f"fetch_comps:{tax_id}", e, {'tax_id': tax_id})
            continue
    
    return all_comps

def extract_city_from_raw_text(raw_text: str) -> Optional[str]:
    """Extract city name from raw text"""
    if not raw_text:
        return None
    
    # Common DeKalb cities
    cities = [
        'ATLANTA', 'DECATUR', 'DORAVILLE', 'DUNWOODY',
        'CHAMBLEE', 'STONE MOUNTAIN', 'LITHONIA', 'CLARKSTON',
        'AVONDALE ESTATES', 'PINE LAKE', 'TUCKER'
    ]
    
    text_upper = raw_text.upper()
    for city in cities:
        if city in text_upper:
            return city.title()  # Return proper case
    
    # Default to Decatur (county seat)
    return 'Decatur'

def create_sample_workbook(
    properties_df: pd.DataFrame,
    comps_list: List[Dict],
    methodology_df: pd.DataFrame,
    output_file: str
):
    """Create multi-sheet Excel workbook"""
    logger.info(f"Creating workbook: {output_file}")
    
    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        # Sheet 1: Analyzed Properties
        properties_df.to_excel(writer, sheet_name='Properties', index=False)
        
        # Sheet 2: Comparable Sales
        if comps_list:
            comps_df = pd.DataFrame(comps_list)
            comps_df.to_excel(writer, sheet_name='Comparable Sales', index=False)
        else:
            # Empty sheet with headers
            pd.DataFrame(columns=['source_tax_id', 'address', 'price', 'message']).to_excel(
                writer, sheet_name='Comparable Sales', index=False
            )
        
        # Sheet 3: Methodology
        methodology_df.to_excel(writer, sheet_name='Methodology', index=False)
        
        # Sheet 4: Errors Log (if any)
        if errors_log:
            errors_df = pd.DataFrame(errors_log)
            errors_df.to_excel(writer, sheet_name='Errors', index=False)
    
    logger.info(f"Workbook created successfully")

def main():
    """Main execution"""
    # Load environment
    env_path = Path(__file__).parent.parent / '.env'
    dotenv.load_dotenv(dotenv_path=env_path)
    
    # Check for Apify key
    apify_key = os.getenv('APIFY_API_KEY') or os.getenv('APIFY_API_TOKEN')
    
    # Get sample properties
    input_file = '.tmp/dekalb_results/dekalb_enhanced_analysis.xlsx'
    properties_df = get_sample_properties(input_file, limit=25)
    
    # Fetch comps if Apify available
    comps_list = []
    if apify_key:
        try:
            logger.info("Initializing Apify Zillow client...")
            apify = ApifyZillowComps()
            comps_list = fetch_comps_for_properties(properties_df, apify)
        except Exception as e:
            log_error("apify_initialization", e)
            logger.warning("Continuing without Apify comps")
    else:
        logger.warning("No APIFY_API_KEY found - skipping comps")
        errors_log.append({
            'timestamp': datetime.now().isoformat(),
            'context': 'apify_check',
            'error_type': 'MissingAPIKey',
            'error_message': 'APIFY_API_KEY not found in environment',
            'details': {'solution': 'Add APIFY_API_KEY to .env file'}
        })
    
    # Create methodology
    methodology_df = create_methodology_sheet()
    
    # Create output workbook
    output_file = '.tmp/dekalb_results/dekalb_sample_analysis_with_comps.xlsx'
    create_sample_workbook(properties_df, comps_list, methodology_df, output_file)
    
    # Summary
    print("\n" + "="*80)
    print("SAMPLE ANALYSIS COMPLETE")
    print("="*80)
    print(f"Properties Analyzed: {len(properties_df)}")
    print(f"Comparable Sales Found: {len(comps_list)}")
    print(f"Errors Encountered: {len(errors_log)}")
    print(f"\nOutput: {output_file}")
    print("="*80)
    
    # Save error log separately
    if errors_log:
        error_file = output_file.replace('.xlsx', '_errors.json')
        with open(error_file, 'w') as f:
            json.dump(errors_log, f, indent=2)
        print(f"Errors logged to: {error_file}")

if __name__ == "__main__":
    main()
