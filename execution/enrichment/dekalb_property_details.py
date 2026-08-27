"""
DeKalb County Property Details Scraper

Fetches actual property characteristics from DeKalb County GIS/Assessor database:
- Square footage (heated living area)
- Bedrooms / Bathrooms
- Year built
- Property type
- Lot size
- Assessment values

Source: DeKalb County Tax Assessor / GIS Portal
"""
import requests
import time
import re
from typing import Dict, Optional
from loguru import logger
import json

class DeKalbPropertyScraper:
    """
    Scrape property details from DeKalb County's property search system.

    DeKalb uses a searchable database at:
    https://www.dekalbcountyga.gov/

    We'll try multiple approaches:
    1. Direct API calls if available
    2. Web scraping if necessary
    3. Third-party data APIs as fallback
    """

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.base_url = "https://www.dekalbcountyga.gov"

    def get_property_details(self, parcel_id: str) -> Dict:
        """
        Get property details for a DeKalb County parcel.

        Args:
            parcel_id: Format like "06 249 01 010"

        Returns:
            Dict with property details or error info
        """
        logger.info(f"Fetching details for parcel {parcel_id}")

        # Normalize parcel ID (remove spaces for some APIs)
        parcel_normalized = parcel_id.replace(' ', '')
        parcel_with_dashes = self._format_parcel_with_dashes(parcel_id)

        # Try multiple methods
        result = None

        # Method 1: Try DeKalb GIS API (if they have one)
        result = self._try_gis_api(parcel_normalized)
        if result and result.get('success'):
            logger.info(f"✓ Found via GIS API")
            return result

        # Method 2: Try property search portal
        result = self._try_property_search(parcel_id, parcel_normalized)
        if result and result.get('success'):
            logger.info(f"✓ Found via property search")
            return result

        # Method 3: Manual lookup instructions
        logger.warning(f"✗ Could not auto-fetch details for {parcel_id}")
        return {
            'success': False,
            'parcel_id': parcel_id,
            'error': 'Could not auto-fetch property details',
            'manual_lookup_url': f"https://www.dekalbcountyga.gov/tax-commissioner/property-search",
            'instructions': 'Search manually by parcel ID on county website',
            'data_source': 'manual_lookup_required'
        }

    def _format_parcel_with_dashes(self, parcel_id: str) -> str:
        """Format parcel ID with dashes: 06-249-01-010"""
        parts = parcel_id.replace(' ', '').replace('-', '')
        if len(parts) >= 10:
            return f"{parts[0:2]}-{parts[2:5]}-{parts[5:7]}-{parts[7:10]}"
        return parcel_id

    def _try_gis_api(self, parcel_id: str) -> Optional[Dict]:
        """
        Try to fetch from GIS API endpoint.

        Many counties have ArcGIS REST APIs we can query.
        """
        # DeKalb County GIS endpoints to try
        gis_endpoints = [
            "https://gis.dekalbcountyga.gov/arcgis/rest/services/",
            "https://maps.dekalbcountyga.gov/",
        ]

        # This is a placeholder - would need to find actual endpoint
        # through research or by inspecting their GIS portal

        return None  # Not implemented yet

    def _try_property_search(self, parcel_id: str, parcel_normalized: str) -> Optional[Dict]:
        """
        Try to scrape from property search portal.

        This would require analyzing their search form and response.
        """
        # Placeholder for now
        return None

    def get_property_from_zillow(self, address: str, city: str, state: str = "GA") -> Dict:
        """
        Fallback: Get property details from Zillow if county source fails.

        Note: This uses the address to search Zillow directly.
        """
        # This would be implemented if county scraping fails
        return {
            'success': False,
            'error': 'Zillow scraping not yet implemented',
            'recommendation': 'Use Apify Zillow scraper or manual lookup'
        }


def enrich_property_with_details(property: Dict, scraper: DeKalbPropertyScraper) -> Dict:
    """
    Enrich a property with actual county data.

    Falls back gracefully if data unavailable.
    """
    parcel_id = property.get('tax_id', '')

    # Try to get details
    details = scraper.get_property_details(parcel_id)

    if details.get('success'):
        # Merge county data
        property['sqft'] = details.get('sqft')
        property['bedrooms'] = details.get('bedrooms')
        property['bathrooms'] = details.get('bathrooms')
        property['year_built'] = details.get('year_built')
        property['lot_size_sqft'] = details.get('lot_size_sqft')
        property['lot_size_acres'] = details.get('lot_size_acres')
        property['assessed_value'] = details.get('assessed_value')
        property['property_class'] = details.get('property_class')
        property['data_source'] = details.get('data_source', 'county_records')
        property['data_quality'] = 'high'
    else:
        # Mark as needing manual research
        property['data_source'] = 'incomplete'
        property['data_quality'] = 'low'
        property['manual_lookup_required'] = True
        property['manual_lookup_url'] = details.get('manual_lookup_url', '')

    return property


if __name__ == "__main__":
    # Test the scraper
    scraper = DeKalbPropertyScraper()

    test_parcels = [
        "06 249 01 010",
        "06 277 01 046"
    ]

    for parcel in test_parcels:
        print(f"\n{'='*60}")
        print(f"Testing parcel: {parcel}")
        print('='*60)

        result = scraper.get_property_details(parcel)
        print(json.dumps(result, indent=2))

        time.sleep(1)  # Be polite to servers
