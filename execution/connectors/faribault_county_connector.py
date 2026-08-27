"""Faribault County, MN tax forfeiture sale connector.

Fetches property listings from Faribault County PublicSurplus auctions.
Minnesota uses "tax forfeiture" instead of "tax deed" - properties sold via online auction.
"""
import re
import json
import requests
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from pathlib import Path
from loguru import logger

from .base_connector import BaseConnector

# Try to import Apify (primary data source)
try:
    from execution.enrichment.apify_comps import ApifyZillowComps
    APIFY_AVAILABLE = True
except Exception:
    APIFY_AVAILABLE = False


class FaribaultCountyConnector(BaseConnector):
    """
    Connector for Faribault County, MN tax forfeiture sales.

    Data Sources:
    1. PublicSurplus.com auctions (https://www.publicsurplus.com/sms/faribaultcore,mn/browse/home)
    2. Faribault County Auditor's Office listings
    3. Minnesota tax forfeiture property database

    Minnesota Tax Forfeiture Process:
    - Properties forfeit to the state after 3+ years of unpaid property taxes
    - Sold via online auction on PublicSurplus.com
    - 24-day public viewing period followed by 30-day auction
    - Sold "as is" with no warranty
    - All sales are final
    """

    BASE_URL = "https://www.co.faribault.mn.us"
    AUDITOR_URL = f"{BASE_URL}/auditor-treasurer/pages/tax-forfeiture-land-sale-information"
    PUBLIC_SURPLUS_URL = "https://www.publicsurplus.com/sms/faribaultcore,mn/browse/home"

    def __init__(self, cache_dir: Optional[Path] = None):
        """
        Initialize Faribault County connector.

        Args:
            cache_dir: Directory to cache downloaded data
        """
        super().__init__()
        self.cache_dir = cache_dir or Path(".tmp/faribault_county_cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.logger = logger.bind(connector='FaribaultCounty')

        # Initialize Apify as primary data source (1000x cheaper than Attom)
        self.apify = None

        # Initialize Web Scraper for property enrichment
        self.web_scraper = None
        if APIFY_AVAILABLE:
            try:
                self.apify = ApifyZillowComps()
                self.logger.info("Apify Zillow fallback initialized successfully")

                # Try to initialize Web Scraper for property enrichment
                try:
                    from execution.enrichment.web_scraper import WebScraper
                    self.web_scraper = WebScraper()
                    self.logger.info("Web Scraper initialized for property enrichment")
                except Exception as ws_e:
                    self.logger.warning(f"Could not initialize Web Scraper: {ws_e}")
            except Exception as e:
                self.logger.warning(f"Could not initialize Apify: {e}")

    def fetch_raw_data(self) -> List[Dict]:
        """
        Fetch raw property data from Faribault County sources.

        For MVP, loads from cached JSON file. Future: scrape PublicSurplus.com.

        Returns:
            List of raw property dicts
        """
        # Check for cached data specific to Faribault County
        # Prioritize December 2025 data over old February data
        cache_paths = [
            Path("scraped_deals_faribault_december.json"),  # December 2025 auction
            Path("scraped_deals_faribault.json"),  # February 2025 auction (old)
            Path(".tmp/faribault_county_cache/properties.json"),
            self.cache_dir / "properties.json"
        ]

        for cache_path in cache_paths:
            if cache_path.exists():
                self.logger.info(f"Loading cached property data from {cache_path}")
                with open(cache_path, 'r') as f:
                    properties = json.load(f)
                return properties

        self.logger.warning("No cached data found for Faribault County")
        self.logger.info(f"To add properties, create one of these files: {cache_paths[0]}")
        self.logger.info(f"Or scrape from: {self.PUBLIC_SURPLUS_URL}")

        return []

    def normalize_to_canonical(self, raw_data: List[Dict]) -> List[Dict]:
        """
        Normalize Faribault County data to canonical schema.

        Args:
            raw_data: Raw property dicts from source

        Returns:
            Normalized property dicts
        """
        # If data is already in canonical format, return as-is
        # Otherwise, map fields appropriately
        normalized = []

        for prop in raw_data:
            # Check if already normalized
            if 'parcel_id' in prop and 'county' in prop:
                normalized.append(prop)
                continue

            # Map from PublicSurplus/Minnesota format to canonical
            # Extract auction_url from nested auction_details or top level
            auction_url = prop.get('auction_url')
            if not auction_url and 'auction_details' in prop:
                auction_url = prop['auction_details'].get('auction_url')
            if not auction_url:
                auction_url = f"{self.PUBLIC_SURPLUS_URL}"

            canonical_prop = {
                'parcel_id': prop.get('parcel_id') or prop.get('parcel_number') or prop.get('id'),
                'address': prop.get('address') or prop.get('street_address'),
                'city': prop.get('city') or self._extract_city_from_address(prop.get('address', '')),
                'state': 'MN',
                'county': 'Faribault',
                'zip_code': prop.get('zip_code') or prop.get('zipcode'),
                'property_type': prop.get('property_type', 'Residential'),
                'bedrooms': prop.get('bedrooms'),
                'bathrooms': prop.get('bathrooms'),
                'sqft': prop.get('sqft') or prop.get('square_feet'),
                'year_built': prop.get('year_built'),
                'source_url': auction_url,  # Add source URL for spreadsheet
                'auction_details': {
                    'sale_date': prop.get('sale_date') or prop.get('auction_end_date'),
                    'minimum_bid': prop.get('minimum_bid') or prop.get('starting_bid'),
                    'auction_id': prop.get('auction_id'),
                    'auction_url': auction_url,
                }
            }

            normalized.append(canonical_prop)

        # Enrich properties with web scraper data if available
        if self.web_scraper:
            normalized = self._enrich_with_web_scraper(normalized)

        return normalized

    def _enrich_with_web_scraper(self, properties: List[Dict]) -> List[Dict]:
        """
        Enrich properties with data from Zillow Web Scraper.

        Only scrapes properties missing critical data (sqft, beds, baths).
        Adds Zillow URL for verification.

        Args:
            properties: List of property dicts

        Returns:
            Enriched property dicts
        """
        enriched = []

        for prop in properties:
            # Check if property is missing critical data
            missing_sqft = not prop.get('sqft') or prop['sqft'] <= 0
            missing_beds = not prop.get('bedrooms')
            missing_baths = not prop.get('bathrooms')
            missing_year = not prop.get('year_built')

            needs_enrichment = missing_sqft or missing_beds or missing_baths or missing_year

            if needs_enrichment:
                address = prop.get('address', '')
                city = prop.get('city', '')
                state = prop.get('state', 'MN')

                # Skip if address is invalid/placeholder
                if address and city and address not in ['Address TBD', 'TBD', 'UNKNOWN', '']:
                    self.logger.info(f"Enriching {address} from Zillow (missing: sqft={missing_sqft}, beds={missing_beds}, baths={missing_baths}, year={missing_year})")

                    try:
                        zillow_data = self.web_scraper.scrape_zillow_property(address, city, state)

                        if zillow_data:
                            # Fill in missing data from Zillow
                            if missing_sqft and zillow_data.get('sqft'):
                                prop['sqft'] = zillow_data['sqft']
                                self.logger.info(f"  → Added sqft: {zillow_data['sqft']}")

                            if missing_beds and zillow_data.get('bedrooms'):
                                prop['bedrooms'] = zillow_data['bedrooms']
                                self.logger.info(f"  → Added bedrooms: {zillow_data['bedrooms']}")

                            if missing_baths and zillow_data.get('bathrooms'):
                                prop['bathrooms'] = zillow_data['bathrooms']
                                self.logger.info(f"  → Added bathrooms: {zillow_data['bathrooms']}")

                            if missing_year and zillow_data.get('year_built'):
                                prop['year_built'] = zillow_data['year_built']
                                self.logger.info(f"  → Added year_built: {zillow_data['year_built']}")

                            # Add Zillow URL for verification
                            prop['zillow_url'] = zillow_data.get('url')

                            # Add Zestimate if available
                            if zillow_data.get('price_estimate'):
                                prop['zillow_estimate'] = zillow_data['price_estimate']

                    except Exception as e:
                        self.logger.warning(f"Could not enrich {address} from Zillow: {e}")

            enriched.append(prop)

        return enriched

    def _extract_city_from_address(self, address: str) -> str:
        """Extract city from address string if not provided separately."""
        # Simple heuristic: city is usually after last comma
        if ',' in address:
            parts = address.split(',')
            # City is typically second-to-last element (last is state+zip)
            if len(parts) >= 2:
                return parts[-2].strip()
        return ''

    def _update_auction_urls(self, properties: List[Dict]) -> List[Dict]:
        """
        Update properties with individual auction URLs from PublicSurplus.

        Scrapes PublicSurplus to get specific auction listing URLs
        instead of using the homepage URL.

        Args:
            properties: List of property dicts

        Returns:
            Properties with updated auction URLs
        """
        if not self.web_scraper:
            return properties

        self.logger.info("Scraping PublicSurplus for individual auction URLs")

        try:
            # Scrape all auction listings
            listings = self.web_scraper.scrape_publicsurplus_listings("Faribault", "MN")

            if not listings:
                self.logger.warning("No auction listings found on PublicSurplus")
                return properties

            self.logger.info(f"Found {len(listings)} auction listings on PublicSurplus")

            # Match listings to properties by parcel ID or address
            for prop in properties:
                parcel_id = prop.get('parcel_id', '')
                address = prop.get('address', '')

                # Find matching listing
                for listing in listings:
                    listing_parcel = listing.get('parcel_id', '')
                    listing_address = listing.get('address', '')

                    # Match by parcel ID (preferred)
                    if parcel_id and listing_parcel:
                        # Normalize parcel IDs for comparison
                        norm_parcel = parcel_id.replace('-', '').replace('.', '').lower()
                        norm_listing = listing_parcel.replace('-', '').replace('.', '').lower()

                        if norm_parcel == norm_listing:
                            prop['source_url'] = listing['auction_url']
                            if 'auction_details' in prop:
                                prop['auction_details']['auction_url'] = listing['auction_url']
                            self.logger.info(f"Matched {address} to auction {listing['auction_id']}")
                            break

                    # Fallback: match by address similarity
                    if address and listing_address:
                        if address.lower() in listing_address.lower() or listing_address.lower() in address.lower():
                            prop['source_url'] = listing['auction_url']
                            if 'auction_details' in prop:
                                prop['auction_details']['auction_url'] = listing['auction_url']
                            self.logger.info(f"Matched {address} to auction {listing['auction_id']} by address")
                            break

        except Exception as e:
            self.logger.error(f"Error scraping PublicSurplus auction URLs: {e}")

        return properties

    def fetch_properties(self, max_properties: Optional[int] = None) -> List[Dict]:
        """
        Fetch tax forfeiture sale properties from Faribault County.

        Strategy:
        1. Check for pre-scraped JSON in cache
        2. If not available, attempt to scrape PublicSurplus.com
        3. Normalize to standard schema

        Args:
            max_properties: Maximum number of properties to fetch (None = all)

        Returns:
            List of property dicts
        """
        self.logger.info("Fetching Faribault County tax forfeiture sale properties")

        raw_data = self.fetch_raw_data()
        normalized = self.normalize_to_canonical(raw_data)

        # Update with individual auction URLs from PublicSurplus
        # DISABLED: URLs already in scraped_deals_faribault_december.json
        # if self.web_scraper:
        #     normalized = self._update_auction_urls(normalized)

        if max_properties:
            normalized = normalized[:max_properties]

        self.logger.info(f"Loaded {len(normalized)} properties")
        return normalized

    def enrich_property(self, property_data: Dict) -> Dict:
        """
        Enrich a single property with additional data.

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
            'known_liens_count': 1,  # Tax forfeiture = at least 1 lien
            'total_lien_amount': property_data.get('auction_details', {}).get('minimum_bid', 0),
            'estimated_rent_monthly': None,
            'data_quality_score': 50  # Start at medium
        }

        # Get property details
        sqft = property_data.get('sqft', 0)
        city = property_data.get('city', '')
        state = property_data.get('state', 'MN')
        year_built = property_data.get('year_built', 0)
        address = property_data.get('address', '')
        bedrooms = property_data.get('bedrooms')
        bathrooms = property_data.get('bathrooms')

        # Use Apify Zillow Scraper as PRIMARY (and only) data source
        # Cost: $0.0009/property vs Attom's $1.25/property (1000x cheaper)
        comps = []
        if self.apify:
            try:
                self.logger.info(f"Fetching comps for {address} from Apify Zillow")
                apify_comps = self.apify.get_sold_properties(
                    city=city,
                    state_code=state,
                    bedrooms=bedrooms,
                    bathrooms=int(bathrooms) if bathrooms else None,
                    max_price=500000,  # Minnesota rural cap
                    year_built=year_built,
                    limit=10
                )
                if apify_comps:
                    comps = apify_comps
                    self.logger.info(f"Found {len(comps)} comps from Apify Zillow")
            except Exception as e:
                self.logger.warning(f"Error fetching Apify comps: {e}")

        # Note: Attom API removed - expensive ($1.25/property) and unreliable for rural properties
        # Apify has proven sufficient for comp data (Dec 2025 analysis)
        if len(comps) < 3:
            self.logger.warning(f"Only found {len(comps)} comps for {address} - may affect ARV accuracy")

        # Calculate ARV from comps or use rule-based fallback
        if comps and len(comps) > 0:
            # Store all comps for spreadsheet
            enrichment['comps'] = comps

            # Use real comp data
            comp_prices = [c['sale_price'] for c in comps if c.get('sale_price') and c['sale_price'] > 0]
            comp_sqfts = [c['sqft'] for c in comps if c.get('sqft') and c['sqft'] > 0]

            if comp_prices:
                enrichment['median_sale_price'] = sorted(comp_prices)[len(comp_prices) // 2]
                enrichment['comp_count'] = len(comps)

                # Find the closest/most similar comp
                closest_comp = None
                if bedrooms and sqft:
                    # Find comp with most similar beds/sqft/price
                    target_psf = enrichment.get('avg_price_per_sqft') or 120  # Minnesota baseline

                    def comp_similarity(c):
                        score = 0
                        # Bedroom match (weight: 3)
                        if c.get('bedrooms') == bedrooms:
                            score += 3
                        elif abs(c.get('bedrooms', 0) - bedrooms) <= 1:
                            score += 1

                        # Price per sqft similarity (weight: 2)
                        if c.get('sqft') and c.get('sqft') > 0 and target_psf:
                            c_psf = c['sale_price'] / c['sqft']
                            psf_diff = abs(c_psf - target_psf) / target_psf
                            if psf_diff < 0.15:  # Within 15%
                                score += 2
                            elif psf_diff < 0.30:  # Within 30%
                                score += 1

                        return score

                    closest_comp = max(comps, key=comp_similarity)
                else:
                    # Just use first comp
                    closest_comp = comps[0]

                # Store closest comp info
                if closest_comp:
                    # Handle address - could be string or dict
                    address = closest_comp.get('address', 'N/A')
                    if isinstance(address, dict):
                        # Build full address string from dict
                        parts = []
                        if address.get('streetAddress'):
                            parts.append(address['streetAddress'])
                        if address.get('city'):
                            parts.append(address['city'])
                        if address.get('state'):
                            parts.append(address['state'])
                        if address.get('zipcode'):
                            parts.append(str(address['zipcode']))
                        enrichment['best_comp_address'] = ', '.join(parts) if parts else 'N/A'
                    else:
                        enrichment['best_comp_address'] = address

                    enrichment['best_comp_price'] = closest_comp.get('sale_price')
                    enrichment['best_comp_beds'] = closest_comp.get('bedrooms')
                    enrichment['best_comp_baths'] = closest_comp.get('bathrooms')
                    enrichment['best_comp_sqft'] = closest_comp.get('sqft')

                # Calculate avg price per sqft from comps
                if comp_sqfts and len(comp_sqfts) == len(comp_prices):
                    price_per_sqfts = [p / s for p, s in zip(comp_prices, comp_sqfts)]
                    avg_psf = sum(price_per_sqfts) / len(price_per_sqfts)
                    enrichment['avg_price_per_sqft'] = round(avg_psf, 2)

                    # Calculate ARV using comp avg PSF
                    arv_estimate = sqft * avg_psf
                    enrichment['arv_estimate'] = round(arv_estimate, 2)
                    enrichment['avm_value'] = round(arv_estimate * 0.95, 2)  # High confidence AVM
                    enrichment['data_quality_score'] = 95  # High quality - has real comps
                    enrichment['avm_confidence'] = 'high'
                else:
                    # Use median sale price as estimate
                    enrichment['arv_estimate'] = enrichment['median_sale_price']
                    enrichment['avm_value'] = round(enrichment['median_sale_price'] * 0.90, 2)
                    enrichment['data_quality_score'] = 85
                    enrichment['avm_confidence'] = 'medium'

        # Fallback to rule-based if no comps (Minnesota-specific pricing)
        if not enrichment.get('arv_estimate') and sqft > 0:
            # Minnesota rural/small town baseline: $100-140/sqft for renovated properties
            base_psf = 120

            # City adjustments (major MN cities near Faribault County)
            city_lower = city.lower()
            if 'mankato' in city_lower:
                base_psf = 130
            elif 'owatonna' in city_lower:
                base_psf = 125
            elif 'faribault' in city_lower:
                base_psf = 115
            elif 'waseca' in city_lower:
                base_psf = 110
            else:
                # Small towns/rural
                base_psf = 100

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

        # Estimate rent for rental strategy (Minnesota rents are lower than GA)
        if enrichment['arv_estimate']:
            rent_estimate = enrichment['arv_estimate'] * 0.007  # 0.7% of ARV (lower than GA)
            enrichment['estimated_rent_monthly'] = round(rent_estimate, 2)

        # City-based crime scoring (simplified - Minnesota cities)
        crime_zones = {
            'mankato': 35,
            'owatonna': 30,
            'faribault': 40,
            'waseca': 25,
            'blue earth': 20,
            'wells': 20,
            'minnesota lake': 15
        }

        city_lower = city.lower()
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

    def validate(self, property_data: Dict) -> bool:
        """
        Validate that property data meets minimum requirements.

        Args:
            property_data: Property dict

        Returns:
            True if valid, False otherwise
        """
        required_fields = ['parcel_id', 'address', 'city', 'state', 'county']

        for field in required_fields:
            if not property_data.get(field):
                self.logger.warning(f"Property missing required field: {field}")
                return False

        # Must have auction details for tax forfeiture sale
        if 'auction_details' not in property_data:
            self.logger.warning("Property missing auction_details")
            return False

        return True

    def fetch_and_enrich(self, max_properties: Optional[int] = None) -> List[Dict]:
        """
        Fetch properties and enrich them in one call.

        Args:
            max_properties: Maximum number of properties to process

        Returns:
            List of enriched property dicts
        """
        properties = self.fetch_properties(max_properties)

        enriched = []
        for prop in properties:
            if not self.validate(prop):
                self.logger.warning(f"Skipping invalid property: {prop.get('parcel_id', 'unknown')}")
                continue

            enriched_prop = self.enrich_property(prop)
            enriched.append(enriched_prop)

        self.logger.info(f"Enriched {len(enriched)} properties")
        return enriched


def fetch_faribault_county_deals(max_properties: Optional[int] = None) -> List[Dict]:
    """
    Convenience function to fetch and enrich Faribault County deals.

    Args:
        max_properties: Maximum number of properties to fetch

    Returns:
        List of enriched property dicts ready for orchestrator
    """
    connector = FaribaultCountyConnector()
    return connector.fetch_and_enrich(max_properties)
