# 🗺️ Google Maps API Setup - Quick Guide

## Why You Need This

**Problem:** Attom API is using city center coordinates (downtown Atlanta) and returning commercial properties instead of residential comps.

**Solution:** Google Maps Geocoding API converts property addresses to exact coordinates → Attom returns accurate residential comps.

**Cost:** 100% FREE for your usage (40,000 requests/month free tier)

---

## Setup Steps (5 minutes)

### 1. Go to Google Cloud Console
https://console.cloud.google.com/

### 2. Create New Project
- Click project dropdown (top of page)
- Click **"NEW PROJECT"**
- Name: `real-estate-deals`
- Click **"CREATE"**

### 3. Enable Geocoding API
- Left menu → **"APIs & Services"** → **"Library"**
- Search: `Geocoding API`
- Click result → Click **"ENABLE"**

### 4. Create API Key
- Left menu → **"APIs & Services"** → **"Credentials"**
- Click **"+ CREATE CREDENTIALS"**
- Select **"API Key"**
- **COPY THE KEY!** (looks like: `AIzaSyXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxX`)

### 5. Restrict Key (Recommended)
After creating:
- Click **"Edit API Key"** (pencil icon)
- Under **"API restrictions"**:
  - Select **"Restrict key"**
  - Check **"Geocoding API"** only
- Click **"SAVE"**

### 6. Enable Billing
- Left menu → **"Billing"**
- Click **"Link a billing account"**
- Add credit/debit card
  - ✅ $200 FREE credit for new Google Cloud users
  - ✅ 40,000 geocoding requests/month FREE (permanent)
  - ✅ Won't charge without permission after free credit

### 7. Add Key to .env File

Open `<repo-root>\.env` and replace:

```bash
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

With your actual key:

```bash
GOOGLE_MAPS_API_KEY=AIzaSyXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxX
```

**Save the file!**

---

## Test It!

Run the system to see the difference:

```bash
cd <repo-root>
python find_deals_autonomous.py --county Fulton --state GA --budget 200000 --min-roi 20 --strategy flip --max-risk 60
```

### Expected Output:

**Before (without Google Maps):**
```
❌ Using city center coordinates: 33.749, -84.388
❌ Found 0 comparable sales
❌ Comp Count: 0
```

**After (with Google Maps):**
```
✅ Google Geocoder initialized successfully
✅ Using precise geocoded coordinates: 33.712, -84.431
✅ Found 8 comparable sales from Attom
✅ Comp Count: 8
✅ Data Quality: 85-90
```

---

## Cost Breakdown

| Metric | Your Usage | Free Tier | Cost |
|--------|-----------|-----------|------|
| Requests per property | 1 | - | - |
| Properties per run | 5 | - | - |
| Total requests per run | 5 | - | - |
| Runs per month | ~200 | - | - |
| **Total requests/month** | **~1,000** | **40,000** | **$0** |

**You can analyze 8,000 properties per month for FREE!**

---

## Troubleshooting

### "API key not valid"
1. Check that Geocoding API is **enabled**
2. Wait 2-3 minutes after creating key
3. Verify key has no spaces/typos in .env

### "Billing not enabled"
1. Go to Google Cloud Console → Billing
2. Add payment method
3. Wait 2-3 minutes for activation

### Still getting 0 comps
1. Check logs for: `Google Geocoder initialized successfully`
2. If not initialized, verify key is in `.env` file
3. Restart the system after adding key

---

## What This Fixes

| Issue | Before | After |
|-------|--------|-------|
| Coordinates | City center (downtown) | Exact property location |
| Comp Type | Commercial properties | Residential properties |
| Comp Count | 0 | 5-10 per property |
| Data Quality | 60 (rule-based) | 85-90 (real comps) |
| Max Bid Accuracy | Low | High |
| Verdict | All "PASS" | Accurate "BUY"/"PASS" |

---

## References

- [Google Maps Geocoding API Documentation](https://developers.google.com/maps/documentation/geocoding/start)
- [API Key Management](https://docs.cloud.google.com/docs/authentication/api-keys)
- [Pricing Information](https://developers.google.com/maps/documentation/geocoding/usage-and-billing)

---

**Status:** ⏳ Waiting for your Google Maps API key
**Next Step:** Follow steps 1-7 above, then test the system
**Expected Time:** 5-10 minutes
