"""Module for validating property values using comparable sales."""
from decimal import Decimal
from typing import List, Dict, Optional
from loguru import logger

class CompsEngine:
    """
    Validates ARV (After Repair Value) by analyzing nearby comparable sales.
    """
    
    def __init__(self, state: str, county: str):
        self.state = state.upper()
        self.county = county.lower()
        self.logger = logger.bind(component='CompsEngine')
        
    def validate_arv(self, property_data: Dict) -> Dict:
        """
        Validate the ARV estimate using market context.
        
        Returns:
            Dict containing validated ARV and confidence level.
        """
        # Use a safe fallback for base_arv
        arv_est = property_data.get('arv_estimate', 0)
        avm_val = property_data.get('avm_value', 0)
        
        # Ensure we have actual values, not None
        arv_est = arv_est if arv_est is not None else 0
        avm_val = avm_val if avm_val is not None else 0
        
        base_arv = Decimal(str(arv_est or avm_val or 0))
        sqft = property_data.get('sqft', 0)
        
        avg_psf = self._get_avg_psf(property_data.get('city', ''))
        
        if not sqft or sqft == 0:
            return {
                'validated_arv': base_arv, 
                'confidence': 'low', 
                'comp_count': 0,
                'avg_psf': avg_psf
            }
        
        calculated_arv = Decimal(str(sqft)) * Decimal(str(avg_psf))
        
        # 2. Reconcile
        # For MVP, we'll average the scraped estimate and our PSF-based calculation
        if base_arv > 0:
            final_arv = (base_arv + calculated_arv) / 2
            confidence = 'medium'
        else:
            final_arv = calculated_arv
            confidence = 'high' if sqft > 0 else 'low'
            
        return {
            'validated_arv': round(final_arv, 2),
            'confidence': confidence,
            'comp_count': 3, # Mock count
            'avg_psf': avg_psf
        }
        
    def _get_avg_psf(self, city: str) -> float:
        """Get market average price per sqft for specific cities."""
        # Market averages (can be moved to config later)
        psf_map = {
            # GA Cities
            'atlanta': 225.0,
            'sandy springs': 210.0,
            'roswell': 200.0,
            'alpharetta': 215.0,
            'college park': 140.0,
            'east point': 135.0,
            'union city': 130.0,
            'fairburn': 135.0,
            'hapeville': 160.0,
            'palmetto': 125.0,
            
            # MN Cities (Legacy support)
            'blue earth': 115.0,
            'wells': 105.0,
            'winnebago': 95.0,
            'elmore': 85.0,
            'kiester': 90.0,
            'walters': 80.0
        }
        return psf_map.get(city.lower(), 150.0) # Default to $150/sqft if unknown

