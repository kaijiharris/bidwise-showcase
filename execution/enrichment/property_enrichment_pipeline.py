"""
Property Enrichment Pipeline for Gwinnett County.

Orchestrates:
1. County Assessor data (MOST ACCURATE - official records)
2. Claude AI analysis (intelligent estimates)
3. Financial calculations (systemized formulas)

Priority: Assessor data > Claude analysis > Defaults
"""
import logging
from typing import Dict, List, Optional
from pathlib import Path

from ..analysis.claude_analyzer import ClaudePropertyAnalyzer, PropertyAnalysis
from .gwinnett_assessor_scraper import GwinnettAssessorScraper
from ..valuation.deal_calculator import TaxDeedDealCalculator, DealMetrics


class PropertyEnrichmentPipeline:
    """
    Complete enrichment pipeline for tax deed properties.

    Features:
    - Multi-source data acquisition (Assessor, Claude, defaults)
    - Intelligent data merging (prefer official sources)
    - Financial analysis
    - Quality scoring
    """

    def __init__(
        self,
        use_assessor: bool = True,
        use_claude: bool = True,
        anthropic_api_key: Optional[str] = None
    ):
        """
        Initialize enrichment pipeline.

        Args:
            use_assessor: Enable county assessor scraping (most accurate)
            use_claude: Enable Claude AI analysis
            anthropic_api_key: API key for Claude (optional, uses env var)
        """
        self.logger = logging.getLogger(__name__)
        self.use_assessor = use_assessor
        self.use_claude = use_claude

        # Initialize components
        self.assessor_scraper = GwinnettAssessorScraper() if use_assessor else None
        self.claude_analyzer = (
            ClaudePropertyAnalyzer(api_key=anthropic_api_key)
            if use_claude else None
        )
        self.deal_calculator = TaxDeedDealCalculator(county="Gwinnett")

    def enrich_properties(
        self,
        properties: List[Dict],
        max_assessor_requests: int = 100
    ) -> List[Dict]:
        """
        Enrich a list of properties with complete data.

        Args:
            properties: List of property dicts from tax sale PDF
            max_assessor_requests: Limit assessor requests (rate limiting)

        Returns:
            List of enriched property dicts
        """
        self.logger.info(
            f"Starting enrichment for {len(properties)} properties "
            f"(Assessor: {self.use_assessor}, Claude: {self.use_claude})"
        )

        enriched = []
        assessor_count = 0

        for i, prop in enumerate(properties):
            self.logger.info(
                f"Enriching {i+1}/{len(properties)}: {prop.get('tax_id')}"
            )

            enriched_prop = self._enrich_single_property(
                prop,
                use_assessor=(
                    self.use_assessor and assessor_count < max_assessor_requests
                )
            )

            if enriched_prop.get('_assessor_used'):
                assessor_count += 1

            enriched.append(enriched_prop)

        self.logger.info(
            f"Enrichment complete: {len(enriched)} properties, "
            f"{assessor_count} assessor lookups"
        )

        return enriched

    def _enrich_single_property(
        self,
        prop: Dict,
        use_assessor: bool = True
    ) -> Dict:
        """
        Enrich a single property with all available data sources.

        Data Priority:
        1. County Assessor (official records - MOST RELIABLE)
        2. Claude AI analysis (intelligent estimates)
        3. Defaults (conservative fallbacks)
        """
        enriched = prop.copy()
        enriched['_data_sources'] = []

        # Step 1: County Assessor (MOST ACCURATE)
        assessor_data = None
        if use_assessor and self.assessor_scraper:
            try:
                assessor_data = self.assessor_scraper.get_property_details(
                    prop.get('tax_id', '')
                )
                if assessor_data:
                    enriched.update(assessor_data)
                    enriched['_data_sources'].append('assessor')
                    enriched['_assessor_used'] = True
                    self.logger.info(
                        f"✓ Assessor data: {assessor_data.get('property_type')} - "
                        f"{assessor_data.get('sqft')} sqft"
                    )
            except Exception as e:
                self.logger.warning(f"Assessor lookup failed for {prop.get('tax_id')}: {e}")

        # Step 2: Claude AI Analysis
        claude_analysis = None
        if self.use_claude and self.claude_analyzer:
            try:
                # Merge what we have so far for Claude's context
                claude_input = {**prop, **enriched}

                claude_analysis = self.claude_analyzer.analyze_property(claude_input)

                # Merge Claude's analysis (don't overwrite assessor data)
                claude_dict = claude_analysis.model_dump()
                for key, value in claude_dict.items():
                    # Only use Claude's value if we don't have it from assessor
                    if value is not None and (assessor_data is None or key not in assessor_data):
                        enriched[key] = value

                enriched['_data_sources'].append('claude')
                self.logger.info(
                    f"✓ Claude analysis: {claude_analysis.recommendation}"
                )

            except Exception as e:
                self.logger.warning(f"Claude analysis failed for {prop.get('tax_id')}: {e}")

        # Step 3: Apply defaults for missing critical fields
        enriched = self._apply_defaults(enriched)

        # Step 4: Financial calculations
        try:
            metrics = self.deal_calculator.calculate_deal_metrics(enriched)

            # Add metrics to property
            enriched.update({
                'purchase_price': metrics.purchase_price,
                'rehab_cost': metrics.rehab_cost,
                'closing_costs': metrics.closing_costs,
                'holding_costs': metrics.holding_costs,
                'all_in_cost': metrics.all_in_cost,
                'gross_profit': metrics.gross_profit,
                'net_profit': metrics.net_profit,
                'roi_pct': metrics.roi_pct,
                'cash_on_cash_return': metrics.cash_on_cash_return,
                'deal_score': metrics.deal_score,
                'risk_score': metrics.risk_score,
                'confidence_score': metrics.confidence_score
            })

            enriched['_data_sources'].append('calculations')

        except Exception as e:
            self.logger.error(f"Financial calculations failed for {prop.get('tax_id')}: {e}")

        return enriched

    def _apply_defaults(self, prop: Dict) -> Dict:
        """Apply conservative defaults for missing data."""
        defaults = {
            'property_type': 'unknown',
            'sqft': 1500,  # Conservative default for residential
            'year_built': 1980,  # Middle-age property
            'bedrooms': None,
            'bathrooms': None,
            'city': 'Lawrenceville',  # County seat
            'data_quality_score': 30  # Low if using mostly defaults
        }

        for key, default_value in defaults.items():
            if prop.get(key) is None:
                prop[key] = default_value

        # Update data quality score based on completeness
        has_data = sum(1 for k in ['sqft', 'year_built', 'property_type', 'bedrooms', 'arv'] if prop.get(k))
        prop['data_quality_score'] = min(100, has_data * 20 + prop.get('data_quality_score', 0))

        return prop

    def close(self):
        """Clean up resources."""
        if self.assessor_scraper:
            self.assessor_scraper.close()

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()
