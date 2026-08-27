# SOP: Adding a New County to the Real Estate Deal Finder

**Purpose:** This Standard Operating Procedure ensures seamless addition of new counties to the real estate deal analysis system. Follow these steps to add support for any new county across any state.

**Time Required:** 1-2 hours per county (first time), 30 minutes (subsequent counties)

---

## Prerequisites

Before starting, gather:
1. **County Name** (e.g., "Faribault County")
2. **State** (e.g., "Minnesota", "MN")
3. **Property Listing Source** (tax deed sale website, auction portal, or county records)
4. **County Website URLs** (Auditor, Treasurer, Assessor, Sheriff/Auction)

---

## Step 1: Research the County's Tax Sale System

### 1.1 Identify Property Listing Source

**Where properties are published:**
- County Sheriff's website (tax deed auctions)
- County Treasurer/Auditor website (tax forfeiture lists)
- Third-party auction platforms (PublicSurplus, Bid4Assets, Auction.com, GovEase)
- State-level tax sale portals

**Research checklist:**
- [ ] Find the official auction/sale website URL
- [ ] Determine auction frequency (monthly, quarterly, annual)
- [ ] Identify data format (PDF lists, HTML tables, API, online auction portal)
- [ ] Note minimum bid requirements and sale terms
- [ ] Check if properties can be scraped or need manual download

### 1.2 Document State-Specific Rules

**Key information needed:**
- **State type:** Tax lien state or tax deed state?
- **Redemption period:** How long after sale can owner redeem? (0-36 months typical)
- **Interest rate:** Tax lien interest rate or penalty rate
- **Property tax rate:** State and county average (check Tax Foundation or county website)
- **Transfer tax:** Deed recording fees per $1000 of value
- **Typical costs:** Inspection fees, winterization (cold states), insurance rates

**Research sources:**
- County Auditor/Treasurer website
- State revenue department website
- [Tax Lien University](https://www.taxlienuniversity.com/)
- [National Tax Lien Association](https://www.ntla.org/)
- Local real estate investor forums

---

## Step 2: Create the County Connector

### 2.1 Copy Template from Existing Connector

**Use existing connector as template:**
```bash
cp execution/connectors/fulton_county_connector.py execution/connectors/[new_county]_connector.py
```

**Example:**
```bash
cp execution/connectors/fulton_county_connector.py execution/connectors/faribault_county_connector.py
```

### 2.2 Update Connector Metadata

**File:** `execution/connectors/[new_county]_connector.py`

**Update the docstring:**
```python
"""[County Name], [State] tax deed/forfeiture sale connector.

Fetches property listings from [data source].
[State-specific notes about tax sale system].
"""
```

**Update class name and URLs:**
```python
class [CountyName]CountyConnector(BaseConnector):
    """
    Connector for [County Name], [State] tax deed/forfeiture sales.

    Data Sources:
    1. [Primary source URL]
    2. [Assessor portal]
    3. [Other data sources]
    """

    BASE_URL = "https://www.[county-website].gov"
    AUDITOR_URL = f"{BASE_URL}/auditor"
    AUCTION_URL = "https://[auction-platform].com/[county-id]"
```

### 2.3 Implement `fetch_raw_data()` Method

**For MVP (using cached JSON):**
```python
def fetch_raw_data(self) -> List[Dict]:
    """Fetch raw property data from [County] sources."""
    cache_paths = [
        Path("scraped_deals_[county].json"),
        Path(".tmp/[county]_cache/properties.json"),
        self.cache_dir / "properties.json"
    ]

    for cache_path in cache_paths:
        if cache_path.exists():
            self.logger.info(f"Loading cached property data from {cache_path}")
            with open(cache_path, 'r') as f:
                properties = json.load(f)
            return properties

    self.logger.warning("No cached data found for [County]")
    self.logger.info(f"To add properties, create: {cache_paths[0]}")
    self.logger.info(f"Or scrape from: {self.AUCTION_URL}")
    return []
```

**For production (implement scraping):**
- Add PDF parsing (if county publishes PDFs)
- Add HTML scraping (if county has web tables)
- Add API integration (if auction platform has API)

### 2.4 Update `normalize_to_canonical()` Method

Map county-specific fields to canonical schema:

```python
def normalize_to_canonical(self, raw_data: List[Dict]) -> List[Dict]:
    """Normalize [County] data to canonical schema."""
    normalized = []

    for prop in raw_data:
        # Check if already normalized
        if 'parcel_id' in prop and 'county' in prop:
            normalized.append(prop)
            continue

        # Map from county-specific format to canonical
        canonical_prop = {
            'parcel_id': prop.get('parcel_id') or prop.get('[county_field]'),
            'address': prop.get('address') or prop.get('[county_field]'),
            'city': prop.get('city') or self._extract_city_from_address(prop.get('address', '')),
            'state': '[STATE_CODE]',
            'county': '[County Name]',
            'zip_code': prop.get('zip_code') or prop.get('[county_field]'),
            'property_type': prop.get('property_type', 'Residential'),
            'bedrooms': prop.get('bedrooms'),
            'bathrooms': prop.get('bathrooms'),
            'sqft': prop.get('sqft') or prop.get('[county_field]'),
            'year_built': prop.get('year_built'),
            'auction_details': {
                'sale_date': prop.get('sale_date') or prop.get('[county_field]'),
                'minimum_bid': prop.get('minimum_bid') or prop.get('[county_field]'),
                'auction_id': prop.get('auction_id'),
                'auction_url': prop.get('auction_url') or f"{self.AUCTION_URL}",
            }
        }

        normalized.append(canonical_prop)

    return normalized
```

### 2.5 Update Price Per Square Foot Baseline

**In `enrich_property()` method, update rule-based fallback pricing:**

```python
# Fallback to rule-based if no comps ([State]-specific pricing)
if not enrichment.get('arv_estimate') and sqft > 0:
    # [State/region] baseline: $XX-XX/sqft for renovated properties
    base_psf = [BASELINE_PSF]  # Adjust based on state/region

    # City adjustments (major cities in the county/region)
    city_lower = city.lower()
    if '[major_city_1]' in city_lower:
        base_psf = [ADJUSTED_PSF_1]
    elif '[major_city_2]' in city_lower:
        base_psf = [ADJUSTED_PSF_2]
    elif '[major_city_3]' in city_lower:
        base_psf = [ADJUSTED_PSF_3]
    else:
        # Small towns/rural
        base_psf = [RURAL_PSF]

    # Age adjustment
    if year_built > 0:
        age = 2025 - year_built
        if age < 20:
            base_psf *= 1.1  # Newer homes
        elif age > 60:
            base_psf *= 0.85  # Older homes need more rehab

    arv_estimate = sqft * base_psf
    enrichment['arv_estimate'] = round(arv_estimate, 2)
    enrichment['avg_price_per_sqft'] = base_psf
    enrichment['avm_value'] = round(arv_estimate * 0.70, 2)  # Distressed value
    enrichment['data_quality_score'] = 60  # Estimated, not from comps
```

**How to determine baseline PSF:**
1. Search Zillow/Realtor.com for recently sold homes in the county
2. Calculate average $/sqft from 10-20 sales
3. Adjust for metro vs rural (metro = +10-20%, rural = -10-20%)

### 2.6 Update Rent Estimate Factor

```python
# Estimate rent for rental strategy ([State] rents)
if enrichment['arv_estimate']:
    rent_estimate = enrichment['arv_estimate'] * [RENT_FACTOR]  # Adjust by state
    enrichment['estimated_rent_monthly'] = round(rent_estimate, 2)
```

**Typical rent factors:**
- High-demand metros (Atlanta, Austin, Phoenix): 0.009 (0.9%)
- Medium markets (Minnesota, Ohio, Indiana): 0.007 (0.7%)
- Low-demand rural (Mississippi, West Virginia): 0.006 (0.6%)

### 2.7 Update Crime Scoring

```python
# City-based crime scoring (simplified - [State] cities)
crime_zones = {
    '[city_1]': [score],  # 0-100, higher = more crime
    '[city_2]': [score],
    '[city_3]': [score],
    # Add major cities/towns in the county
}

city_lower = city.lower()
for zone_city, score in crime_zones.items():
    if zone_city in city_lower:
        enrichment['crime_score'] = score
        break
```

**How to determine crime scores:**
1. Check [FBI Crime Data Explorer](https://cde.ucr.cjis.gov/)
2. Check [NeighborhoodScout](https://www.neighborhoodscout.com/)
3. Use this scale: 0-25 (low), 26-50 (medium), 51-75 (high), 76-100 (very high)

### 2.8 Add Convenience Function

At the bottom of the connector file:

```python
def fetch_[county]_deals(max_properties: Optional[int] = None) -> List[Dict]:
    """
    Convenience function to fetch and enrich [County] deals.

    Args:
        max_properties: Maximum number of properties to fetch

    Returns:
        List of enriched property dicts ready for orchestrator
    """
    connector = [CountyName]CountyConnector()
    return connector.fetch_and_enrich(max_properties)
```

---

## Step 3: Create/Update Market Configuration

### 3.1 Check if State Config Exists

```bash
ls config/markets/[state].yaml
```

If exists, skip to 3.3. If not, create new state config.

### 3.2 Create New State Configuration (if needed)

**File:** `config/markets/[state].yaml`

```yaml
state: [STATE_CODE]
state_name: [State Full Name]

# State-level settings
property_tax_rate: [RATE]  # Statewide average (decimal, e.g., 0.0119 = 1.19%)
transfer_tax_per_1000: [AMOUNT]  # Deed tax per $1000 of sale price
redemption_period_months: [MONTHS]  # Statutory redemption period
tax_lien_interest_rate: [RATE]  # Interest or penalty rate (if tax lien state)

# State-specific cost adjustments
costs:
  insurance_per_sqft_annual: [AMOUNT]  # Homeowners insurance cost
  termite_inspection: [AMOUNT]  # Required in south/humid climates
  winterization_cost: [AMOUNT]  # Required in cold climates

# Counties configuration
counties:
  # Will add county in next step
```

**Research sources for state-level data:**
- Property tax rate: [Tax Foundation](https://taxfoundation.org/data/all/state/property-taxes-by-state-county-2024/)
- Transfer tax: Search "[State] deed recording fees" or check state revenue dept
- Redemption period: Search "[State] tax sale redemption period"
- Insurance rates: [Insurance Information Institute](https://www.iii.org/)

### 3.3 Add County to State Configuration

**File:** `config/markets/[state].yaml`

Add county under `counties:` section:

```yaml
counties:
  [county_slug]:  # lowercase, no spaces (e.g., "faribault" not "Faribault County")
    name: "[County Name] County"
    county_seat: "[City]"

    # Data sources
    tax_commissioner: "https://www.[county-website].gov/[auditor-page]"
    assessor_portal: "https://[assessor-portal].com/"
    sheriff_sales: "https://[auction-platform].com/[county]"

    # County-specific rates
    property_tax_rate: [RATE]  # County-specific rate
    transfer_tax_per_1000: [AMOUNT]  # Usually same as state

    # Market characteristics
    median_home_price: [PRICE]  # From Zillow/Realtor.com
    avg_days_on_market: [DAYS]  # Time to sell
    investor_activity: "[low/moderate/high]"
    major_metro: [true/false]  # Is this a major metro area?

    # Rehab cost adjustments
    rehab_cost_multiplier: [MULTIPLIER]  # 1.0 = average, <1.0 = cheaper, >1.0 = expensive

    # Tax lien notes
    tax_lien_market: "[lien/deed/forfeiture]"  # Type of tax sale
    lien_auction_frequency: "[monthly/quarterly/annual]"
```

**How to find county data:**
- **Median home price:** Search "[County Name] median home price" on Zillow
- **Days on market:** Realtor.com or local MLS
- **Property tax rate:** County Assessor website or Tax Foundation
- **Rehab cost multiplier:**
  - Major metros (NYC, SF, LA): 1.3-1.5
  - Medium cities: 1.0-1.1
  - Rural areas: 0.85-0.95

---

## Step 4: Update Main Orchestrator

### 4.1 Open Main Script

**File:** `find_deals_autonomous.py`

### 4.2 Import New Connector

Add import at top of file:

```python
from execution.connectors.[county]_connector import fetch_[county]_deals
```

**Example:**
```python
from execution.connectors.faribault_county_connector import fetch_faribault_county_deals
```

### 4.3 Add County to Connector Map

Find the `COUNTY_CONNECTORS` dict and add new entry:

```python
COUNTY_CONNECTORS = {
    ('Fulton', 'GA'): fetch_fulton_county_deals,
    ('[County Name]', '[STATE_CODE]'): fetch_[county]_deals,
    # Add more as needed
}
```

**Example:**
```python
COUNTY_CONNECTORS = {
    ('Fulton', 'GA'): fetch_fulton_county_deals,
    ('Faribault', 'MN'): fetch_faribault_county_deals,
}
```

### 4.4 Test Import

```bash
python -c "from execution.connectors.[county]_connector import fetch_[county]_deals; print('Import successful')"
```

---

## Step 5: Create Sample Data File

### 5.1 Create JSON File for Testing

**File:** `scraped_deals_[county].json`

**Format:**
```json
[
  {
    "parcel_id": "[PARCEL_ID]",
    "address": "[STREET ADDRESS]",
    "city": "[CITY]",
    "state": "[STATE_CODE]",
    "county": "[County Name]",
    "zip_code": "[ZIP]",
    "property_type": "Residential",
    "bedrooms": [NUMBER],
    "bathrooms": [NUMBER],
    "sqft": [NUMBER],
    "year_built": [YEAR],
    "auction_details": {
      "sale_date": "YYYY-MM-DD",
      "minimum_bid": [AMOUNT],
      "auction_id": "[ID]",
      "auction_url": "[URL]"
    }
  }
]
```

**How to populate:**
1. Find 3-5 sample properties from county auction website
2. Copy property details into JSON format
3. Ensure all required fields are present
4. Validate JSON syntax (use [JSONLint](https://jsonlint.com/))

**Example:**
```json
[
  {
    "parcel_id": "123-456-789",
    "address": "123 Main St",
    "city": "Blue Earth",
    "state": "MN",
    "county": "Faribault",
    "zip_code": "56013",
    "property_type": "Residential",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1500,
    "year_built": 1985,
    "auction_details": {
      "sale_date": "2025-02-15",
      "minimum_bid": 15000,
      "auction_id": "AUC123456",
      "auction_url": "https://www.publicsurplus.com/sms/faribaultcore,mn/auction/view?auc=123456"
    }
  }
]
```

---

## Step 6: Test the System

### 6.1 Run Basic Import Test

```bash
cd <repo-root>
python -c "from execution.connectors.[county]_connector import [CountyName]CountyConnector; c = [CountyName]CountyConnector(); print('Connector initialized successfully')"
```

### 6.2 Test Property Fetching

```bash
python -c "from execution.connectors.[county]_connector import fetch_[county]_deals; props = fetch_[county]_deals(); print(f'Fetched {len(props)} properties')"
```

### 6.3 Run Full Analysis

```bash
python find_deals_autonomous.py --county [County] --state [STATE] --budget 200000 --min-roi 20 --strategy flip --max-risk 60
```

**Example:**
```bash
python find_deals_autonomous.py --county Faribault --state MN --budget 200000 --min-roi 20 --strategy flip --max-risk 60
```

### 6.4 Verify Output

**Check for:**
- [ ] Script runs without errors
- [ ] Properties are fetched and enriched
- [ ] Comp data is populated (Comp Count > 0)
- [ ] Best Comp address and price are shown
- [ ] ARV estimate is reasonable
- [ ] Spreadsheet is generated in `.tmp/` folder
- [ ] Spreadsheet opens without errors
- [ ] Top Deals sheet shows comp data with Google Maps links

### 6.5 Validate Spreadsheet Data

**Open the generated spreadsheet and check:**
- [ ] All Leads sheet has all properties
- [ ] Top Deals sheet has only BUY-rated properties
- [ ] Comp Count > 0 for most properties
- [ ] Best Comp column has addresses (or "No comp found")
- [ ] Comp Price shows realistic values
- [ ] Max Bid is less than ARV
- [ ] ROI % is calculated correctly
- [ ] Verdict ("BUY" or "PASS") makes sense

---

## Step 7: Document the Addition

### 7.1 Update README (if public repo)

Add county to supported list:

```markdown
## Supported Counties

- **Georgia:**
  - Fulton County

- **Minnesota:**
  - Faribault County
```

### 7.2 Create County-Specific Notes (optional)

**File:** `docs/counties/[county]_[state].md`

Document:
- Auction schedule and frequency
- Bidder registration requirements
- Payment terms and deadlines
- Common property types
- Local market insights
- Special considerations (rural properties, seasonal access, etc.)

---

## Common Issues & Troubleshooting

### Issue 1: No Comps Found (Comp Count = 0)

**Causes:**
- Google Maps API key not configured
- Address formatting issues preventing geocoding
- Rural area with no recent sales

**Solutions:**
1. Verify Google Maps API key in `.env`: `GOOGLE_MAPS_API_KEY=your_key`
2. Check if Attom API is initialized successfully (look for log message)
3. Verify Apify fallback is working (look for "Apify Zillow fallback" in logs)
4. For very rural areas, widen search radius in connector (increase `radius_miles` parameter)

### Issue 2: Connector Not Found Error

**Error:** `ModuleNotFoundError: No module named 'execution.connectors.[county]_connector'`

**Solutions:**
1. Check file exists: `ls execution/connectors/[county]_connector.py`
2. Check for typos in import statement
3. Ensure `__init__.py` exists in `execution/connectors/` directory
4. Restart Python interpreter if running in interactive mode

### Issue 3: Invalid Property Data

**Error:** `Property missing required field: [field_name]`

**Solutions:**
1. Check `scraped_deals_[county].json` has all required fields
2. Verify `normalize_to_canonical()` is mapping fields correctly
3. Add default values for optional fields (bedrooms, bathrooms, sqft)

### Issue 4: Unrealistic ARV Estimates

**Symptoms:** ARV way too high or too low compared to market

**Solutions:**
1. Adjust `base_psf` in rule-based fallback (see Step 2.5)
2. Research recent sales in county on Zillow to find accurate $/sqft
3. Add more city-specific adjustments for major towns
4. Check if comps are from wrong property types (commercial vs residential)

### Issue 5: Apify/Attom API Errors

**Error:** `Error fetching comps: [API error]`

**Solutions:**
1. Check API key is in `.env` file
2. Verify API credits haven't been exhausted (check dashboard)
3. Check for API rate limits (wait 60 seconds and retry)
4. For Apify: verify actor ID is correct
5. For Attom: check address format and geocoding results

---

## Checklist: Adding a New County

Use this checklist to ensure you've completed all steps:

- [ ] **Research**
  - [ ] Found property listing source URL
  - [ ] Documented state/county tax sale rules
  - [ ] Identified data format (PDF, HTML, API, etc.)
  - [ ] Researched median home prices and $/sqft

- [ ] **Connector**
  - [ ] Created `execution/connectors/[county]_connector.py`
  - [ ] Updated class name and docstrings
  - [ ] Updated URLs (BASE_URL, AUDITOR_URL, AUCTION_URL)
  - [ ] Implemented or adapted `fetch_raw_data()`
  - [ ] Implemented `normalize_to_canonical()` with field mapping
  - [ ] Updated price per sqft baseline for the region
  - [ ] Updated rent estimate factor for the state
  - [ ] Added city-specific crime scoring
  - [ ] Added convenience function at bottom

- [ ] **Configuration**
  - [ ] Created or updated `config/markets/[state].yaml`
  - [ ] Added state-level rates and costs (if new state)
  - [ ] Added county configuration under `counties:`
  - [ ] Populated all required fields (tax rates, median price, etc.)

- [ ] **Integration**
  - [ ] Imported connector in `find_deals_autonomous.py`
  - [ ] Added to `COUNTY_CONNECTORS` dict
  - [ ] Tested import successfully

- [ ] **Testing**
  - [ ] Created sample data file `scraped_deals_[county].json`
  - [ ] Added 3-5 realistic property examples
  - [ ] Ran connector import test
  - [ ] Ran property fetching test
  - [ ] Ran full analysis with `find_deals_autonomous.py`
  - [ ] Verified spreadsheet generation
  - [ ] Validated comp data in spreadsheet
  - [ ] Checked that ARV estimates are realistic

- [ ] **Documentation**
  - [ ] Updated README with new county (if applicable)
  - [ ] Created county-specific notes (optional)
  - [ ] Documented any special considerations

---

## Quick Reference: File Locations

| File Type | Location | Purpose |
|-----------|----------|---------|
| Connector | `execution/connectors/[county]_connector.py` | Fetch and enrich properties |
| Market Config | `config/markets/[state].yaml` | State/county rates and costs |
| Sample Data | `scraped_deals_[county].json` | Test properties |
| Main Script | `find_deals_autonomous.py` | Orchestrator that calls connectors |
| Enrichment | `execution/enrichment/attom_api.py` | Get real comps |
| Enrichment | `execution/enrichment/apify_comps.py` | Zillow comps fallback |
| Geocoding | `execution/enrichment/geocoding.py` | Google Maps address → coordinates |

---

## Tips for Success

1. **Start with a working connector** - Always copy an existing connector rather than starting from scratch. Fulton County connector is the most complete template.

2. **Test incrementally** - Don't wait until everything is done to test. Test after each major change (import, fetch, enrich, analyze).

3. **Use realistic sample data** - The quality of your test results depends on realistic property data. Use actual properties from the county's auction website.

4. **Research local market prices** - Don't guess at price per sqft. Spend 10 minutes on Zillow researching recent sales to get accurate baselines.

5. **Document as you go** - Take notes on quirks, special requirements, or data source issues as you discover them. This helps when adding similar counties later.

6. **Check the logs** - When something doesn't work, read the full log output. Most issues are clearly explained in error messages.

7. **Leverage the cache** - The system caches comp results to avoid repeated API calls. This saves money and speeds up testing.

---

## Maintenance

### Updating Existing Connectors

When county changes their data source or format:

1. Update URLs in connector class constants
2. Update `fetch_raw_data()` to match new format
3. Update `normalize_to_canonical()` field mappings
4. Test with new sample data
5. Document the change

### Monitoring Data Quality

Periodically check:
- Comp count averages (should be 5-10 per property)
- Data quality scores (should be 85+ with real comps)
- ARV estimate accuracy (compare to actual sale prices)
- API usage and costs (Attom, Apify, Google Maps)

---

**Version:** 1.0
**Last Updated:** December 19, 2025
**Maintained By:** Real Estate Deal Finder System
