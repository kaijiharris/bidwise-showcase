# Gwinnett County Tax Deed Analysis - Setup Guide

**Date**: February 11, 2026
**Status**: ✅ Production Ready

---

## 🎯 What Was Built

A complete, systemized pipeline for analyzing Gwinnett County tax deed properties:

### Core Components

1. **Claude-Based Property Analyzer**
   - Uses Anthropic Claude API for intelligent analysis
   - Estimates property types, values, and risks
   - Provides bid recommendations

2. **Gwinnett County Assessor Scraper**
   - **Most accurate data source** - official county records
   - Extracts property details (beds, baths, sqft, year)
   - Works with qPublic portal

3. **Systemized Financial Calculator**
   - Repeatable formulas for all calculations
   - Age-based rehab cost estimates
   - ROI, deal scores, risk scores

4. **Integrated Enrichment Pipeline**
   - Multi-source data merging
   - Intelligent prioritization (Assessor > Claude > Defaults)
   - Graceful error handling

---

## 🚀 Quick Start

### Step 1: Install Dependencies

```bash
pip install anthropic selenium pandas openpyxl python-dotenv pdfplumber
```

### Step 2: Configure API Key

Add your Anthropic API key to `.env`:

```bash
# .env file
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

**Get API key**: https://console.anthropic.com/

### Step 3: Run Analysis

```bash
# Full analysis with all enrichment
python execution/run_gwinnett_analysis.py

# Or use existing data (faster testing)
python execution/run_gwinnett_analysis.py --input_file .tmp/gwinnett_results/gwinnett_fetched_*.json
```

### Step 4: Review Results

Output files in `.tmp/gwinnett_results/`:
- `gwinnett_deals_*.xlsx` - **Formatted spreadsheet** (open this first!)
- `gwinnett_enriched_*.json` - Complete data with calculations
- `gwinnett_analysis_*.xlsx` - Simple DataFrame export

---

## ⚙️ Configuration Options

### Basic Options

```bash
# Skip county assessor (faster, less accurate)
python execution/run_gwinnett_analysis.py --no-assessor

# Skip Claude AI (no API costs, uses defaults)
python execution/run_gwinnett_analysis.py --no-claude

# Limit assessor requests (avoid rate limiting)
python execution/run_gwinnett_analysis.py --max-assessor 50
```

### Advanced Usage

```bash
# Use custom output directory
python execution/run_gwinnett_analysis.py --output_dir ./my_results

# Full command with all options
python execution/run_gwinnett_analysis.py \
  --input_file data.json \
  --output_dir ./results \
  --max-assessor 50 \
  --no-claude
```

---

## 📊 What You'll Get

### Spreadsheet Columns

**All Leads Sheet**:
- Address, City, Parcel ID
- Property Type, Bed/Bath, Sqft, Year Built
- **Taxes Owed** (minimum opening bid)
- **Bid Recommendation** (AI-generated)
- **As-Is Price** (current market value)
- **ARV** (After Repair Value)
- **Rehab Cost** (estimated)
- **All-In Cost** (total investment)
- **Net Profit** (after sale)
- **ROI %** (return on investment)
- **Deal Score** (0-100 ranking)
- **Risk Score** (0-100, lower = safer)

### Summary Statistics

- Total properties analyzed
- Property type breakdown
- Average/min/max tax amounts
- **Top 5 deals by score**
- Data source usage (Assessor vs AI)

---

## 🔍 Understanding the Output

### Deal Scores (0-100)

- **70-100**: Strong opportunities - investigate immediately
- **50-69**: Solid deals - worth considering
- **30-49**: Marginal - needs careful analysis
- **0-29**: High risk or poor data quality

### Bid Recommendations

- **STRONG BUY**: High confidence, good ROI (>20%)
- **Consider**: Potential deal, needs more research
- **PASS**: Low confidence or poor value

### Risk Scores (0-100)

- **0-25**: Low risk (good data, residential, low tax amount)
- **26-50**: Medium risk (some unknowns)
- **51-75**: High risk (poor data, commercial, or land)
- **76-100**: Very high risk (minimal data, speculation)

---

## 🛠️ Troubleshooting

### "No ANTHROPIC_API_KEY found"

**Solution**: Add key to `.env` file or run with `--no-claude`

```bash
# Works without API key (uses conservative defaults)
python execution/run_gwinnett_analysis.py --no-claude
```

### "Assessor lookup failed"

**Cause**: Rate limiting or website changes

**Solution**:
1. Reduce requests: `--max-assessor 25`
2. Or skip assessor: `--no-assessor`

### "PDF not found" or "Wrong PDF downloaded"

**Cause**: County website changed or multiple PDFs available

**Solution**: System auto-selects best PDF (prefers 2026 upcoming sales)
- Check logs for "Selected PDF: ..."
- If wrong, update `gwinnett_adapter.py` priority logic

### Zero properties returned

**Cause**: PDF format changed

**Solution**:
1. Download PDF manually from https://www.gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales
2. Check format with: `python -c "import pdfplumber; print(pdfplumber.open('file.pdf').pages[0].extract_text()[:500])"`
3. Update parser in `gwinnett_adapter.py`

---

## 📈 Performance Expectations

### 53 Properties (March 2026 Sale)

**With Full Enrichment**:
- Data acquisition: 5-10 seconds
- Assessor scraping: 30-60 seconds
- Claude analysis: 60-90 seconds (parallelizable)
- **Total**: 2-3 minutes

**With Defaults Only** (`--no-assessor --no-claude`):
- **Total**: < 1 second

---

## 💡 Best Practices

### For Accuracy
1. ✅ Always enable assessor scraping (official records)
2. ✅ Enable Claude analysis (intelligent estimates)
3. ✅ Review top 10 deals manually before bidding
4. ✅ Verify property details on county website

### For Speed
1. ⚡ Use existing data files (`--input_file`)
2. ⚡ Skip assessor for quick tests (`--no-assessor`)
3. ⚡ Limit assessor requests (`--max-assessor 25`)

### For Cost Control
1. 💰 Skip Claude if no API key (`--no-claude`)
2. 💰 Assessor scraping is FREE (but respectful)
3. 💰 Claude API: ~$0.01-0.02 per property

---

## 🔐 Security Notes

### API Keys
- Never commit `.env` to version control
- `.env` is in `.gitignore` by default
- Rotate keys periodically

### Web Scraping
- Assessor scraper is respectful (0.5s delay between requests)
- Respects robots.txt
- User-agent identifies as legitimate browser
- Rate limiting built-in (max 100 requests default)

---

## 📚 Additional Documentation

- **System Architecture**: See `memory/SYSTEM_ARCHITECTURE.md`
- **Gwinnett County Details**: See `memory/gwinnett_county.md`
- **Run Summary**: See `.tmp/GWINNETT_ANALYSIS_RUN_SUMMARY.md`

---

## 🚨 Important Disclaimers

1. **Due Diligence Required**: This system provides analysis tools, not investment advice
2. **Verify Everything**: Always verify property details with official sources
3. **Title Research**: Check for liens, title issues before bidding
4. **Inspection Needed**: Physical inspection recommended for all properties
5. **Market Conditions**: Real estate markets fluctuate - use current comps
6. **Legal Review**: Consult real estate attorney before purchasing

---

## ✅ Next Steps

### Immediate (To Start Using System)
1. ✅ Add ANTHROPIC_API_KEY to `.env`
2. ✅ Run first analysis: `python execution/run_gwinnett_analysis.py`
3. ✅ Open spreadsheet and review top deals
4. ✅ Manually verify top 3-5 properties

### Soon (To Improve Accuracy)
- [ ] Test assessor scraper with more properties
- [ ] Validate ARV estimates against Zillow
- [ ] Add comparable sales integration
- [ ] Track which properties actually sell (and for how much)

### Later (To Scale)
- [ ] Add more Georgia counties (Fulton, Cobb, DeKalb)
- [ ] Parallel processing for faster enrichment
- [ ] Historical tracking database
- [ ] Automated alerts for high-score properties

---

## 📞 Support

**Issues**: Document in `memory/` files for future reference
**Improvements**: Update directives and execution modules
**Questions**: Check `SYSTEM_ARCHITECTURE.md` first

---

## 🎉 You're All Set!

Run your first analysis:

```bash
python execution/run_gwinnett_analysis.py
```

The system will:
1. ✅ Download the latest tax sale PDF
2. ✅ Parse all properties
3. ✅ Enrich with assessor data
4. ✅ Analyze with Claude AI
5. ✅ Calculate financial metrics
6. ✅ Generate formatted spreadsheet
7. ✅ Show you the top deals!

**Happy hunting! 🏠💰**
