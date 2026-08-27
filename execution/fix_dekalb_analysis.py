"""
Enhanced DeKalb Analyzer with Fixes

Improvements:
1. Handle missing tax_due by making it optional in analysis
2. Add property type classification
3. Skip vacant lot analysis
4. Better error logging
"""

import os
import sys
import json
import logging
import pandas as pd
import re
from pathlib import Path
from typing import List, Dict, Optional

# Add project root
sys.path.insert(0, str(Path(__file__).parent.parent))

from execution.analysis.deterministic_analyzer import DeterministicAnalyzer, PropertyInput, AnalysisOutput
from pydantic import ValidationError

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("EnhancedDeKalbAnalyzer")

# Error log for tracking issues
error_log = []

def classify_property_type(raw_text: str) -> str:
    """
    Classify property type based on raw text
    
    Returns: 'vacant_lot', 'residential', 'commercial', 'industrial', 'unknown'
    """
    text_upper = raw_text.upper()
    
    # Vacant lot indicators
    vacant_indicators = [
        'VACANT', 'VAC LAND', 'LOT', 'UNIMPROVED',
        'RAW LAND', 'UNDEVELOPED'
    ]
    if any(ind in text_upper for ind in vacant_indicators):
        return 'vacant_lot'
    
    # Commercial indicators
    commercial_indicators = [
        'COMMERCIAL', 'COMM', 'RETAIL', 'OFFICE',
        'SHOPPING', 'STORE', 'WAREHOUSE'  
    ]
    if any(ind in text_upper for ind in commercial_indicators):
        return 'commercial'
    
    # Industrial indicators
    industrial_indicators = [
        'INDUSTRIAL', 'IND', 'FACTORY', 'MANUFACTURING'
    ]
    if any(ind in text_upper for ind in industrial_indicators):
        return 'industrial'
    
    # Residential indicators (default if address-like)
    residential_indicators = [
        'SINGLE FAMILY', 'SF', 'CONDO', 'TOWNHOUSE',
        'DUPLEX', 'TRIPLEX', 'APARTMENT', 'RES'
    ]
    if any(ind in text_upper for ind in residential_indicators):
        return 'residential'
    
    # Check for address patterns as residential
    if re.search(r'\d+\s+[A-Z]+\s+(ST|AVE|RD|DR|LN|CT|WAY|BLVD|CIR|PL)', text_upper):
        return 'residential'
    
    return 'unknown'

def extract_tax_amount_from_raw(raw_text: str) -> Optional[float]:
    """
    Try to extract tax amount from raw text using multiple patterns
   
    """
    if not raw_text:
        return None
    
    # Pattern 1: GRAND TOTAL DUE followed by amount
    match = re.search(r'GRAND TOTAL DUE\s+\$?([\d,]+\.?\d*)', raw_text, re.IGNORECASE)
    if match:
        return float(match.group(1).replace(',', ''))
    
    # Pattern 2: Just dollar amounts
    matches = re.findall(r'\$(\d{1,3}(?:,\d{3})*\.\d{2})', raw_text)
    if matches:
        # Return the largest amount found (likely the total)
        amounts = [float(m.replace(',', '')) for m in matches]
        return max(amounts)
    
    # Pattern 3: Numbers with commas (no $)
    matches = re.findall(r'\b(\d{1,3}(?:,\d{3})+\.\d{2})\b', raw_text)
    if matches:
        amounts = [float(m.replace(',', '')) for m in matches]
        return max(amounts)
    
    return None

def fix_and_enhance_properties(input_file: str, output_file: str, api_key: Optional[str] = None):
    """
    Load existing DeKalb data, fix issues, classify, and re-analyze
    """
    logger.info(f"Loading existing data from {input_file}")
    df = pd.read_excel(input_file)
    
    logger.info(f"Loaded {len(df)} properties")
    logger.info(f"Columns: {list(df.columns)}")
    
    # Add property_type column
    logger.info("Classifying property types...")
    df['property_type'] = df['raw_text'].apply(classify_property_type)
    
    type_counts = df['property_type'].value_counts()
    logger.info(f"Property type distribution:\n{type_counts}")
    
    # Add tax_due column if missing
    if 'tax_due' not in df.columns:
        logger.info("Extracting tax amounts from raw_text...")
        df['tax_due'] = df['raw_text'].apply(extract_tax_amount_from_raw)
        
        extracted_count = df['tax_due'].notna().sum()
        logger.info(f"Successfully extracted tax_due for {extracted_count}/{len(df)} properties")
    
    # Initialize analyzer (API key optional now, but keeping signature flexible if needed)
    analyzer = DeterministicAnalyzer()
    
    # Re-analyze properties (skip vacant lots)
    results = []
    for idx, row in df.iterrows():
        prop_dict = row.to_dict()
        
        # Skip analysis for vacant lots
        if prop_dict.get('property_type') == 'vacant_lot':
            prop_dict['analysis_notes'] = 'Vacant lot - analysis skipped'
            prop_dict['recommended_max_bid'] = None
            prop_dict['risk_flags'] = ['VACANT_LOT']
            results.append(prop_dict)
            continue
        
        # Try to analyze if analyzer available and has tax_due
        if analyzer and pd.notna(prop_dict.get('tax_due')):
            try:
                # Create PropertyInput
                prop_input = {
                    'county': prop_dict.get('county', 'DeKalb'),
                    'tax_id': prop_dict.get('tax_id'),
                    'tax_due': float(prop_dict['tax_due'])
                }
                
                # Add optional fields if available
                if pd.notna(prop_dict.get('full_address')):
                    prop_input['street_name'] = str(prop_dict['full_address'])
                
                analysis = analyzer.analyze_property(prop_input)
                
                # Merge analysis results
                prop_dict.update(analysis.model_dump())
                
                logger.info(f"[{idx+1}/{len(df)}] Analyzed {prop_dict['tax_id']}")
                
            except ValidationError as e:
                error_msg = f"Validation error: {str(e)}"
                prop_dict['analysis_notes'] = error_msg
                error_log.append({
                    'tax_id': prop_dict.get('tax_id'),
                    'error_type': 'ValidationError',
                    'error': str(e)
                })
                logger.warning(f"Validation error for {prop_dict.get('tax_id')}: {e}")
                
            except Exception as e:
                error_msg = f"Analysis error: {str(e)}"
                prop_dict['analysis_notes'] = error_msg
                error_log.append({
                    'tax_id': prop_dict.get('tax_id'),
                    'error_type': type(e).__name__,
                    'error': str(e)
                })
                logger.error(f"Error analyzing {prop_dict.get('tax_id')}: {e}")
        else:
            if not analyzer:
                prop_dict['analysis_notes'] = 'No API key - analysis skipped'
            elif pd.isna(prop_dict.get('tax_due')):
                prop_dict['analysis_notes'] = 'Missing tax_due - analysis skipped'
        
        results.append(prop_dict)
        
        # Progress update every 1000 properties
        if (idx + 1) % 1000 == 0:
            logger.info(f"Progress: {idx+1}/{len(df)} properties processed")
    
    # Save results
    logger.info(f"Saving {len(results)} properties to {output_file}")
    result_df = pd.DataFrame(results)
    result_df.to_excel(output_file, index=False)
    
    # Save error log
    if error_log:
        error_log_file = output_file.replace('.xlsx', '_errors.json')
        with open(error_log_file, 'w') as f:
            json.dump(error_log, f, indent=2)
        logger.info(f"Saved {len(error_log)} errors to {error_log_file}")
    
    logger.info("Processing complete!")
    
    # Print summary
    print("\n" + "="*80)
    print("PROCESSING SUMMARY")
    print("="*80)
    print(f"Total properties: {len(result_df)}")
    print(f"\nProperty Types:")
    print(result_df['property_type'].value_counts())
    print(f"\nProperties with tax_due: {result_df['tax_due'].notna().sum()}")
    print(f"Properties missing tax_due: {result_df['tax_due'].isna().sum()}")
    if analyzer:
        analyzed = result_df[result_df['analysis_notes'].str.contains('analysis skipped', na=False) == False]
        print(f"\nProperties analyzed: {len(analyzed)}")
    print(f"\nErrors encountered: {len(error_log)}")
    print("="*80)

if __name__ == "__main__":
    import dotenv
    from pathlib import Path
    
    env_path = Path(__file__).parent.parent / '.env'
    dotenv.load_dotenv(dotenv_path=env_path)
    
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    
    input_file = '.tmp/dekalb_results/dekalb_analysis_20260204_204822.xlsx'
    output_file = '.tmp/dekalb_results/dekalb_enhanced_analysis.xlsx'
    
    fix_and_enhance_properties(input_file, output_file, api_key)
