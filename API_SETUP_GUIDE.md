# API Setup Guide - Real Estate Deal Finder

This guide will help you set up the necessary API keys to maximize the system's data quality.

## Priority 1: Google Maps Geocoding API (HIGHLY RECOMMENDED)

**Why you need it:** Converts property addresses to precise lat/long coordinates, dramatically improving comparable sales searches. Without this, the system uses city centers which often return commercial properties.

**Cost:** FREE for up to 40,000 requests/month (current usage: ~5-10 requests per analysis)

**Setup Steps:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the "Geocoding API":
   - Go to "APIs & Services" > "Library"
   - Search for "Geocoding API"
   - Click "Enable"
4. Create API credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy the API key
5. (Optional but recommended) Restrict the API key:
   - Click on the key name
   - Under "API restrictions", select "Restrict key"
   - Choose "Geocoding API"
   - Save

6. Add to your `.env` file:
```bash
# Google Maps Geocoding API
GOOGLE_MAPS_API_KEY=your_api_key_here
```

## Priority 2: ATTOM Data API (ALREADY CONFIGURED)

**Status:** ✓ Already set up with key: `***REMOVED***`

**What it provides:** Property valuations (AVM), comparable sales, property details

**Current limitation:** Returns primarily commercial properties in downtown areas without precise geocoding. Will improve significantly once Google Maps API is added.

## Alternative Comp Data Sources (Optional)

If ATTOM + Google Maps still don't provide enough residential comps, consider these alternatives:

### Option 1: RapidAPI - US Real Estate API

**Cost:** FREE tier with 100 requests/month

**What it provides:** Property listings, sold comps, estimates from multiple sources (Redfin, Realtor.com)

**Setup:**
1. Go to [RapidAPI Hub](https://rapidapi.com/)
2. Sign up for a free account
3. Subscribe to [US Real Estate API](https://rapidapi.com/datascraper/api/us-real-estate)
4. Copy your RapidAPI key
5. Add to `.env`:
```bash
RAPIDAPI_KEY=your_rapidapi_key_here
```

### Option 2: Redfin Unofficial API (RapidAPI)

**Cost:** Freemium (free tier available)

**What it provides:** Redfin property data, sold listings

**Setup:**
1. Subscribe to [Unofficial Redfin API](https://rapidapi.com/apidojo/api/unofficial-redfin) on RapidAPI
2. Use the same RAPIDAPI_KEY from Option 1

### Option 3: Bridge Interactive (Zillow Data Partner)

**Cost:** $500+/month (for production use)

**What it provides:** Official Zillow Zestimates, ~148M property records

**Note:** Only consider if you need Zestimates at scale. Not necessary for MVP.

## Notes on Zillow API

**Important:** Zillow's public API was deprecated on September 30, 2021 and is no longer available for new developers. 

**Alternatives:**
- Bridge Interactive (official partner, paid)
- RapidAPI scraping services (limited free tier)
- Stick with ATTOM + Google Maps for best free option

## Testing Your Setup

After adding the Google Maps API key, run:

```bash
python find_deals_autonomous.py --county Fulton --state GA --budget 200000 --min-roi 20 --strategy flip --max-risk 60
```

Look for these log messages:
- ✓ "Google Geocoder initialized - will use precise coordinates"
- ✓ "Using precise geocoded coordinates: X.XXXX, -X.XXXX"
- ✓ "Found N comparable sales" (where N > 0)

## Current System Capabilities

**With ATTOM only:**
- Rule-based ARV estimates (~$175/sqft)
- Data quality score: 60
- Comp count: 0

**With ATTOM + Google Maps (recommended):**
- Real comparable sales data
- Data quality score: 85-95
- Comp count: 3-10 per property
- Precise coordinates for targeted searches

**With all APIs (overkill for most users):**
- Multiple data sources for validation
- Highest confidence estimates
- Fallback options if one API fails

## Support

If you need help with API setup, check the API provider's documentation or create an issue in the repository.
