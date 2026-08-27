"""
Market Intelligence Enricher

Enhances property deals with market-specific intelligence from Tax Lien School
and other educational resources. Provides context that helps investors make
better bidding decisions.
"""
from typing import Dict, Optional
from pathlib import Path
from loguru import logger
import json
from datetime import datetime, timedelta


class MarketIntelligenceEnricher:
    """
    Enriches deals with market intelligence from Tax Lien School and cached data.

    Provides:
    - State-specific tax sale rules
    - Redemption periods and interest rates
    - County-specific auction procedures
    - Bidding strategies and best practices
    """

    def __init__(self, cache_dir: Optional[Path] = None):
        """
        Initialize enricher.

        Args:
            cache_dir: Directory for cached intelligence data
        """
        self.cache_dir = cache_dir or Path(".tmp/taxlien_cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.logger = logger.bind(enricher='MarketIntelligence')

        # State-specific baseline data (fallback if scraping fails)
        self.state_baselines = {
            'GA': {
                'tax_sale_type': 'Redeemable Tax Deed',
                'redemption_period': '12 months',
                'interest_rate': '20% per year',
                'bidding_process': 'Competitive bidding - highest bidder wins',
                'investor_advantages': [
                    'Properties can be acquired at 60-90% below market value',
                    'Redemption provides 20% annual interest if owner redeems',
                    'Clear title after redemption period expires',
                    'Strong investor protections under Georgia law'
                ],
                'key_considerations': [
                    'Title search essential - check for senior liens',
                    'Property inspection recommended before bidding',
                    'Budget for potential legal costs (quiet title action)',
                    '12-month redemption period before full ownership'
                ]
            },
            'FL': {
                'tax_sale_type': 'Tax Lien Certificate',
                'redemption_period': '24 months',
                'interest_rate': 'Auction rate (bidding down from 18%)',
                'bidding_process': 'Bid down interest rate - lowest rate wins',
                'investor_advantages': [
                    'High interest rates (up to 18% annually)',
                    'First position lien - senior to most other liens',
                    'Can apply for tax deed after 2 years',
                    'Low entry point - liens start at unpaid tax amount'
                ],
                'key_considerations': [
                    'May need to pay subsequent taxes to protect investment',
                    'Property may be in poor condition',
                    '2-year wait for tax deed application',
                    'Competition can drive interest rates very low'
                ]
            }
        }

    def get_cached_state_data(self, state: str) -> Optional[Dict]:
        """
        Load cached state guide data.

        Args:
            state: State code (e.g., 'GA', 'FL')

        Returns:
            Cached state guide data or None
        """
        state_full = self._state_code_to_name(state)
        cache_file = self.cache_dir / f"{state_full.lower().replace(' ', '-')}_guide.json"

        if cache_file.exists():
            # Check if cache is recent (within 30 days)
            mtime = datetime.fromtimestamp(cache_file.stat().st_mtime)
            if datetime.now() - mtime < timedelta(days=30):
                try:
                    with open(cache_file, 'r') as f:
                        return json.load(f)
                except Exception as e:
                    self.logger.warning(f"Could not load cached data: {e}")

        return None

    def enrich_deal(self, deal: Dict) -> Dict:
        """
        Enrich a deal with market intelligence.

        Args:
            deal: Deal dict from deal finder

        Returns:
            Deal dict with added market_intelligence field
        """
        state = deal.get('state', 'GA')
        county = deal.get('county', 'Unknown')

        # Try to load cached data
        cached_data = self.get_cached_state_data(state)

        if cached_data and cached_data.get('state_guide'):
            guide = cached_data['state_guide']
        else:
            # Fall back to baseline data
            guide = self.state_baselines.get(state, self.state_baselines['GA'])

        # Build market intelligence summary
        intelligence = {
            'tax_sale_type': guide.get('tax_sale_type'),
            'redemption_period': guide.get('redemption_period'),
            'interest_rate': guide.get('interest_rate'),
            'bidding_process': guide.get('bidding_process'),
            'investor_advantages': guide.get('investor_advantages', [])[:3],  # Top 3
            'key_considerations': guide.get('key_considerations', [])[:3],  # Top 3
            'data_source': 'Tax Lien School' if cached_data else 'Baseline Knowledge'
        }

        # Add county-specific notes
        intelligence['county_notes'] = self._get_county_notes(state, county)

        deal['market_intelligence'] = intelligence
        return deal

    def _get_county_notes(self, state: str, county: str):
        """
        Get county-specific notes and tips.

        Args:
            state: State code
            county: County name

        Returns:
            List of county-specific notes
        """
        # Fulton County specific intelligence
        if state == 'GA' and 'fulton' in county.lower():
            return [
                "Fulton County holds monthly tax sales at the courthouse",
                "Properties typically in Atlanta metro - high demand area",
                "Auctions are in-person at 136 Pryor St SW, Atlanta",
                "Property list published ~4 weeks before auction",
                "High competition on well-located properties"
            ]

        # Generic county notes
        return [
            f"{county} County follows standard {state} tax sale procedures",
            "Check county website for specific auction dates and times",
            "Contact county tax commissioner for property list"
        ]

    def _state_code_to_name(self, state_code: str) -> str:
        """Convert state code to full name."""
        states = {
            'GA': 'Georgia',
            'FL': 'Florida',
            'AL': 'Alabama',
            'TN': 'Tennessee',
            'NC': 'North Carolina',
            'SC': 'South Carolina'
        }
        return states.get(state_code.upper(), state_code)

    def generate_bidding_strategy(self, deal: Dict) -> str:
        """
        Generate auction bidding strategy based on market intelligence and deal metrics.

        Args:
            deal: Enriched deal dict

        Returns:
            Bidding strategy recommendation string
        """
        max_bid = deal.get('max_bid', 0)
        min_bid = deal.get('minimum_bid', 0)
        roi_pct = deal.get('roi_pct', 0)
        risk_score = deal.get('composite_risk_score', 50)
        intel = deal.get('market_intelligence', {})

        # Build strategy
        strategy_parts = []

        # Opening recommendation
        if max_bid > min_bid * 1.5:
            strategy_parts.append(f"STRONG BUY: Bid up to ${max_bid:,.0f} (${max_bid - min_bid:,.0f} cushion)")
        elif max_bid > min_bid * 1.2:
            strategy_parts.append(f"MODERATE BUY: Bid conservatively up to ${max_bid:,.0f}")
        elif max_bid > min_bid:
            strategy_parts.append(f"CAUTIOUS: Tight margins - max ${max_bid:,.0f}")
        else:
            strategy_parts.append("PASS: Minimum bid exceeds profitable range")

        # Risk-based advice
        if risk_score < 30:
            strategy_parts.append("Low risk property - safer investment")
        elif risk_score > 60:
            strategy_parts.append("High risk - factor in extra contingency")

        # ROI-based advice
        if roi_pct > 0.30:
            strategy_parts.append(f"Excellent {roi_pct*100:.0f}% ROI - strong opportunity")
        elif roi_pct > 0.20:
            strategy_parts.append(f"Good {roi_pct*100:.0f}% ROI - solid deal")

        # Market-specific advice
        redemption = intel.get('redemption_period')
        if redemption:
            strategy_parts.append(f"Note: {redemption} redemption period in {intel.get('tax_sale_type', 'tax sale')}")

        return " | ".join(strategy_parts)


def test_enricher():
    """Test market intelligence enricher."""
    print("Testing Market Intelligence Enricher...")
    print("=" * 60)

    enricher = MarketIntelligenceEnricher()

    # Test deal
    test_deal = {
        'address': '123 Test St',
        'city': 'Atlanta',
        'state': 'GA',
        'county': 'Fulton',
        'minimum_bid': 50000,
        'max_bid': 85000,
        'roi_pct': 0.28,
        'composite_risk_score': 35
    }

    print("\nTest 1: Enriching deal with market intelligence...")
    enriched = enricher.enrich_deal(test_deal)

    intel = enriched.get('market_intelligence', {})
    print(f"  [OK] Tax Sale Type: {intel.get('tax_sale_type')}")
    print(f"  [OK] Redemption Period: {intel.get('redemption_period')}")
    print(f"  [OK] Interest Rate: {intel.get('interest_rate')}")
    print(f"  [OK] Investor Advantages: {len(intel.get('investor_advantages', []))}")
    print(f"  [OK] County Notes: {len(intel.get('county_notes', []))}")

    print("\nTest 2: Generating bidding strategy...")
    strategy = enricher.generate_bidding_strategy(enriched)
    print(f"  [OK] Strategy: {strategy}")

    print("\n" + "=" * 60)
    print("Test complete!")


if __name__ == '__main__':
    test_enricher()
