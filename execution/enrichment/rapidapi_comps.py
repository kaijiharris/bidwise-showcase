"""
RapidAPI integration for alternative comp data sources.

Provides fallback comp data when ATTOM API returns insufficient results.
Uses US Real Estate API and Unofficial Redfin API.
"""
import os
import requests
from typing import Dict, List, Optional
from loguru import logger
from pathlib import Path
from datetime import datetime, timedelta


# Load API key manually
def _load_rapidapi_key():
    """Load RapidAPI key from env."""
    if os.getenv('RAPIDAPI_KEY'):
        return os.getenv('RAPIDAPI_KEY')

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
                        if line.startswith('RAPIDAPI_KEY='):
                            key = line.split('=', 1)[1].strip()
                            return key
            except Exception as e:
                logger.warning(f"Error reading {env_path}: {e}")

    return None


if not os.getenv('RAPIDAPI_KEY'):
    api_key = _load_rapidapi_key()
    if api_key:
        os.environ['RAPIDAPI_KEY'] = api_key


class RapidAPIComps:
    """
    Client for RapidAPI comp data sources.
    
    Provides fallback comp data when ATTOM returns insufficient results.
    """
    
    def __init__(self):
        """Initialize RapidAPI client."""
        self.api_key = os.getenv('RAPIDAPI_KEY')
        
        if not self.api_key:
            logger.warning("RAPIDAPI_KEY not found - RapidAPI comps unavailable")
            raise ValueError("RAPIDAPI_KEY not found in environment variables")
        
        self.headers = {
            'X-RapidAPI-Key': self.api_key,
            'X-RapidAPI-Host': 'us-real-estate.p.rapidapi.com'
        }
        
        self.logger = logger.bind(service='RapidAPI')
        self.logger.info("RapidAPI client initialized successfully")
    
    def get_sold_properties(
        self,
        city: str,
        state_code: str,
        bedrooms: Optional[int] = None,
        bathrooms: Optional[int] = None,
        max_price: Optional[int] = None,
        limit: int = 10
    ) -> List[Dict]:
        """
        Get recently sold properties from US Real Estate API.
        
        Args:
            city: City name (e.g., "Atlanta")
            state_code: State code (e.g., "GA")
            bedrooms: Number of bedrooms
            bathrooms: Number of bathrooms
            max_price: Maximum sale price
            limit: Max results to return
        
        Returns:
            List of sold property dicts with comp data
        """
        try:
            url = "https://us-real-estate.p.rapidapi.com/v2/sold-properties"
            
            params = {
                'city': city,
                'state_code': state_code,
                'limit': limit,
                'offset': 0
            }
            
            if bedrooms:
                params['beds_min'] = bedrooms - 1  # Slightly flexible
                params['beds_max'] = bedrooms + 1
            
            if bathrooms:
                params['baths_min'] = bathrooms - 1
                params['baths_max'] = bathrooms + 1
            
            if max_price:
                params['price_max'] = max_price
            
            self.logger.info(f"Fetching sold comps for {city}, {state_code}")
            
            response = requests.get(url, headers=self.headers, params=params, timeout=15)
            
            if response.status_code == 403:
                self.logger.warning("RapidAPI quota exceeded or subscription inactive")
                return []
            
            if response.status_code != 200:
                self.logger.warning(f"RapidAPI request failed: {response.status_code}")
                return []
            
            data = response.json()
            
            if not data.get('data') or not data['data'].get('results'):
                self.logger.info("No sold properties found")
                return []
            
            comps = []
            for prop in data['data']['results'][:limit]:
                # Extract relevant data
                comp = {
                    'address': prop.get('location', {}).get('address', {}).get('line', 'Unknown'),
                    'sale_price': prop.get('description', {}).get('sold_price'),
                    'sale_date': prop.get('description', {}).get('sold_date'),
                    'bedrooms': prop.get('description', {}).get('beds'),
                    'bathrooms': prop.get('description', {}).get('baths'),
                    'sqft': prop.get('description', {}).get('sqft'),
                    'year_built': prop.get('description', {}).get('year_built'),
                    'distance_miles': None,  # Not provided by API
                    'source': 'RapidAPI'
                }
                
                # Only include if has key data
                if comp['sale_price'] and comp['sale_price'] > 0:
                    comps.append(comp)
            
            self.logger.info(f"Found {len(comps)} RapidAPI comps")
            return comps
        
        except requests.exceptions.RequestException as e:
            self.logger.error(f"Network error fetching RapidAPI comps: {e}")
            return []
        except Exception as e:
            self.logger.error(f"Error fetching RapidAPI comps: {e}")
            return []
