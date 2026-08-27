"""ROI calculation module for real estate investments."""
from decimal import Decimal
from typing import Dict, Optional, List
from loguru import logger

from ..utils import config


class ROICalculator:
    """
    Calculate ROI and IRR metrics for flip and rental strategies.
    """
    
    def __init__(self):
        self.logger = logger.bind(calculator='ROICalculator')
        self.cost_config = config.get('costs', {})
    
    def calculate_flip_metrics(
        self,
        all_in_cost: Decimal,
        arv: Decimal,
        holding_months: int = 6
    ) -> Dict[str, Decimal]:
        """
        Calculate flip metrics.
        
        Args:
            all_in_cost: Total all-in cost
            arv: After Repair Value (projected sale price)
            holding_months: Expected holding period
            
        Returns:
            Dict with gross_profit, net_profit, roi_pct, irr_pct
        """
        # Gross profit
        gross_profit = arv - all_in_cost
        
        # Selling costs (realtor commission + seller closing costs)
        realtor_val = self.cost_config.get('realtor_commission_pct', 6)
        seller_val = self.cost_config.get('seller_closing_pct', 1)
        
        realtor_pct = Decimal(str(realtor_val if realtor_val is not None else 6))
        seller_pct = Decimal(str(seller_val if seller_val is not None else 1))
        
        total_selling_pct = realtor_pct + seller_pct
        selling_costs = arv * (total_selling_pct / Decimal('100'))
        
        # Net profit
        net_profit = gross_profit - selling_costs
        
        # ROI percentage
        if all_in_cost > 0:
            roi_pct = (net_profit / all_in_cost) * Decimal('100')
        else:
            roi_pct = Decimal('0')
        
        # IRR (annualized return)
        irr_pct = self._calculate_simple_irr(
            initial_investment=float(all_in_cost),
            final_return=float(all_in_cost + net_profit),
            holding_months=holding_months
        )
        
        return {
            'gross_profit': gross_profit,
            'net_profit': net_profit,
            'roi_pct': roi_pct,
            'estimated_irr_pct': Decimal(str(irr_pct))
        }
    
    def calculate_rental_metrics(
        self,
        all_in_cost: Decimal,
        monthly_rent: Decimal,
        financing: Optional[Dict] = None
    ) -> Dict[str, Decimal]:
        """
        Calculate rental investment metrics.
        
        Args:
            all_in_cost: Total all-in cost
            monthly_rent: Estimated monthly rent
            financing: Optional dict with 'down_payment_pct', 'interest_rate', 'loan_term_years'
            
        Returns:
            Dict with cash_on_cash_return_pct, dscr, five_year_irr_pct
        """
        # Annual rental income
        annual_rent = monthly_rent * Decimal('12')
        
        # Operating expenses (estimate: 50% rule - half of rent goes to expenses)
        # This includes: vacancy, repairs, property management, insurance, taxes, HOA
        operating_expense_pct = Decimal('0.50')
        annual_operating_expenses = annual_rent * operating_expense_pct
        
        # Net Operating Income (NOI)
        noi = annual_rent - annual_operating_expenses
        
        if financing:
            # With financing
            down_payment_pct = Decimal(str(financing.get('down_payment_pct', 20)))
            cash_invested = all_in_cost * (down_payment_pct / Decimal('100'))
            
            loan_amount = all_in_cost - cash_invested
            interest_rate = Decimal(str(financing.get('interest_rate', 7.5))) / Decimal('100')
            loan_term_years = financing.get('loan_term_years', 30)
            
            # Calculate monthly mortgage payment
            annual_debt_service = self._calculate_annual_debt_service(
                loan_amount, interest_rate, loan_term_years
            )
            
            # Cash flow after debt service
            annual_cash_flow = noi - annual_debt_service
            
            # Cash-on-cash return
            if cash_invested > 0:
                cash_on_cash = (annual_cash_flow / cash_invested) * Decimal('100')
            else:
                cash_on_cash = Decimal('0')
            
            # DSCR (Debt Service Coverage Ratio)
            if annual_debt_service > 0:
                dscr = noi / annual_debt_service
            else:
                dscr = Decimal('0')
        else:
            # All-cash purchase
            cash_invested = all_in_cost
            annual_cash_flow = noi
            
            if cash_invested > 0:
                cash_on_cash = (noi / cash_invested) * Decimal('100')
            else:
                cash_on_cash = Decimal('0')
            
            dscr = Decimal('0')  # Not applicable for all-cash
        
        # 5-year IRR (simplified)
        five_year_irr = self._calculate_rental_irr(
            cash_invested=float(cash_invested),
            annual_cash_flow=float(annual_cash_flow),
            years=5,
            appreciation_rate=0.03  # Conservative 3% annual appreciation
        )
        
        return {
            'monthly_rent_estimate': monthly_rent,
            'annual_noi': noi,
            'annual_cash_flow': annual_cash_flow,
            'cash_on_cash_return_pct': cash_on_cash,
            'dscr': dscr,
            'five_year_irr_pct': Decimal(str(five_year_irr))
        }
    
    def _calculate_simple_irr(
        self,
        initial_investment: float,
        final_return: float,
        holding_months: int
    ) -> float:
        """
        Calculate simple annualized IRR for flip.
        
        Formula: IRR = (final_value / initial_value) ^ (12 / months) - 1
        """
        if initial_investment <= 0 or holding_months <= 0:
            return 0.0
        
        ratio = final_return / initial_investment
        annualized_irr = (ratio ** (12 / holding_months)) - 1.0
        
        return annualized_irr * 100  # Return as percentage
    
    def _calculate_annual_debt_service(
        self,
        loan_amount: Decimal,
        interest_rate: Decimal,
        loan_term_years: int
    ) -> Decimal:
        """
        Calculate annual debt service (total mortgage payments per year).
        
        Uses standard mortgage payment formula.
        """
        # Monthly interest rate
        monthly_rate = interest_rate / Decimal('12')
        num_payments = loan_term_years * 12
        
        # Mortgage payment formula: M = P[r(1+r)^n]/[(1+r)^n - 1]
        if monthly_rate > 0:
            factor = (1 + monthly_rate) ** num_payments
            monthly_payment = loan_amount * (monthly_rate * factor) / (factor - 1)
        else:
            monthly_payment = loan_amount / Decimal(str(num_payments))
        
        annual_debt_service = monthly_payment * Decimal('12')
        
        return annual_debt_service
    
    def _calculate_rental_irr(
        self,
        cash_invested: float,
        annual_cash_flow: float,
        years: int,
        appreciation_rate: float
    ) -> float:
        """
        Calculate simplified IRR for rental investment.
        
        Uses approximation: average annual return / initial investment
        """
        # Total cash flows over holding period
        total_cash_flows = annual_cash_flow * years
        
        # Sale proceeds at end
        property_value = cash_invested * ((1 + appreciation_rate) ** years)
        net_sale_proceeds = property_value * 0.94  # 6% selling costs
        
        # Total return
        total_return = total_cash_flows + (net_sale_proceeds - cash_invested)
        
        # Average annual return
        avg_annual_return = total_return / years
        
        # IRR approximation
        if cash_invested > 0:
            irr = (avg_annual_return / cash_invested) * 100
        else:
            irr = 0.0
        
        return irr
