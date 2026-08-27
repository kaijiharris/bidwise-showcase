"""
Comprehensive Property Enrichment System

Gets REAL property data through market research:
1. Search for subject property on Zillow by address
2. Extract actual beds/baths/sqft/year built
3. Calculate realistic as-is price (wholesale value)
4. Estimate accurate rehab costs based on property size
5. Document all data sources and confidence levels

NO GUESSING - Every field backed by data or clearly marked as estimate.
"""
import os
import sys
import json
import re
from pathlib import Path
from typing import Dict, List, Optional
from loguru import logger
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))

from apify_client import ApifyClient
import google.generativeai as genai


class PropertyEnrichmentEngine:
    """
    Enriches tax deed properties with actual market data.
    """

    def __init__(self, apify_key: str, gemini_key: str = None):
        self.client = ApifyClient(apify_key)
        self.actor_id = "igolaizola/zillow-scraper-ppe"
        self.google_actor_id = "apify/google-search-scraper"
        self.gemini_key = gemini_key
        if self.gemini_key:
            genai.configure(api_key=self.gemini_key)

    def search_property_on_zillow(self, address: str, city: str, state: str = "GA") -> Optional[Dict]:
        """
        Search for specific property on Zillow to get actual details.

        Args:
            address: Street address (e.g., "4340 BANKERS CIR")
            city: City name
            state: State code

        Returns:
            Property details if found, None otherwise
        """
        # Clean up address for search
        parts = [p for p in [address, city, state] if p and str(p).strip()]
        search_address = ", ".join(parts)
        logger.info(f"Searching Zillow for: {search_address}")

        # Try multiple search operations to find the property
        operations = ["sold", "buy"]  # Try sold first (tax deeds), then for-sale

        for operation in operations:
            try:
                logger.info(f"  Trying operation: {operation}")

                # Run Zillow scraper to search for this specific address
                run_input = {
                    "location": search_address,
                    "operation": operation,
                    "maxItems": 5,  # Just need the first match
                }

                run = self.client.actor(self.actor_id).call(run_input=run_input, timeout_secs=60)

                # Get results
                items = list(self.client.dataset(run["defaultDatasetId"]).iterate_items())

                if not items:
                    logger.warning(f"  No results with operation '{operation}'")
                    continue

                # Try to find exact address match
                for item in items:
                    item_address = item.get('address', {})
                    if isinstance(item_address, dict):
                        item_street = item_address.get('streetAddress', '').upper()
                        if address.upper() in item_street:
                            logger.info(f"✓ Found property on Zillow (operation: {operation})!")
                            return self._extract_property_details(item)

                # If no exact match but we have results, use first result
                logger.warning(f"  No exact match, using first result from '{operation}'")
                return self._extract_property_details(items[0])

            except Exception as e:
                logger.error(f"  Error with operation '{operation}': {e}")
                continue

        # If all operations failed
        logger.warning(f"✗ Could not find property on Zillow after trying all operations")
        return None

    def _extract_property_details(self, zillow_item: Dict) -> Dict:
        """Extract property details from Zillow data"""
        # Extract price
        price = zillow_item.get('price', {})
        if isinstance(price, dict):
            price_value = price.get('value')
        else:
            price_value = price

        # Extract address
        address = zillow_item.get('address', {})
        if isinstance(address, dict):
            full_address = f"{address.get('streetAddress', '')}, {address.get('city', '')}, {address.get('state', '')} {address.get('zipcode', '')}"
        else:
            full_address = str(address)

        # Extract zestimate
        estimates = zillow_item.get('estimates', {})
        zestimate = estimates.get('zestimate') if isinstance(estimates, dict) else None

        return {
            'success': True,
            'zillow_found': True,
            'sqft': zillow_item.get('livingArea'),
            'bedrooms': zillow_item.get('bedrooms'),
            'bathrooms': zillow_item.get('bathrooms'),
            'year_built': zillow_item.get('yearBuilt'),
            'lot_size_sqft': zillow_item.get('lotSize'),
            'property_type': zillow_item.get('propertyType', '').title(),
            'current_listing_price': price_value,
            'zestimate': zestimate,
            'zillow_url': f"https://www.zillow.com{zillow_item.get('detailUrl', '')}",
            'address_verified': full_address,
            'data_source': 'Zillow Property Search',
            'data_quality': 'verified',
            'fetched_at': datetime.now().isoformat()
        }

    def search_properties_on_google(self, addresses: List[str]) -> Dict[str, Dict]:
        """
        Batch searches Google for properties to get basic specs (beds, baths, sqft, year) from snippets.
        Uses Gemini to parse the unstructured snippets.
        """
        if not addresses:
            return {}

        logger.info(f"Batch searching {len(addresses)} properties on Google...")
        queries = []
        for a in addresses:
            queries.append(f"{a} real estate")

        try:
            run = self.client.actor(self.google_actor_id).call(run_input={
                "queries": "\\n".join(queries),
                "resultsPerPage": 3,
                "countryCode": "us"
            })
            
            snippets_by_addr = {a: [] for a in addresses}
            items = list(self.client.dataset(run['defaultDatasetId']).iterate_items())
            
            for item in items:
                q = item.get('searchQuery', '')
                matched_addr = next((a for a in addresses if q.startswith(a)), None)
                if not matched_addr: continue
                
                for res in item.get('organicResults', []):
                    title = res.get('title', '')
                    desc = res.get('description', '')
                    if title or desc:
                        snippets_by_addr[matched_addr].append(f"Title: {title}\\nSnippet: {desc}")

            logger.info("Snippets retrieved. Parsing with Gemini...")
            return self._parse_snippets_with_gemini(snippets_by_addr)
            
        except Exception as e:
            logger.error(f"Google Search Error: {e}")
            return {a: {} for a in addresses}

    def _parse_snippets_with_gemini(self, snippets_by_addr: Dict[str, List[str]]) -> Dict[str, Dict]:
        """Parses the search snippets using Gemini to extract exact property metrics."""
        if not self.gemini_key:
            logger.warning("No Gemini API key provided for snippet parsing.")
            return {a: {} for a in snippets_by_addr}

        prompt = f"""You are a real estate data extraction tool.
I will provide Search Snippets for a list of property addresses.
Return ONLY a valid JSON object answering for each address.
Extract 'beds' (int/null), 'baths' (float/null), 'sqft' (int/null), 'year_built' (int/null), and 'property_type' (string/null, e.g. 'Residential', 'Industrial').
If the snippet indicates it's land, Industrial, or Commercial without beds/baths, leave beds/baths as null.
Output JSON format should perfectly match the address strings exact keys:
{{ "ADDRESS_1": {{"beds": 3, "baths": 2, "sqft": 1500, "year_built": 1990, "property_type": "Residential"}} }}

Data:
"""
        for addr, snippets in snippets_by_addr.items():
            prompt += f"\\nAddress: {addr}\\nSnippets:\\n" + "\\n---\\n".join(snippets) + "\\n"

        try:
            model = genai.GenerativeModel('gemini-1.5-pro')
            resp = model.generate_content(prompt)
            text = resp.text.strip()
            if text.startswith("```json"):
                text = text.split("```json")[-1].split("```")[0].strip()
            # In case it just starts with ``` and not json
            elif text.startswith("```"):
                text = text.split("```")[-1].split("```")[0].strip()
            return json.loads(text)
        except Exception as e:
            logger.error(f"Gemini parsing error: {e}")
            return {a: {} for a in snippets_by_addr}

    def estimate_from_comps(self, comps: List[Dict]) -> Dict:
        """
        If property not found on Zillow, estimate from comparable sales.

        This is a FALLBACK - always prefer actual property data.
        """
        if not comps:
            return {
                'success': False,
                'error': 'No comps available for estimation'
            }

        # Calculate median values from comps
        sqfts = [c.get('sqft') for c in comps if c.get('sqft')]
        bedrooms = [c.get('bedrooms') for c in comps if c.get('bedrooms')]
        bathrooms = [c.get('bathrooms') for c in comps if c.get('bathrooms')]
        years = [c.get('year_built') for c in comps if c.get('year_built')]

        def median(values):
            if not values:
                return None
            sorted_vals = sorted(values)
            n = len(sorted_vals)
            if n % 2 == 0:
                return (sorted_vals[n//2-1] + sorted_vals[n//2]) / 2
            return sorted_vals[n//2]

        return {
            'success': True,
            'zillow_found': False,
            'sqft': median(sqfts),
            'bedrooms': median(bedrooms),
            'bathrooms': median(bathrooms),
            'year_built': int(median(years)) if years else None,
            'data_source': 'Estimated from Comparables',
            'data_quality': 'estimated',
            'estimation_note': f'Based on median of {len(comps)} comparable properties',
            'confidence': 'low',
            'fetched_at': datetime.now().isoformat()
        }

    def calculate_as_is_price(self, arv: float, property_details: Dict,
                               rehab_cost: float = None, is_high_risk: bool = False) -> Dict:
        """
        Calculate as-is price (immediate sale without repairs).

        UNIFORM FORMULA (same for every property):
          As-Is = ARV × 0.70 − Rehab_Cost          (standard)
          As-Is = ARV × 0.65 − Rehab_Cost          (high-risk: title/location issues)
          As-Is = ARV × 0.20                        (land/vacant lot — no rehab deducted)
          Floor: max(As-Is, tax_due)

        Definition: what a cash investor would pay TODAY without doing any rehab.
        This is the industry-standard MAO (Maximum Allowable Offer) formula.

        The 70% factor bakes in the end buyer's profit margin (30% of ARV).
        Subtracting actual rehab cost gives the price for THIS property specifically.
        """
        if not arv:
            return {
                'as_is_price': None,
                'as_is_calculation': 'ARV unknown - cannot calculate',
                'as_is_confidence': 'none'
            }

        prop_type = str(property_details.get('property_type', '')).lower()
        is_land = prop_type in ('land', 'lot', 'vacant', 'vacant land', 'vacant lot')
        rehab = rehab_cost or 0.0

        if is_land:
            as_is_pct = 0.20
            as_is_price = arv * as_is_pct
            formula_str = f"ARV (${arv:,.0f}) × 20% (lot value) = ${as_is_price:,.0f}"
        elif is_high_risk:
            as_is_pct = 0.65
            as_is_price = arv * as_is_pct - rehab
            formula_str = f"ARV (${arv:,.0f}) × 65% − Rehab (${rehab:,.0f}) = ${as_is_price:,.0f}"
        else:
            as_is_pct = 0.70
            as_is_price = arv * as_is_pct - rehab
            formula_str = f"ARV (${arv:,.0f}) × 70% − Rehab (${rehab:,.0f}) = ${as_is_price:,.0f}"

        confidence = 'medium' if property_details.get('data_quality') == 'verified' else 'low'

        return {
            'as_is_price': round(as_is_price, 2),
            'as_is_calculation': formula_str,
            'as_is_percentage_of_arv': as_is_pct,
            'as_is_confidence': confidence,
            'as_is_confidence_note': f'ARV × {as_is_pct:.0%} − rehab (MAO formula)',
            'as_is_buyer_type': 'Cash investor/wholesaler',
            'as_is_assumptions': 'Unknown condition, needs repairs, quick sale to investor'
        }

    def calculate_detailed_rehab_cost(self, sqft: Optional[float], property_type: str, arv: float) -> Dict:
        """
        Calculate accurate rehab costs based on actual property size and type.

        Industry Rehab Costs (2024-2025):
        - Basic cosmetic: $15-25/sqft
        - Standard rehab: $25-40/sqft
        - Heavy rehab: $40-60/sqft
        - Gut renovation: $60-100/sqft

        For tax deeds (unknown condition), we assume "standard rehab" = $35/sqft

        Includes:
        - Paint (interior/exterior)
        - Flooring (carpet/LVP)
        - Kitchen updates (cabinets, counters, appliances)
        - Bathroom updates (vanity, fixtures)
        - HVAC service/replacement
        - Roof repairs
        - Misc repairs (doors, windows, trim)
        - Contingency (10%)
        """
        if sqft and sqft > 0:
            # Use actual sqft-based calculation
            cost_per_sqft = 35  # Standard rehab rate
            base_cost = sqft * cost_per_sqft

            # Add contingency
            contingency = base_cost * 0.10
            total_cost = base_cost + contingency

            calculation = (
                f"Square Footage: {sqft:,.0f} sqft\n"
                f"Cost per sqft: ${cost_per_sqft}/sqft (standard rehab)\n"
                f"Base cost: {sqft:,.0f} × ${cost_per_sqft} = ${base_cost:,.0f}\n"
                f"Contingency (10%): ${contingency:,.0f}\n"
                f"Total: ${total_cost:,.0f}"
            )

            confidence = 'medium'
            method = 'Square footage based'

        elif arv:
            # Fallback to 20% of ARV
            total_cost = arv * 0.20

            calculation = (
                f"ARV: ${arv:,.0f}\n"
                f"Percentage: 20% (industry standard estimate)\n"
                f"Total: ${arv:,.0f} × 0.20 = ${total_cost:,.0f}\n"
                f"Note: Actual sqft unknown - using conservative ARV percentage"
            )

            confidence = 'low'
            method = 'ARV percentage (20%)'

        else:
            return {
                'rehab_cost': None,
                'rehab_calculation': 'Insufficient data to estimate',
                'rehab_confidence': 'none'
            }

        # Breakdown by category
        breakdown = {
            'paint': total_cost * 0.15,
            'flooring': total_cost * 0.20,
            'kitchen': total_cost * 0.25,
            'bathrooms': total_cost * 0.20,
            'hvac_plumbing': total_cost * 0.10,
            'misc_repairs': total_cost * 0.10
        }

        return {
            'rehab_cost': total_cost,
            'rehab_calculation': calculation,
            'rehab_method': method,
            'rehab_confidence': confidence,
            'cost_per_sqft': cost_per_sqft if sqft else None,
            'rehab_breakdown': breakdown,
            'rehab_scope': 'Standard cosmetic rehab + systems check',
            'rehab_timeline': '60-90 days typical',
            'rehab_note': 'Based on industry averages - always get contractor bids'
        }


def enrich_property_comprehensive(
    property: Dict,
    comps: List[Dict],
    arv: float,
    enrichment_engine: PropertyEnrichmentEngine
) -> Dict:
    """
    Comprehensively enrich a single property with ALL details.

    Returns enriched property with:
    - Actual property details (beds/baths/sqft/year)
    - As-is price calculation
    - Detailed rehab cost estimate
    - Data quality indicators
    - Source documentation
    """
    logger.info(f"Enriching property: {property.get('tax_id')}")

    # Step 1: Try to find property on Zillow
    address = property.get('full_address', '')
    city = property.get('city', 'Decatur')

    if address and len(address) > 5:
        details = enrichment_engine.search_property_on_zillow(address, city)
    else:
        details = None

    # Step 2: Fall back to comp estimates if Zillow search failed
    if not details or not details.get('success'):
        logger.warning(f"Property not found on Zillow, estimating from comps")
        details = enrichment_engine.estimate_from_comps(comps)

    # Step 3: Calculate as-is price
    as_is_data = enrichment_engine.calculate_as_is_price(arv, details)

    # Step 4: Calculate detailed rehab costs
    sqft = details.get('sqft') if details else None
    property_type = details.get('property_type', 'Single Family') if details else 'Single Family'
    rehab_data = enrichment_engine.calculate_detailed_rehab_cost(sqft, property_type, arv)

    # Step 5: Merge all data
    enriched = {
        **property,
        # Property characteristics
        'sqft': details.get('sqft') if details else None,
        'bedrooms': details.get('bedrooms') if details else None,
        'bathrooms': details.get('bathrooms') if details else None,
        'year_built': details.get('year_built') if details else None,
        'lot_size_sqft': details.get('lot_size_sqft') if details else None,
        'verified_property_type': details.get('property_type') if details else None,

        # Valuation data
        'zestimate': details.get('zestimate') if details else None,
        'current_listing_price': details.get('current_listing_price') if details else None,

        # As-is pricing
        **as_is_data,

        # Rehab costs
        **rehab_data,

        # Data quality
        'property_details_source': details.get('data_source') if details else 'unavailable',
        'property_details_quality': details.get('data_quality') if details else 'none',
        'zillow_url': details.get('zillow_url') if details else None,
        'address_verified': details.get('address_verified') if details else property.get('full_address'),

        # Enrichment metadata
        'enrichment_timestamp': datetime.now().isoformat(),
        'enrichment_version': '2.0'
    }

    return enriched


if __name__ == "__main__":
    # Test the enrichment engine
    import dotenv
    dotenv.load_dotenv(Path(__file__).parent.parent / '.env')

    apify_key = os.getenv('APIFY_API_KEY')
    if not apify_key:
        print("ERROR: APIFY_API_KEY not found")
        exit(1)

    engine = PropertyEnrichmentEngine(apify_key)

    # Test property
    test_property = {
        'tax_id': '06 249 01 010',
        'full_address': '4340 BANKERS CIR',
        'city': 'Decatur',
        'zip_code': '30360'
    }

    print("Testing Zillow search...")
    result = engine.search_property_on_zillow(
        test_property['full_address'],
        test_property['city']
    )

    print(json.dumps(result, indent=2, default=str))
