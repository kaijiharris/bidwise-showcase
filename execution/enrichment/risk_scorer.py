"""Module for calculating property risk scores."""
from decimal import Decimal
from typing import Dict, Optional
from loguru import logger

class RiskScorer:
    """
    Calculates composite risk scores based on crime, flood, fire, and other factors.
    """
    
    def __init__(self, state: str, county: str):
        self.state = state.upper()
        self.county = county.lower()
        self.logger = logger.bind(component='RiskScorer')
        
    def calculate_composite_score(self, property_data: Dict) -> Dict:
        """
        Calculate composite risk score (0-100, higher = riskier).
        
        Logic:
        - Crime Score (0-100): Based on city/neighborhood safety records
        - Flood Score (0-100): Based on FEMA zones (A/AE = High, X = Low)
        - Data Quality Score (0-100): Based on completeness of property data
        """
        # 1. Crime Score Simulation (MVP uses city-level averages if no neighborhood data)
        crime_score = self._estimate_crime_score(property_data.get('city', ''))
        
        # 2. Flood Risk Simulation (MVP uses FEMA zone mapping)
        flood_zone = property_data.get('flood_zone', 'X')
        flood_score = self._calculate_flood_score(flood_zone)
        
        # 3. Liens/Title Risk
        lien_count = property_data.get('known_liens_count', 0)
        lien_score = min(100, lien_count * 25)
        
        # 4. Composite Calculation (Weighted)
        # Weights: Crime (40%), Flood (40%), Liens (20%)
        composite = (crime_score * 0.4) + (flood_score * 0.4) + (lien_score * 0.2)
        
        return {
            'composite_risk_score': round(composite),
            'crime_score': crime_score,
            'flood_risk_score': flood_score,
            'lien_score': lien_score,
            'flood_zone': flood_zone
        }
        
    def _estimate_crime_score(self, city: str) -> int:
        """Simulate crime score based on city-level data for Faribault County."""
        # Faribault County Cities (Representative Scores)
        city_scores = {
            'blue earth': 35,
            'wells': 42,
            'winnebago': 48,
            'elmore': 51,
            'kiester': 38,
            'walters': 30
        }
        return city_scores.get(city.lower(), 45) # Default to 45 if unknown
        
    def _calculate_flood_score(self, zone: str) -> int:
        """Map FEMA flood zones to 0-100 risk score."""
        zone_map = {
            'A': 95,   # High risk
            'AE': 90,  # High risk
            'AH': 80,
            'AO': 80,
            'V': 100,  # Coastal high risk
            'VE': 100,
            'X': 10,   # Low risk (minimal flooding)
            'SHADED X': 40, # Moderate risk (500-year)
            'D': 50    # Undetermined
        }
        return zone_map.get(zone.upper(), 50)
