#!/usr/bin/env python3
"""
Simple Autonomous Deal Finder - No Database Required

Processes deals entirely in-memory without requiring PostgreSQL.
Perfect for quick analysis and MVP usage.

Usage:
    python find_deals_simple.py --county Fulton --budget 200000 --min-roi 20
"""
import sys
import json
from pathlib import Path
from decimal import Decimal
from datetime import datetime

# Add project root (this file lives in scripts/, so the root is one level up)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from execution.connectors.fulton_county_connector import fetch_fulton_county_deals
from execution.valuation.cost_calculator import CostCalculator
from execution.valuation.roi_calculator import ROICalculator
from execution.valuation.deal_scorer import DealScorer
from execution.export.spreadsheet_generator import SpreadsheetGenerator
from execution.enrichment.market_intelligence import MarketIntelligenceEnricher


def process_deals_simple(county, state, budget, min_roi, max_rehab, max_risk, strategy):
    """
    Process deals without database - in-memory only.
    """
    print(f"\n{'='*60}")
    print(f"Real Estate Deal Finder - Simple Mode")
    print(f"{'='*60}")
    print(f"Target: {county} County, {state}")
    print(f"Budget: ${budget:,} | Min ROI: {min_roi}% | Strategy: {strategy}")
    print(f"{'='*60}\n")

    # Step 1: Fetch and enrich properties
    print("[1/4] Fetching and enriching properties...")
    if county.lower() == 'fulton' and state.upper() == 'GA':
        properties = fetch_fulton_county_deals()
    else:
        print(f"ERROR: {county} County not yet supported")
        return None

    print(f"[OK] Fetched {len(properties)} properties\n")

    # Step 2: Calculate costs and ROI for each property
    print("[2/4] Calculating costs and ROI...")
    cost_calc = CostCalculator(state, county)
    roi_calc = ROICalculator()
    deal_scorer = DealScorer()

    analyzed_deals = []

    for prop in properties:
        try:
            # Extract data
            sqft = prop.get('sqft', 0) or 0
            year_built = prop.get('year_built', 0) or 0
            enrichment = prop.get('enrichment', {})
            auction_details = prop.get('auction_details', {})

            # Calculate purchase price
            purchase_price = Decimal(str(auction_details.get('minimum_bid', 0)))
            buyers_premium_pct = Decimal('10')  # Standard 10%
            buyers_premium = purchase_price * (buyers_premium_pct / Decimal('100'))

            # Calculate rehab
            rehab_category = 'heavy' if year_built < 1975 else 'medium' if year_built < 2000 else 'light'
            rehab_cost = cost_calc.calculate_rehab_cost(sqft, rehab_category, year_built) if sqft > 0 else Decimal('0')

            # Transaction costs
            transaction_costs = cost_calc.calculate_transaction_costs(purchase_price)
            total_transaction = sum(Decimal(str(v)) for v in transaction_costs.values())

            # Carrying costs
            carrying_data = cost_calc.calculate_carrying_costs(sqft) if sqft > 0 else {'total_carrying': Decimal('0')}
            carrying_costs = carrying_data['total_carrying']

            # All-in cost
            all_in_cost = purchase_price + buyers_premium + rehab_cost + total_transaction + carrying_costs

            # ARV from enrichment
            arv = Decimal(str(enrichment.get('arv_estimate', 0)))

            # As-Is Price (60% of ARV for distressed/wholesale)
            as_is_price = arv * Decimal('0.60')

            # Calculate Max Bid (70% ARV - Rehab)
            # This is the maximum you should bid to maintain 30% profit margin
            max_bid = (arv * Decimal('0.70')) - rehab_cost
            if max_bid < 0:
                max_bid = Decimal('0')

            # ROI calculation
            if strategy == 'flip':
                roi_metrics = roi_calc.calculate_flip_metrics(all_in_cost, arv)
            else:
                monthly_rent = Decimal(str(enrichment.get('estimated_rent_monthly', 0)))
                roi_metrics = roi_calc.calculate_rental_metrics(all_in_cost, monthly_rent)

            roi_pct = roi_metrics.get('roi_pct') or roi_metrics.get('cash_on_cash_return_pct') or Decimal('0')

            # Deal score
            composite_risk = enrichment.get('composite_risk_score', 50)
            deal_score = deal_scorer.calculate_deal_score(roi_pct, composite_risk)

            # Determine bid recommendation
            if max_bid == 0:
                if rehab_cost > (arv * Decimal('0.70')):
                    bid_recommendation = "NO BID - Rehab exceeds 70% ARV"
                else:
                    bid_recommendation = "NO BID - Insufficient profit margin"
            elif purchase_price > max_bid:
                bid_recommendation = f"NO BID - Min bid ${purchase_price:,.0f} exceeds max ${max_bid:,.0f}"
            else:
                potential_profit = max_bid - purchase_price
                bid_recommendation = f"BID UP TO ${max_bid:,.0f} (${potential_profit:,.0f} cushion)"

            # Build deal dict
            deal = {
                'property_id': len(analyzed_deals) + 1,
                'parcel_id': prop.get('parcel_id'),
                'address': prop.get('address'),
                'city': prop.get('city'),
                'state': prop.get('state'),
                'county': prop.get('county'),
                'property_type': prop.get('property_type'),
                'bedrooms': prop.get('bedrooms'),
                'bathrooms': prop.get('bathrooms'),
                'sqft': sqft,
                'year_built': year_built,
                'source': prop.get('source'),
                'source_url': prop.get('source_url'),
                'auction_date': auction_details.get('auction_date'),
                'minimum_bid': float(auction_details.get('minimum_bid', 0)),
                'max_bid': float(max_bid),
                'bid_recommendation': bid_recommendation,
                'as_is_price': float(as_is_price),
                'all_in_cost': float(all_in_cost),
                'arv': float(arv),
                'comp_count': enrichment.get('comp_count', 0),
                'rehab_cost': float(rehab_cost),
                'net_profit': float(roi_metrics.get('net_profit', 0)),
                'roi_pct': float(roi_pct),
                'irr_pct': float(roi_metrics.get('estimated_irr_pct', 0)),
                'deal_score': deal_score,
                'composite_risk_score': composite_risk,
                'crime_score': enrichment.get('crime_score'),
                'flood_zone': enrichment.get('flood_zone'),
                'known_liens_count': enrichment.get('known_liens_count', 0),
                'data_quality_score': enrichment.get('data_quality_score', 50),
                'data_freshness': datetime.now()
            }

            analyzed_deals.append(deal)

        except Exception as e:
            print(f"[WARN] Skipped property {prop.get('parcel_id', 'unknown')}: {e}")
            continue

    print(f"[OK] Analyzed {len(analyzed_deals)} deals\n")

    # Step 3: Filter and rank
    print("[3/4] Filtering and ranking deals...")
    top_deals = []
    exceptional_deals = []

    for deal in analyzed_deals:
        violations = 0
        violation_notes = []

        # Check filters
        if deal['all_in_cost'] > budget:
            violations += 1
            violation_notes.append(f"Over budget by ${deal['all_in_cost'] - budget:,.0f}")

        if deal['roi_pct'] < min_roi:
            violations += 1
            violation_notes.append(f"ROI {deal['roi_pct']:.1f}% below min {min_roi}%")

        if max_rehab and deal['rehab_cost'] > max_rehab:
            violations += 1
            violation_notes.append(f"Rehab ${deal['rehab_cost']:,.0f} over max ${max_rehab:,.0f}")

        if deal['composite_risk_score'] > max_risk:
            violations += 1
            violation_notes.append(f"Risk {deal['composite_risk_score']} over max {max_risk}")

        # Categorize
        if violations == 0:
            top_deals.append(deal)
        elif violations <= 2 and deal['roi_pct'] >= min_roi * 1.5:
            # Exceptional: violates 1-2 filters but has 1.5x the min ROI
            deal['filter_violations_note'] = '; '.join(violation_notes)
            exceptional_deals.append(deal)

    # Sort
    top_deals.sort(key=lambda x: x['deal_score'], reverse=True)
    exceptional_deals.sort(key=lambda x: x['deal_score'], reverse=True)

    print(f"[OK] Top deals: {len(top_deals)} | Exceptional: {len(exceptional_deals)}\n")


    # Step 3.7: Add market intelligence to all deals
    print("[3.7/4] Adding market intelligence from Tax Lien School...")

    try:
        market_enricher = MarketIntelligenceEnricher()

        # Enrich top deals with market intelligence
        for deal in top_deals:
            deal = market_enricher.enrich_deal(deal)
            deal['bidding_strategy'] = market_enricher.generate_bidding_strategy(deal)

        # Enrich analyzed deals for context
        for deal in analyzed_deals:
            deal = market_enricher.enrich_deal(deal)

        print(f"[OK] Added market intelligence to {len(top_deals)} top deals\n")

    except Exception as e:
        print(f"[WARN] Market intelligence unavailable: {e}")
        print("[INFO] Continuing without market intelligence\n")

    # Step 4: Generate spreadsheet
    print("[4/4] Generating spreadsheet...")
    generator = SpreadsheetGenerator()

    query_params = {
        'State': state,
        'County': county,
        'Strategy': strategy,
        'Max Budget': f"${budget:,}",
        'Min ROI': f"{min_roi}%",
        'Max Rehab': f"${max_rehab:,}" if max_rehab else "N/A",
        'Max Risk Score': max_risk,
    }

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{county.lower()}_{state.lower()}_deals_{timestamp}.xlsx"

    spreadsheet_path = generator.generate(top_deals, exceptional_deals, analyzed_deals, query_params, filename)

    print(f"[OK] Spreadsheet generated\n")
    print(f"{'='*60}")
    print(f"SUCCESS - Deal Finder Complete")
    print(f"{'='*60}")
    print(f"Spreadsheet: {spreadsheet_path}")
    print(f"Total properties analyzed: {len(analyzed_deals)}")
    print(f"Top deals (match all filters): {len(top_deals)}")
    print(f"Exceptional deals (high ROI): {len(exceptional_deals)}")
    print(f"\nNext steps:")
    print(f"  1. Open the spreadsheet in Excel")
    print(f"  2. Review 'Top Deals' sheet")
    print(f"  3. Check 'Exceptional ROI' for hidden gems")
    print(f"  4. Conduct due diligence on shortlisted properties")
    print(f"{'='*60}\n")

    return spreadsheet_path


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Find real estate deals autonomously')
    parser.add_argument('--county', required=True, help='County name (e.g., Fulton)')
    parser.add_argument('--state', default='GA', help='State code (default: GA)')
    parser.add_argument('--budget', type=int, default=200000, help='Max all-in budget')
    parser.add_argument('--min-roi', type=float, default=20.0, help='Min ROI percentage')
    parser.add_argument('--max-rehab', type=int, help='Max rehab cost (optional)')
    parser.add_argument('--max-risk', type=int, default=50, help='Max risk score (0-100)')
    parser.add_argument('--strategy', default='flip', choices=['flip', 'rental'], help='Investment strategy')

    args = parser.parse_args()

    try:
        process_deals_simple(
            county=args.county,
            state=args.state,
            budget=args.budget,
            min_roi=args.min_roi,
            max_rehab=args.max_rehab,
            max_risk=args.max_risk,
            strategy=args.strategy
        )
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
