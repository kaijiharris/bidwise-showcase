"""Fulton County, GA tax deed sale connector.

Scrapes property listings from Fulton County Sheriff's tax sale PDFs and web sources.
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


class FultonCountyConnector(BaseConnector):
    """
    Connector for Fulton County, GA tax deed sales.

    Data Sources:
    1. Fulton County Sheriff's Office PDF listings
    2. County property assessor lookups for enrichment
    3. Online auction portals (if available)
    """

    BASE_URL = "https://fultoncountyga.gov"
    SHERIFF_TAX_SALES_URL = f"{BASE_URL}/inside-fulton-county/fulton-county-departments/sheriff/tax-sales"
    ASSESSOR_BASE = "https://www.qpublic.net/ga/fulton"

    def __init__(self, cache_dir: Optional[Path] = None):
        """
        Initialize Fulton County connector.

        Args:
            cache_dir: Directory to cache downloaded PDFs and data
        """
        super().__init__()
        self.cache_dir = cache_dir or Path(".tmp/fulton_county_cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.logger = logger.bind(connector='FultonCounty')

        # Initialize Apify as primary data source (1000x cheaper than Attom)
        self.apify = None
        if APIFY_AVAILABLE:
            try:
                self.apify = ApifyZillowComps()
                self.logger.info("Apify Zillow fallback initialized successfully")
            except Exception as e:
                self.logger.warning(f"Could not initialize Apify: {e}")

    def fetch_raw_data(self) -> List[Dict]:
        """
        Fetch raw property data from Fulton County sources.

        For MVP, loads from cached JSON file.

        Returns:
            List of raw property dicts
        """
        sample_data_path = Path("scraped_deals.json")
        if sample_data_path.exists():
            self.logger.info(f"Loading cached property data from {sample_data_path}")
            with open(sample_data_path, 'r') as f:
                properties = json.load(f)
            return properties

        self.logger.warning("No cached data found")
        return []

    def normalize_to_canonical(self, raw_data: List[Dict]) -> List[Dict]:
        """
        Normalize Fulton County data to canonical schema.

        Args:
            raw_data: Raw property dicts from source

        Returns:
            Normalized property dicts
        """
        # Fulton County data is already in canonical format
        return raw_data

    def fetch_properties(self, max_properties: Optional[int] = None) -> List[Dict]:
        """
        Fetch tax deed sale properties from Fulton County.

        Strategy:
        1. Check for pre-scraped JSON in cache
        2. If not available, look for PDF listings on sheriff's site
        3. Parse PDF or scrape web portal
        4. Normalize to standard schema

        Args:
            max_properties: Maximum number of properties to fetch (None = all)

        Returns:
            List of property dicts
        """
        self.logger.info("Fetching Fulton County tax deed sale properties")

        # For MVP, check if we have cached/sample data
        sample_data_path = Path("scraped_deals.json")
        if sample_data_path.exists():
            self.logger.info(f"Loading cached property data from {sample_data_path}")
            with open(sample_data_path, 'r') as f:
                properties = json.load(f)

            if max_properties:
                properties = properties[:max_properties]

            self.logger.info(f"Loaded {len(properties)} properties from cache")
            return properties

        # If no cache, attempt to scrape live data
        self.logger.warning("No cached data found. Live scraping not yet fully implemented.")
        self.logger.info("For autonomous operation, ensure scraped_deals.json is populated or implement PDF/web scraping.")

        return []

    def enrich_property(self, property_data: Dict) -> Dict:
        """
        Enrich a single property with additional data from county assessor.

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
            'known_liens_count': 1,  # Tax deed = at least 1 lien
            'total_lien_amount': property_data.get('auction_details', {}).get('minimum_bid', 0),
            'estimated_rent_monthly': None,
            'data_quality_score': 50  # Start at medium
        }

        # Get real comps from Attom API (REMOVED - Using Apify)
        sqft = property_data.get('sqft', 0)
        city = property_data.get('city', '')
        state = property_data.get('state', 'GA')
        address = property_data.get('address', '')
        
        # New: Lookup subject property details if missing (Proxy for County Scraping)
        if (not sqft or sqft == 0) and self.apify:
            try:
                full_address = f"{address}, {city}, {state}"
                self.logger.info(f"Missing details for {full_address}, performing lookup...")
                details = self.apify.lookup_property(full_address)
                
                if details:
                    if details.get('sqft'):
                        property_data['sqft'] = details['sqft']
                        sqft = details['sqft']
                        self.logger.info(f"  → Added sqft: {sqft}")
                    
                    if details.get('bedrooms'):
                        property_data['bedrooms'] = details['bedrooms']
                        self.logger.info(f"  → Added bedrooms: {details['bedrooms']}")
                        
                    if details.get('bathrooms'):
                        property_data['bathrooms'] = details['bathrooms']
                        self.logger.info(f"  → Added bathrooms: {details['bathrooms']}")
                        
                    if details.get('year_built'):
                        property_data['year_built'] = details['year_built']
                        self.logger.info(f"  → Added year_built: {details['year_built']}")
            except Exception as e:
                self.logger.warning(f"Error looking up subject property: {e}")

        year_built = property_data.get('year_built', 0)
        bedrooms = property_data.get('bedrooms')
        bathrooms = property_data.get('bathrooms')

        # Use Apify Zillow as primary (and only) data source
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
                    max_price=800000,  # Residential cap
                    limit=10
                )
                if apify_comps:
                    comps = apify_comps
                    self.logger.info(f"Found {len(comps)} comps from Apify Zillow")
            except Exception as e:
                self.logger.warning(f"Error fetching Apify comps: {e}")

        if len(comps) < 3:
            self.logger.warning(f"Only found {len(comps)} comps for {address} - may affect ARV accuracy")

        # Calculate ARV from comps or use rule-based fallback
        if comps and len(comps) > 0:
            # Use real comp data
            comp_prices = [c['sale_price'] for c in comps if c.get('sale_price') and c['sale_price'] > 0]
            comp_sqfts = [c['sqft'] for c in comps if c.get('sqft') and c['sqft'] > 0]

            if comp_prices:
                enrichment['median_sale_price'] = sorted(comp_prices)[len(comp_prices) // 2]
                enrichment['comp_count'] = len(comps)

                # Find the closest/most similar comp (by price similarity if no sqft, or by PSF similarity if sqft available)
                closest_comp = None
                if bedrooms and sqft:
                    # Find comp with most similar beds/sqft/price
                    target_psf = enrichment.get('avg_price_per_sqft') or 180

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

        # Fallback to rule-based if no comps
        if not enrichment.get('arv_estimate') and sqft > 0:
            # Atlanta metro average: $150-200/sqft for renovated properties
            base_psf = 175

            # City adjustments
            if 'atlanta' in city.lower():
                base_psf = 180
            elif 'sandy springs' in city.lower():
                base_psf = 200
            elif city.lower() in ['palmetto', 'fairburn', 'union city']:
                base_psf = 140

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

        # Estimate rent for rental strategy (rule of thumb: 0.8-1% of value per month)
        if enrichment['arv_estimate']:
            rent_estimate = enrichment['arv_estimate'] * 0.009  # 0.9% of ARV
            enrichment['estimated_rent_monthly'] = round(rent_estimate, 2)

        # City-based crime scoring (simplified)
        crime_zones = {
            'atlanta': 55,
            'sandy springs': 25,
            'alpharetta': 20,
            'roswell': 30,
            'palmetto': 45,
            'college park': 65,
            'east point': 60,
            'union city': 50,
            'fairburn': 45
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

        # Must have source details
        if 'auction_details' not in property_data and \
           'tax_lien_details' not in property_data and \
           'otc_details' not in property_data:
            self.logger.warning("Property missing source details (auction/lien/otc)")
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


def fetch_fulton_county_deals(max_properties: Optional[int] = None) -> List[Dict]:
    """
    Convenience function to fetch and enrich Fulton County deals.

    Args:
        max_properties: Maximum number of properties to fetch

    Returns:
        List of enriched property dicts ready for orchestrator
    """
    connector = FultonCountyConnector()
    return connector.fetch_and_enrich(max_properties)
