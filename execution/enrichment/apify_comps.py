"""
Apify Zillow Scraper integration for comparable sales data.

Uses Apify's Zillow Scraper actor to get sold property comps.
Better alternative to RapidAPI - you already have the key!
"""
import os
import sys
from typing import Dict, List, Optional
from loguru import logger
from pathlib import Path

# Allow running standalone as well as via the pipeline package
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from execution.utils.apify_budget import check_apify_budget
from execution.utils.comps_cache import load_cached_items, save_cached_items

# City sweeps request this many sold items (actor bills ~$0.0009/result, so a
# full sweep costs ~$0.45). Tune with APIFY_MAX_ITEMS; ZIP-scoped sweeps cover
# a far smaller market and default to the cheaper APIFY_MAX_ITEMS_ZIP.
DEFAULT_MAX_ITEMS = 500
DEFAULT_MAX_ITEMS_ZIP = 150


def _max_items(zip_scoped: bool) -> int:
    var = "APIFY_MAX_ITEMS_ZIP" if zip_scoped else "APIFY_MAX_ITEMS"
    default = DEFAULT_MAX_ITEMS_ZIP if zip_scoped else DEFAULT_MAX_ITEMS
    try:
        return max(1, int(os.getenv(var, str(default))))
    except ValueError:
        return default


try:
    from apify_client import ApifyClient
    APIFY_CLIENT_AVAILABLE = True
except ImportError:
    APIFY_CLIENT_AVAILABLE = False
    logger.warning("apify-client not installed. Run: pip install apify-client")


# Load API key manually
def _load_apify_key():
    """Load Apify API key from env."""
    if os.getenv('APIFY_API_KEY'):
        return os.getenv('APIFY_API_KEY')

    env_paths = [
        Path(__file__).parent.parent.parent / '.env',
        Path(__file__).parent.parent.parent.parent / '.env'
    ]

    for env_path in env_paths:
        if env_path.exists():
            try:
                with open(env_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith('APIFY_API_KEY='):
                            key = line.split('=', 1)[1].strip()
                            return key
            except Exception as e:
                logger.warning(f"Error reading {env_path}: {e}")

    return None


if not os.getenv('APIFY_API_KEY'):
    api_key = _load_apify_key()
    if api_key:
        os.environ['APIFY_API_KEY'] = api_key


class ApifyZillowComps:
    """
    Client for Apify Zillow Scraper.

    Scrapes sold property data from Zillow for comparable sales.
    Cost: $0.9 per 1000 results (cheaper than RapidAPI!)
    """

    # Correct actor ID from the example you provided
    ACTOR_ID = "igolaizola/zillow-scraper-ppe"

    def __init__(self):
        """Initialize Apify client."""
        self.api_key = os.getenv('APIFY_API_KEY')

        if not self.api_key:
            logger.warning("APIFY_API_KEY not found - Apify comps unavailable")
            raise ValueError("APIFY_API_KEY not found in environment variables")

        if not APIFY_CLIENT_AVAILABLE:
            raise ImportError("apify-client not installed. Run: pip install apify-client")

        # Initialize Apify client
        self.client = ApifyClient(self.api_key)

        # Cache for comp results to avoid repeated calls for same location
        self._comp_cache = {}

        self.logger = logger.bind(service='ApifyZillow')
        self.logger.info("Apify Zillow Scraper initialized successfully")

    def get_sold_properties(
        self,
        city: str,
        state_code: str,
        bedrooms: Optional[int] = None,
        bathrooms: Optional[int] = None,
        max_price: Optional[int] = None,
        year_built: Optional[int] = None,
        limit: int = 25,
        zip_code: Optional[str] = None,
    ):
        """
        Get recently sold properties from Zillow via Apify.

        Args:
            city: City name (e.g., "Atlanta")
            state_code: State code (e.g., "GA")
            bedrooms: Number of bedrooms (not applied at city level — filtering done downstream)
            bathrooms: Number of bathrooms (not applied at city level — filtering done downstream)
            max_price: Maximum sale price
            limit: Max results to return in the city-level pool
            zip_code: Optional ZIP to scope the sweep (Zillow accepts ZIPs as
                search locations) — a ZIP sweep requests ~150 items instead of
                500, cutting the per-sweep cost ~70% for targeted refreshes.

        Returns:
            Tuple of (comps: List[Dict], window_months: int)
            window_months is 12 or 24 depending on data availability.
        """
        try:
            # Build search location — a bare ZIP is a valid Zillow search and
            # scopes the sold sweep to one submarket.
            location = f"{zip_code}, {state_code}" if zip_code else f"{city}, {state_code}"

            # Cache at CITY/ZIP level (not per property) to avoid repeated API
            # calls. We'll filter the cached results per property's criteria.
            cache_key = location

            # If we have cached RAW data for this city, use it
            from datetime import datetime, timedelta

            if cache_key in self._comp_cache:
                self.logger.info(f"Using cached Apify data for {location}")
                raw_items = self._comp_cache[cache_key]
            elif (disk_items := load_cached_items("apify", city, state_code, zip_code=zip_code)) is not None:
                # Comp store of record (90d fresh / 180d aged tiers) — repeat
                # runs within an auction cycle must not re-buy the same city
                # (2026-07-05 hard-limit incident; 2026-07-12 recycle directive).
                raw_items = disk_items
                self._comp_cache[cache_key] = raw_items
            else:
                # Fresh actor run = real spend. Re-check the monthly budget at
                # fetch time (not just run start): a session that starts under
                # the 90% block can cross it mid-run. Refusal degrades this
                # city to the next chain layer instead of spending.
                if not check_apify_budget(self.api_key).ok:
                    self.logger.error(
                        f"Apify budget guard refused a fresh sweep for {location} "
                        f"— degrading to the next comps layer (store/free sources)."
                    )
                    return [], 0  # failure sentinel: lets the chain continue

                self.logger.info(f"Starting Apify Zillow scraper for {location} (NOT cached)")

                # Build Zillow search input for SOLD properties
                # NOTE: This actor searches Zillow's "Recently Sold" section
                actor_input = {
                    "location": location,
                    "operation": "sold",  # Get sold properties (not for sale!)
                    "maxItems": _max_items(zip_scoped=bool(zip_code)),
                    "sortBy": "newest",  # Get most recent sold properties
                    "maxSoldDate": "1y"  # Request 1 year (we'll filter to 6mo, expand if needed)
                }

                # Run the actor and wait for it to finish
                run = self.client.actor(self.ACTOR_ID).call(run_input=actor_input)

                self.logger.info(f"Apify run completed, fetching results...")

                # Fetch results from dataset and cache the RAW items for this city
                raw_items = list(self.client.dataset(run["defaultDatasetId"]).iterate_items())
                self._comp_cache[cache_key] = raw_items  # Cache raw items, not filtered results
                save_cached_items("apify", city, state_code, raw_items, zip_code=zip_code)
                self.logger.info(f"Cached {len(raw_items)} raw items for {location}")

            def process_and_filter_items(items, months_back):
                """Process raw Zillow items and filter by criteria."""
                filtered_comps = []
                today = datetime.now()  # FIX: Use current date, not hardcoded date
                cutoff_date = today - timedelta(days=months_back * 30)

                for item in items:
                    # Extract sale price - handle dict format from Zillow
                    price = item.get('price') or item.get('soldPrice')
                    if isinstance(price, dict):
                        price = price.get('price') or price.get('value') or price.get('amount')

                    # Extract bedrooms/bathrooms similarly
                    item_bedrooms = item.get('bedrooms') or item.get('beds')
                    if isinstance(item_bedrooms, dict):
                        item_bedrooms = item_bedrooms.get('value') or item_bedrooms.get('count')

                    item_bathrooms = item.get('bathrooms') or item.get('baths')
                    if isinstance(item_bathrooms, dict):
                        item_bathrooms = item_bathrooms.get('value') or item_bathrooms.get('count')

                    sqft = item.get('livingArea') or item.get('area')
                    if isinstance(sqft, dict):
                        sqft = sqft.get('value') or sqft.get('size')

                    # CRITICAL: Skip active listings (we only want sold properties!)
                    listing_status = item.get('listing', {}).get('listingStatus') or item.get('hdpView', {}).get('listingStatus')
                    # Accept both 'sold' and 'recentlySold' statuses (Zillow uses both)
                    if listing_status and 'sold' not in listing_status.lower():
                        continue

                    # Format address - handle dict format
                    address = item.get('address', 'Unknown')
                    if isinstance(address, dict):
                        street = address.get('streetAddress', '')
                        city = address.get('city', '')
                        state = address.get('state', '')
                        zipcode = address.get('zipcode', '')
                        address = f"{street}, {city}, {state} {zipcode}".strip(', ')

                    comp = {
                        'address': address,
                        'sale_price': price,
                        'sale_date': item.get('dateSold') or item.get('lastSoldDate'),
                        'bedrooms': item_bedrooms,
                        'bathrooms': item_bathrooms,
                        'sqft': sqft,
                        'year_built': item.get('yearBuilt'),
                        # Pin coordinates for the dashboard comps map (2026-07-05)
                        'latitude': (item.get('location') or {}).get('latitude'),
                        'longitude': (item.get('location') or {}).get('longitude'),
                        'distance_miles': None,
                        'source': 'Zillow Scraper'
                    }

                    # Filter: must have sale price
                    if not comp['sale_price'] or not isinstance(comp['sale_price'], (int, float)) or comp['sale_price'] <= 0:
                        continue

                    # Filter: residential only (has bedrooms)
                    if not comp['bedrooms'] or comp['bedrooms'] == 0:
                        continue

                    # Filter: skip commercial properties
                    if comp['sale_price'] > 2000000:
                        continue

                    # Filter: sale date within specified window
                    if comp.get('sale_date'):
                        try:
                            if isinstance(comp['sale_date'], str):
                                sale_date = datetime.fromisoformat(comp['sale_date'].replace('Z', '+00:00'))
                            elif isinstance(comp['sale_date'], (int, float)):
                                # Handle epoch milliseconds (Zillow format)
                                sale_date = datetime.fromtimestamp(comp['sale_date'] / 1000)
                            else:
                                sale_date = comp['sale_date']

                            if sale_date < cutoff_date or sale_date > today:
                                continue
                        except Exception as e:
                            # If date parsing fails, skip this comp
                            continue

                    # Filter: year built - REMOVED (no longer filtering by year built)
                    # Users want to see all comps regardless of age difference

                    # Filter: sqft - OPTIONAL (prefer comps with sqft but don't require it)
                    # If sqft is missing, we'll still include the comp

                    # Apply bedroom filter if specified
                    if bedrooms and abs(comp['bedrooms'] - bedrooms) > 1:
                        continue

                    # Apply bathroom filter if specified (more flexible)
                    if bathrooms and abs(comp['bathrooms'] - bathrooms) > 1:
                        continue

                    # Apply max price filter
                    if max_price and comp['sale_price'] > max_price:
                        continue

                    filtered_comps.append(comp)

                    # Stop once we have enough
                    if len(filtered_comps) >= limit:
                        break

                return filtered_comps

            # Try 12-month window first (relaxed from 6 months)
            window_months = 12
            comps = process_and_filter_items(raw_items, 12)

            if len(comps) < 3:
                # Small market - expand to 24 months
                window_months = 24
                self.logger.info(f"Only {len(comps)} comps in 12mo window, expanding to 24 months for small market")
                comps = process_and_filter_items(raw_items, 24)

            self.logger.info(f"Found {len(comps)} Zillow comps from {len(raw_items)} cached items (window: {window_months}mo)")
            return comps, window_months

        except Exception as e:
            error_msg = str(e)
            self.logger.error(f"Error fetching Apify comps: {error_msg}")

            # If out of credits, try to load from mock data for testing
            if 'exceed your remaining usage' in error_msg.lower():
                self.logger.warning("Out of Apify credits - checking for mock data...")
                mock_file = Path(__file__).parent.parent.parent / '.tmp' / 'mock_apify_comps_blue_earth.json'

                if mock_file.exists() and city.lower() == 'blue earth':
                    self.logger.info(f"Loading mock Apify data from {mock_file}")
                    try:
                        import json
                        with open(mock_file, 'r') as f:
                            mock_items = json.load(f)

                        # Process mock items same as real Apify data
                        comps = []
                        for item in mock_items:
                            # Extract same fields as real processing
                            price = item.get('price')
                            if isinstance(price, dict):
                                price = price.get('price') or price.get('value')

                            beds = item.get('bedrooms')
                            baths = item.get('bathrooms')
                            sqft = item.get('livingArea')

                            comp = {
                                'address': self._format_address(item.get('address')),
                                'sale_price': price,
                                'sale_date': item.get('dateSold'),
                                'bedrooms': beds,
                                'bathrooms': baths,
                                'sqft': sqft,
                                'year_built': item.get('yearBuilt'),
                                'distance_miles': None,
                                'source': 'Apify-Zillow (Mock)'
                            }

                            # Same filters as real data
                            if not comp['sale_price'] or comp['sale_price'] <= 0:
                                continue
                            if not comp['bedrooms'] or comp['bedrooms'] == 0:
                                continue
                            if max_price and comp['sale_price'] > max_price:
                                continue

                            comps.append(comp)
                            if len(comps) >= limit:
                                break

                        self.logger.info(f"Loaded {len(comps)} mock comps for testing")
                        return comps, 24  # mock data treated as 24-month window

                    except Exception as mock_error:
                        self.logger.error(f"Could not load mock data: {mock_error}")

            # Loud, unambiguous degradation marker: a comps fetch failed and we
            # are returning ZERO comps. Downstream ARV will be unreliable — this
            # must not look like a clean "this market has no comps" result.
            self.logger.error(
                f"DEGRADED: Apify comps fetch FAILED for {location} — returning 0 comps "
                f"(ARV/ROI for this batch will be unreliable). Cause: {error_msg}"
            )
            return [], 0  # 0 = unknown/failed window

    def lookup_property(self, address: str) -> Optional[Dict]:
        """
        Lookup a specific property on Zillow to get details (beds, baths, sqft).
        
        Args:
            address: Full address (e.g., "123 Main St, Atlanta, GA")
            
        Returns:
            Dict with property details or None if not found
        """
        try:
            self.logger.info(f"Looking up property details for: {address}")
            
            # Use 'search' operation to find specific address
            actor_input = {
                "location": address,
                "maxItems": 1,
                "sort": "relevance"
            }
            
            # Run the actor
            run = self.client.actor(self.ACTOR_ID).call(run_input=actor_input)
            
            # Fetch results
            dataset_items = list(self.client.dataset(run["defaultDatasetId"]).iterate_items())
            
            if not dataset_items:
                self.logger.warning(f"No results found for {address}")
                return None
                
            item = dataset_items[0]
            
            # Extract details
            details = {
                'address': self._format_address(item.get('address')),
                'bedrooms': item.get('bedrooms') or item.get('beds'),
                'bathrooms': item.get('bathrooms') or item.get('baths'),
                'sqft': item.get('livingArea') or item.get('area'),
                'year_built': item.get('yearBuilt'),
                'zestimate': item.get('zestimate'),
                'description': item.get('description'),
                'property_type': item.get('propertyType')
            }
            
            # Handle dict values if present
            if isinstance(details['bedrooms'], dict):
                details['bedrooms'] = details['bedrooms'].get('value')
            if isinstance(details['bathrooms'], dict):
                details['bathrooms'] = details['bathrooms'].get('value')
            if isinstance(details['sqft'], dict):
                details['sqft'] = details['sqft'].get('value')
                
            self.logger.info(f"Found property details: {details}")
            return details
            
        except Exception as e:
            self.logger.error(f"Error looking up property: {e}")
            return None

    def _format_address(self, addr_dict):
        """Format address dict to string."""
        if isinstance(addr_dict, str):
            return addr_dict
        if isinstance(addr_dict, dict):
            parts = []
            if addr_dict.get('streetAddress'):
                parts.append(addr_dict['streetAddress'])
            if addr_dict.get('city'):
                parts.append(addr_dict['city'])
            if addr_dict.get('state'):
                parts.append(addr_dict['state'])
            if addr_dict.get('zipcode'):
                parts.append(str(addr_dict['zipcode']))
            return ', '.join(parts) if parts else 'Unknown'
        return 'Unknown'
