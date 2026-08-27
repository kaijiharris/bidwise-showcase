"""Wayne County, PA tax repository sale connector.

Fetches property listings from the Wayne County Tax Services website.
"""

import re
import math
import requests
from bs4 import BeautifulSoup
from typing import List, Dict, Optional
from pathlib import Path

from execution.connectors.base_connector import BaseConnector
from execution.utils.logger import logger
from execution.enrichment.attom_api import AttomAPI


class WayneCountyConnector(BaseConnector):
    """
    Connector for Wayne County, PA tax repository sales.

    Data Sources:
    1. https://taxservices.waynecountypa.gov/TaxSales/Repository/2026-02-20
    """

    BASE_URL = "https://taxservices.waynecountypa.gov"
    REPO_URL = f"{BASE_URL}/TaxSales/Repository/2026-02-20"

    def __init__(self):
        super().__init__()
        try:
            self.attom_api = AttomAPI()
            self.logger.info("Attom API initialized successfully")
        except Exception as e:
            self.logger.warning(f"Could not initialize Attom API: {e}")
            self.attom_api = None

    def fetch_raw_data(self) -> List[Dict]:
        """Fetch raw property data from Wayne County website."""
        self.logger.info(f"Fetching Wayne County repository sales from {self.REPO_URL}")
        
        properties = []
        
        try:
            # First request
            current_url = self.REPO_URL
            page_num = 1
            max_pages = 50 
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            }
            
            while current_url and page_num <= max_pages:
                self.logger.info(f"Fetching page {page_num}: {current_url}")
                response = requests.get(current_url, headers=headers)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Find the grid
                grid = soup.find(id='dataTaxSaleItemGrid')
                if not grid:
                    tables = soup.find_all('table')
                    if tables: grid = tables[0]
                
                print(f"DEBUG: Grid found: {bool(grid)}")
                
                if not grid:
                    self.logger.warning(f"No table found on page {page_num}.")
                    # Log snippet for debugging
                    self.logger.warning(f"Response snippet: {response.text[:200]}")
                    print(f"DEBUG: Response snippet: {response.text[:200]}")
                    break

                # Extract rows
                rows = grid.find_all('tr')
                print(f"DEBUG: Found {len(rows)} rows")
                page_props = []
                
                # Known headers: ['Tax Map', 'Sale Number', 'Control Number', 'Owner Name', 'Sale Price']
                # Indices: 0, 1, 2, 3, 4
                
                for i, row in enumerate(rows):
                    # Skip header/filter rows
                    if row.find('th') or 'dxbs-filter-row' in row.get('class', []):
                        continue
                        
                    td_cells = row.find_all('td')
                    if not td_cells or len(td_cells) < 5: 
                        continue
                    
                    # Extract text
                    cells = [td.get_text(strip=True) for td in td_cells]
                    
                    # Skip empty rows (filter row often has empty cells)
                    if not any(cells): continue
                    
                    prop = {}
                    
                    # Explicit mapping
                    prop['parcel_id'] = cells[0]  # Tax Map
                    prop['auction_id'] = cells[1] # Sale Number
                    prop['control_number'] = cells[2] # Control Number
                    prop['owner'] = cells[3]      # Owner Name
                    
                    # Price from index 4
                    try:
                        prop['min_bid'] = float(cells[4].replace('$', '').replace(',', ''))
                    except:
                        prop['min_bid'] = 0.0
                    
                    # Link from Control Number (index 2)
                    link_elem = td_cells[2].find('a')
                    if link_elem and link_elem.get('href'):
                        prop['detail_url'] = f"{self.BASE_URL}{link_elem['href']}"
                    
                    if prop['parcel_id']:
                        page_props.append(prop)
                
                if not page_props:
                    self.logger.info("No properties found on this page (or end of list).")
                    break
                    
                properties.extend(page_props)
                self.logger.info(f"Page {page_num}: Found {len(page_props)} properties. Total: {len(properties)}")
                
                # Pagination
                # DevExpress simple pagination check
                next_page_link = soup.find('a', text='Next') or soup.find('a', attrs={'aria-label': 'Next'})
                # Or check if there's a pager
                pager = soup.find(class_='dxbs-pager')
                
                # For now, without confirmed pagination URL pattern (likely JS postback), we stop at page 1.
                # To be improved later with Playwright if full scrape is needed.
                self.logger.info("Pagination requires JS interaction. Stopping at Page 1 for MVP.")
                break 
                
                page_num += 1

        except Exception as e:
            self.logger.error(f"Error scraping Wayne County: {e}")
            
        return properties

    def normalize_to_canonical(self, raw_data: List[Dict]) -> List[Dict]:
        """Normalize Wayne County data to canonical schema."""
        normalized = []

        for prop in raw_data:
            # Map from county-specific format to canonical
            canonical_prop = {
                'parcel_id': prop.get('parcel_id'),
                'address': prop.get('address', 'Address TBD'), 
                'city': 'Wayne County', 
                'state': 'PA',
                'county': 'Wayne',
                'zip_code': '',
                'property_type': 'Residential', 
                'auction_details': {
                    'sale_date': '2026-02-20',
                    'minimum_bid': prop.get('min_bid', 0),
                    'auction_id': prop.get('control_number'),
                    'auction_url': prop.get('detail_url', self.REPO_URL),
                }
            }
            normalized.append(canonical_prop)
            
        return normalized

    def validate(self, property_data: Dict) -> bool:
        """Validate property data."""
        if not property_data.get('parcel_id'):
            return False
        return True

    def enrich_property(self, property_data: Dict) -> Dict:
        """
        Deep enrichment:
        1. Lookup address via Attom API using Parcel ID (APN).
        2. If address found, get valuations and comps.
        3. If not found, use rule-based fallback.
        """
        # Init enrichment if missing
        if 'enrichment' not in property_data:
            property_data['enrichment'] = {}
            
        # Defaults
        defaults = {
            'avm_value': None,
            'arv_estimate': None,
            'avm_confidence': 'low',
            'comp_count': 0,
            'data_quality_score': 0
        }
        for k, v in defaults.items():
            if k not in property_data['enrichment']:
                property_data['enrichment'][k] = v

        if not self.attom_api:
            self.logger.warning("Attom API not enabled, skipping deep enrichment")
            return property_data

        parcel_id = property_data.get('parcel_id')
        if not parcel_id: return property_data
        
        # 1. Resolve Address via APN
        # Wayne County PA FIPS: 42127
        # Try both raw parcel ID and stripped version
        attom_prop = self.attom_api.get_property_by_apn(parcel_id, fips='42127')
        
        if not attom_prop:
            # Retry with stripped formatting if needed (e.g. 05-0-0001 -> 0500001)
            # Experiment showed dashes were fine for the specific example, but let's be safe
            pass

        if attom_prop:
            address_info = attom_prop.get('address', {})
            building_info = attom_prop.get('building', {})
            
            # Update basic info
            if address_info.get('oneLine'):
                property_data['address'] = address_info['oneLine']
                property_data['city'] = address_info.get('locality', property_data['city'])
                property_data['zip_code'] = address_info.get('postal1', '')
                self.logger.info(f"Resolved Address: {property_data['address']}")
                
            property_data['bedrooms'] = building_info.get('rooms', {}).get('beds')
            property_data['bathrooms'] = building_info.get('rooms', {}).get('bathstotal')
            property_data['sqft'] = building_info.get('size', {}).get('universalsize')
            property_data['year_built'] = attom_prop.get('summary', {}).get('yearbuilt')
            
            # 2. Get Comps and Valuation
            if property_data.get('address') and property_data['address'] != 'Address TBD':
                enriched_data = self.attom_api.enrich_property(
                    address=property_data['address'],
                    city=property_data['city'],
                    state='PA',
                    bedrooms=property_data.get('bedrooms'),
                    bathrooms=property_data.get('bathrooms'),
                    sqft=property_data.get('sqft'),
                    use_comps=True
                )
                
                # Merge enrichment data
                property_data['enrichment'].update(enriched_data)
                
                # If we got comps, map the best comp for the spreadsheet
                if enriched_data.get('comps'):
                    best = enriched_data['comps'][0]
                    # Map to flat fields if needed by spreadsheet generator (which usually reads from enrichment dict)
                    # But the Orchestrator expects 'Best Comp', 'Comp Price' etc. 
                    # The orchestrator usually handles this mapping from the 'enrichment' dict in '_generate_spreadsheet'
                    pass

        return property_data

    def fetch_and_enrich(self, max_properties: Optional[int] = None) -> List[Dict]:
        """Fetch and enrich properties."""
        
        # Initial scraping
        raw_data = self.fetch_raw_data()
        normalized = self.normalize_to_canonical(raw_data)
        
        if max_properties:
            normalized = normalized[:max_properties]
            
        self.logger.info(f"Starting Deep Enrichment for {len(normalized)} properties...")
        
        enriched = []
        for i, prop in enumerate(normalized):
            if not self.validate(prop):
                continue
                
            self.logger.info(f"Enriching {i+1}/{len(normalized)}: {prop['parcel_id']}")
            try:
                enriched_prop = self.enrich_property(prop)
                enriched.append(enriched_prop)
            except Exception as e:
                self.logger.error(f"Failed to enrich {prop['parcel_id']}: {e}")
                enriched.append(prop) # Keep original if enrichment fails
            
        return enriched

def fetch_wayne_deals(max_properties: Optional[int] = None) -> List[Dict]:
    """Convenience function to fetch Wayne County deals."""
    connector = WayneCountyConnector()
    return connector.fetch_and_enrich(max_properties)
