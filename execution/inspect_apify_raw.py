"""
Inspect raw Apify data to understand the structure
"""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from apify_client import ApifyClient
import json
import dotenv

# Load env
dotenv.load_dotenv(Path(__file__).parent.parent / '.env')

def main():
    api_key = os.getenv('APIFY_API_KEY')
    client = ApifyClient(api_key)

    print("Fetching FRESH data from Apify for Decatur, GA...")
    print("This will use Apify credits to get real data\n")

    actor_input = {
        "location": "Decatur, GA",
        "operation": "sold",  # Request sold properties
        "maxItems": 50,  # Just get 50 for inspection
        "sortBy": "newest",
        "maxSoldDate": "6m"  # Last 6 months
    }

    run = client.actor("igolaizola/zillow-scraper-ppe").call(run_input=actor_input)

    print("Run completed! Fetching results...\n")

    items = list(client.dataset(run["defaultDatasetId"]).iterate_items())

    print(f"Got {len(items)} items from Apify")

    if items:
        print("\n" + "="*80)
        print("FIRST ITEM STRUCTURE:")
        print("="*80)
        print(json.dumps(items[0], indent=2, default=str)[:3000])

        print("\n" + "="*80)
        print("KEY FIELDS FROM FIRST 10 ITEMS:")
        print("="*80)

        for i, item in enumerate(items[:10]):
            print(f"\nItem {i+1}:")
            print(f"  address: {item.get('address', 'N/A')}")
            print(f"  price: {item.get('price', 'N/A')}")
            print(f"  soldPrice: {item.get('soldPrice', 'N/A')}")
            print(f"  listPrice: {item.get('listPrice', 'N/A')}")
            print(f"  dateSold: {item.get('dateSold', 'N/A')}")
            print(f"  lastSoldDate: {item.get('lastSoldDate', 'N/A')}")
            print(f"  bedrooms: {item.get('bedrooms', 'N/A')}")
            print(f"  bathrooms: {item.get('bathrooms', 'N/A')}")
            print(f"  livingArea: {item.get('livingArea', 'N/A')}")

            # Check listing status
            listing = item.get('listing', {})
            hdp = item.get('hdpView', {})
            print(f"  listing.listingStatus: {listing.get('listingStatus', 'N/A')}")
            print(f"  hdpView.listingStatus: {hdp.get('listingStatus', 'N/A')}")
            print(f"  homeStatus: {item.get('homeStatus', 'N/A')}")
            print(f"  propertyType: {item.get('propertyType', 'N/A')}")

        # Save to file for deeper inspection
        output_file = ".tmp/apify_raw_inspection.json"
        with open(output_file, 'w') as f:
            json.dump(items, f, indent=2, default=str)
        print(f"\n\nFull data saved to: {output_file}")

if __name__ == "__main__":
    main()
