"""Spreadsheet generation module for exporting deal analysis."""
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import CellIsRule
from loguru import logger

from ..utils import config


class SpreadsheetGenerator:
    """
    Generate formatted XLSX spreadsheets with deal analysis.

    Creates multi-sheet workbooks:
    - Sheet 1: All Leads (all analyzed properties)
    - Sheet 2: Top Deals (filtered results matching all criteria)
    - Sheet 3: Exceptional ROI (outside filters but high scoring)
    - Sheet 4: Summary & Disclaimers (county-specific explanations)
    """

    def __init__(self, output_dir: str = ".tmp"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logger = logger.bind(generator='SpreadsheetGenerator')

    def generate(
        self,
        top_deals: List[Dict],
        exceptional_deals: List[Dict],
        all_deals: List[Dict],
        query_params: Dict,
        filename: Optional[str] = None,
        all_comps: Optional[List[Dict]] = None
    ) -> str:
        """
        Generate complete spreadsheet with deal analysis.

        Args:
            top_deals: List of properties matching filters
            exceptional_deals: List of high-ROI properties outside filters
            all_deals: List of all analyzed properties
            query_params: User query parameters for summary
            filename: Optional custom filename

        Returns:
            Path to generated XLSX file
        """
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"real_estate_deals_{timestamp}.xlsx"

        filepath = self.output_dir / filename

        # Create new workbook
        wb = openpyxl.Workbook()

        # Remove default sheet
        if 'Sheet' in wb.sheetnames:
            wb.remove(wb['Sheet'])

        # Create sheets in order
        self._create_all_leads_sheet(wb, all_deals)
        self._create_top_deals_sheet(wb, top_deals)

        if exceptional_deals:
            self._create_exceptional_deals_sheet(wb, exceptional_deals)

        self._create_summary_sheet(wb, top_deals, exceptional_deals, all_deals, query_params)

        # Add Comparable Properties sheet if comps provided
        if all_comps:
            self._create_comps_sheet(wb, all_comps)

        # Save workbook
        wb.save(filepath)

        self.logger.info(f"Spreadsheet generated: {filepath}")

        return str(filepath)

    def _create_all_leads_sheet(self, wb: openpyxl.Workbook, deals: List[Dict]) -> None:
        """Create 'All Leads' sheet with all analyzed properties."""
        ws = wb.create_sheet("All Leads", 0)

        columns = [
            ("Address", 35),
            ("City", 15),
            ("Parcel ID", 20),
            ("Type", 15),
            ("Bed/Bath", 10),
            ("Sqft", 10),
            ("Year Built", 12),
            ("Taxes Owed", 15),
            ("Min Bid", 15),
            ("Max Bid", 15),
            ("Bid Recommendation", 50),
            ("As-Is Price", 15),
            ("ARV", 15),
            ("Rehab Cost", 15),
            ("All-In Cost (Min Bid)", 18),
            ("Net Profit (Min Bid)", 18),
            ("ROI %", 10),
            ("Deal Score", 10),
            ("Risk Score", 10),
            ("Best Comp", 45),
            ("Comp Price", 15),
            ("Comp Beds/Baths", 15),
            ("Source URL", 40)
        ]

        # Header formatting
        header_font = Font(bold=True, color="FFFFFF", size=11)
        header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")

        for col_idx, (name, width) in enumerate(columns, 1):
            cell = ws.cell(row=1, column=col_idx, value=name)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")
            ws.column_dimensions[get_column_letter(col_idx)].width = width

        # Data rows
        for row_idx, deal in enumerate(deals, 2):
            bed = deal.get('bedrooms')
            bath = deal.get('bathrooms')

            ws.cell(row=row_idx, column=1, value=deal.get('address'))
            ws.cell(row=row_idx, column=2, value=deal.get('city'))
            ws.cell(row=row_idx, column=3, value=deal.get('parcel_id'))
            ws.cell(row=row_idx, column=4, value=deal.get('property_type'))
            ws.cell(row=row_idx, column=5, value=f"{bed}/{bath}" if bed and bath else "")
            ws.cell(row=row_idx, column=6, value=deal.get('sqft'))
            ws.cell(row=row_idx, column=7, value=deal.get('year_built'))

            # Financial data with formatting
            self._set_currency(ws, row_idx, 8, deal.get('taxes_owed'))  # Taxes owed
            self._set_currency(ws, row_idx, 9, deal.get('minimum_bid'))
            self._set_currency(ws, row_idx, 10, deal.get('max_bid'))

            # Bid recommendation with conditional formatting
            bid_rec = deal.get('bid_recommendation', '')
            bid_cell = ws.cell(row=row_idx, column=11, value=bid_rec)
            if 'NO BID' in bid_rec or 'PASS' in bid_rec:
                bid_cell.fill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
                bid_cell.font = Font(bold=True, color="9C0006")
            elif 'BID UP TO' in bid_rec or 'STRONG BUY' in bid_rec:
                bid_cell.fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
                bid_cell.font = Font(bold=True, color="006100")

            self._set_currency(ws, row_idx, 12, deal.get('as_is_price'))
            self._set_currency(ws, row_idx, 13, deal.get('arv'))
            self._set_currency(ws, row_idx, 14, deal.get('rehab_cost'))
            self._set_currency(ws, row_idx, 15, deal.get('all_in_cost'))
            self._set_currency(ws, row_idx, 16, deal.get('net_profit'))
            self._set_percentage(ws, row_idx, 17, deal.get('roi_pct'))

            ws.cell(row=row_idx, column=18, value=deal.get('deal_score'))
            ws.cell(row=row_idx, column=19, value=deal.get('composite_risk_score'))

            # Best comparable property with Google Maps link
            comp_address = deal.get('best_comp_address')
            if comp_address:
                # Handle address - could be string or dict
                if isinstance(comp_address, dict):
                    # Build address string from dict
                    parts = []
                    if comp_address.get('streetAddress'):
                        parts.append(comp_address['streetAddress'])
                    if comp_address.get('city'):
                        parts.append(comp_address['city'])
                    if comp_address.get('state'):
                        parts.append(comp_address['state'])
                    if comp_address.get('zipcode'):
                        parts.append(str(comp_address['zipcode']))
                    address_str = ', '.join(parts) if parts else 'Unknown'
                else:
                    address_str = str(comp_address)

                # Create Google Maps search link
                maps_url = f"https://www.google.com/maps/search/{address_str.replace(' ', '+')}"
                comp_cell = ws.cell(row=row_idx, column=20, value=address_str)
                comp_cell.hyperlink = maps_url
                comp_cell.font = Font(color="0563C1", underline="single")
            else:
                ws.cell(row=row_idx, column=20, value="No comp found")

            self._set_currency(ws, row_idx, 21, deal.get('best_comp_price'))
            comp_beds = deal.get('best_comp_beds')
            comp_baths = deal.get('best_comp_baths')
            ws.cell(row=row_idx, column=22, value=f"{comp_beds}/{comp_baths}" if comp_beds and comp_baths else "")

            # Hyperlink for source
            source_url = deal.get('source_url', '')
            if source_url:
                ws.cell(row=row_idx, column=23).hyperlink = source_url
                ws.cell(row=row_idx, column=23, value="View Listing")
                ws.cell(row=row_idx, column=23).font = Font(color="0563C1", underline="single")

        ws.freeze_panes = "A2"

    def _create_top_deals_sheet(self, wb: openpyxl.Workbook, deals: List[Dict]) -> None:
        """Create 'Top Deals' sheet with filtered results and comp-validated ARV."""
        ws = wb.create_sheet("Top Deals", 1)

        columns = [
            ("Address", 35),
            ("City", 15),
            ("Parcel ID", 20),
            ("Type", 15),
            ("Bed/Bath", 10),
            ("Sqft", 10),
            ("Year Built", 12),
            ("Min Bid", 15),
            ("Max Bid", 15),
            ("Bid Recommendation", 50),
            ("As-Is Price", 15),
            ("ARV (Validated)", 18),
            ("Comp Count", 12),
            ("Comp", 45),  # Comparable property
            ("Comp Price", 15),  # Comp sale price
            ("Comp Beds/Baths", 15),  # Comp beds/baths
            ("Comp Sqft", 10),  # Comp square footage
            ("Rehab Cost", 15),
            ("All-In Cost (Min Bid)", 18),
            ("Net Profit (Min Bid)", 18),
            ("ROI %", 10),
            ("IRR %", 10),
            ("Deal Score", 10),
            ("Risk Score", 10),
            ("Crime Score", 12),
            ("Flood Zone", 12),
            ("Data Quality", 12),
            ("Source URL", 40)
        ]

        # Header formatting
        header_font = Font(bold=True, color="FFFFFF", size=11)
        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")

        for col_idx, (name, width) in enumerate(columns, 1):
            cell = ws.cell(row=1, column=col_idx, value=name)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            ws.column_dimensions[get_column_letter(col_idx)].width = width

        # Data rows
        for row_idx, deal in enumerate(deals, 2):
            bed = deal.get('bedrooms')
            bath = deal.get('bathrooms')

            ws.cell(row=row_idx, column=1, value=deal.get('address'))
            ws.cell(row=row_idx, column=2, value=deal.get('city'))
            ws.cell(row=row_idx, column=3, value=deal.get('parcel_id'))
            ws.cell(row=row_idx, column=4, value=deal.get('property_type'))
            ws.cell(row=row_idx, column=5, value=f"{bed}/{bath}" if bed and bath else "")
            ws.cell(row=row_idx, column=6, value=deal.get('sqft'))
            ws.cell(row=row_idx, column=7, value=deal.get('year_built'))

            # Financial data
            self._set_currency(ws, row_idx, 8, deal.get('minimum_bid'))
            self._set_currency(ws, row_idx, 9, deal.get('max_bid'))

            # Bid recommendation with conditional formatting
            bid_rec = deal.get('bid_recommendation', '')
            bid_cell = ws.cell(row=row_idx, column=10, value=bid_rec)
            if 'NO BID' in bid_rec:
                bid_cell.fill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
                bid_cell.font = Font(bold=True, color="9C0006")
            elif 'BID UP TO' in bid_rec:
                bid_cell.fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
                bid_cell.font = Font(bold=True, color="006100")

            self._set_currency(ws, row_idx, 11, deal.get('as_is_price'))
            self._set_currency(ws, row_idx, 12, deal.get('arv'))
            ws.cell(row=row_idx, column=13, value=deal.get('comp_count', 0))

            # Best comparable property with Google Maps link
            comp_address = deal.get('best_comp_address')
            if comp_address:
                # Handle address - could be string or dict
                if isinstance(comp_address, dict):
                    # Build address string from dict
                    parts = []
                    if comp_address.get('streetAddress'):
                        parts.append(comp_address['streetAddress'])
                    if comp_address.get('city'):
                        parts.append(comp_address['city'])
                    if comp_address.get('state'):
                        parts.append(comp_address['state'])
                    if comp_address.get('zipcode'):
                        parts.append(str(comp_address['zipcode']))
                    address_str = ', '.join(parts) if parts else 'Unknown'
                else:
                    address_str = str(comp_address)

                # Create Google Maps search link
                maps_url = f"https://www.google.com/maps/search/{address_str.replace(' ', '+')}"
                comp_cell = ws.cell(row=row_idx, column=14, value=address_str)
                comp_cell.hyperlink = maps_url
                comp_cell.font = Font(color="0563C1", underline="single")
            else:
                ws.cell(row=row_idx, column=14, value="No comp found")

            self._set_currency(ws, row_idx, 15, deal.get('best_comp_price'))
            comp_beds = deal.get('best_comp_beds')
            comp_baths = deal.get('best_comp_baths')
            ws.cell(row=row_idx, column=16, value=f"{comp_beds}/{comp_baths}" if comp_beds and comp_baths else "")
            ws.cell(row=row_idx, column=17, value=deal.get('best_comp_sqft'))

            self._set_currency(ws, row_idx, 18, deal.get('rehab_cost'))
            self._set_currency(ws, row_idx, 19, deal.get('all_in_cost'))
            self._set_currency(ws, row_idx, 20, deal.get('net_profit'))
            self._set_percentage(ws, row_idx, 21, deal.get('roi_pct'))
            self._set_percentage(ws, row_idx, 22, deal.get('irr_pct'))

            # Scores
            ws.cell(row=row_idx, column=23, value=deal.get('deal_score'))
            ws.cell(row=row_idx, column=24, value=deal.get('composite_risk_score'))
            ws.cell(row=row_idx, column=25, value=deal.get('crime_score'))
            ws.cell(row=row_idx, column=26, value=deal.get('flood_zone', 'X'))
            ws.cell(row=row_idx, column=27, value=deal.get('data_quality_score'))

            # Source URL - Always display if available
            source_url = deal.get('source_url', '').strip()
            if source_url and source_url != '':
                ws.cell(row=row_idx, column=28).hyperlink = source_url
                ws.cell(row=row_idx, column=28, value="View Listing")
                ws.cell(row=row_idx, column=28).font = Font(color="0563C1", underline="single")
            else:
                # If no URL, show "No URL"
                ws.cell(row=row_idx, column=28, value="No URL")
                ws.cell(row=row_idx, column=28).font = Font(color="999999")

        # Conditional formatting for ROI
        if len(deals) > 0:
            roi_col = get_column_letter(21)  # ROI % column
            ws.conditional_formatting.add(
                f'{roi_col}2:{roi_col}{len(deals)+1}',
                CellIsRule(operator='greaterThan', formula=['0.30'], stopIfTrue=True,
                          fill=PatternFill(start_color='C6EFCE', end_color='C6EFCE', fill_type='solid'))
            )
            ws.conditional_formatting.add(
                f'{roi_col}2:{roi_col}{len(deals)+1}',
                CellIsRule(operator='lessThan', formula=['0.10'], stopIfTrue=True,
                          fill=PatternFill(start_color='FFC7CE', end_color='FFC7CE', fill_type='solid'))
            )

        ws.freeze_panes = "A2"

    def _create_exceptional_deals_sheet(self, wb: openpyxl.Workbook, deals: List[Dict]) -> None:
        """Create 'Exceptional ROI' sheet."""
        ws = wb.create_sheet("Exceptional ROI", 2)

        # Warning note
        ws.merge_cells('A1:F1')
        note_cell = ws['A1']
        note_cell.value = "⚠️ These properties violate 1-2 filters but have exceptional ROI potential (1.5x+ your minimum)"
        note_cell.font = Font(bold=True, color="FF6600", size=12)
        note_cell.alignment = Alignment(horizontal="center")
        note_cell.fill = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid")

        # Headers
        columns = [
            ("Address", 35),
            ("All-In Cost (Min Bid)", 18),
            ("ARV", 15),
            ("ROI %", 10),
            ("Deal Score", 10),
            ("Filter Violations", 50)
        ]

        header_font = Font(bold=True, size=11)
        for col_idx, (name, width) in enumerate(columns, 1):
            cell = ws.cell(row=2, column=col_idx, value=name)
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center")
            ws.column_dimensions[get_column_letter(col_idx)].width = width

        # Data rows
        for row_idx, deal in enumerate(deals, 3):
            ws.cell(row=row_idx, column=1, value=deal.get('address'))
            self._set_currency(ws, row_idx, 2, deal.get('all_in_cost'))
            self._set_currency(ws, row_idx, 3, deal.get('arv'))
            self._set_percentage(ws, row_idx, 4, deal.get('roi_pct'))
            ws.cell(row=row_idx, column=5, value=deal.get('deal_score'))
            ws.cell(row=row_idx, column=6, value=deal.get('filter_violations_note', ''))

        ws.freeze_panes = "A3"

    def _create_summary_sheet(
        self,
        wb: openpyxl.Workbook,
        top_deals: List[Dict],
        exceptional_deals: List[Dict],
        all_deals: List[Dict],
        query_params: Dict
    ) -> None:
        """Create comprehensive summary with county-specific methodology explanations."""
        ws = wb.create_sheet("Summary & Disclaimers", 3)

        # Title
        ws['A1'] = "Real Estate Investment Analysis - Summary & Methodology"
        ws['A1'].font = Font(bold=True, size=16, color="1F4E78")
        ws.merge_cells('A1:B1')

        row = 3

        # Query Parameters
        ws[f'A{row}'] = "🔍 Search Criteria:"
        ws[f'A{row}'].font = Font(bold=True, size=12, color="4472C4")
        row += 1

        for key, value in query_params.items():
            ws[f'A{row}'] = f"  {key}:"
            ws[f'B{row}'] = str(value)
            row += 1

        # Results Summary
        row += 1
        ws[f'A{row}'] = "📊 Results Summary:"
        ws[f'A{row}'].font = Font(bold=True, size=12, color="4472C4")
        row += 1

        ws[f'A{row}'] = "  Total Properties Analyzed:"
        ws[f'B{row}'] = len(all_deals)
        row += 1

        ws[f'A{row}'] = "  Top Deals (match all filters):"
        ws[f'B{row}'] = len(top_deals)
        row += 1

        ws[f'A{row}'] = "  Exceptional ROI Deals:"
        ws[f'B{row}'] = len(exceptional_deals)
        row += 1

        # County-Specific Methodology
        county = query_params.get('County', 'Unknown')
        state = query_params.get('State', 'Unknown')

        row += 2
        ws[f'A{row}'] = f"📍 {county} County, {state} - Calculation Methodology"
        ws[f'A{row}'].font = Font(bold=True, size=13, color="1F4E78")
        ws.merge_cells(f'A{row}:B{row}')
        row += 1

        methodology = self._get_county_methodology(county, state)

        for section_title, content in methodology:
            row += 1
            ws[f'A{row}'] = section_title
            ws[f'A{row}'].font = Font(bold=True, size=11, color="4472C4")
            ws.merge_cells(f'A{row}:B{row}')
            row += 1

            for line in content:
                ws[f'A{row}'] = line
                ws[f'A{row}'].alignment = Alignment(wrap_text=True)
                ws.merge_cells(f'A{row}:B{row}')
                row += 1

        # Important Disclaimers
        row += 2
        ws[f'A{row}'] = "⚠️ IMPORTANT DISCLAIMERS"
        ws[f'A{row}'].font = Font(bold=True, size=14, color="FF0000")
        ws.merge_cells(f'A{row}:B{row}')
        row += 1

        disclaimers = [
            "",
            "1. DECISION SUPPORT ONLY",
            "   This analysis is for informational purposes ONLY and does NOT constitute financial, legal, or investment advice.",
            "",
            "2. DATA ACCURACY & ESTIMATES",
            "   All property values (ARV, As-Is Price), cost estimates, and risk scores are ESTIMATES based on available data.",
            "   - ARV estimates use rule-based models and may not reflect actual market values",
            "   - Comps are estimated based on city averages unless live data is integrated",
            "   - Crime scores use city-level data, not neighborhood-specific statistics",
            "   - Rehab costs are estimates based on property age and may vary significantly",
            "",
            "3. MANDATORY DUE DILIGENCE",
            "   You MUST conduct independent professional due diligence before investing:",
            "   ✓ Order a professional title search to verify ownership and liens",
            "   ✓ Hire a licensed home inspector to assess actual property condition",
            "   ✓ Get contractor bids to validate rehab cost estimates",
            "   ✓ Verify zoning, permits, and code violations with the county",
            "   ✓ Confirm flood zone with FEMA maps and get insurance quotes",
            "   ✓ Drive the neighborhood and assess local market conditions",
            "   ✓ Verify auction terms, buyer's premium, and redemption rights",
            "",
            "4. NO GUARANTEES OR WARRANTIES",
            "   - No guarantee of investment returns or property values",
            "   - No warranty of data accuracy, completeness, or timeliness",
            "   - Property conditions may differ significantly from estimates",
            "   - Market conditions can change rapidly",
            "",
            "5. RISK ACKNOWLEDGMENT",
            "   Real estate investing involves substantial risk including:",
            "   - Loss of invested capital",
            "   - Unexpected repair costs exceeding estimates",
            "   - Title defects, liens, or legal issues",
            "   - Market downturns reducing property values",
            "   - Inability to resell at projected prices",
            "",
            "6. REGULATORY COMPLIANCE",
            "   Ensure full compliance with all federal, state, and local laws regarding real estate investment,",
            "   auction purchases, and property renovations.",
            "",
            f"📅 Report Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"🔧 System Version: {config.get('system.version', '1.0.0')}"
        ]

        for line in disclaimers:
            ws[f'A{row}'] = line
            ws[f'A{row}'].alignment = Alignment(wrap_text=True)
            ws.merge_cells(f'A{row}:B{row}')

            if line.startswith(('1.', '2.', '3.', '4.', '5.', '6.')):
                ws[f'A{row}'].font = Font(bold=True, size=11)

            row += 1

        # Set column widths
        ws.column_dimensions['A'].width = 100
        ws.column_dimensions['B'].width = 30

    def _get_county_methodology(self, county: str, state: str) -> List[Tuple[str, List[str]]]:
        """Get county-specific methodology explanations."""

        # Load market config for specifics
        try:
            market_config = config.load_market_config(state)
            county_config = market_config.get('counties', {}).get(county.lower(), {})
        except:
            market_config = {}
            county_config = {}

        methodology = []

        # As-Is Price
        methodology.append((
            "💰 As-Is Price Calculation",
            [
                "The 'As-Is Price' represents the estimated sale price if you won the auction and immediately resold",
                "the property WITHOUT making any repairs (distressed condition).",
                "",
                "Formula: ARV × 60%",
                "  - Based on standard wholesale/distressed property discount",
                "  - Assumes buyer will need to factor in rehab costs",
                "  - Used as baseline for minimum exit strategy"
            ]
        ))

        # ARV Calculation
        arv_method = "Rule-based estimation" if county_config.get('median_home_price') else "Manual entry"
        methodology.append((
            "🏠 ARV (After-Repair Value) Calculation",
            [
                f"Method: {arv_method}",
                "",
                "For rule-based estimates:",
                f"  1. Base price per sqft: $150-200 (adjusted by city)",
                f"  2. {county} County adjustments:",
                f"     - Atlanta metro: $180/sqft",
                f"     - Sandy Springs: $200/sqft",
                f"     - Other cities: $140-175/sqft",
                "  3. Property age adjustment:",
                "     - < 20 years: +10% premium",
                "     - > 60 years: -15% discount",
                "",
                "For Top Deals: ARV should be validated against actual comparable sales (comps)",
                "when live comps API is integrated."
            ]
        ))

        # Deal Score
        methodology.append((
            "🎯 Deal Score Calculation (0-100, higher = better)",
            [
                "Deal Score is a composite metric combining three factors:",
                "",
                "Formula: (ROI Score × 50%) + (Risk Score × 30%) + (Filter Match × 20%)",
                "",
                "1. ROI Score (50% weight):",
                "   - 30%+ ROI = 100 points",
                "   - 20-30% ROI = 75 points",
                "   - 10-20% ROI = 50 points",
                "   - < 10% ROI = 25 points or less",
                "",
                "2. Risk Score (30% weight, INVERTED):",
                "   - Lower risk = higher score",
                "   - Risk < 30 = 100 points",
                "   - Risk 30-60 = 50 points",
                "   - Risk > 60 = 0-50 points",
                "",
                "3. Filter Match (20% weight):",
                "   - All filters passed = 100 points",
                "   - Some filters failed = proportionally lower"
            ]
        ))

        # Risk Score
        methodology.append((
            "⚠️ Risk Score Calculation (0-100, lower = safer)",
            [
                "Risk Score is a composite of three sub-scores:",
                "",
                "Formula: (Crime × 40%) + (Flood × 40%) + (Fire × 20%)",
                "",
                f"Crime Score ({county} County specific):",
                "  - Based on city-level crime statistics",
                "  - Atlanta: 55 (higher crime)",
                "  - Sandy Springs: 25 (low crime)",
                "  - College Park: 65 (higher crime)",
                "  - Alpharetta: 20 (very low crime)",
                "  - Other areas: 45-50 (medium)",
                "",
                "Flood Risk Score:",
                "  - Zone X (low risk): 20 points",
                "  - Zone A/AE (high risk): 80-100 points",
                "  - Based on FEMA flood zone designations",
                "  - Note: Flood insurance may add $1,500+/year in high-risk zones",
                "",
                "Fire Risk Score:",
                "  - Default: 30 (medium risk)",
                "  - Higher in wildfire-prone areas",
                "  - Lower in areas with good fire department coverage"
            ]
        ))

        # Data Quality
        methodology.append((
            "📊 Data Quality Score (0-100)",
            [
                "Indicates completeness and confidence in the property data:",
                "",
                "  100 = Complete data with verified comps from live APIs",
                "   80 = Good data with rule-based estimates",
                "   60 = Moderate data (some fields missing or estimated)",
                "   40 = Limited data (many estimates, missing key info)",
                "   20 = Poor data quality (proceed with extreme caution)",
                "",
                f"For {county} County:",
                "  - Current data source: Cached/sample data",
                "  - Typical score: 60-80 (rule-based estimates)",
                "  - To improve: Integrate live comps API, county assessor data, and MLS feeds"
            ]
        ))

        # Cost Calculations
        rehab_multiplier = county_config.get('rehab_cost_multiplier', 1.0)
        methodology.append((
            f"💵 Cost Calculations ({county} County)",
            [
                "All-In Cost includes ALL expenses to acquire and renovate:",
                "",
                "1. Purchase Price: Auction minimum bid or tax lien amount",
                "2. Buyer's Premium: 10% of purchase (standard auction fee)",
                "3. Rehab Cost (age-based):",
                "   - Light (< 20 years): $15/sqft",
                "   - Medium (20-50 years): $40/sqft",
                "   - Heavy (> 50 years): $75/sqft",
                f"   - {county} County multiplier: {rehab_multiplier}x",
                "4. Transaction Costs:",
                "   - Closing costs: 3% of purchase",
                "   - Title insurance: 0.5% of purchase",
                f"   - Transfer tax ({state}): ${market_config.get('transfer_tax_per_1000', 1.0)}/thousand",
                "   - Inspection: $500",
                "   - Recording fees: $250",
                "5. Carrying Costs (6 months):",
                f"   - Insurance: ${market_config.get('costs', {}).get('insurance_per_sqft_annual', 0.45)}/sqft/year × 6 months",
                "   - Utilities: $200/month × 6 months",
                "   - Property taxes (prorated)",
                "",
                "Note: Does NOT include financing costs (assumes cash purchase)"
            ]
        ))

        return methodology

    def _set_currency(self, ws, row: int, col: int, value) -> None:
        """Set cell value with currency formatting."""
        cell = ws.cell(row=row, column=col)
        if value is not None:
            try:
                cell.value = float(value) if isinstance(value, Decimal) else float(value)
                cell.number_format = '$#,##0.00'
            except:
                cell.value = 0
                cell.number_format = '$#,##0.00'
        else:
            cell.value = ""

    def _set_percentage(self, ws, row: int, col: int, value) -> None:
        """Set cell value with percentage formatting."""
        cell = ws.cell(row=row, column=col)
        if value is not None:
            try:
                # Convert to decimal (e.g., 25% -> 0.25 for Excel)
                decimal_value = (float(value) if isinstance(value, Decimal) else float(value)) / 100
                cell.value = decimal_value
                cell.number_format = '0.00%'
            except:
                cell.value = 0
                cell.number_format = '0.00%'
        else:
            cell.value = ""

    def _create_comps_sheet(self, wb: openpyxl.Workbook, all_comps: List[Dict]) -> None:
        """Create 'Comparable Properties' sheet with all comps used in analysis."""
        ws = wb.create_sheet("Comparable Properties")

        # Header styling
        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF", size=11)

        columns = [
            ("Address", 45),
            ("City", 15),
            ("State", 8),
            ("Zip Code", 10),
            ("Bedrooms", 10),
            ("Bathrooms", 10),
            ("Sqft", 10),
            ("Year Built", 12),
            ("Sale Price", 15),
            ("Price/Sqft", 12),
            ("Sale Date", 15),
            ("Distance (mi)", 12),
            ("Source", 20),
            ("Zillow URL", 50),
        ]

        # Write header
        for col_idx, (col_name, col_width) in enumerate(columns, 1):
            cell = ws.cell(row=1, column=col_idx, value=col_name)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
            ws.column_dimensions[get_column_letter(col_idx)].width = col_width

        # Write data rows
        row_idx = 2
        for comp in all_comps:
            # Parse address
            address_str = comp.get('address', 'Unknown')
            if isinstance(address_str, dict):
                street = address_str.get('streetAddress', '')
                city = address_str.get('city', '')
                state = address_str.get('state', '')
                zipcode = address_str.get('zipcode', '')
            else:
                # Try to parse string address
                parts = address_str.split(', ')
                street = parts[0] if len(parts) > 0 else ''
                city = parts[1] if len(parts) > 1 else ''
                state_zip = parts[2] if len(parts) > 2 else ''
                state = state_zip.split()[0] if state_zip else ''
                zipcode = state_zip.split()[-1] if state_zip and len(state_zip.split()) > 1 else ''

            # Address with Google Maps link
            full_address = address_str if isinstance(address_str, str) else f"{street}, {city}, {state} {zipcode}"
            maps_url = f"https://www.google.com/maps/search/{full_address.replace(' ', '+')}"
            addr_cell = ws.cell(row=row_idx, column=1, value=full_address)
            addr_cell.hyperlink = maps_url
            addr_cell.font = Font(color="0563C1", underline="single")

            ws.cell(row=row_idx, column=2, value=city)
            ws.cell(row=row_idx, column=3, value=state)
            ws.cell(row=row_idx, column=4, value=zipcode)

            # Property details
            beds = comp.get('bedrooms')
            baths = comp.get('bathrooms')
            sqft = comp.get('sqft')
            year_built = comp.get('year_built')

            ws.cell(row=row_idx, column=5, value=beds)
            ws.cell(row=row_idx, column=6, value=baths)
            ws.cell(row=row_idx, column=7, value=sqft)
            ws.cell(row=row_idx, column=8, value=year_built)

            # Sale price
            sale_price = comp.get('sale_price')
            if sale_price:
                self._set_currency(ws, row_idx, 9, sale_price)

            # Price per sqft
            if sale_price and sqft and sqft > 0:
                psf = sale_price / sqft
                psf_cell = ws.cell(row=row_idx, column=10, value=psf)
                psf_cell.number_format = '$#,##0.00'

            # Sale date
            ws.cell(row=row_idx, column=11, value=comp.get('sale_date'))

            # Distance
            distance = comp.get('distance_miles')
            if distance:
                ws.cell(row=row_idx, column=12, value=distance)

            # Source
            source = comp.get('source', 'Unknown')
            ws.cell(row=row_idx, column=13, value=source)

            # Zillow URL (generate if not provided)
            zillow_url = comp.get('zillow_url')
            if not zillow_url and street and city and state:
                # Generate Zillow URL from address
                search_query = f"{street}-{city}-{state}-{zipcode}".replace(' ', '-').replace(',', '')
                zillow_url = f"https://www.zillow.com/homes/{search_query}"

            if zillow_url:
                cell = ws.cell(row=row_idx, column=14)
                cell.hyperlink = zillow_url
                cell.value = "View on Zillow"
                cell.font = Font(color="0563C1", underline="single")

            row_idx += 1

        # Freeze panes at header
        ws.freeze_panes = "A2"

        # Add filters
        ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{row_idx - 1}"

        self.logger.info(f"Added Comparable Properties sheet with {len(all_comps)} comps")
