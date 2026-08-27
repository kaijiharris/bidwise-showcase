# Quick Start - Finding Your First Deals

**Goal**: Get from "0 setup" to "investment spreadsheet" in 10 minutes.

---

## Prerequisites

- PostgreSQL installed and running
- Python 3.11+ installed

---

## Step 1: Environment Setup (2 minutes)

```powershell
# Navigate to project
cd <repo-root>

# Create virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers (for agent scraping)
playwright install chromium
```

---

## Step 2: Database Configuration (2 minutes)

### Create PostgreSQL Database

```sql
-- In psql or PgAdmin:
CREATE DATABASE real_estate_investment;
CREATE USER rei_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE real_estate_investment TO rei_user;
```

### Configure Environment

```powershell
# Copy environment template
Copy-Item .env.example .env

# Edit .env file
notepad .env
```

Update this line in `.env`:
```env
DATABASE_URL=postgresql://rei_user:your_secure_password@localhost:5432/real_estate_investment
```

### Initialize Database Tables

```powershell
python init_db.py
```

You should see:
```
✅ Database tables created successfully!
Tables: properties, auction_details, tax_lien_details, otc_details, enrichment_data, valuation_metrics, ingestion_logs
```

---

## Step 3: Find Deals with Antigravity (5 minutes)

### In Antigravity chat, say:

> "Find me flip deals in Fulton County, GA with a $200k budget, minimum 20% ROI, max $50k rehab, and medium risk tolerance."

### What Antigravity will do:

1. **Scrape property listings** from:
   - Fulton County Sheriff Sales
   - Bid4Assets Georgia auctions
   - County tax lien sales (if available)

2. **Enrich each property** with:
   - ARV estimates (Zillow, county assessor)
   - Crime scores (FBI data, local reports)
   - Flood zones (FEMA maps)
   - Rent estimates (Rentometer, Zillow)

3. **Calculate valuation** for all properties:
   - All-in cost (purchase + rehab + closing + carrying)
   - Net profit and ROI
   - Deal score (0-100)

4. **Filter and rank**:
   - Top deals matching ALL your filters
   - Exceptional deals (1-2 filter violations but high ROI)

5. **Generate Excel spreadsheet** at:
   ```
   real-estate-system/.tmp/fulton_ga_deals_[timestamp].xlsx
   ```

### Antigravity will respond with:

```
✅ Found 28 properties in Fulton County, GA.
   - 7 match all your criteria
   - 2 exceptional ROI deals

Top 3 deals:
1. 123 Main St, Atlanta - All-in $178k, ARV $255k, ROI 26%, Score 91
2. 456 Oak Ave, Atlanta - All-in $145k, ARV $205k, ROI 24%, Score 88
3. 789 Elm St, College Park - All-in $189k, ARV $265k, ROI 23%, Score 85

Spreadsheet: real-estate-system/.tmp/fulton_ga_deals_20251216_220000.xlsx
```

---

## Step 4: Review Spreadsheet (1 minute)

Open the generated Excel file. You'll see:

### Sheet 1: Top Deals
- All properties matching your filters
- Sorted by Deal Score
- Conditional formatting (green = high ROI, red = low)
- All details: address, costs, ROI, risk scores, liens

### Sheet 2: Exceptional ROI
- Properties slightly outside filters but great ROI
- Notes on which filters violated

### Sheet 3: Summary & Disclaimers
- Your search criteria
- Important legal disclaimers
- Reminds you to do due diligence

---

## Step 5: Select Properties for Due Diligence

From the spreadsheet:

1. **Sort by Deal Score** or **ROI %** (highest first)
2. **Review top 10 properties**
3. **Check risk factors**:
   - Crime score >60 = high crime area
   - Flood Zone A/AE = flood insurance required
   - Known liens >0 = title complexity
4. **Shortlist 3-5 properties** for deeper research

---

## Next Steps

For each shortlisted property:

### Research
- [ ] Look up parcel ID on county assessor website
- [ ] View property on Google Street View
- [ ] Check recent sales history
- [ ] Read auction terms carefully

### Due Diligence
- [ ] Order professional title search ($200-500)
- [ ] Schedule property inspection ($300-500)
- [ ] Get contractor bids for rehab
- [ ] Verify redemption rights (tax liens/deeds)
- [ ] Check for code violations

### Bidding
- [ ] Register for auction (may require deposit)
- [ ] Set max bid (don't exceed your numbers!)
- [ ] Attend auction or submit online bid
- [ ] Have financing arranged in advance

---

## Customizing Your Search

### Try Different Criteria

```
"Find rental properties in Orange County, FL under $250k"

"Show me tax lien deals in Gwinnett County, GA with 30%+ ROI"

"Find heavy rehab flips in Pinellas County, FL, I have $100k budget"
```

### Adjust Cost Assumptions

Edit `config/markets/georgia.yaml` or `florida.yaml`:

```yaml
costs:
  rehab_per_sqft:
    light: 12    # Lower if you have cheap labor
    medium: 35
    heavy: 65
```

### Change Scoring Weights

Edit `config/default.yaml`:

```yaml
scoring:
  weights:
    roi: 0.60      # Care more about ROI
    risk: 0.20     # Care less about risk
    filter_match: 0.20
```

---

## Troubleshooting

### "Database connection failed"
- Make sure PostgreSQL is running
- Check DATABASE_URL in `.env`
- Try connecting manually: `psql -U rei_user -d real_estate_investment`

### "No properties found"
- Auction sites may have limited current listings
- Try different county or loosen filters
- Check if auction dates are upcoming (not past)

### "Some data missing"
- Normal! Not all properties have complete data
- Check "Data Quality" column in spreadsheet
- Properties with quality <50 need more research

### Logs
All activity logged to: `logs/rei_system.log`

---

## Tips for Success

✅ **Start conservative**: Use stricter filters first, loosen later  
✅ **Review risk scores**: Don't ignore high crime or flood zones  
✅ **Cross-check ARV**: Get independent appraiser opinion  
✅ **Factor in time**: Properties take 6+ months to flip  
✅ **Have reserves**: Budget extra 10-20% for surprises  
✅ **Do title search**: ALWAYS, no exceptions  

❌ **Don't skip inspection**: Even if deal looks amazing  
❌ **Don't overbid**: Emotion kills ROI  
❌ **Don't trust estimates**: They're estimates, not guarantees  
❌ **Don't ignore liens**: They can destroy your profit  

---

## Ready to Scale

Once comfortable:

### Add More Markets
- Edit `config/markets/georgia.yaml` to add new counties
- Or create `config/markets/new_state.yaml` for new states

### Refine Assumptions
- Update rehab costs based on actual contractor bids
- Adjust carrying costs based on your experience
- Tune risk weights to your tolerance

### Build Deal Library
- Keep spreadsheets organized by date
- Track which properties you bid on
- Note outcomes (won, lost, passed)
- Refine criteria based on results

---

**You're now ready to find profitable real estate deals!** 🏠💰

For detailed explanations, see `OPERATOR_GUIDE.md`.  
For technical details, see `README.md`.  
For changing criteria, just ask Antigravity!
