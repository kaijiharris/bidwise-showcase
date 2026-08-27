"""
Claude-based Property Analyzer using Anthropic API.
Replaces Gemini analyzer with Claude for property analysis.
"""
import os
import json
import logging
from typing import Dict, Optional
from pydantic import BaseModel, Field

try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    anthropic = None


# Model for Analysis Output
class PropertyAnalysis(BaseModel):
    """Structured output from Claude property analysis."""
    full_address: Optional[str] = None
    city: Optional[str] = None
    property_type: Optional[str] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[float] = None
    sqft: Optional[int] = None
    year_built: Optional[int] = None

    # Valuation
    min_bid: Optional[float] = None
    recommended_max_bid: Optional[float] = None
    as_is_value: Optional[float] = None
    arv: Optional[float] = None
    market_value_estimate: Optional[float] = None

    # Analysis
    risk_flags: list[str] = Field(default_factory=list)
    strategy_notes: Optional[str] = None
    analysis_notes: Optional[str] = None
    recommendation: Optional[str] = None  # "Strong Buy", "Consider", "Pass"

    # Confidence scores
    data_quality_score: Optional[int] = None  # 0-100


class ClaudePropertyAnalyzer:
    """
    Analyzes tax deed properties using Claude (Anthropic API).

    Features:
    - Property type identification
    - Value estimation based on address and tax amount
    - Risk assessment
    - Bid recommendations
    """

    def __init__(self, api_key: Optional[str] = None):
        """Initialize Claude analyzer."""
        self.logger = logging.getLogger(__name__)

        if not ANTHROPIC_AVAILABLE:
            raise ImportError(
                "Anthropic package not installed. Install with: pip install anthropic"
            )

        # Get API key from parameter or environment
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not self.api_key:
            self.logger.warning(
                "No Anthropic API key found. Set ANTHROPIC_API_KEY environment variable."
            )
            self.client = None
        else:
            self.client = anthropic.Anthropic(api_key=self.api_key)

        # Load prompt template
        self.prompt_template = self._get_analysis_prompt_template()

    def _get_analysis_prompt_template(self) -> str:
        """Get the analysis prompt template."""
        return """You are a real estate tax deed property analyst. Analyze the following property and provide structured insights.

Property Data:
{property_json}

Task: Analyze this tax deed auction property and provide:

1. **Property Identification**:
   - Determine likely city/municipality (Gwinnett County, GA)
   - Estimate property type (residential, commercial, land, unknown)
   - Estimate bedrooms, bathrooms, sqft, year built (if determinable from address)

2. **Valuation Analysis**:
   - min_bid: Set equal to tax_due (minimum opening bid at auction)
   - as_is_value: Estimated current market value in as-is condition
   - arv: After Repair Value (if residential)
   - market_value_estimate: Your best estimate of market value
   - recommended_max_bid: Maximum you'd recommend bidding (based on conservative investment principles)

3. **Risk Assessment**:
   - Identify risk flags (e.g., UNKNOWN_VALUE, HIGH_TAX_DELINQUENCY, VACANT_LAND, etc.)
   - Provide strategy notes (1-2 sentences)
   - Analysis notes explaining your reasoning

4. **Recommendation**:
   - "Strong Buy" - Clear opportunity with good data
   - "Consider" - Potential deal but needs more research
   - "Pass" - High risk or poor value

**Important Rules**:
- If you lack data, estimate conservatively or set to null
- min_bid should ALWAYS equal tax_due (Georgia law)
- recommended_max_bid should be ≤ as_is_value (maintain equity cushion)
- For land/unknown types, be very conservative with valuations
- Consider that tax deed properties often have issues (title, condition, etc.)

**Output Format**: Return ONLY valid JSON matching this schema:
{{
  "full_address": "string or null",
  "city": "string or null",
  "property_type": "residential|commercial|land|unknown",
  "bedrooms": number or null,
  "bathrooms": number or null,
  "sqft": number or null,
  "year_built": number or null,
  "min_bid": number (equal to tax_due),
  "recommended_max_bid": number or null,
  "as_is_value": number or null,
  "arv": number or null,
  "market_value_estimate": number or null,
  "risk_flags": ["string array"],
  "strategy_notes": "string",
  "analysis_notes": "string",
  "recommendation": "Strong Buy|Consider|Pass",
  "data_quality_score": number (0-100)
}}

Do not include markdown formatting, only raw JSON."""

    def analyze_property(self, property_data: Dict) -> PropertyAnalysis:
        """
        Analyze a single property using Claude.

        Args:
            property_data: Dict with at minimum: county, tax_id, tax_due, address

        Returns:
            PropertyAnalysis object with enriched data
        """
        if not self.client:
            self.logger.error("Claude client not initialized. Check API key.")
            # Return minimal analysis
            return PropertyAnalysis(
                min_bid=property_data.get('tax_due'),
                recommendation="Pass",
                analysis_notes="API key not configured",
                risk_flags=["NO_API_KEY"],
                data_quality_score=0
            )

        try:
            # Prepare property data for analysis
            prop_json = json.dumps(property_data, indent=2)
            prompt = self.prompt_template.format(property_json=prop_json)

            # Call Claude API
            message = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",  # Latest Claude model
                max_tokens=2048,
                temperature=0.2,  # Low temperature for consistency
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )

            # Extract response
            response_text = message.content[0].text

            # Parse JSON response
            # Remove markdown code blocks if present
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            if response_text.startswith("```"):
                response_text = response_text[3:]
            if response_text.endswith("```"):
                response_text = response_text[:-3]

            response_text = response_text.strip()

            # Parse and validate
            result_json = json.loads(response_text)
            analysis = PropertyAnalysis(**result_json)

            self.logger.info(
                f"Analyzed {property_data.get('tax_id')}: "
                f"{analysis.recommendation} - {analysis.property_type}"
            )

            return analysis

        except json.JSONDecodeError as e:
            self.logger.error(f"JSON parse error for {property_data.get('tax_id')}: {e}")
            self.logger.debug(f"Response text: {response_text}")
            return PropertyAnalysis(
                min_bid=property_data.get('tax_due'),
                recommendation="Pass",
                analysis_notes=f"JSON parse error: {str(e)}",
                risk_flags=["ANALYSIS_ERROR"],
                data_quality_score=10
            )

        except Exception as e:
            self.logger.error(
                f"Error analyzing property {property_data.get('tax_id', 'unknown')}: {e}"
            )
            import traceback
            traceback.print_exc()

            # Return minimal safe analysis
            return PropertyAnalysis(
                min_bid=property_data.get('tax_due'),
                recommendation="Pass",
                analysis_notes=f"Analysis error: {str(e)}",
                risk_flags=["ANALYSIS_ERROR"],
                data_quality_score=0
            )
