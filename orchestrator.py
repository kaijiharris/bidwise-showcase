"""Orchestrator for coordinating the deal-finding workflow."""
from typing import List, Dict, Optional
from decimal import Decimal
from datetime import datetime
from loguru import logger

from execution.db import db, Property, EnrichmentData, ValuationMetrics
from execution.valuation import CostCalculator, ROICalculator, DealScorer
from execution.enrichment.risk_scorer import RiskScorer
from execution.enrichment.comps_engine import CompsEngine
from execution.enrichment.market_intelligence import MarketIntelligenceEnricher
from execution.export import SpreadsheetGenerator
from execution.utils import config


class DealOrchestrator:
    """
    Coordinates the full workflow from raw property data to ranked deals.
    
    Workflow:
    1. Accept raw property data (from agent scraping)
    2. Enrich with comps, risk data (from agent research)
    3. Calculate costs and ROI
    4. Score and rank properties
    5. Filter by user criteria
    6. Identify exceptional deals
    7. Generate spreadsheet
    """
    
    def __init__(self):
        self.logger = logger.bind(component='DealOrchestrator')
        self.all_comps = []  # Track all comparable properties used
    
    def process_deals(
        self,
        raw_properties: List[Dict],
        user_filters: Dict,
        state: str,
        county: str
    ) -> str:
        """
        Process raw property data through full workflow.
        
        Args:
            raw_properties: List of property dicts from agent scraping
            user_filters: Dict with budget, min_roi, max_rehab, max_risk, strategy
            state: State code (FL, GA)
            county: County name
            
        Returns:
            Path to generated spreadsheet
        """
        self.logger.info(f"Starting deal processing for {len(raw_properties)} properties in {county}, {state}")

        # Collect all comps from raw properties before storing
        self._collect_comps_from_properties(raw_properties)

        # Step 1: Store properties in database
        property_ids = self._store_properties(raw_properties)
        self.logger.info(f"Stored {len(property_ids)} properties in database")
        
        # Step 2: Calculate valuations for all properties
        self._calculate_valuations(property_ids, state, county, user_filters)
        self.logger.info(f"Calculated valuations for {len(property_ids)} properties")
        
        # Step 3: Retrieve and rank deals
        all_deals = self._retrieve_deals(property_ids)
        self.logger.info(f"Retrieved {len(all_deals)} deals with complete data")
        
        # Step 4: Filter by user criteria
        top_deals, exceptional_deals = self._filter_and_rank(all_deals, user_filters)
        self.logger.info(f"Top deals: {len(top_deals)}, Exceptional: {len(exceptional_deals)}")
        
        # Step 5: Generate spreadsheet
        spreadsheet_path = self._generate_spreadsheet(
            top_deals,
            exceptional_deals,
            all_deals,
            user_filters,
            state,
            county
        )
        
        self.logger.info(f"✅ Spreadsheet generated: {spreadsheet_path}")
        
        return spreadsheet_path

    def _collect_comps_from_properties(self, raw_properties: List[Dict]) -> None:
        """Extract all comparable properties from enrichment data."""
        for prop in raw_properties:
            enrichment = prop.get('enrichment', {})

            # Check if this property has comp data stored
            comps_data = enrichment.get('comps', [])
            if comps_data:
                self.all_comps.extend(comps_data)

        # Remove duplicates based on address
        seen_addresses = set()
        unique_comps = []
        for comp in self.all_comps:
            addr = comp.get('address', '')
            if addr and addr not in seen_addresses:
                seen_addresses.add(addr)
                unique_comps.append(comp)

        self.all_comps = unique_comps
        self.logger.info(f"Collected {len(self.all_comps)} unique comparable properties")

    def _store_properties(self, raw_properties: List[Dict]) -> List[int]:
        """Store raw properties in database."""
        property_ids = []
        
        # Import models inside method to avoid circular imports
        from execution.db.models import Property, AuctionDetail, TaxLienDetail, OTCDetail, EnrichmentData
        
        with db.get_session() as session:
            for prop_data in raw_properties:
                # Extract nested data
                auction_data = prop_data.pop('auction_details', None)
                lien_data = prop_data.pop('tax_lien_details', None)
                otc_data = prop_data.pop('otc_details', None)
                enrichment_data = prop_data.pop('enrichment', None)
                
                # Helper to parse dates
                def parse_dates(data_dict, date_keys):
                    if not data_dict: return
                    for key in date_keys:
                        if key in data_dict and isinstance(data_dict[key], str):
                            try:
                                data_dict[key] = datetime.fromisoformat(data_dict[key])
                            except ValueError:
                                pass # Keep as string if parse fails (might fail later but better effort)

                # Map sale_date to auction_date if needed (for backwards compatibility)
                if auction_data and 'sale_date' in auction_data and 'auction_date' not in auction_data:
                    auction_data['auction_date'] = auction_data.pop('sale_date')

                # Filter out fields not in AuctionDetail model (auction_id, auction_url are not in schema)
                if auction_data:
                    valid_auction_fields = {'auction_platform', 'auction_date', 'auction_type', 'minimum_bid',
                                           'current_bid', 'buyers_premium_pct', 'deposit_required', 'redemption_period_days'}
                    auction_data = {k: v for k, v in auction_data.items() if k in valid_auction_fields}

                # Parse dates in nested objects
                parse_dates(auction_data, ['auction_date'])
                parse_dates(lien_data, ['sale_date', 'redemption_deadline'])
                parse_dates(otc_data, ['listing_date'])
                
                # Check if property exists
                existing = session.query(Property).filter_by(
                    parcel_id=prop_data['parcel_id']
                ).first()
                
                if existing:
                    # Update existing
                    for key, value in prop_data.items():
                        if hasattr(existing, key):
                            # Convert bathrooms to Decimal if present
                            if key == 'bathrooms' and value is not None:
                                try: value = Decimal(str(value))
                                except: value = None
                            setattr(existing, key, value)
                    existing.updated_at = datetime.now()
                    existing.data_freshness = datetime.now()
                    
                    # Update relationships (simplified: delete old, create new?)
                    # For MVP, we'll just update if attributes match, or replacements
                    if auction_data:
                        if existing.auction_details:
                            for k, v in auction_data.items(): setattr(existing.auction_details, k, v)
                        else:
                            existing.auction_details = AuctionDetail(**auction_data)
                            
                    if enrichment_data:
                        # Extract extra fields not in model (best_comp_*, comps)
                        extra_fields = {k: v for k, v in enrichment_data.items()
                                      if k.startswith('best_comp_') or k == 'comps'}
                        # Only pass model fields to EnrichmentData
                        model_fields = {k: v for k, v in enrichment_data.items()
                                       if not k.startswith('best_comp_') and k != 'comps'}

                        if existing.enrichment:
                             for k, v in model_fields.items():
                                 if hasattr(existing.enrichment, k):
                                     setattr(existing.enrichment, k, v)
                             # Store extra fields in JSON column
                             if extra_fields:
                                 existing.enrichment.title_flags = extra_fields
                        else:
                            existing.enrichment = EnrichmentData(**model_fields)
                            if extra_fields:
                                existing.enrichment.title_flags = extra_fields
                            
                    property_ids.append(existing.id)
                else:
                    # Create new
                    # Handle decimals in prop_data
                    if 'bathrooms' in prop_data and prop_data['bathrooms'] is not None:
                        try: prop_data['bathrooms'] = Decimal(str(prop_data['bathrooms']))
                        except: prop_data['bathrooms'] = None

                    new_prop = Property(**prop_data)
                    new_prop.data_freshness = datetime.now()
                    
                    if auction_data:
                        new_prop.auction_details = AuctionDetail(**auction_data)
                    if lien_data:
                        new_prop.tax_lien_details = TaxLienDetail(**lien_data)
                    if otc_data:
                        new_prop.otc_details = OTCDetail(**otc_data)
                    if enrichment_data:
                        # Extract extra fields not in model (best_comp_*, comps)
                        extra_fields = {k: v for k, v in enrichment_data.items()
                                      if k.startswith('best_comp_') or k == 'comps'}
                        model_fields = {k: v for k, v in enrichment_data.items()
                                       if not k.startswith('best_comp_') and k != 'comps'}
                        new_prop.enrichment = EnrichmentData(**model_fields)
                        if extra_fields:
                            new_prop.enrichment.title_flags = extra_fields
                        
                    session.add(new_prop)
                    session.flush()
                    property_ids.append(new_prop.id)
        
        return property_ids
    
    def _calculate_valuations(
        self,
        property_ids: List[int],
        state: str,
        county: str,
        user_filters: Dict
    ) -> None:
        """Calculate costs and ROI for all properties."""
        cost_calc = CostCalculator(state, county)
        roi_calc = ROICalculator()
        deal_scorer = DealScorer()
        risk_scorer = RiskScorer(state, county)
        comps_engine = CompsEngine(state, county)
        
        with db.get_session() as session:
            for prop_id in property_ids:
                try:
                    prop = session.query(Property).get(prop_id)
                    if not prop:
                        self.logger.warning(f"Property with ID {prop_id} not found, skipping valuation.")
                        continue
                    
                    # Get source-specific details
                    auction_detail = prop.auction_details
                    tax_lien_detail = prop.tax_lien_details
                    otc_detail = prop.otc_details
                    enrichment = prop.enrichment
                    
                    def safe_decimal(val):
                        if val is None: return Decimal('0')
                        if isinstance(val, Decimal): return val
                        try: return Decimal(str(val))
                        except: return Decimal('0')

                    # Property attributes with defaults
                    sqft = int(prop.sqft) if prop.sqft is not None else 0
                    year_built = int(prop.year_built) if prop.year_built is not None else 0
                    
                    # Calculate purchase price
                    purchase_data = cost_calc.calculate_purchase_price(
                        prop,
                        auction_detail,
                        tax_lien_detail,
                        otc_detail
                    )
                    purchase_price = safe_decimal(purchase_data['purchase_price'])
                    
                    # Calculate rehab cost
                    rehab_cost = Decimal('0')
                    rehab_category = 'medium'
                    if sqft > 0:
                        rehab_cost = cost_calc.calculate_rehab_cost(
                            sqft,
                            rehab_category,
                            year_built
                        )
                    
                    # Calculate transaction costs
                    transaction_costs = cost_calc.calculate_transaction_costs(
                        purchase_price,
                        enrichment.avm_value if enrichment else None
                    )
                    
                    # Calculate carrying costs
                    carrying_costs = Decimal('0')
                    if sqft > 0:
                        carrying_data = cost_calc.calculate_carrying_costs(
                            sqft,
                            property_tax_annual=None  # TODO: Get from enrichment
                        )
                        carrying_costs = carrying_data['total_carrying']
                    
                    # All-in cost
                    all_in_cost = cost_calc.calculate_all_in_cost(
                        purchase_price,
                        safe_decimal(purchase_data.get('buyers_premium', 0)),
                        rehab_cost,
                        transaction_costs,
                        {'total_carrying': carrying_costs}
                    )
                    
                    # PHASE 5: ENRICHMENT (Dynamic Scoring)
                    # Use defaults for enrichment logic
                    risk_data = risk_scorer.calculate_composite_score({
                        'city': prop.city,
                        'flood_zone': enrichment.flood_zone if enrichment else 'X',
                        'known_liens_count': enrichment.known_liens_count if enrichment else 0
                    })
                    
                    # Update enrichment data in DB
                    if not enrichment:
                        from execution.db.models import EnrichmentData
                        enrichment = EnrichmentData(property_id=prop_id)
                        session.add(enrichment)
                    
                    enrichment.crime_score = risk_data['crime_score']
                    enrichment.flood_risk_score = risk_data['flood_risk_score']
                    enrichment.composite_risk_score = risk_data['composite_risk_score']
                    enrichment.flood_zone = risk_data['flood_zone']

                    # PHASE 5: VALUATION VALIDATION
                    val_data = comps_engine.validate_arv({
                        'city': prop.city,
                        'sqft': sqft,
                        'arv_estimate': enrichment.arv_estimate if enrichment else 0,
                        'avm_value': enrichment.avm_value if enrichment else 0
                    })
                    
                    arv = safe_decimal(val_data['validated_arv'])
                    psf = safe_decimal(val_data['avg_psf'])
                    comp_count = val_data['comp_count']
                    
                    # NEW: Calculate "AS IS" Price (e.g., 60% of ARV as a baseline for distressed state)
                    as_is_price = arv * Decimal('0.60')
                    
                    if enrichment:
                        enrichment.data_quality_score = 80 # Higher confidence now
                        enrichment.comp_count = comp_count
                        enrichment.avg_price_per_sqft = psf
                        enrichment.avm_value = as_is_price # Use as_is as baseline AVM if missing
                    
                    # ROI based on validated ARV
                    strategy = user_filters.get('strategy', 'flip')
                    
                    if strategy == 'flip':
                        roi_metrics = roi_calc.calculate_flip_metrics(all_in_cost, arv)
                    else:
                        # Rental
                        monthly_rent = safe_decimal(enrichment.estimated_rent_monthly if enrichment else 0)
                        roi_metrics = roi_calc.calculate_rental_metrics(all_in_cost, monthly_rent)
                    
                    # Calculate deal score
                    composite_risk = enrichment.composite_risk_score if enrichment else 50
                    roi_val = roi_metrics.get('roi_pct') or roi_metrics.get('cash_on_cash_return_pct') or Decimal('0')
                    deal_score = deal_scorer.calculate_deal_score(
                        roi_val,
                        composite_risk
                    )
                    
                    # NEW: Calculate Max Bid and generate summary
                    # Formula: (ARV * 0.70) - Rehab
                    max_bid = (arv * Decimal('0.70')) - rehab_cost
                    if max_bid < 0: max_bid = Decimal('0')
                    
                    # Generate breakdown notes
                    notes = f"{prop.bedrooms}BR/{prop.bathrooms}BA. " if prop.bedrooms else ""
                    notes += f"ARV: {arv:,.0f} (${psf}/sqft * {sqft} sqft). "
                    notes += f"Rehab: ${rehab_cost:,.0f} ({rehab_category}). "
                    
                    if max_bid == 0:
                        if rehab_cost > (arv * Decimal('0.70')):
                            notes += "NO BID: Rehab costs exceed 70% ARV threshold."
                        elif composite_risk > user_filters.get('max_risk', 100):
                            notes += f"NO BID: Risk score ({composite_risk}) exceeds tolerance."
                        else:
                            notes += "NO BID: Projected profit insufficient for risk."
                    else:
                        notes += f"Score: {deal_score}/100."

                    # Store or update valuation
                    valuation = session.query(ValuationMetrics).filter_by(property_id=prop_id).first()
                    
                    if not valuation:
                        valuation = ValuationMetrics(property_id=prop_id)
                        session.add(valuation)
                    
                    # Update valuation fields
                    valuation.purchase_price = safe_decimal(purchase_data['purchase_price'])
                    valuation.buyers_premium = safe_decimal(purchase_data['buyers_premium'])
                    valuation.rehab_category = rehab_category
                    valuation.rehab_cost = safe_decimal(rehab_cost)
                    valuation.closing_costs = safe_decimal(transaction_costs['closing_costs'])
                    valuation.transfer_tax = safe_decimal(transaction_costs['transfer_tax'])
                    valuation.all_in_cost = safe_decimal(all_in_cost)
                    valuation.projected_sale_price = arv
                    valuation.net_profit = safe_decimal(roi_metrics.get('net_profit'))
                    valuation.roi_pct = safe_decimal(roi_val)
                    valuation.estimated_irr_pct = safe_decimal(roi_metrics.get('estimated_irr_pct') or roi_metrics.get('five_year_irr_pct'))
                    valuation.deal_score = deal_score
                    valuation.config_version = config.get('system.version', '1.0.0')
                    valuation.calculated_at = datetime.now()
                    # Store extra metadata for exporter
                    valuation.market_config = notes # Overloading for now or use a proper field
                    valuation.avm_value = as_is_price # Map back to model if field exists or use JSON

                except Exception as e:
                    self.logger.error(f"Error processing property {prop_id}: {e}")
                    session.rollback()
                    continue
    
    def _retrieve_deals(self, property_ids: List[int]) -> List[Dict]:
        """Retrieve all properties with valuation and enrichment data."""
        deals = []
        market_intel = MarketIntelligenceEnricher()

        with db.get_session() as session:
            for prop_id in property_ids:
                prop = session.query(Property).get(prop_id)
                if not prop or not prop.valuation:
                    continue
                
                enrichment = prop.enrichment
                valuation = prop.valuation
                
                # Build deal dict
                deal = {
                    'property_id': prop.id,
                    'parcel_id': prop.parcel_id,
                    'address': prop.address,
                    'city': prop.city,
                    'state': prop.state,
                    'county': prop.county,
                    'property_type': prop.property_type,
                    'bedrooms': prop.bedrooms,
                    'bathrooms': float(prop.bathrooms) if prop.bathrooms else None,
                    'sqft': prop.sqft,
                    'year_built': prop.year_built,
                    'source': prop.source,
                    'source_url': prop.source_url,
                    
                    # Auction/lien/OTC details
                    'auction_date': prop.auction_details.auction_date if prop.auction_details else None,
                    'minimum_bid': float(prop.auction_details.minimum_bid) if prop.auction_details and prop.auction_details.minimum_bid else None,
                    
                    # Valuation
                    'all_in_cost': float(valuation.all_in_cost) if valuation.all_in_cost else 0,
                    'arv': float(valuation.projected_sale_price) if valuation.projected_sale_price else 0,
                    'rehab_cost': float(valuation.rehab_cost) if valuation.rehab_cost else 0,
                    'net_profit': float(valuation.net_profit) if valuation.net_profit else 0,
                    'roi_pct': float(valuation.roi_pct) if valuation.roi_pct else 0,
                    'irr_pct': float(valuation.estimated_irr_pct) if valuation.estimated_irr_pct else 0,
                    'deal_score': valuation.deal_score or 0,

                    # Calculate max_bid and as_is_price
                    'max_bid': float((valuation.projected_sale_price * Decimal('0.70')) - valuation.rehab_cost) if valuation.projected_sale_price and valuation.rehab_cost else 0,
                    'as_is_price': float(valuation.projected_sale_price * Decimal('0.60')) if valuation.projected_sale_price else 0,
                    
                    # Risk & enrichment
                    'composite_risk_score': enrichment.composite_risk_score if enrichment else 50,
                    'crime_score': enrichment.crime_score if enrichment else None,
                    'flood_zone': enrichment.flood_zone if enrichment else None,
                    'known_liens_count': enrichment.known_liens_count if enrichment else 0,
                    'data_quality_score': enrichment.data_quality_score if enrichment else 50,

                    # Best comparable property (stored in title_flags JSON field)
                    'best_comp_address': (enrichment.title_flags or {}).get('best_comp_address') if enrichment else None,
                    'best_comp_price': float((enrichment.title_flags or {}).get('best_comp_price', 0)) if enrichment and (enrichment.title_flags or {}).get('best_comp_price') else None,
                    'best_comp_beds': (enrichment.title_flags or {}).get('best_comp_beds') if enrichment else None,
                    'best_comp_baths': float((enrichment.title_flags or {}).get('best_comp_baths', 0)) if enrichment and (enrichment.title_flags or {}).get('best_comp_baths') else None,
                    'best_comp_sqft': float((enrichment.title_flags or {}).get('best_comp_sqft', 0)) if enrichment and (enrichment.title_flags or {}).get('best_comp_sqft') else None,

                    # Comp count
                    'comp_count': enrichment.comp_count if enrichment and enrichment.comp_count else 0,

                    # Taxes owed (minimum bid at auction)
                    'taxes_owed': float(prop.auction_details.minimum_bid) if prop.auction_details and prop.auction_details.minimum_bid else 0,

                    # Source URL (auction listing link)
                    'source_url': prop.source_url or '',

                    # Metadata
                    'data_freshness': prop.data_freshness
                }

                # Add market intelligence and bidding recommendation
                deal = market_intel.enrich_deal(deal)
                deal['bid_recommendation'] = market_intel.generate_bidding_strategy(deal)

                deals.append(deal)
        
        return deals
    
    def _filter_and_rank(
        self,
        all_deals: List[Dict],
        user_filters: Dict
    ) -> tuple[List[Dict], List[Dict]]:
        """Filter deals by user criteria and identify exceptional deals."""
        top_deals = []
        exceptional_deals = []
        
        for deal in all_deals:
            # Count filter violations
            violations = 0
            violation_notes = []
            
            # Budget filter
            if 'budget' in user_filters:
                if deal['all_in_cost'] > user_filters['budget']:
                    violations += 1
                    violation_notes.append(f"Over budget by ${deal['all_in_cost'] - user_filters['budget']:,.0f}")
            
            # ROI filter
            if 'min_roi' in user_filters:
                if deal['roi_pct'] < user_filters['min_roi']:
                    violations += 1
                    violation_notes.append(f"ROI {deal['roi_pct']:.1f}% below min {user_filters['min_roi']}%")
            
            # Rehab filter
            if 'max_rehab' in user_filters:
                if deal['rehab_cost'] > user_filters['max_rehab']:
                    violations += 1
                    violation_notes.append(f"Rehab ${deal['rehab_cost']:,.0f} over max ${user_filters['max_rehab']:,.0f}")
            
            # Risk filter
            if 'max_risk' in user_filters:
                if deal['composite_risk_score'] > user_filters['max_risk']:
                    violations += 1
                    violation_notes.append(f"Risk {deal['composite_risk_score']} over max {user_filters['max_risk']}")
            
            # Categorize deal
            if violations == 0:
                # Perfect match
                top_deals.append(deal)
            elif violations <= 2:
                # Check if exceptional
                deal_scorer = DealScorer()
                is_exceptional = deal_scorer.is_exceptional_deal(
                    deal['deal_score'],
                    Decimal(str(deal['roi_pct'])),
                    violations,
                    Decimal(str(user_filters.get('min_roi', 0)))
                )
                
                if is_exceptional:
                    deal['filter_violations_note'] = '; '.join(violation_notes)
                    exceptional_deals.append(deal)
        
        # Sort by deal score (descending)
        top_deals.sort(key=lambda x: x['deal_score'], reverse=True)
        exceptional_deals.sort(key=lambda x: x['deal_score'], reverse=True)
        
        return top_deals, exceptional_deals
    
    def _generate_spreadsheet(
        self,
        top_deals: List[Dict],
        exceptional_deals: List[Dict],
        all_deals: List[Dict],
        user_filters: Dict,
        state: str,
        county: str
    ) -> str:
        """Generate Excel spreadsheet."""
        generator = SpreadsheetGenerator()
        
        # Build query params for summary
        query_params = {
            'State': state,
            'County': county,
            'Strategy': user_filters.get('strategy', 'flip'),
            'Max Budget': f"${user_filters.get('budget', 0):,}",
            'Min ROI': f"{user_filters.get('min_roi', 0)}%",
            'Max Rehab': f"${user_filters.get('max_rehab', 0):,}",
            'Max Risk Score': user_filters.get('max_risk', 100),
        }
        
        # Generate filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{county.lower()}_{state.lower()}_deals_{timestamp}.xlsx"
        
        return generator.generate(top_deals, exceptional_deals, all_deals, query_params, filename, all_comps=self.all_comps)
