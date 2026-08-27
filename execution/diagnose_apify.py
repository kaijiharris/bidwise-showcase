"""
Diagnostic script to inspect raw Apify Zillow scraper data
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from execution.enrichment.apify_comps import ApifyZillowComps

def main():
    print("Initializing Apify client...")
    apify = ApifyZillowComps()

    # Check cache
    if 'Decatur, GA' in apify._comp_cache:
        print("\n" + "="*80)
        print("CACHED DATA FOUND FOR DECATUR, GA")
        print("="*80)

        raw_items = apify._comp_cache['Decatur, GA']
        print(f"Total raw items: {len(raw_items)}")

        # Sample first item
        if raw_items:
            print("\n" + "="*80)
            print("FIRST RAW ITEM (Full Structure):")
            print("="*80)
            print(json.dumps(raw_items[0], indent=2)[:2000])

            # Check listing status distribution
            statuses = {}
            for item in raw_items[:100]:  # Sample first 100
                status = item.get('listing', {}).get('listingStatus') or item.get('hdpView', {}).get('listingStatus') or 'unknown'
                statuses[status] = statuses.get(status, 0) + 1

            print("\n" + "="*80)
            print("LISTING STATUS DISTRIBUTION (first 100 items):")
            print("="*80)
            for status, count in sorted(statuses.items(), key=lambda x: -x[1]):
                print(f"  {status}: {count}")

            # Check for sold properties
            sold_count = 0
            for item in raw_items:
                status = item.get('listing', {}).get('listingStatus') or item.get('hdpView', {}).get('listingStatus')
                if status and 'sold' in str(status).lower():
                    sold_count += 1

            print(f"\nTotal items with 'sold' in status: {sold_count}")

    else:
        print("No cached data found for Decatur, GA")
        print("Run the analysis first to populate cache")

if __name__ == "__main__":
    main()
