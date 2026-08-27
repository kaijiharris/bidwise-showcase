"""Wayne County, PA repository tax sale connector.

Fetches property listings from Wayne County PA Repository Tax Sales.
Data Source: https://taxservices.waynecountypa.gov/TaxSales/Repository/2026-02-20
"""
import re
import json
import requests
from typing import List, Dict, Optional
from datetime import datetime
from pathlib import Path
from loguru import logger

from .base_connector import BaseConnector

# Try to import Apify (primary data source)
try:
    from execution.enrichment.apify_comps import ApifyZillowComps
    APIFY_AVAILABLE = True
except Exception:
    APIFY_AVAILABLE = False


class WayneCountyPAConnector(BaseConnector):
    """
    Connector for Wayne County, PA repository tax sales.

    Data Sources:
    1. Wayne County Tax Services website (https://taxservices.waynecountypa.gov)
    2. Repository tax sale listings
    3. Individual parcel detail pages

    Pennsylvania Repository Sale Process:
    - Properties forfeit to county after 2+ years unpaid taxes and failed upset sale
    - Sold at repository sale (usually February)
    - Sold "as is" with no warranty
    - 10-day right of redemption for property owner
    - All sales are final after redemption period
    """

    BASE_URL = "https://taxservices.waynecountypa.gov"
    SALE_URL = f"{BASE_URL}/TaxSales/Repository/2026-02-20"

    def __init__(self, cache_dir: Optional[Path] = None):
        """
        Initialize Wayne County PA connector.

        Args:
            cache_dir: Directory to cache downloaded data
        """
        super().__init__()
        self.cache_dir = cache_dir or Path(".tmp/wayne_county_pa_cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.logger = logger.bind(connector='WayneCountyPA')

        # Initialize Apify as primary data source (1000x cheaper than Attom)
        # Note: Wayne County PA is 100% vacant land - comps not needed
        self.apify = None
        if APIFY_AVAILABLE:
            try:
                self.apify = ApifyZillowComps()
                self.logger.info("Apify Zillow fallback initialized successfully")
            except Exception as e:
                self.logger.warning(f"Could not initialize Apify: {e}")

        # Initialize Web Scraper for property scraping
        self.web_scraper = None
        try:
            from execution.enrichment.web_scraper import WebScraper
            self.web_scraper = WebScraper()
            self.logger.info("Web Scraper initialized for property scraping")
        except Exception as e:
            self.logger.warning(f"Could not initialize Web Scraper: {e}")

    def fetch_raw_data(self) -> List[Dict]:
        """
        Fetch raw property data from Wayne County PA sources.

        Checks for cached data first, otherwise scrapes from website.

        Returns:
            List of raw property dicts
        """
        # Check for cached data
        cache_paths = [
            Path("scraped_deals_wayne_pa.json"),
            Path(".tmp/wayne_county_pa_cache/properties.json"),
            self.cache_dir / "properties.json"
        ]

        for cache_path in cache_paths:
            if cache_path.exists():
                self.logger.info(f"Loading cached property data from {cache_path}")
                with open(cache_path, 'r') as f:
                    properties = json.load(f)
                return properties

        self.logger.info("No cached data found, will need to scrape from website")
        self.logger.info(f"To scrape, use web scraper on: {self.SALE_URL}")
        self.logger.info("Expected fields: Tax Map, Sale Number, Control Number, Owner Name, Sale Price")

        return []

    def normalize_to_canonical(self, raw_data: List[Dict]) -> List[Dict]:
        """
        Normalize Wayne County PA data to canonical schema.
        Automatically categorizes and filters out vacant land.

        Args:
            raw_data: Raw property dicts from source

        Returns:
            Normalized property dicts (vacant land filtered out)
        """
        normalized = []

        for prop in raw_data:
            # Extract fields from Wayne County format
            tax_map = prop.get('tax_map', '')
            control_number = prop.get('control_number', '')
            sale_number = prop.get('sale_number', '')
            owner_name = prop.get('owner_name', '')
            sale_price = prop.get('sale_price', 0)

            # Parse address if available
            address = prop.get('address', '')
            city = prop.get('city', '')
            state = prop.get('state', 'PA')
            zip_code = prop.get('zip_code', '')

            # Parcel detail URL
            parcel_url = f"{self.BASE_URL}/Parcel/{control_number}" if control_number else ""

            # Categorize property type based on land use
            property_type = self._categorize_property(prop)

            canonical_prop = {
                'parcel_id': tax_map or control_number,
                'address': address,
                'city': city,
                'state': state,
                'zip_code': zip_code,
                'county': 'Wayne',
                'property_type': property_type,
                'bedrooms': prop.get('bedrooms'),
                'bathrooms': prop.get('bathrooms'),
                'sqft': prop.get('sqft'),
                'lot_size': prop.get('lot_size'),
                'year_built': prop.get('year_built'),
                'land_use': prop.get('land_use'),
                'township': prop.get('township'),
                'acreage': prop.get('acreage'),
                'source': 'Wayne County PA Repository Sale',
                'source_url': parcel_url,
                'auction_details': {
                    'sale_number': sale_number,
                    'control_number': control_number,
                    'minimum_bid': sale_price,
                    'sale_date': '2026-02-20',  # Repository sale date
                    'auction_url': parcel_url,
                    'auction_type': 'repository'
                }
            }

            # Filter out vacant land (only include residential/commercial)
            if property_type != 'vacant_land':
                normalized.append(canonical_prop)

        total_count = len(raw_data)
        filtered_count = len(normalized)
        vacant_count = total_count - filtered_count

        self.logger.info(f"Normalized {filtered_count} properties (filtered {vacant_count} vacant land)")
        return normalized

    def _categorize_property(self, prop: Dict) -> str:
        """
        Determine property type based on land use and characteristics.

        Returns:
            'vacant_land', 'residential', 'commercial', or 'other'
        """
        land_use = prop.get('land_use', '').upper()
        sqft = prop.get('sqft')
        bedrooms = prop.get('bedrooms')

        # Check for vacant land indicators
        vacant_indicators = [
            'LOT',
            'VACANT',
            'UNDEVELOPED',
            'UNIMPROVED',
            'LAND ONLY',
            'WELL LOT'
        ]

        if any(indicator in land_use for indicator in vacant_indicators):
            return 'vacant_land'

        # Check if property has no building characteristics
        if sqft is None and bedrooms is None:
            # Likely vacant land
            return 'vacant_land'

        # Check for residential indicators
        residential_indicators = [
            'RESIDENTIAL',
            'SINGLE FAMILY',
            'SFR',
            'HOUSE',
            'DWELLING',
            'MOBILE HOME',
            'MANUFACTURED HOME'
        ]

        if any(indicator in land_use for indicator in residential_indicators):
            return 'residential'

        # Check for commercial indicators
        commercial_indicators = [
            'COMMERCIAL',
            'RETAIL',
            'OFFICE',
            'INDUSTRIAL',
            'WAREHOUSE',
            'STORE'
        ]

        if any(indicator in land_use for indicator in commercial_indicators):
            return 'commercial'

        # Default: if has bedrooms, it's residential
        if bedrooms and bedrooms > 0:
            return 'residential'

        # Default: if has sqft but no bedrooms, likely commercial
        if sqft and sqft > 0:
            return 'commercial'

        # Unknown - default to residential for now
        return 'residential'

    def enrich_property(self, property_data: Dict) -> Dict:
        """
        Enrich a single property with Attom API data and comparable sales.

        Uses parcel ID to fetch property details from Attom API,
        then pulls comparable sales to calculate ARV.

        Args:
            property_data: Property dict with at least parcel_id

        Returns:
            Property dict with enrichment data added
        """
        parcel_id = property_data.get('parcel_id')
        if not parcel_id:
            self.logger.warning("Property missing parcel_id, cannot enrich")
            return property_data

        self.logger.debug(f"Enriching property {parcel_id}")

        # Initialize enrichment dict
        enrichment = {
            'avm_value': None,
            'arv_estimate': None,
            'avm_confidence': 'medium',
            'comp_count': 0,
            'avg_price_per_sqft': None,
            'median_sale_price': None,
            'crime_score': 50,  # Default medium
            'flood_zone': 'X',  # Default low risk
            'flood_risk_score': 20,
            'fire_risk_score': 30,
            'composite_risk_score': 35,
            'known_liens_count': 1,  # Repository sale = at least 1 lien
            'total_lien_amount': property_data.get('auction_details', {}).get('minimum_bid', 0),
            'estimated_rent_monthly': None,
            'data_quality_score': 50  # Start at medium
        }

        address = property_data.get('address', '')
        city = property_data.get('city', '')
        state = property_data.get('state', 'PA')

        # Step 1: Try to get property details from Attom API by parcel ID
        if self.attom_api and parcel_id:
            try:
                self.logger.info(f"Fetching property details for parcel {parcel_id}")
                property_details = self.attom_api.get_property_by_apn(parcel_id, state)

                if property_details:
                    # Update property with details from Attom
                    if property_details.get('bedrooms') and not property_data.get('bedrooms'):
                        property_data['bedrooms'] = property_details['bedrooms']
                        self.logger.info(f"  → Added bedrooms: {property_details['bedrooms']}")

                    if property_details.get('bathrooms') and not property_data.get('bathrooms'):
                        property_data['bathrooms'] = property_details['bathrooms']
                        self.logger.info(f"  → Added bathrooms: {property_details['bathrooms']}")

                    if property_details.get('sqft') and not property_data.get('sqft'):
                        property_data['sqft'] = property_details['sqft']
                        self.logger.info(f"  → Added sqft: {property_details['sqft']}")

                    if property_details.get('year_built') and not property_data.get('year_built'):
                        property_data['year_built'] = property_details['year_built']
                        self.logger.info(f"  → Added year_built: {property_details['year_built']}")

                    # Use improved address if available
                    if property_details.get('address'):
                        property_data['address'] = property_details['address']
                        address = property_details['address']
                    if property_details.get('city'):
                        property_data['city'] = property_details['city']
                        city = property_details['city']
                    if property_details.get('zip_code'):
                        property_data['zip_code'] = property_details['zip_code']

            except Exception as e:
                self.logger.warning(f"Could not fetch property details from Attom API: {e}")

        # Get updated property details after enrichment
        sqft = property_data.get('sqft') or 0
        year_built = property_data.get('year_built') or 0
        bedrooms = property_data.get('bedrooms')
        bathrooms = property_data.get('bathrooms')

        # Step 2: Get comparable sales (DISABLED - Attom API removed, use Apify instead)
        comps = []
        if False:  # Attom API removed
            try:
                self.logger.info(f"Fetching comps for {address}, {city}, {state}")
                raw_attom_comps = []  # self.attom_api.get_comparable_sales(
                    address=address,
                    city=city,
                    state=state,
                    bedrooms=bedrooms,
                    bathrooms=bathrooms,
                    sqft=sqft if sqft > 0 else None,
                    radius_miles=15.0,  # Pennsylvania - wider search for rural areas
                    max_comps=10
                )
                self.logger.info(f"Found {len(raw_attom_comps)} raw comps from Attom")

                # Filter comps by date and criteria
                from datetime import datetime, timedelta

                def filter_comps_by_date_window(raw_comps, months_back):
                    """Filter comps by date window and other criteria."""
                    filtered = []
                    today = datetime(2025, 12, 29)
                    cutoff_date = today - timedelta(days=months_back * 30)

                    for comp in raw_comps:
                        # Filter 1: Must have sale price
                        if not comp.get('sale_price') or comp['sale_price'] <= 0:
                            continue

                        # Filter 2: Sale date within window
                        if comp.get('sale_date'):
                            try:
                                if isinstance(comp['sale_date'], str):
                                    sale_date = datetime.fromisoformat(comp['sale_date'].replace('Z', '+00:00'))
                                else:
                                    sale_date = comp['sale_date']

                                if sale_date < cutoff_date or sale_date > today:
                                    continue
                            except:
                                continue

                        # Filter 3: Must be residential (has bedrooms)
                        if not comp.get('bedrooms') or comp['bedrooms'] == 0:
                            continue

                        # Filter 4: Skip commercial properties (price > $2M)
                        if comp['sale_price'] > 2000000:
                            continue

                        filtered.append(comp)

                    return filtered

                # Try 12-month window first
                filtered_comps = filter_comps_by_date_window(raw_attom_comps, 12)

                if len(filtered_comps) < 3:
                    # Expand to 24 months for small markets
                    self.logger.info(f"Only {len(filtered_comps)} comps in 12mo window, expanding to 24 months")
                    filtered_comps = filter_comps_by_date_window(raw_attom_comps, 24)
                    self.logger.info(f"Filtered to {len(filtered_comps)} valid comps (24mo window)")
                else:
                    self.logger.info(f"Filtered to {len(filtered_comps)} valid comps (12mo window)")

                comps = filtered_comps

            except Exception as e:
                self.logger.warning(f"Error fetching Attom comps: {e}")

        # Fallback: try Apify if Attom didn't return enough comps
        if len(comps) < 3 and self.apify and city:
            try:
                self.logger.info(f"Trying Apify Zillow as fallback (only {len(comps)} from Attom)")
                apify_comps = self.apify.get_sold_properties(
                    city=city,
                    state_code=state,
                    bedrooms=bedrooms,
                    bathrooms=int(bathrooms) if bathrooms else None,
                    max_price=800000,  # Pennsylvania cap
                    year_built=year_built,
                    limit=10
                )
                if apify_comps:
                    comps.extend(apify_comps)
                    self.logger.info(f"Added {len(apify_comps)} comps from Apify (total: {len(comps)})")
            except Exception as e:
                self.logger.warning(f"Error fetching Apify comps: {e}")

        # Step 3: Calculate ARV from comps
        if comps and len(comps) > 0:
            # Store all comps for spreadsheet
            enrichment['comps'] = comps

            # Use real comp data
            comp_prices = [c['sale_price'] for c in comps if c.get('sale_price') and c['sale_price'] > 0]
            comp_sqfts = [c['sqft'] for c in comps if c.get('sqft') and c['sqft'] > 0]

            if comp_prices:
                enrichment['median_sale_price'] = sorted(comp_prices)[len(comp_prices) // 2]
                enrichment['comp_count'] = len(comps)

                # Calculate avg price per sqft from comps
                if comp_sqfts and len(comp_sqfts) == len(comp_prices):
                    price_per_sqfts = [p / s for p, s in zip(comp_prices, comp_sqfts)]
                    avg_psf = sum(price_per_sqfts) / len(price_per_sqfts)
                    enrichment['avg_price_per_sqft'] = round(avg_psf, 2)

                    # Calculate ARV using comp avg PSF
                    if sqft > 0:
                        arv_estimate = sqft * avg_psf
                        enrichment['arv_estimate'] = round(arv_estimate, 2)
                        enrichment['avm_value'] = round(arv_estimate * 0.95, 2)  # High confidence
                        enrichment['data_quality_score'] = 95  # High quality - has real comps
                        enrichment['avm_confidence'] = 'high'
                    else:
                        # No sqft - use median price as estimate
                        enrichment['arv_estimate'] = enrichment['median_sale_price']
                        enrichment['avm_value'] = round(enrichment['median_sale_price'] * 0.90, 2)
                        enrichment['data_quality_score'] = 85
                        enrichment['avm_confidence'] = 'medium'
                else:
                    # Use median sale price as estimate
                    enrichment['arv_estimate'] = enrichment['median_sale_price']
                    enrichment['avm_value'] = round(enrichment['median_sale_price'] * 0.90, 2)
                    enrichment['data_quality_score'] = 85
                    enrichment['avm_confidence'] = 'medium'

        # Step 4: Fallback to rule-based if no comps (Pennsylvania-specific pricing)
        if not enrichment.get('arv_estimate') and sqft > 0:
            # Pennsylvania baseline: $120-180/sqft for renovated properties
            base_psf = 140

            # City adjustments (Wayne County PA cities)
            city_lower = city.lower() if city else ''
            if 'honesdale' in city_lower:
                base_psf = 150  # County seat
            elif 'hawley' in city_lower:
                base_psf = 160  # Tourist area near Lake Wallenpaupack
            elif 'bethany' in city_lower or 'beach lake' in city_lower:
                base_psf = 155  # Lake communities
            elif 'damascus' in city_lower or 'newfoundland' in city_lower:
                base_psf = 130  # Rural areas
            else:
                # Small towns/rural
                base_psf = 120

            # Age adjustment
            if year_built > 0:
                age = 2025 - year_built
                if age < 20:
                    base_psf *= 1.1
                elif age > 60:
                    base_psf *= 0.85

            arv_estimate = sqft * base_psf
            enrichment['arv_estimate'] = round(arv_estimate, 2)
            enrichment['avg_price_per_sqft'] = base_psf
            enrichment['avm_value'] = round(arv_estimate * 0.70, 2)  # Distressed value
            enrichment['data_quality_score'] = 60  # Estimated, not from comps

        # Step 5: Estimate rent for rental strategy
        if enrichment['arv_estimate']:
            rent_estimate = enrichment['arv_estimate'] * 0.008  # 0.8% of ARV (PA market)
            enrichment['estimated_rent_monthly'] = round(rent_estimate, 2)

        # Step 6: City-based crime scoring (Wayne County PA)
        crime_zones = {
            'honesdale': 35,
            'hawley': 25,
            'bethany': 20,
            'beach lake': 20,
            'damascus': 15,
            'newfoundland': 25
        }

        city_lower = city.lower() if city else ''
        for zone_city, score in crime_zones.items():
            if zone_city in city_lower:
                enrichment['crime_score'] = score
                break

        # Recalculate composite risk
        enrichment['composite_risk_score'] = int(
            enrichment['crime_score'] * 0.4 +
            enrichment['flood_risk_score'] * 0.4 +
            enrichment['fire_risk_score'] * 0.2
        )

        property_data['enrichment'] = enrichment

        return property_data

    def fetch_and_enrich(self, max_properties: Optional[int] = None) -> List[Dict]:
        """
        Fetch properties and enrich them with Attom API data and comps.

        Args:
            max_properties: Maximum number of properties to process

        Returns:
            List of enriched property dicts
        """
        properties = self.fetch_properties(max_properties)

        enriched = []
        for prop in properties:
            enriched_prop = self.enrich_property(prop)
            enriched.append(enriched_prop)

        self.logger.info(f"Enriched {len(enriched)} properties")
        return enriched

    def fetch_properties(self, max_properties: Optional[int] = None) -> List[Dict]:
        """
        Main entry point: Fetch and normalize Wayne County PA properties.

        Args:
            max_properties: Optional limit on number of properties

        Returns:
            List of normalized property dicts ready for enrichment
        """
        self.logger.info("Fetching Wayne County PA repository tax sale properties")

        raw_data = self.fetch_raw_data()
        normalized = self.normalize_to_canonical(raw_data)

        if max_properties:
            normalized = normalized[:max_properties]

        self.logger.info(f"Loaded {len(normalized)} properties")
        return normalized
