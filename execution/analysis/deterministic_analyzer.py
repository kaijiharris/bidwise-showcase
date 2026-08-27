import logging
from typing import Dict, List, Optional
from pydantic import BaseModel, Field

# Using the same input/output schemas as the original LLM analyzer to ensure drop-in replacement
class PropertyInput(BaseModel):
    county: str
    sale_date: Optional[str] = None
    sheriff_number: Optional[str] = None
    house_number: Optional[str] = None
    street_name: Optional[str] = None
    street_suffix: Optional[str] = None
    zip_code: Optional[str] = None
    tax_id: Optional[str] = None
    tax_due: float
    market_value_estimate: Optional[float] = None
    low_value_estimate: Optional[float] = None
    high_value_estimate: Optional[float] = None
    rent_estimate: Optional[float] = None
    property_type: Optional[str] = None
    years_delinquent: Optional[int] = None
    prior_sale_price: Optional[float] = None
    prior_sale_year: Optional[int] = None
    notes_raw: Optional[str] = None
    risk_profile: Optional[str] = "conservative"
    # Physical property details for rehab estimation
    sqft: Optional[int] = None
    year_built: Optional[int] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[float] = None

class AnalysisOutput(BaseModel):
    full_address: Optional[str] = None
    min_bid: Optional[float] = None
    recommended_max_bid: Optional[float] = None
    as_is_value: Optional[float] = None
    arv: Optional[float] = None
    repair_cost_estimate: Optional[float] = None  # Deterministic rehab estimate
    risk_flags: List[str] = Field(default_factory=list)
    strategy_notes: Optional[str] = None
    analysis_notes: Optional[str] = None

class DeterministicAnalyzer:
    """
    A deterministic real estate deal analyzer.
    Replaces LLM-based analysis with strict guardrails and formulas.
    Guarantees the exact same output for the same input data.
    """
    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def analyze_property(self, property_data: Dict) -> AnalysisOutput:
        """
        Analyzes a single property deterministically matching the original LLM prompt rules.
        """
        try:
            prop = PropertyInput(**property_data)
            notes_lower = (prop.notes_raw or "").lower()
            prop_type_lower = (prop.property_type or "unknown").lower()
            
            # --- 1. Construct Full Address ---
            address_parts = []
            if prop.house_number: address_parts.append(prop.house_number)
            if prop.street_name: address_parts.append(prop.street_name)
            if prop.street_suffix: address_parts.append(prop.street_suffix)
            
            street_address = " ".join(address_parts).strip()
            full_address = f"{street_address}, {prop.county} County GA {prop.zip_code or ''}".strip()
            if full_address.endswith("GA"): full_address = full_address.strip()
            
            # --- 2. Determine Risk Flags ---
            risk_flags = []
            if prop.years_delinquent and prop.years_delinquent >= 3:
                risk_flags.append("LONG_DELINQUENCY")
                
            risk_keywords = {
                "questionable parcel location": "QUESTIONABLE_LOCATION",
                "landlocked": "LANDLOCKED",
                "street riding through lot": "STREET_THROUGH_PARCEL",
                "street through": "STREET_THROUGH_PARCEL",
                "special district": "SPECIAL_DISTRICT",
                "paid": "RECENT_HIGH_SALE",
                "comps": "VERY_STRONG_COMPS",
            }
            
            for keyword, flag in risk_keywords.items():
                if keyword in notes_lower:
                    risk_flags.append(flag)
                    
            if prop_type_lower == "commercial":
                risk_flags.append("COMMERCIAL")
            elif prop_type_lower == "residential":
                risk_flags.append("RESIDENTIAL")
                
            is_high_risk = any(flag in ["QUESTIONABLE_LOCATION", "LANDLOCKED", "STREET_THROUGH_PARCEL", "SPECIAL_DISTRICT"] for flag in risk_flags)

            # --- 3. Compute As-Is Value (uniform formula) ---
            # As-Is = ARV × 0.70 − Rehab_Cost  (industry-standard MAO formula)
            # Represents what a cash investor would pay TODAY without doing any rehab.
            # NOTE: we compute As-Is AFTER ARV and repair_cost_estimate are known (steps 4 & 5).
            # Placeholder here; finalized after step 5.
            as_is_value = None
            analysis_notes_parts = []
                
            # --- 4. Compute After-Repair Value (ARV) ---
            arv = None
            if prop.high_value_estimate is not None and prop.high_value_estimate > 0:
                arv = prop.high_value_estimate
            elif prop.market_value_estimate is not None and prop.market_value_estimate > 0:
                upside_pct = 0.20 if "VERY_STRONG_COMPS" in risk_flags else 0.10
                arv = prop.market_value_estimate * (1.0 + upside_pct)
            else:
                analysis_notes_parts.append("ARV missing due to lack of estimates.")
                
            # --- 5. Estimate Repair Cost (GA Tax Deed rates — elevated for neglected properties) ---
            repair_cost_estimate = None
            sqft = prop.sqft
            year_built = prop.year_built
            if sqft and sqft > 0:
                age = (2026 - year_built) if (year_built and year_built > 1900) else 50
                if age < 20:
                    rate = 35    # Post-2005: cosmetic but still distressed after neglect
                elif age < 45:
                    rate = 55    # 1980-2005: standard rehab, mechanicals likely needed
                else:
                    rate = 85    # Pre-1980: heavy rehab — old systems, potential lead/asbestos
                repair_cost_estimate = round(sqft * rate * 1.15, 2)  # +15% contingency
            elif arv is not None and arv > 0:
                repair_cost_estimate = round(arv * 0.20, 2)  # 20% of ARV conservative fallback
            elif prop.low_value_estimate and prop.low_value_estimate > 0:
                repair_cost_estimate = round(prop.low_value_estimate * 0.20, 2)

            # --- 5b. Compute As-Is Value (uniform formula: ARV × 0.70 − Rehab) ---
            # Definition: what a cash investor would pay TODAY without doing any rehab.
            # This is the industry-standard MAO (Maximum Allowable Offer) formula.
            #   Normal:    As-Is = ARV × 0.70 − Rehab_Cost
            #   High-risk: As-Is = ARV × 0.65 − Rehab_Cost  (extra margin for risk)
            #   Land:      As-Is = ARV × 0.20               (lot value — no rehab deducted)
            #   Floor:     max(As-Is, tax_due)
            is_land_type = prop_type_lower in ('land', 'lot', 'vacant', 'vacant land', 'vacant lot')
            rehab_for_asis = repair_cost_estimate or 0.0

            if arv is not None and arv > 0:
                if is_land_type:
                    as_is_value = round(arv * 0.20, 2)
                elif is_high_risk:
                    as_is_value = round(arv * 0.65 - rehab_for_asis, 2)
                else:
                    as_is_value = round(arv * 0.70 - rehab_for_asis, 2)
                as_is_value = max(as_is_value, prop.tax_due)  # Floor at opening bid
            else:
                as_is_value = None
                analysis_notes_parts.append("As-Is Value unknown — ARV unavailable.")

            if as_is_value is None and arv is None:
                risk_flags.append("UNKNOWN_VALUE")

            # --- 6. Minimum Bid ---
            min_bid = prop.tax_due

            # --- 7. Recommended Maximum Bid (70% rule, GA tax deed: use 65%) ---
            # Formula: max_bid = (ARV × pct) − Rehab_Cost
            #   conservative: ARV × 0.60 − Rehab
            #   moderate:     ARV × 0.65 − Rehab
            #   aggressive:   ARV × 0.70 − Rehab
            recommended_max_bid = min_bid
            strategy_notes = ""

            if arv is None:
                recommended_max_bid = min_bid
                strategy_notes = "Defaulted to minimum bid — ARV unavailable."
            elif is_land_type:
                recommended_max_bid = max(round(as_is_value * 0.50, 2) if as_is_value else min_bid, min_bid)
                strategy_notes = "Land: max bid = 50% of lot value (ARV × 0.20 × 0.50). Target ~$10k-$15k."
            elif is_high_risk:
                recommended_max_bid = min_bid
                strategy_notes = "Sticking to minimum bid due to high-risk flags (title/location)."
            else:
                arv_pct_by_profile = {
                    "conservative": 0.60,
                    "moderate":     0.65,
                    "aggressive":   0.70,
                }
                pct = arv_pct_by_profile.get((prop.risk_profile or "conservative").lower(), 0.60)
                calculated_max = round((arv * pct) - rehab_for_asis, 2)

                if "VERY_STRONG_COMPS" in risk_flags or "RECENT_HIGH_SALE" in risk_flags:
                    if prop.prior_sale_price and prop.prior_sale_price > 0:
                        upside_bump = round(prop.prior_sale_price * 0.30, 2)
                        calculated_max = max(calculated_max, upside_bump)

                calculated_max = max(calculated_max, min_bid)

                recommended_max_bid = calculated_max
                strategy_notes = (
                    f"70% Rule ({pct:.0%} of ARV minus rehab). "
                    f"Risk profile: {prop.risk_profile}. "
                    f"Verify ARV with local comps before bidding above minimum."
                )

            analysis_notes = " ".join(analysis_notes_parts) if analysis_notes_parts else "Deterministic analysis applied successfully."

            result = AnalysisOutput(
                full_address=full_address,
                min_bid=round(min_bid, 2),
                recommended_max_bid=round(recommended_max_bid, 2) if recommended_max_bid is not None else None,
                as_is_value=round(as_is_value, 2) if as_is_value is not None else None,
                arv=round(arv, 2) if arv is not None else None,
                repair_cost_estimate=repair_cost_estimate,
                risk_flags=list(set(risk_flags)),  # Unique flags
                strategy_notes=strategy_notes,
                analysis_notes=analysis_notes
            )
            return result
        except Exception as e:
            self.logger.error(f"Error during deterministic analysis for property {property_data.get('tax_id', 'unknown')}: {e}")
            return AnalysisOutput(
               analysis_notes=f"Error during analysis: {str(e)}",
               risk_flags=["ANALYSIS_FAILED"]
            )

if __name__ == "__main__":
    analyzer = DeterministicAnalyzer()
    
    # Same mock properties used in the LLM test
    mock_prop = {
      "county": "Cobb",
      "sale_date": "2026-03-03",
      "sheriff_number": "2026-00123",
      "house_number": "2030",
      "street_name": "Main",
      "street_suffix": "St",
      "zip_code": "30318",
      "tax_id": "17-0252-0008-048-0",
      "tax_due": 33358.55,
      "market_value_estimate": 250000,
      "low_value_estimate": 220000,
      "high_value_estimate": 280000,
      "rent_estimate": 2100,
      "property_type": "residential",
      "years_delinquent": 4,
      "prior_sale_price": 1200000,
      "prior_sale_year": 2021,
      "notes_raw": "Questionable parcel location. Paid $1,200,000 in 2021.",
      "risk_profile": "conservative"
    }
    
    print("Testing Deterministic Analyzer...")
    res = analyzer.analyze_property(mock_prop)
    print(res.model_dump_json(indent=2))
