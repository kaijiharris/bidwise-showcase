"""
Google Maps Geocoding API integration.

Converts property addresses to accurate lat/long coordinates for better comp searches.
"""
import os
import requests
from typing import Optional, Tuple
from loguru import logger
from pathlib import Path


# Load API key manually
def _load_google_api_key():
    """Load Google Maps API key from env."""
    # Check environment variable first
    if os.getenv('GOOGLE_MAPS_API_KEY'):
        return os.getenv('GOOGLE_MAPS_API_KEY')

    # Try to load from .env files
    # Tenancy: never read another project's .env — provision a BidWise-owned key in this repo's .env (see vault TENANCY-MAP).
    env_paths = [
        Path(__file__).parent.parent.parent / '.env',  # real-estate-system/.env
    ]

    for env_path in env_paths:
        if env_path.exists():
            try:
                with open(env_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith('GOOGLE_MAPS_API_KEY='):
                            key = line.split('=', 1)[1].strip()
                            return key
            except Exception as e:
                logger.warning(f"Error reading {env_path}: {e}")

    return None


# Set API key
if not os.getenv('GOOGLE_MAPS_API_KEY'):
    api_key = _load_google_api_key()
    if api_key:
        os.environ['GOOGLE_MAPS_API_KEY'] = api_key


class GoogleGeocoder:
    """
    Google Maps Geocoding API client.
    
    Converts addresses to precise lat/long coordinates for accurate comp searches.
    """
    
    BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
    
    def __init__(self):
        """Initialize geocoder with API key."""
        self.api_key = os.getenv('GOOGLE_MAPS_API_KEY')
        
        if not self.api_key:
            logger.warning("GOOGLE_MAPS_API_KEY not found - geocoding will be limited")
            raise ValueError("GOOGLE_MAPS_API_KEY not found in environment variables")
        
        logger.info("Google Geocoder initialized successfully")
    
    def geocode_address(
        self, 
        address: str, 
        city: Optional[str] = None, 
        state: Optional[str] = None, 
        zipcode: Optional[str] = None
    ) -> Optional[Tuple[float, float]]:
        """
        Geocode a property address to lat/long.
        
        Args:
            address: Street address (e.g., "892 Confederate Ave SE")
            city: City name (e.g., "Atlanta")
            state: State code (e.g., "GA")
            zipcode: ZIP code (optional)
        
        Returns:
            Tuple of (latitude, longitude) or None if geocoding fails
        """
        try:
            # Build full address string
            parts = [address]
            if city:
                parts.append(city)
            if state:
                parts.append(state)
            if zipcode:
                parts.append(zipcode)
            
            full_address = ", ".join(parts)
            
            logger.debug(f"Geocoding: {full_address}")
            
            # Make API request
            params = {
                'address': full_address,
                'key': self.api_key
            }
            
            response = requests.get(self.BASE_URL, params=params, timeout=10)
            
            if response.status_code != 200:
                logger.warning(f"Geocoding failed: {response.status_code}")
                return None
            
            data = response.json()
            
            if data['status'] != 'OK':
                logger.warning(f"Geocoding status: {data['status']} for {full_address}")
                return None
            
            if not data.get('results'):
                logger.warning(f"No results for {full_address}")
                return None
            
            # Extract lat/long from first result
            location = data['results'][0]['geometry']['location']
            lat = location['lat']
            lng = location['lng']
            
            logger.info(f"Geocoded {address} to ({lat}, {lng})")
            
            return (lat, lng)
        
        except requests.exceptions.RequestException as e:
            logger.error(f"Network error geocoding: {e}")
            return None
        except KeyError as e:
            logger.error(f"Unexpected API response format: {e}")
            return None
        except Exception as e:
            logger.error(f"Error geocoding address: {e}")
            return None
