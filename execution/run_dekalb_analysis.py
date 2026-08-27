import os
import sys
import json
import logging
import argparse
import pandas as pd
import dotenv
from pathlib import Path
from typing import List

# Add project root to path to allow imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from execution.analysis.deterministic_analyzer import DeterministicAnalyzer
from execution.adapters.dekalb_adapter import DeKalbAdapter
from execution.export.spreadsheet_generator import SpreadsheetGenerator

# Load Environment
env_path = Path(__file__).parent.parent.parent / '.env'
dotenv.load_dotenv(dotenv_path=env_path)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("DeKalbRunner")

def run_analysis(input_file: str = None, output_dir: str = ".tmp/dekalb_results"):
    """
    Main execution flow for DeKalb County.
    """
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True, parents=True)

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    analyzer = DeterministicAnalyzer()

    # 2. Acquire Data (Adapter or File)
    raw_properties = []
    
    if input_file:
        logger.info(f"Loading data from file: {input_file}")
        with open(input_file, 'r') as f:
            raw_properties = json.load(f)
    else:
        logger.info("Fetching data via DeKalbAdapter...")
        try:
            adapter = DeKalbAdapter()
            raw_properties = adapter.fetch_data()
            
            # Save raw fetch
            timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
            raw_save_path = output_path / f"dekalb_fetched_{timestamp}.json"
            with open(raw_save_path, 'w') as f:
                json.dump(raw_properties, f, indent=2)
            logger.info(f"Saved {len(raw_properties)} raw properties to {raw_save_path}")

        except Exception as e:
            logger.error(f"Failed to fetch data: {e}")
            import traceback
            traceback.print_exc()
            return

    if not raw_properties:
        logger.warning("No properties found to analyze.")
        return

    # 3. Analyze (if key present)
    results = []
    if analyzer:
        logger.info(f"Starting analysis on {len(raw_properties)} properties...")
        for i, prop in enumerate(raw_properties):
            tax_id = prop.get('tax_id', 'Unknown')
            logger.info(f"Analyzing {i+1}/{len(raw_properties)}: {tax_id}")
            
            analysis = analyzer.analyze_property(prop)
            
            # Merge
            merged = prop.copy()
            merged.update(analysis.model_dump())
            results.append(merged)
            
            # Rate limit/Safety pause if needed could go here
    else:
        logger.info("Skipping analysis (No API Key). Outputting raw data.")
        results = raw_properties

    # 4. Save Results
    timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
    
    # JSON
    json_out = output_path / f"dekalb_analysis_{timestamp}.json"
    with open(json_out, 'w') as f:
        json.dump(results, f, indent=2)
        
    # Excel
    excel_out = output_path / f"dekalb_analysis_{timestamp}.xlsx"
    df = pd.DataFrame(results)
    df.to_excel(excel_out, index=False)
    
    logger.info(f"Analysis complete. Results saved to:")
    logger.info(f"  JSON: {json_out}")
    logger.info(f"  Excel: {excel_out}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run BidWise AI for DeKalb County")
    parser.add_argument("--input_file", help="Path to existing JSON data file", default=None)
    args = parser.parse_args()
    
    run_analysis(args.input_file)
