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

from execution.adapters.gwinnett_adapter import GwinnettAdapter
from execution.enrichment.property_enrichment_pipeline import PropertyEnrichmentPipeline
from execution.export.spreadsheet_generator import SpreadsheetGenerator

# Load Environment
env_path = Path(__file__).parent.parent / '.env'
dotenv.load_dotenv(dotenv_path=env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("GwinnettRunner")

def run_analysis(
    input_file: str = None,
    output_dir: str = ".tmp/gwinnett_results",
    use_assessor: bool = True,
    use_claude: bool = True,
    max_assessor_requests: int = 100
):
    """
    Main execution flow for Gwinnett County with full enrichment pipeline.

    Args:
        input_file: Optional path to pre-fetched JSON data
        output_dir: Output directory for results
        use_assessor: Enable county assessor scraping (most accurate)
        use_claude: Enable Claude AI analysis
        max_assessor_requests: Limit assessor requests (avoid overwhelming server)
    """
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True, parents=True)

    # 1. Acquire Data (Adapter or File)
    raw_properties = []

    if input_file:
        logger.info(f"Loading data from file: {input_file}")
        with open(input_file, 'r') as f:
            raw_properties = json.load(f)
    else:
        logger.info("Fetching data via GwinnettAdapter...")
        try:
            adapter = GwinnettAdapter()
            raw_properties = adapter.fetch_data()

            # Save raw fetch
            timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
            raw_save_path = output_path / f"gwinnett_fetched_{timestamp}.json"
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

    logger.info(f"\n{'='*60}")
    logger.info(f"GWINNETT COUNTY TAX DEED ANALYSIS")
    logger.info(f"{'='*60}")
    logger.info(f"Properties to analyze: {len(raw_properties)}")
    logger.info(f"Assessor scraping: {'ENABLED' if use_assessor else 'DISABLED'}")
    logger.info(f"Claude AI analysis: {'ENABLED' if use_claude else 'DISABLED'}")
    logger.info(f"{'='*60}\n")

    # 2. Enrich Properties with Complete Pipeline
    enriched_properties = []

    try:
        with PropertyEnrichmentPipeline(
            use_assessor=use_assessor,
            use_claude=use_claude
        ) as pipeline:

            enriched_properties = pipeline.enrich_properties(
                raw_properties,
                max_assessor_requests=max_assessor_requests
            )

    except Exception as e:
        logger.error(f"Enrichment pipeline failed: {e}")
        import traceback
        traceback.print_exc()
        # Continue with partial data
        enriched_properties = raw_properties

    # 3. Save Enriched Results
    timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")

    # JSON
    json_out = output_path / f"gwinnett_enriched_{timestamp}.json"
    with open(json_out, 'w') as f:
        json.dump(enriched_properties, f, indent=2)

    # Excel
    excel_out = output_path / f"gwinnett_analysis_{timestamp}.xlsx"
    df = pd.DataFrame(enriched_properties)
    df.to_excel(excel_out, index=False)

    logger.info(f"\n{'='*60}")
    logger.info(f"ANALYSIS COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"JSON: {json_out}")
    logger.info(f"Excel: {excel_out}")

    # 4. Generate Summary Statistics
    _print_summary_stats(enriched_properties)

    # 5. Generate Formatted Spreadsheet (if SpreadsheetGenerator is available)
    try:
        _generate_formatted_spreadsheet(enriched_properties, output_path, timestamp)
    except Exception as e:
        logger.warning(f"Could not generate formatted spreadsheet: {e}")

    logger.info(f"\n✅ GWINNETT COUNTY ANALYSIS COMPLETE\n")

def _print_summary_stats(properties: List[dict]):
    """Print summary statistics."""
    logger.info("\n=== SUMMARY STATISTICS ===")
    logger.info(f"Total properties: {len(properties)}")

    # Tax amounts
    tax_dues = [p.get('tax_due', 0) for p in properties if p.get('tax_due')]
    if tax_dues:
        logger.info(f"Total tax due: ${sum(tax_dues):,.2f}")
        logger.info(f"Average tax due: ${sum(tax_dues)/len(tax_dues):,.2f}")
        logger.info(f"Min tax due: ${min(tax_dues):,.2f}")
        logger.info(f"Max tax due: ${max(tax_dues):,.2f}")

    # Property types
    types = {}
    for p in properties:
        pt = p.get('property_type', 'unknown')
        types[pt] = types.get(pt, 0) + 1
    logger.info(f"\nProperty types:")
    for ptype, count in sorted(types.items(), key=lambda x: x[1], reverse=True):
        logger.info(f"  {ptype}: {count}")

    # Deal scores
    scored = [p for p in properties if p.get('deal_score')]
    if scored:
        avg_score = sum(p.get('deal_score', 0) for p in scored) / len(scored)
        logger.info(f"\nAverage deal score: {avg_score:.1f}/100")

        # Top deals
        top_deals = sorted(scored, key=lambda x: x.get('deal_score', 0), reverse=True)[:5]
        logger.info(f"\nTop 5 deals:")
        for i, deal in enumerate(top_deals, 1):
            roi = deal.get('roi_pct') or 0
            logger.info(
                f"  {i}. {deal.get('tax_id')} - Score: {deal.get('deal_score')}/100 - "
                f"ROI: {roi:.1f}%"
            )

    # Data sources
    assessor_count = sum(1 for p in properties if 'assessor' in p.get('_data_sources', []))
    claude_count = sum(1 for p in properties if 'claude' in p.get('_data_sources', []))
    logger.info(f"\nData sources used:")
    logger.info(f"  Assessor: {assessor_count}/{len(properties)}")
    logger.info(f"  Claude AI: {claude_count}/{len(properties)}")

def _generate_formatted_spreadsheet(properties: List[dict], output_path: Path, timestamp: str):
    """Generate formatted spreadsheet with deal analysis."""
    logger.info("\n=== GENERATING FORMATTED SPREADSHEET ===")

    # Prepare data for spreadsheet generator
    # Sort by deal score
    sorted_props = sorted(
        properties,
        key=lambda x: x.get('deal_score', 0),
        reverse=True
    )

    # Format fields for spreadsheet
    for prop in sorted_props:
        # Map fields to expected names
        prop['parcel_id'] = prop.get('tax_id')
        prop['taxes_owed'] = prop.get('tax_due')
        prop['minimum_bid'] = prop.get('min_bid') or prop.get('tax_due')
        prop['max_bid'] = prop.get('recommended_max_bid')
        prop['as_is_price'] = prop.get('as_is_value')
        prop['composite_risk_score'] = prop.get('risk_score')

        # Bid recommendation
        score = prop.get('deal_score', 0)
        roi = prop.get('roi_pct', 0)
        if score >= 70 and roi >= 20:
            prop['bid_recommendation'] = f"STRONG BUY - Bid up to ${prop.get('recommended_max_bid', 0):,.0f}"
        elif score >= 50 and roi >= 10:
            prop['bid_recommendation'] = f"Consider - Bid up to ${prop.get('recommended_max_bid', 0):,.0f}"
        else:
            prop['bid_recommendation'] = "PASS - Low confidence/ROI"

    # Generate spreadsheet
    generator = SpreadsheetGenerator(output_dir=str(output_path))

    spreadsheet_path = generator.generate(
        top_deals=sorted_props[:20],  # Top 20 by score
        exceptional_deals=[],  # No filters applied yet
        all_deals=sorted_props,
        query_params={
            'county': 'Gwinnett',
            'state': 'GA',
            'strategy': 'flip',
            'timestamp': timestamp
        },
        filename=f"gwinnett_deals_{timestamp}.xlsx"
    )

    logger.info(f"✓ Formatted spreadsheet: {spreadsheet_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run complete analysis for Gwinnett County tax deed properties"
    )
    parser.add_argument(
        "--input_file",
        help="Path to existing JSON data file",
        default=None
    )
    parser.add_argument(
        "--output_dir",
        help="Output directory for results",
        default=".tmp/gwinnett_results"
    )
    parser.add_argument(
        "--no-assessor",
        action="store_true",
        help="Disable county assessor scraping"
    )
    parser.add_argument(
        "--no-claude",
        action="store_true",
        help="Disable Claude AI analysis"
    )
    parser.add_argument(
        "--max-assessor",
        type=int,
        default=100,
        help="Maximum assessor requests (default: 100)"
    )

    args = parser.parse_args()

    run_analysis(
        input_file=args.input_file,
        output_dir=args.output_dir,
        use_assessor=not args.no_assessor,
        use_claude=not args.no_claude,
        max_assessor_requests=args.max_assessor
    )
