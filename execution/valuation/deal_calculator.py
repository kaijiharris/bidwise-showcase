"""
Systemized Deal Calculator for Tax Deed Properties.

Provides standardized, repeatable calculations for:
- Rehab costs
- All-in costs
- ROI/IRR
- Deal scores
- Risk scores

All formulas are documented and consistent.
"""
import logging
from typing import Dict, Optional
from dataclasses import dataclass


@dataclass
class DealMetrics:
    """Standardized deal metrics output."""
    # Costs
    purchase_price: float  # Winning bid (use min_bid for conservative estimate)
    rehab_cost: float
    closing_costs: float
    holding_costs: float
    all_in_cost: float

    # Values
    arv: Optional[float]  # After Repair Value
    as_is_value: Optional[float]

    # Profit calculations
    gross_profit: Optional[float]  # ARV - all_in_cost
    net_profit: Optional[float]  # After selling costs

    # Returns
    roi_pct: Optional[float]  # Return on Investment %
    cash_on_cash_return: Optional[float]

    # Scoring
    deal_score: int  # 0-100
    risk_score: int  # 0-100
    confidence_score: int  # 0-100 (data quality)


class TaxDeedDealCalculator:
    """
    Calculates financial metrics for tax deed properties.

    Methodology:
    - Conservative assumptions (protect capital)
    - Georgia-specific costs and rules
    - Repeatable formulas
    """

    # Cost assumptions for Georgia
    CLOSING_COST_PCT = 0.03  # 3% of purchase price
    HOLDING_MONTHS = 6  # Average flip timeline
    MONTHLY_HOLDING_COST_PER_SQFT = 0.15  # Insurance, utilities, taxes

    # Rehab cost per sqft (Georgia, 2026)
    REHAB_LIGHT_PER_SQFT = 15  # Paint, clean, minor repairs
    REHAB_MEDIUM_PER_SQFT = 40  # Kitchen/bath updates, flooring
    REHAB_HEAVY_PER_SQFT = 70  # Major systems, full renovation

    # Selling costs
    SELLING_COST_PCT = 0.08  # 6% commission + 2% closing

    def __init__(self, county: str = "Gwinnett"):
        """Initialize calculator."""
        self.logger = logging.getLogger(__name__)
        self.county = county

    def calculate_deal_metrics(
        self,
        property_data: Dict,
        purchase_price: Optional[float] = None
    ) -> DealMetrics:
        """
        Calculate complete deal metrics for a property.

        Args:
            property_data: Property dict with tax_due, sqft, arv, etc.
            purchase_price: Actual/expected winning bid (defaults to min_bid/tax_due)

        Returns:
            DealMetrics object with all calculations
        """
        # Extract data
        tax_due = property_data.get('tax_due', 0)
        sqft = property_data.get('sqft', 1500)  # Default assumption
        year_built = property_data.get('year_built')
        property_type = property_data.get('property_type', 'residential')
        arv = property_data.get('arv')
        as_is_value = property_data.get('as_is_value')

        # Use minimum bid as purchase price if not specified
        if purchase_price is None:
            purchase_price = tax_due

        # Calculate costs
        rehab_cost = self._calculate_rehab_cost(sqft, year_built, property_type)
        closing_costs = purchase_price * self.CLOSING_COST_PCT
        holding_costs = self._calculate_holding_costs(sqft, self.HOLDING_MONTHS)
        all_in_cost = purchase_price + rehab_cost + closing_costs + holding_costs

        # Calculate profit
        gross_profit = None
        net_profit = None
        roi_pct = None
        cash_on_cash_return = None

        if arv:
            selling_costs = arv * self.SELLING_COST_PCT
            gross_profit = arv - all_in_cost
            net_profit = gross_profit - selling_costs

            if all_in_cost > 0:
                roi_pct = (net_profit / all_in_cost) * 100
                cash_on_cash_return = (net_profit / purchase_price) * 100

        # Calculate scores
        deal_score = self._calculate_deal_score(
            property_data, roi_pct, net_profit, arv, all_in_cost
        )
        risk_score = self._calculate_risk_score(property_data)
        confidence_score = self._calculate_confidence_score(property_data)

        return DealMetrics(
            purchase_price=purchase_price,
            rehab_cost=rehab_cost,
            closing_costs=closing_costs,
            holding_costs=holding_costs,
            all_in_cost=all_in_cost,
            arv=arv,
            as_is_value=as_is_value,
            gross_profit=gross_profit,
            net_profit=net_profit,
            roi_pct=roi_pct,
            cash_on_cash_return=cash_on_cash_return,
            deal_score=deal_score,
            risk_score=risk_score,
            confidence_score=confidence_score
        )

    def _calculate_rehab_cost(
        self,
        sqft: int,
        year_built: Optional[int],
        property_type: str
    ) -> float:
        """
        Calculate estimated rehab costs.

        Methodology:
        - Older homes (pre-1980) = heavy rehab
        - Mid-age (1980-2000) = medium rehab
        - Newer (2000+) = light rehab
        - Tax deed properties typically need work
        """
        if property_type == 'land':
            return 0  # No rehab for land

        # Determine rehab level based on age
        current_year = 2026
        age = current_year - year_built if year_built else 50

        if age > 45:  # Pre-1980
            cost_per_sqft = self.REHAB_HEAVY_PER_SQFT
        elif age > 25:  # 1980-2000
            cost_per_sqft = self.REHAB_MEDIUM_PER_SQFT
        else:  # 2000+
            cost_per_sqft = self.REHAB_LIGHT_PER_SQFT

        # Tax deed properties typically need more work (add 20%)
        cost_per_sqft *= 1.2

        return sqft * cost_per_sqft

    def _calculate_holding_costs(self, sqft: int, months: int) -> float:
        """Calculate holding costs during renovation."""
        monthly_cost = sqft * self.MONTHLY_HOLDING_COST_PER_SQFT
        return monthly_cost * months

    def _calculate_deal_score(
        self,
        property_data: Dict,
        roi_pct: Optional[float],
        net_profit: Optional[float],
        arv: Optional[float],
        all_in_cost: float
    ) -> int:
        """
        Calculate deal score (0-100).

        Weights:
        - ROI: 40%
        - Profit margin: 30%
        - Data quality: 20%
        - Risk factors: 10%
        """
        score = 0

        # ROI component (40 points max)
        if roi_pct is not None:
            if roi_pct >= 50:
                score += 40
            elif roi_pct >= 30:
                score += 30
            elif roi_pct >= 20:
                score += 20
            elif roi_pct >= 10:
                score += 10

        # Profit margin component (30 points max)
        if net_profit and arv:
            margin = (net_profit / arv) * 100
            if margin >= 20:
                score += 30
            elif margin >= 15:
                score += 20
            elif margin >= 10:
                score += 10

        # Data quality component (20 points max)
        data_quality = property_data.get('data_quality_score', 50)
        score += int((data_quality / 100) * 20)

        # Risk adjustment (10 points max, inverted)
        risk_flags = property_data.get('risk_flags', [])
        if len(risk_flags) == 0:
            score += 10
        elif len(risk_flags) <= 2:
            score += 5

        return min(100, max(0, score))

    def _calculate_risk_score(self, property_data: Dict) -> int:
        """
        Calculate risk score (0-100, higher = riskier).

        Factors:
        - Property type
        - Data quality
        - Risk flags
        - Tax delinquency amount
        """
        risk = 0

        # Property type risk
        prop_type = property_data.get('property_type', 'unknown')
        if prop_type == 'unknown':
            risk += 30
        elif prop_type == 'land':
            risk += 25
        elif prop_type == 'commercial':
            risk += 15
        else:  # residential
            risk += 5

        # Data quality risk (inverse)
        data_quality = property_data.get('data_quality_score', 50)
        risk += int((100 - data_quality) / 2)  # 0-50 points

        # Risk flags
        risk_flags = property_data.get('risk_flags', [])
        risk += min(len(risk_flags) * 5, 20)  # Max 20 points

        # High tax delinquency
        tax_due = property_data.get('tax_due', 0)
        if tax_due > 20000:
            risk += 10
        elif tax_due > 10000:
            risk += 5

        return min(100, max(0, risk))

    def _calculate_confidence_score(self, property_data: Dict) -> int:
        """
        Calculate confidence in analysis (0-100).

        Based on data completeness.
        """
        required_fields = [
            'address', 'tax_due', 'property_type',
            'sqft', 'year_built', 'arv'
        ]

        present = sum(1 for field in required_fields if property_data.get(field))
        return int((present / len(required_fields)) * 100)
