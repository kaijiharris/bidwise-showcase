# Real Estate Investment System - Operator Guide

**For**: Solo founder (non-technical user)  
**Purpose**: How to use this system to find profitable real-estate deals

---

## Table of Contents

1. [What This System Does](#what-this-system-does)
2. [How to Run a Property Search](#how-to-run-a-property-search)
3. [Understanding the Spreadsheet](#understanding-the-spreadsheet)
4. [Changing Cost Assumptions](#changing-cost-assumptions)
5. [Adding New Markets](#adding-new-markets)
6. [Troubleshooting](#troubleshooting)
7. [Understanding Metrics](#understanding-metrics)
8. [Due Diligence Checklist](#due-diligence-checklist)

---

## What This System Does

This system **automates the grunt work** of finding discounted real-estate investment opportunities:

### It DOES:
✅ Search auction platforms, tax lien sales, and county OTC lists  
✅ Gather property data (address, sqft, beds/baths, year built)  
✅ Calculate comparable sales and market value  
✅ Estimate rehab costs based on property age and condition  
✅ Calculate ALL costs (purchase, rehab, closing, carrying, etc.)  
✅ Calculate ROI and IRR for flip and rental strategies  
✅ Score properties by deal quality (ROI + risk)  
✅ Filter to your specific criteria (budget, ROI, risk tolerance)  
✅ Surface "hidden gems" with exceptional ROI outside your filters  
✅ Export everything to an Excel spreadsheet you can review

### It DOES NOT:
❌ Provide legal or financial advice  
❌ Guarantee accuracy of estimates  
❌ Replace professional title search  
❌ Replace property inspection  
❌ Handle bidding/purchasing for you  
❌ Account for every possible cost or risk

**Bottom line**: This system gives you a shortlist of properties worth investigating. You still need to do due diligence on each property before investing.

---

## How to Run a Property Search

### Prerequisites

1. Make sure the system is installed (see `README.md`)
2. Activate the virtual environment:
   ```powershell
   .\venv\Scripts\Activate.ps1
   ```
3. Make sure the database is running and configured

### Basic Search Command

```powershell
python main.py query \
  --state FL \
  --county Orange \
  --strategy flip \
  --budget 150000 \
  --min-roi 20 \
  --max-rehab 50000 \
  --max-risk 50 \
  --output my_deals.xlsx
```

### Parameters Explained

| Parameter | What It Means | Example Values |
|-----------|---------------|----------------|
| `--state` | Which state to search | `FL`, `GA` |
| `--county` | Which county/counties | `Orange`, `"Orange,Pinellas"` (use quotes for multiple) |
| `--strategy` | Investment strategy | `flip`, `rental`, `wholesale` |
| `--budget` | Max total all-in cost | `150000` = $150k total budget |
| `--min-roi` | Minimum ROI you'll accept | `20` = 20% minimum ROI |
| `--max-rehab` | Max rehab you can handle | `50000` = $50k max rehab budget |
| `--max-risk` | Max risk score (0-100) | `50` = medium risk tolerance |
| `--output` | Output filename | `deals_2025-12-16.xlsx` |

### Example Searches

**Conservative investor (low risk, modest returns):**
```powershell
python main.py query --state FL --county Pinellas --strategy flip --budget 200000 --min-roi 15 --max-rehab 30000 --max-risk 30
```

**Aggressive investor (higher risk, higher returns):**
```powershell
python main.py query --state GA --county "Fulton,Gwinnett" --strategy flip --budget 300000 --min-roi 30 --max-rehab 100000 --max-risk 70
```

**Rental investor:**
```powershell
python main.py query --state FL --county Orange --strategy rental --budget 250000 --min-roi 12 --max-risk 40
```
*(Note: For rentals, `min-roi` is cash-on-cash return %)*

---

## Understanding the Spreadsheet

The exported Excel file has **3 sheets**:

### Sheet 1: Top Deals

These properties **match all your filter criteria**.

**Key Columns:**
- **Address, City, State, County**: Property location
- **Parcel ID**: Unique property identifier (for county records lookup)
- **Type**: SFR (single-family), Condo, Multi-family, etc.
- **Bed/Bath**: Number of bedrooms/bathrooms
- **Sqft**: Square footage
- **Year Built**: When property was built
- **Source**: Where we found it (`auction`, `tax_lien`, `otc`)
- **Auction Date**: When auction occurs (if applicable)
- **Min Bid**: Minimum bid required (auctions) or lien amount
- **All-In Cost**: **YOUR TOTAL INVESTMENT** (purchase + rehab + closing + carrying costs)
- **ARV**: After Repair Value (what it's worth fully renovated)
- **Rehab Cost**: Estimated renovation cost
- **Net Profit**: Profit after all costs and selling costs
- **ROI %**: Return on investment (net profit / all-in cost)
- **IRR %**: Annualized return (accounts for time)
- **Deal Score**: 0-100 score (higher = better deal)
- **Risk Score**: 0-100 (lower = less risky)
- **Crime**: Crime score for area
- **Flood Zone**: FEMA flood zone designation
- **Known Liens**: Number of known liens on property
- **Data Quality**: 0-100 (higher = more complete/confident data)
- **Last Updated**: When data was last refreshed

**How to use it:**
1. Sort by `Deal Score` (highest first) or `ROI %` (highest first)
2. Review top 10-20 properties
3. Check `Risk Score` and `Crime`/`Flood Zone` for deal-breakers
4. Note properties with low `Data Quality` (may need more research)
5. Cross-reference `Parcel ID` with county assessor website for official records

### Sheet 2: Exceptional ROI

These properties **violate 1-2 of your filters** (e.g., slightly over budget or higher risk), **BUT have exceptional ROI potential**.

**Why this list matters:**
Sometimes the best deals are just outside your filters. For example:
- Property is $10k over budget but has 40% ROI vs 20% minimum
- Property is in higher crime area but deal score is 90+

**Review these if:**
- Your main list is too small
- You're willing to stretch criteria for the right deal
- You want to see what you might be missing

### Sheet 3: Summary & Disclaimers

- Shows your search criteria
- Counts of properties found
- **IMPORTANT LEGAL DISCLAIMERS** (read these!)

---

## Changing Cost Assumptions

The system uses **market-specific cost assumptions** that you can customize.

### Where to Edit

**Florida**: `config/markets/florida.yaml`  
**Georgia**: `config/markets/georgia.yaml`

### Common Adjustments

#### Rehab Costs (per square foot)

```yaml
costs:
  rehab_per_sqft:
    light: 15    # Cosmetic only (paint, carpet, fixtures)
    medium: 40   # Kitchen/bath updates, some mechanicals
    heavy: 75    # Gut rehab, structural work
```

**When to adjust:**
- Labor costs are higher/lower in your market
- You have contractor relationships with better rates
- Material costs have changed

#### Transaction Costs

```yaml
costs:
  buyers_premium_pct: 10     # Auction buyer's premium
  closing_costs_pct: 3       # Title, escrow, attorney
  realtor_commission_pct: 6  # When you sell (flip)
```

**When to adjust:**
- You negotiate lower buyer's premium
- You use a discount broker for selling
- Local closing costs differ

#### Carrying Costs

```yaml
costs:
  carrying_months: 6              # How long you'll hold (flip)
  insurance_per_sqft_annual: 0.50  # Insurance cost per sqft/year
  utilities_monthly: 200          # Utilities while vacant
```

**When to adjust:**
- You flip faster than 6 months
- Insurance quotes come in different
- You're in a different climate (utilities vary)

### After Making Changes

**Just re-run your query** - the system will use the new assumptions automatically.

---

## Adding New Markets

To add a new state or county:

### Adding a County (within FL or GA)

1. Open the state file (`config/markets/florida.yaml` or `georgia.yaml`)

2. Add a new county section:

```yaml
counties:
  new_county_name:
    name: "Full County Name"
    county_seat: "City Name"
    
    # Data sources (URLs for tax commissioner, assessor, etc.)
    tax_commissioner: "https://..."
    assessor_portal: "https://..."
    
    # Tax rate
    property_tax_rate: 0.0100  # 1.00%
    
    # Market characteristics
    median_home_price: 350000
    avg_days_on_market: 35
    investor_activity: "medium"
    
    # Rehab cost adjustment (multiplier on default)
    rehab_cost_multiplier: 1.05  # 5% higher than state default
```

3. Save and re-run queries with `--county new_county_name`

### Adding a New State

1. Create `config/markets/new_state.yaml` (copy `florida.yaml` as template)

2. Update state-level settings:
   - Property tax rates
   - Transfer tax formulas
   - Redemption periods
   - Insurance costs

3. Add county entries

4. Update system if different tax formulas needed (may require code changes)

---

## Troubleshooting

### "Database connection failed"

**Solution**: Check `.env` file has correct `DATABASE_URL`. Make sure PostgreSQL is running.

```powershell
# Test database connection
psql -U rei_user -d real_estate_investment
```

### "No properties found"

**Possible reasons:**
1. **Filters too strict**: Try relaxing budget, ROI, or risk constraints
2. **No data ingested yet**: Run ingestion first (`python main.py ingest ...`)
3. **Data source unavailable**: Check logs for scraping errors

**Solution**: Check `logs/rei_system.log` for details.

### "Data quality score is low"

**Meaning**: Missing data for that property (e.g., no comps, no flood data).

**Solution**: 
- Use these deals cautiously
- Do extra manual research
- Consider it a high-risk property

### Spreadsheet export fails

**Error**: `openpyxl` or file permission issues

**Solution**:
1. Close any open Excel files with the same name
2. Check `.tmp/` folder permissions
3. Re-install openpyxl: `pip install --force-reinstall openpyxl`

---

## Understanding Metrics

### All-In Cost

**Formula**:
```
Purchase Price
+ Buyer's Premium (if auction)
+ Rehab Cost
+ Closing Costs (title, escrow, recording)
+ Transfer Tax
+ Inspection/Appraisal
+ Carrying Costs (insurance, utilities, taxes for 6 months)
= ALL-IN COST
```

**This is your total cash outlay** to acquire and renovate the property.

### ARV (After Repair Value)

**What it is**: Estimated market value of the property after full renovation.

**How we calculate it**:
1. Find comparable sales (similar properties sold recently within 1 mile)
2. Adjust for size, age, condition
3. Use median comp price or AVM (Automated Valuation Model)

**Note**: ARV is an ESTIMATE. Get a professional appraisal before relying on it.

### ROI (Return on Investment)

**Formula (Flip)**:
```
ARV - All-In Cost - Selling Costs (6% commission + 1% closing)
= Net Profit

ROI = (Net Profit / All-In Cost) × 100
```

**Example**:
- All-In Cost: $100,000
- ARV: $150,000
- Selling Costs (7%): $10,500
- Net Profit: $150k - $100k - $10.5k = $39,500
- ROI: ($39,500 / $100,000) × 100 = **39.5%**

**Formula (Rental)**:
```
Annual Cash Flow
÷ Cash Invested
× 100
= Cash-on-Cash Return %
```

### IRR (Internal Rate of Return)

**What it is**: Annualized return accounting for TIME.

**Why it matters**: A 30% ROI in 3 months is better than 30% ROI in 12 months. IRR captures this.

- **Flip**: Assumes you sell at ARV after holding period (default: 6 months)
- **Rental**: Assumes you hold 5 years, collect cash flow, sell with appreciation

**Rule of thumb**:
- IRR < 15%: Mediocre
- IRR 15-25%: Good
- IRR > 25%: Excellent

### Deal Score

Deal Score is 0-100, computed by the live GA pipeline
(`execution/run_ga_county.py`) in two steps:

1. **ROI → opportunity score** (ROI is capped at 150% first, so inflated
   numbers can't game the curve):
   - ROI ≥ 50% → 80-100 (Exceptional)
   - ROI 30-49% → 60-79 (Top Deal)
   - ROI 20-29% → 40-59 (Possible)
   - ROI < 20% → 0-40 (Pass — breakeven and money-losers score 0)

2. **Valuation-confidence cap** — how defensible the comps are limits how high
   the score may go:
   - HIGH (≥ 5 tight comps) → score kept as-is
   - MEDIUM → capped at 80
   - LOW → capped at 50
   - ESTIMATE_ONLY (≤ 1 comp) → score 0 and the bid is nulled

Land and Commercial parcels always score 0 (estimate-only — they need
specialist evaluation), and parcels screened out by the NO-BID guardrail are
do-not-bid regardless of score.

**Use Deal Score to rank properties** - it balances return potential with how
much the valuation can be trusted.

### Risk Scores

**Composite Risk Score** (0-100, lower is better):
- Combines crime, flood, and fire risk
- Weighted: 40% crime, 40% flood, 20% fire

**Crime Score**:
- Based on FBI crime data and local police reports
- Incidents within 1km radius
- <30 = Low crime area
- 30-60 = Medium
- >60 = High crime

**Flood Zone**:
- From FEMA flood maps
- Zone A/AE = High risk (100 points)
- Zone X = Low risk (20 points)
- Add $1500+/year for flood insurance in high-risk zones

**Fire Risk**:
- Local fire incidents (where data available)
- Wildfire zones (in certain states)

---

## Due Diligence Checklist

Before investing in ANY property from this system, complete these steps:

### 1. Title Search
- [ ] Order professional title search
- [ ] Verify ALL liens (not just known ones)
- [ ] Check for judgments, encumbrances, easements
- [ ] Understand redemption rights (tax liens/deeds)
- [ ] Verify clear chain of title

### 2. Property Inspection
- [ ] Hire licensed home inspector
- [ ] Check foundation, roof, mechanicals, electrical, plumbing
- [ ] Assess actual rehab needed (compare to system estimate)
- [ ] Get contractor bids for repairs
- [ ] Check for environmental hazards (mold, asbestos, lead)

### 3. financial Verification
- [ ] Confirm auction terms (buyer's premium, deposit, financing deadlines)
- [ ] Verify property taxes (check county records directly)
- [ ] Get insurance quote (confirm system estimate)
- [ ] Check HOA fees (if applicable)
- [ ] Confirm transfer tax and closing costs with title company

### 4. Legal & Zoning
- [ ] Verify zoning allows intended use
- [ ] Check for code violations or open permits
- [ ] Understand local landlord laws (if rental)
- [ ] Review auction/sale contract with attorney
- [ ] Confirm occupancy status (vacant vs occupied)

### 5. Market Research
- [ ] Drive the neighborhood
- [ ] Talk to local real estate agents
- [ ] Verify comps (don't rely solely on system)
- [ ] Check recent sales trends
- [ ] Assess buyer demand in area

### 6. Exit Strategy
- [ ] Confirm ARV with agent/appraiser
- [ ] Understand average days on market
- [ ] Have backup plan (rent if can't sell)
- [ ] Calculate break-even point
- [ ] Know your walk-away triggers

**NEVER skip due diligence because "the deal score is high."** The system is decision support, not a crystal ball.

---

## Quick Reference

### Best Practices

✅ **DO's:**
- Start with conservative filters, then loosen if needed
- Cross-check high-scoring deals with county records
- Verify data freshness (check "Last Updated" column)
- Re-run queries weekly to catch new listings
- Save your query commands for future use
- Keep spreadsheets organized by date

❌ **DON'Ts:**
- Don't bid without independent verification
- Don't trust ARV without appraiser confirmation
- Don't skip title search
- Don't assume estimates are exact
- Don't invest more than you can afford to lose

### Support

**Logs**: `logs/rei_system.log` (check here first for errors)  
**Config**: `config/` directory (all customization here)  
**Data Freshness**: Re-run ingestion weekly/monthly

---

**Remember**: This system helps you find opportunities. YOU make the final decision. Do your homework, and invest wisely! 🏠📈
