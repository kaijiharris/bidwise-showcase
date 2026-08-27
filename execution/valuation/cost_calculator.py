"""Cost calculation module for real estate properties."""
from decimal import Decimal
from typing import Dict, Optional
from loguru import logger

from ..db import Property, AuctionDetail, TaxLienDetail, OTCDetail
from ..utils import config


class CostCalculator:
    """
    Calculate all-in costs for real estate properties.
    
    Calculates:
    - Purchase price (based on source: auction/lien/OTC)
    - Rehab costs
    - Transaction costs
    - Carrying costs
    - Total all-in cost
    """
    
    def __init__(self, state: str, county: str = None):
        """
        Initialize cost calculator with market-specific config.
        
        Args:
            state: State code (e.g., 'FL', 'GA')
            county: County name (optional, for county-specific adjustments)
        """
        self.state = state
        self.county = county
        self.cost_config = config.get_cost_config(state, county)
        self.logger = logger.bind(calculator='CostCalculator')
    
    def calculate_purchase_price(
        self,
        property_obj: Property,
        auction_detail: Optional[AuctionDetail] = None,
        tax_lien_detail: Optional[TaxLienDetail] = None,
        otc_detail: Optional[OTCDetail] = None
    ) -> Dict[str, Decimal]:
        """
        Calculate purchase price based on property source.
        
        Returns:
            Dict with 'purchase_price' and 'buyers_premium'
        """
        if property_obj.source == 'auction' and auction_detail:
            return self._calculate_auction_purchase(auction_detail)
        elif property_obj.source == 'tax_lien' and tax_lien_detail:
            return self._calculate_tax_lien_purchase(tax_lien_detail)
        elif property_obj.source == 'otc' and otc_detail:
            return self._calculate_otc_purchase(otc_detail)
        else:
            self.logger.warning(f"Cannot determine purchase price for property {property_obj.parcel_id}")
            return {'purchase_price': Decimal('0'), 'buyers_premium': Decimal('0')}
    
    def _calculate_auction_purchase(self, auction_detail: AuctionDetail) -> Dict[str, Decimal]:
        """Calculate purchase price for auction properties."""
        # Use current bid if available, else minimum bid
        base_price = Decimal(str(auction_detail.current_bid or auction_detail.minimum_bid or 0))
        
        # Add buyer's premium
        premium_val = auction_detail.buyers_premium_pct if auction_detail.buyers_premium_pct is not None else self.cost_config.get('buyers_premium_pct', 10)
        premium_pct = Decimal(str(premium_val if premium_val is not None else 10))
        
        buyers_premium = base_price * (premium_pct / Decimal('100'))
        purchase_price = base_price + buyers_premium
        
        return {
            'purchase_price': purchase_price,
            'buyers_premium': buyers_premium
        }
    
    def _calculate_tax_lien_purchase(self, tax_lien_detail: TaxLienDetail) -> Dict[str, Decimal]:
        """Calculate purchase price for tax lien properties."""
        return {
            'purchase_price': tax_lien_detail.lien_amount or Decimal('0'),
            'buyers_premium': Decimal('0')
        }
    
    def _calculate_otc_purchase(self, otc_detail: OTCDetail) -> Dict[str, Decimal]:
        """Calculate purchase price for OTC properties."""
        return {
            'purchase_price': otc_detail.asking_price or Decimal('0'),
            'buyers_premium': Decimal('0')
        }
    
    def calculate_rehab_cost(
        self,
        sqft: int,
        rehab_category: str = 'medium',
        year_built: Optional[int] = None
    ) -> Decimal:
        """
        Calculate estimated rehab cost.
        
        Args:
            sqft: Square footage
            rehab_category: 'light', 'medium', or 'heavy'
            year_built: Year property was built (for auto-categorization)
            
        Returns:
            Total rehab cost
        """
        # Cast to int defensively
        try:
            sqft = int(float(str(sqft or 0)))
        except:
            sqft = 0
            
        try:
            year_built = int(float(str(year_built or 0)))
        except:
            year_built = 0
            
        # Auto-categorize if not specified and year_built available
        if isinstance(year_built, int) and year_built > 1800 and rehab_category == 'medium':
            current_year = 2025
            age = current_year - year_built
            
            if age < 20:
                rehab_category = 'light'
            elif age > 50:
                rehab_category = 'heavy'
        else:
            # Fallback for invalid years or non-ints
            age = 0
        
        # Get cost per sqft for category
        rehab_per_sqft = self.cost_config['rehab_per_sqft'].get(rehab_category, 40)
        
        total_rehab = Decimal(str(sqft)) * Decimal(str(rehab_per_sqft))
        
        self.logger.debug(f"Rehab cost: {sqft} sqft × ${rehab_per_sqft}/sqft ({rehab_category}) = ${total_rehab}")
        
        return total_rehab
    
    def calculate_transaction_costs(
        self,
        purchase_price: Decimal,
        avm_value: Optional[Decimal] = None
    ) -> Dict[str, Decimal]:
        """
        Calculate transaction costs (closing, title, transfer tax, etc.).
        
        Args:
            purchase_price: Property purchase price
            avm_value: Automated valuation (for transfer tax calculation)
            
        Returns:
            Dict with individual cost components
        """
        # Closing costs (percentage of purchase)
        closing_pct_val = self.cost_config.get('closing_costs_pct', 3)
        closing_pct = Decimal(str(closing_pct_val if closing_pct_val is not None else 3))
        closing_costs = purchase_price * (closing_pct / Decimal('100'))
        
        # Title insurance
        title_pct_val = self.cost_config.get('title_insurance_pct', 0.5)
        title_pct = Decimal(str(title_pct_val if title_pct_val is not None else 0.5))
        title_insurance = purchase_price * (title_pct / Decimal('100'))
        
        # Transfer tax (varies by state/county)
        transfer_tax = self._calculate_transfer_tax(avm_value or purchase_price)
        
        # Fixed costs
        inspection_val = self.cost_config.get('inspection_cost', 500)
        inspection = Decimal(str(inspection_val if inspection_val is not None else 500))
        recording_fees = Decimal('250')  # Standard recording fees
        
        return {
            'closing_costs': closing_costs,
            'title_insurance': title_insurance,
            'transfer_tax': transfer_tax,
            'inspection_cost': inspection,
            'recording_fees': recording_fees
        }
    
    def _calculate_transfer_tax(self, sale_price: Decimal) -> Decimal:
        """Calculate state/county-specific transfer tax."""
        market_config = config.load_market_config(self.state)
        
        if self.state == 'FL':
            # Florida: $0.70 per $100
            rate_val = market_config.get('transfer_tax_per_100', 0.70)
            rate_per_100 = Decimal(str(rate_val if rate_val is not None else 0.70))
            transfer_tax = (sale_price / Decimal('100')) * rate_per_100
        elif self.state == 'GA':
            # Georgia: $1 per $1000 (state + county)
            rate_val = market_config.get('transfer_tax_per_1000', 1.0)
            rate_per_1000 = Decimal(str(rate_val if rate_val is not None else 1.0))
            
            if self.county:
                county_config = market_config.get('counties', {}).get(self.county.lower(), {})
                county_rate_val = county_config.get('transfer_tax_per_1000', 1.0)
                rate_per_1000 += Decimal(str(county_rate_val if county_rate_val is not None else 1.0))
            
            transfer_tax = (sale_price / Decimal('1000')) * rate_per_1000
        else:
            transfer_tax = Decimal('0')
        
        return transfer_tax
    
    def calculate_carrying_costs(
        self,
        sqft: int,
        months: Optional[int] = None,
        property_tax_annual: Optional[Decimal] = None
    ) -> Dict[str, Decimal]:
        """
        Calculate carrying costs for holding period.
        
        Args:
            sqft: Square footage
            months: Holding period in months (default from config)
            property_tax_annual: Annual property tax (if known)
            
        Returns:
            Dict with carrying cost components
        """
        sqft = int(sqft) if sqft is not None else 0
        
        if months is None:
            months_val = self.cost_config.get('carrying_months', 6)
            try:
                months = int(months_val) if months_val is not None else 6
            except (TypeError, ValueError):
                months = 6
        
        # Insurance
        insur_val = self.cost_config.get('insurance_per_sqft_annual', 0.50)
        insurance_per_sqft = Decimal(str(insur_val if insur_val is not None else 0.50))
        insurance_annual = Decimal(str(sqft)) * insurance_per_sqft
        insurance_total = (insurance_annual / Decimal('12')) * Decimal(str(months))
        
        # Utilities
        util_val = self.cost_config.get('utilities_monthly', 200)
        utilities_monthly = Decimal(str(util_val if util_val is not None else 200))
        utilities_total = utilities_monthly * Decimal(str(months))
        
        # Property tax (prorated)
        if property_tax_annual:
            tax_total = (Decimal(str(property_tax_annual)) / Decimal('12')) * Decimal(str(months))
        else:
            # Estimate if not provided
            tax_total = Decimal('0')
        
        return {
            'insurance': insurance_total,
            'utilities': utilities_total,
            'property_tax': tax_total,
            'total_carrying': insurance_total + utilities_total + tax_total
        }
    
    def calculate_all_in_cost(
        self,
        purchase_price: Decimal,
        buyers_premium: Decimal,
        rehab_cost: Decimal,
        transaction_costs: Dict[str, Decimal],
        carrying_costs: Dict[str, Decimal]
    ) -> Decimal:
        """
        Calculate total all-in cost.
        
        Args:
            purchase_price: Base purchase price
            buyers_premium: Auction buyer's premium
            rehab_cost: Total rehab cost
            transaction_costs: Dict of transaction costs
            carrying_costs: Dict of carrying costs
            
        Returns:
            Total all-in cost
        """
        all_in = purchase_price + buyers_premium + rehab_cost
        
        # Add transaction costs
        for cost in transaction_costs.values():
            all_in += cost
        
        # Add carrying costs
        all_in += carrying_costs.get('total_carrying', Decimal('0'))
        
        self.logger.info(f"All-in cost: ${all_in:,.2f}")
        
        return all_in
