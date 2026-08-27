import json
import sys
import pandas as pd
from pathlib import Path
from typing import List

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from execution.analysis.deterministic_analyzer import DeterministicAnalyzer
from execution.adapters.cobb_adapter import CobbAdapter

def load_cobb_data(input_path: Path) -> List[dict]:
    """
    Load Cobb County data from JSON or Excel/CSV.
    """
    if input_path.suffix == '.json':
        with open(input_path, 'r') as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            else:
                return [data] # Handle single object
    elif input_path.suffix in ['.xlsx', '.xls']:
        df = pd.read_excel(input_path)
        return df.to_dict(orient='records')
    elif input_path.suffix == '.csv':
        df = pd.read_csv(input_path)
        return df.to_dict(orient='records')
    else:
        raise ValueError("Unsupported file format")

def run_analysis(input_file: str = None, output_dir: str = ".tmp"):
    """
    Main function to run Cobb analysis.
    """
    # 1. Setup — deterministic analysis does not require an API key
    analyzer = DeterministicAnalyzer()
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True, parents=True)
    
    # 2. Load Data (Scrape if no file)
    raw_properties = []
    
    if not input_file:
        print("No input file provided. Attempting to fetch data via CobbAdapter...")
        try:
            adapter = CobbAdapter()
            raw_properties = adapter.fetch_data()
            if not raw_properties:
                print("Adapter returned no properties. Please provide an input file.")
                return
            
            # Save fetched raw data
            timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
            raw_save_path = output_path / f"cobb_fetched_{timestamp}.json"
            with open(raw_save_path, 'w') as f:
                json.dump(raw_properties, f, indent=2)
            print(f"Fetched data saved to {raw_save_path}")
            
        except Exception as e:
            print(f"Adapter fetch failed: {e}")
            import traceback
            traceback.print_exc()
            return
    else:
        input_path = Path(input_file)
        if not input_path.exists():
            sample_path = output_path / "sample_cobb_input.json"
            sample_data = [{
                "county": "Cobb",
                "sale_date": "2026-03-03",
                "sheriff_number": "2026-00123",
                "house_number": "2030",
                "street_name": "Main",
                "street_suffix": "St",
                "zip_code": "30318",
                "tax_id": "17-0252-0008-048-0",
                "tax_due": 33358.55,
                "market_value_estimate": 250000,
                "property_type": "residential",
                "notes_raw": "Sample property"
            }]
            with open(sample_path, 'w') as f:
                json.dump(sample_data, f, indent=2)
            print(f"Error: Input file {input_path} not found.")
            print(f"Created sample input at {sample_path}. Provide your own data or use the sample.")
            return

        print(f"Loading data from {input_path}...")
        raw_properties = load_cobb_data(input_path)

    print(f"Processing {len(raw_properties)} properties...")

    results = []
    for i, prop in enumerate(raw_properties):
        print(f"Analyzing {i+1}/{len(raw_properties)}: {prop.get('tax_id', 'Unknown ID')}")
        
        # Merge raw prop into analyzer input (mapping fields if necessary)
        # For now assuming input matches internal schema roughly
        
        analysis = analyzer.analyze_property(prop)
        
        # Merge result
        merged = prop.copy()
        merged.update(analysis.model_dump())
        results.append(merged)

    # 4. Save Results
    timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_path / f"cobb_analysis_results_{timestamp}.xlsx"
    
    # Simple DataFrame export for now
    df = pd.DataFrame(results)
    df.to_excel(output_file, index=False)
    print(f"Analysis complete. Results saved to {output_file}")

if __name__ == "__main__":
    import argparse
    import dotenv
    env_path = Path(__file__).parent.parent.parent / '.env'
    dotenv.load_dotenv(dotenv_path=env_path)

    parser = argparse.ArgumentParser(description="Run BidWise AI Analysis for Cobb County")
    parser.add_argument("--input_file", help="Path to input JSON/Excel file. If omitted, will web scrape.", default=None)
    args = parser.parse_args()

    run_analysis(args.input_file)
