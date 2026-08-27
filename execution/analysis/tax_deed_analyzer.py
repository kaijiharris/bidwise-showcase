import os
import json
import logging
import google.generativeai as genai
from typing import Dict, List, Optional
from pydantic import BaseModel, Field

# Ensure you have your API key set in your environment
# os.environ["GOOGLE_API_KEY"] = "YOUR_API_KEY"

# Model for internal property schema (Input to Analyzer)
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

# Model for Analysis Output (Output from Gemini)
class AnalysisOutput(BaseModel):
    full_address: Optional[str] = None
    min_bid: Optional[float] = None
    recommended_max_bid: Optional[float] = None
    as_is_value: Optional[float] = None
    arv: Optional[float] = None
    repair_cost_estimate: Optional[float] = None  # Gemini rehab estimate
    risk_flags: List[str] = Field(default_factory=list)
    strategy_notes: Optional[str] = None
    analysis_notes: Optional[str] = None

class TaxDeedAnalyzer:
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.5-flash')
        self.logger = logging.getLogger(__name__)
        
        # Load prompt template
        try:
             with open('prompts/tax_deed_analysis_ga.md', 'r', encoding='utf-8') as f:
                self.prompt_template = f.read()
        except FileNotFoundError:
             self.logger.error("Prompt template not found at prompts/tax_deed_analysis_ga.md")
             raise

    def analyze_property(self, property_data: Dict) -> AnalysisOutput:
        """
        Analyzes a single property using Gemini.
        """
        try:
            # Validate input
            prop_input = PropertyInput(**property_data)
            prop_json = prop_input.model_dump_json()

            # Construct Prompt
            prompt = self.prompt_template.replace("{{PROPERTY_JSON}}", prop_json)
            
            # Call Gemini
            # Set generation config to ensure JSON output
            generation_config = genai.types.GenerationConfig(
                temperature=0.2, # Conservative
                response_mime_type="application/json"
            )

            response = self.model.generate_content(
                contents=prompt,
                generation_config=generation_config
            )
            
            # Parse Response
            print(f"DEBUG FINISH REASON: {response.candidates[0].finish_reason}")
            response_text = response.text
            # Remove markdown code blocks if present (Gemini sometimes adds them even with mime_type json)
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            
            print(f"DEBUG RESPONSE: {response_text}")
            result_json = json.loads(response_text)
            
            # Validate Output
            analysis_result = AnalysisOutput(**result_json)
            
            # Post-process to enforce strict math for vacant lots
            ptype = str(property_data.get('property_type', '')).lower()
            if ptype in ['land', 'lot', 'vacant land', 'vacant lot', 'vacant']:
                # Ensure we have an ARV to base our math on
                if not analysis_result.arv:
                    fallback_arv = property_data.get('high_value_estimate') or property_data.get('market_value_estimate') or property_data.get('low_value_estimate')
                    if fallback_arv:
                        analysis_result.arv = float(fallback_arv)
                
                if analysis_result.arv:
                    # Lot Value is 20% of single-family ARV
                    calc_as_is = round(analysis_result.arv * 0.20, 2)
                    if calc_as_is < property_data.get('tax_due', 0):
                        calc_as_is = property_data.get('tax_due', 0)
                    analysis_result.as_is_value = calc_as_is
                    
                    # Max bid is 50% of the Lot Value
                    calc_max_bid = round(calc_as_is * 0.50, 2)
                    if calc_max_bid < property_data.get('tax_due', 0):
                        calc_max_bid = property_data.get('tax_due', 0)
                    analysis_result.recommended_max_bid = calc_max_bid
                
                # Ensure the target bid strategy note is present
                notes = analysis_result.strategy_notes or ""
                if "10k" not in notes.lower():
                    notes = notes + (" " if notes else "") + "Target bid is ~$10k - $15k."
                analysis_result.strategy_notes = notes
            
            return analysis_result

        except Exception as e:
            self.logger.error(f"Error analyzing property {property_data.get('tax_id', 'unknown')}: {e}")
            # Return a safe fallback/error object? Or just re-raise?
            # For now, let's return an object with error in notes
            return AnalysisOutput(
               analysis_notes=f"Error during analysis: {str(e)}",
               risk_flags=["ANALYSIS_FAILED"]
            )

if __name__ == "__main__":
    # Test Run
    import dotenv
    dotenv.load_dotenv()
    
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY or GOOGLE_API_KEY not found in .env")
        exit(1)

    analyzer = TaxDeedAnalyzer(api_key)

    # Example Property (Mock)
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

    print("Analyzing mock property...")
    result = analyzer.analyze_property(mock_prop)
    print(json.dumps(result.model_dump(), indent=2))
