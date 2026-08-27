# Autonomous Operation Guide

## Quick Start - Find Deals in Any County

The system is now configured for **fully autonomous operation**. Simply specify the county you want to analyze:

```bash
python find_deals_simple.py --county Fulton --state GA --budget 200000 --min-roi 20
```

That's it! The system will:
1. Fetch properties from the county
2. Enrich with ARV estimates and risk scores
3. Calculate all-in costs and ROI
4. Generate a ranked Excel spreadsheet

---

## Example Usage

### Find flip deals in Fulton County

```bash
python find_deals_simple.py \
  --county Fulton \
  --state GA \
  --budget 200000 \
  --min-roi 20 \
  --strategy flip
```

### Find rental deals with custom filters

```bash
python find_deals_simple.py \
  --county Fulton \
  --state GA \
  --budget 250000 \
  --min-roi 12 \
  --max-risk 40 \
  --strategy rental
```

### Conservative investor (low risk, modest returns)

```bash
python find_deals_simple.py \
  --county Fulton \
  --state GA \
  --budget 150000 \
  --min-roi 15 \
  --max-rehab 30000 \
  --max-risk 30
```

---

## Command-Line Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `--county` | County name (required) | - | `Fulton` |
| `--state` | State code | `GA` | `GA`, `FL` |
| `--budget` | Maximum all-in budget | `200000` | `150000` |
| `--min-roi` | Minimum ROI percentage | `20.0` | `25.0` |
| `--max-rehab` | Maximum rehab cost (optional) | None | `50000` |
| `--max-risk` | Maximum risk score (0-100) | `50` | `40` |
| `--strategy` | Investment strategy | `flip` | `flip`, `rental` |

---

## Output

The system generates an Excel spreadsheet in `.tmp/` with the following sheets:

### Sheet 1: Top Deals
Properties that **match ALL your filter criteria**, ranked by deal score.

**Key columns:**
- Address, Parcel ID, Property Details
- Min Bid, All-In Cost, ARV, Rehab Cost
- Net Profit, ROI %, IRR %
- Deal Score (0-100, higher = better)
- Risk Score (0-100, lower = safer)
- Crime Score, Flood Zone, Known Liens

### Sheet 2: Exceptional ROI
Properties that **violate 1-2 filters but have exceptional ROI** (1.5x your minimum).

**Why this matters:** Sometimes the best deals are just outside your filters (e.g., $10k over budget but 40% ROI vs 20% minimum).

### Sheet 3: Summary
- Your search criteria
- Count of properties analyzed
- Important legal disclaimers

---

## Currently Supported Counties

### Georgia (GA)
- **Fulton County** ✅ (Ready)
- Gwinnett County (Config ready, needs scraper)
- Cobb County (Config ready, needs scraper)

### Florida (FL)
- Orange County (Config ready, needs scraper)
- Pinellas County (Config ready, needs scraper)

---

## Adding a New County

To add support for a new county:

### Step 1: Add County Config

Edit `config/markets/{state}.yaml` and add a new county section:

```yaml
counties:
  new_county:
    name: "New County Name"
    county_seat: "City Name"
    property_tax_rate: 0.0100  # 1.00%
    median_home_price: 350000
    investor_activity: "medium"
    rehab_cost_multiplier: 1.0
```

### Step 2: Update Connector

Edit `execution/connectors/fulton_county_connector.py` (or create a new connector):

- Add scraping logic for the county's tax sale listings
- Update `fetch_raw_data()` to pull from the county's website/PDF
- Ensure `enrich_property()` handles county-specific data

### Step 3: Update Autonomous Script

Edit `find_deals_simple.py`:

```python
if county.lower() == 'new_county' and state.upper() == 'XX':
    properties = fetch_new_county_deals()
```

### Step 4: Test

```bash
python find_deals_simple.py --county NewCounty --state XX --budget 200000 --min-roi 20
```

---

## Data Sources

The system currently works with **cached/pre-scraped data** from:
- `scraped_deals.json` - Sample Fulton County tax deed sales

### Live Scraping (Future Enhancement)

To enable live scraping:

1. **Implement PDF parsing** in the connector:
   - Download monthly PDF from Fulton County Sheriff's Office
   - Parse property listings with tabula-py or pdfplumber
   - Extract parcel ID, address, minimum bid

2. **Web scraping**:
   - Use Playwright for dynamic content
   - Respect robots.txt and rate limits (2-second delay)
   - Cache results to avoid re-scraping

3. **External APIs**:
   - Integrate property data APIs (Attom Data, CoreLogic)
   - Use FEMA flood map API for real-time flood zone data
   - Connect crime data APIs (FBI Crime Data Explorer)

---

## Enrichment Logic

The system enriches each property with:

### ARV Estimation
- **Rule-based model**: Uses city, sqft, and property age
- **Base price per sqft**: $150-200/sqft for renovated properties
- **City adjustments**: Atlanta metro gets premium, rural areas discounted
- **Age adjustments**: Newer properties worth more per sqft

### Risk Scoring (0-100, lower = safer)
- **Crime Score** (40% weight): Based on city crime rates
  - Atlanta: 55, Sandy Springs: 25, College Park: 65
- **Flood Risk** (40% weight): FEMA flood zones
  - Zone X (low risk): 20, Zone A/AE (high risk): 80
- **Fire Risk** (20% weight): Defaults to 30 (medium)
- **Composite Risk**: Weighted average

### Rent Estimates
- **Formula**: 0.9% of ARV per month
- **Example**: $200k ARV → $1,800/month rent

---

## Cost Calculations

The system calculates **all-in costs** including:

1. **Purchase Price**: Minimum bid (for auctions)
2. **Buyer's Premium**: 10% of purchase price
3. **Rehab Cost**: Based on sqft and property age
   - Light (< 20 years old): $15/sqft
   - Medium (20-50 years old): $40/sqft
   - Heavy (> 50 years old): $75/sqft
4. **Transaction Costs**:
   - Closing costs: 3% of purchase
   - Title insurance: 0.5% of purchase
   - Transfer tax (GA): $1/$1000 + county tax
   - Inspection: $500
   - Recording fees: $250
5. **Carrying Costs** (6 months):
   - Insurance: $0.45/sqft/year × 6 months
   - Utilities: $200/month × 6 months
   - Property taxes (prorated)

**All-In Cost = Sum of all above**

---

## ROI Calculations

### Flip Strategy
```
ARV - All-In Cost - Selling Costs (7%) = Net Profit
ROI = (Net Profit / All-In Cost) × 100
IRR = Annualized return (assumes 6-month hold)
```

### Rental Strategy
```
Annual Cash Flow = (Monthly Rent × 12) - Operating Expenses
Cash-on-Cash Return = (Annual Cash Flow / Cash Invested) × 100
```

---

## Deal Scoring

**Deal Score** (0-100, higher = better deal):
```
(ROI Score × 50%) + (Risk Score × 30%) + (Filter Match × 20%)
```

**Components:**
- **ROI Score**: Higher ROI = higher score
  - 30%+ ROI = 100 points
  - 20-30% = 75 points
  - 10-20% = 50 points
- **Risk Score**: Lower risk = higher score (inverted)
  - Risk < 30 = 100 points
  - Risk 30-60 = 50 points
- **Filter Match**: Did it pass all your filters?
  - All passed = 100 points

---

## Troubleshooting

### "No properties found"
- **Cause**: No data in `scraped_deals.json` or data source unavailable
- **Solution**: Ensure `scraped_deals.json` exists with valid property data

### "Market config not found for state: XX"
- **Cause**: Missing `config/markets/xx.yaml` file
- **Solution**: Create the market config file (copy `georgia.yaml` as template)

### "Module not found: loguru"
- **Cause**: Missing Python dependencies
- **Solution**: Install dependencies:
  ```bash
  pip install loguru sqlalchemy click openpyxl pyyaml requests
  ```

### Spreadsheet empty or missing data
- **Cause**: Filters too strict (no properties match criteria)
- **Solution**: Relax filters (increase budget, lower min ROI, increase max risk)

---

## Next Steps After Running

1. **Open the generated spreadsheet** (in `.tmp/` folder)
2. **Sort by Deal Score** (highest first) or ROI % (highest first)
3. **Review top 10-20 properties**
4. **Check Risk Score** and crime/flood data for deal-breakers
5. **Cross-reference Parcel ID** with county assessor website
6. **Shortlist top 5 properties** for deeper due diligence

### Due Diligence Checklist
Before investing:
- [ ] Order professional title search
- [ ] Hire licensed home inspector
- [ ] Get contractor bids for repairs
- [ ] Verify auction terms and redemption rights
- [ ] Check for code violations or open permits
- [ ] Drive the neighborhood
- [ ] Confirm ARV with local real estate agent

---

## System Architecture

```
┌─────────────────────────────────────┐
│   find_deals_simple.py              │ ← You run this
├─────────────────────────────────────┤
│   Fulton County Connector           │ ← Fetches & enriches properties
│   • Loads scraped_deals.json        │
│   • Estimates ARV (rule-based)      │
│   • Calculates risk scores          │
├─────────────────────────────────────┤
│   Valuation Engine                  │ ← Calculates costs & ROI
│   • CostCalculator                  │
│   • ROICalculator                   │
│   • DealScorer                      │
├─────────────────────────────────────┤
│   Spreadsheet Generator             │ ← Outputs Excel file
│   • Top Deals sheet                 │
│   • Exceptional ROI sheet           │
│   • Summary & disclaimers           │
└─────────────────────────────────────┘
```

**Key Principle**: System runs entirely in-memory without requiring a database (perfect for MVP and quick analysis).

---

## Configuration Files

### `config/markets/ga.yaml`
State and county-specific settings:
- Property tax rates
- Transfer tax formulas
- Rehab cost multipliers
- Market characteristics (median price, days on market)

### `config/default.yaml`
System-wide defaults:
- Scoring weights (ROI, risk, filter match)
- Default cost assumptions
- Logging configuration

---

## Legal Disclaimers

⚠️ **This system is for decision support only and does NOT constitute financial, legal, or investment advice.**

- All estimates are based on available data and may be incomplete
- Independent due diligence is REQUIRED before any investment
- Conduct professional title search, property inspection, environmental assessment
- Verify zoning, permits, liens, and redemption rights
- Ensure compliance with all applicable laws

**You are solely responsible for your investment decisions.**

---

## Support

For questions or issues:
1. Check `logs/autonomous_deal_finder.log` for detailed logs
2. Review `OPERATOR_GUIDE.md` for detailed usage instructions
3. Consult configuration files in `config/` for customization

**Happy deal hunting! 🏠📈**
