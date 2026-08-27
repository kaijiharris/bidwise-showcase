"""Deal scoring module for ranking properties."""
from decimal import Decimal
from typing import Dict, Optional
from loguru import logger

from ..utils import config


class DealScorer:
    """
    Calculate composite deal scores for properties.
    
    Combines:
    - ROI/IRR metrics (higher = better)
    - Risk scores (lower = better)
    - Filter match (how well property matches user criteria)
    """
    
    def __init__(self):
        self.logger = logger.bind(scorer='DealScorer')
        self.scoring_config = config.get('scoring', {})
        
        # Get scoring weights
        weights = self.scoring_config.get('weights', {})
        self.roi_weight = Decimal(str(weights.get('roi', 0.50)))
        self.risk_weight = Decimal(str(weights.get('risk', 0.30)))
        self.filter_match_weight = Decimal(str(weights.get('filter_match', 0.20)))
        
        # ROI thresholds
        roi_thresholds = self.scoring_config.get('roi_thresholds', {})
        self.roi_excellent = roi_thresholds.get('excellent', 30)
        self.roi_good = roi_thresholds.get('good', 20)
        self.roi_fair = roi_thresholds.get('fair', 10)
        
        # Risk thresholds
        risk_thresholds = self.scoring_config.get('risk_thresholds', {})
        self.risk_low = risk_thresholds.get('low', 30)
        self.risk_medium = risk_thresholds.get('medium', 60)
    
    def calculate_deal_score(
        self,
        roi_pct: Decimal,
        composite_risk_score: int,
        filter_match_score: Optional[int] = None
    ) -> int:
        """
        Calculate composite deal score (0-100).
        
        Args:
            roi_pct: Return on investment percentage
            composite_risk_score: Risk score (0-100, lower is better)
            filter_match_score: How well property matches filters (0-100, optional)
            
        Returns:
            Deal score (0-100)
        """
        # ROI component score (0-100)
        roi_score = self._score_roi(float(roi_pct))
        
        # Risk component score (inverted: low risk = high score)
        risk_score = self._score_risk(composite_risk_score)
        
        # Filter match score (default to 100 if not provided)
        if filter_match_score is None:
            filter_match_score = 100
        
        # Weighted composite score
        try:
            r_w = self.roi_weight
            ri_w = self.risk_weight
            f_w = self.filter_match_weight
            print(f"DEBUG SCORER: roi_score={roi_score}, roi_weight={r_w}, risk_score={risk_score}, risk_weight={ri_w}, filter={filter_match_score}, filter_weight={f_w}")
            composite_score = (
                Decimal(str(roi_score)) * r_w +
                Decimal(str(risk_score)) * ri_w +
                Decimal(str(filter_match_score)) * f_w
            )
        except Exception as e:
            print(f"DEBUG SCORER ERROR: {e}")
            raise
        
        # Round to integer
        final_score = int(composite_score)
        
        # Ensure within bounds
        final_score = max(0, min(100, final_score))
        
        self.logger.debug(
            f"Deal score: {final_score} "
            f"(ROI: {roi_score}, Risk: {risk_score}, Filter: {filter_match_score})"
        )
        
        return final_score
    
    def _score_roi(self, roi_pct: float) -> int:
        """
        Score ROI on 0-100 scale.
        
        Thresholds:
        - 30%+ = 100 points (excellent)
        - 20-30% = 75 points (good)
        - 10-20% = 50 points (fair)
        - 0-10% = 25 points (poor)
        - <0% = 0 points (losing money)
        """
        if roi_pct >= self.roi_excellent:
            return 100
        elif roi_pct >= self.roi_good:
            # Linear interpolation between 75 and 100
            return int(75 + ((roi_pct - self.roi_good) / (self.roi_excellent - self.roi_good)) * 25)
        elif roi_pct >= self.roi_fair:
            # Linear interpolation between 50 and 75
            return int(50 + ((roi_pct - self.roi_fair) / (self.roi_good - self.roi_fair)) * 25)
        elif roi_pct >= 0:
            # Linear interpolation between 25 and 50
            return int(25 + (roi_pct / self.roi_fair) * 25)
        else:
            # Negative ROI
            return 0
    
    def _score_risk(self, composite_risk_score: int) -> int:
        """
        Score risk on 0-100 scale (inverted: low risk = high score).
        
        Thresholds:
        - <30 = 100 points (low risk)
        - 30-60 = 50 points (medium risk)
        - >60 = 0-50 points (high risk)
        """
        if composite_risk_score < self.risk_low:
            return 100
        elif composite_risk_score < self.risk_medium:
            # Linear interpolation between 50 and 100
            return int(100 - ((composite_risk_score - self.risk_low) / 
                             (self.risk_medium - self.risk_low)) * 50)
        else:
            # High risk: linear decay from 50 to 0
            excess_risk = composite_risk_score - self.risk_medium
            max_excess = 100 - self.risk_medium
            return int(50 - (excess_risk / max_excess) * 50)
    
    def calculate_filter_match_score(
        self,
        property_metrics: Dict,
        user_filters: Dict
    ) -> int:
        """
        Calculate how well property matches user filters (0-100).
        
        Each passed filter adds points, failed filters subtract.
        
        Args:
            property_metrics: Dict with property values (roi, budget, etc.)
            user_filters: Dict with user criteria
            
        Returns:
            Filter match score (0-100)
        """
        total_filters = 0
        passed_filters = 0
        
        # Check budget constraint
        if 'max_budget' in user_filters:
            total_filters += 1
            all_in = property_metrics.get('all_in_cost', 0)
            if all_in <= user_filters['max_budget']:
                passed_filters += 1
        
        # Check ROI constraint
        if 'min_roi' in user_filters:
            total_filters += 1
            roi = property_metrics.get('roi_pct', 0)
            if roi >= user_filters['min_roi']:
                passed_filters += 1
        
        # Check rehab constraint
        if 'max_rehab' in user_filters:
            total_filters += 1
            rehab = property_metrics.get('rehab_cost', 0)
            if rehab <= user_filters['max_rehab']:
                passed_filters += 1
        
        # Check risk constraint
        if 'max_risk' in user_filters:
            total_filters += 1
            risk = property_metrics.get('composite_risk_score', 100)
            if risk <= user_filters['max_risk']:
                passed_filters += 1
        
        # Calculate percentage
        if total_filters > 0:
            match_pct = (passed_filters / total_filters) * 100
        else:
            match_pct = 100  # No filters = perfect match
        
        return int(match_pct)
    
    def is_exceptional_deal(
        self,
        deal_score: int,
        roi_pct: Decimal,
        filter_violations: int,
        user_min_roi: Optional[Decimal] = None
    ) -> bool:
        """
        Determine if property qualifies as "exceptional" despite filter violations.
        
        Criteria:
        - Max 2 filter violations
        - Deal score > 80 OR ROI >= 2x user minimum
        
        Args:
            deal_score: Composite deal score
            roi_pct: ROI percentage
            filter_violations: Number of filters violated
            user_min_roi: User's minimum ROI requirement
            
        Returns:
            True if exceptional, False otherwise
        """
        max_violations = config.get('query.exceptional_roi_max_filter_violations', 2)
        roi_multiplier = Decimal(str(config.get('query.exceptional_roi_multiplier', 2.0)))
        
        # Must not violate too many filters
        if filter_violations > max_violations:
            return False
        
        # High deal score = exceptional
        if deal_score > 80:
            return True
        
        # OR: ROI is 2x+ the user's minimum
        if user_min_roi and roi_pct >= (user_min_roi * roi_multiplier):
            return True
        
        return False
