"""
Apify Web Scraper integration for property data enrichment.

This module uses Apify's Web Scraper to:
1. Scrape property details from Zillow/Realtor (sqft, beds, baths, etc.)
2. Find individual auction listing URLs from PublicSurplus.com
"""

import os
from typing import Dict, List, Optional
from apify_client import ApifyClient
from execution.utils.logger import logger


class WebScraper:
    """Wrapper for Apify Web Scraper actor."""

    ACTOR_ID = "moJRLRc85AitArpNN"  # Apify Web Scraper

    def __init__(self):
        """Initialize the Web Scraper client."""
        # Try both possible environment variable names
        api_token = os.getenv('APIFY_API_TOKEN') or os.getenv('APIFY_API_KEY')
        if not api_token:
            raise ValueError("APIFY_API_TOKEN or APIFY_API_KEY not found in environment variables")

        self.client = ApifyClient(api_token)
        self.logger = logger.bind(component='WebScraper')
        self.logger.info("Web Scraper initialized successfully")

    def scrape_zillow_property(self, address: str, city: str, state: str, zip_code: str = '') -> Optional[Dict]:
        """
        Scrape property details from Zillow for a specific address.

        Args:
            address:  Street address (e.g., "215 N Main St")
            city:     City name (e.g., "Blue Earth")
            state:    State code (e.g., "MN")
            zip_code: ZIP code — included in search to prevent cross-state mismatches
                      (e.g. "1330 Dogwood Ln" exists in both GA and AL; zip pins the state)

        Returns:
            Dict with property details: {
                'sqft': int,
                'bedrooms': int,
                'bathrooms': float,
                'year_built': int,
                'lot_size': str,
                'zillow_url': str,
                'price_estimate': float
            }
            Returns None if Zillow returns a result in the wrong state (cross-state match).
        """
        try:
            # Include zip when available — prevents Zillow returning same-street-name
            # properties from other states (e.g. "1330 Dogwood Ln" exists in GA and AL).
            zip_suffix = f', {zip_code}' if zip_code else ''
            search_query = f"{address}, {city}, {state}{zip_suffix}".replace(' ', '-')
            zillow_url = f"https://www.zillow.com/homes/{search_query}"

            self.logger.info(f"Scraping Zillow for: {address}, {city}, {state}{zip_suffix}")

            # Configure Web Scraper for Zillow
            run_input = {
                "runMode": "PRODUCTION",
                "startUrls": [{"url": zillow_url}],
                "keepUrlFragments": False,
                "respectRobotsTxtFile": True,
                "linkSelector": "a[href]",
                "globs": [],
                "pseudoUrls": [],
                "excludes": [{"glob": "/**/*.{png,jpg,jpeg,pdf}"}],
                "pageFunction": """
async function pageFunction(context) {
    const $ = context.jQuery;

    // Extract property details from Zillow page
    const data = {
        url: context.request.url,
        sqft: null,
        bedrooms: null,
        bathrooms: null,
        year_built: null,
        lot_size: null,
        price_estimate: null
    };

    // Try multiple selectors for each field (Zillow changes frequently)

    // Square footage
    $('[data-testid="bed-bath-beyond"] span').each(function() {
        const text = $(this).text();
        if (text.includes('sqft') || text.includes('Sq. Ft.')) {
            const match = text.match(/([0-9,]+)\\s*(?:sqft|Sq\\. Ft\\.)/i);
            if (match) {
                data.sqft = parseInt(match[1].replace(/,/g, ''));
            }
        }
    });

    // Bedrooms
    $('[data-testid="bed-bath-item"]').each(function() {
        const text = $(this).text();
        if (text.includes('bd') || text.includes('Bed')) {
            const match = text.match(/(\\d+)\\s*(?:bd|Bed)/i);
            if (match) {
                data.bedrooms = parseInt(match[1]);
            }
        }
    });

    // Bathrooms
    $('[data-testid="bed-bath-item"]').each(function() {
        const text = $(this).text();
        if (text.includes('ba') || text.includes('Bath')) {
            const match = text.match(/([0-9.]+)\\s*(?:ba|Bath)/i);
            if (match) {
                data.bathrooms = parseFloat(match[1]);
            }
        }
    });

    // Year built
    $('span').each(function() {
        const text = $(this).text();
        if (text.includes('Built in')) {
            const match = text.match(/Built in (\\d{4})/i);
            if (match) {
                data.year_built = parseInt(match[1]);
            }
        }
    });

    // Lot size
    $('span').each(function() {
        const text = $(this).text();
        if (text.includes('Lot:')) {
            data.lot_size = text.replace('Lot:', '').trim();
        }
    });

    // Price estimate (Zestimate)
    $('[data-testid="zestimate-value"]').each(function() {
        const text = $(this).text();
        const match = text.match(/\\$([0-9,]+)/);
        if (match) {
            data.price_estimate = parseInt(match[1].replace(/,/g, ''));
        }
    });

    context.log.info(`Scraped: sqft=${data.sqft}, beds=${data.bedrooms}, baths=${data.bathrooms}, year=${data.year_built}`);

    return data;
}
                """,
                "injectJQuery": True,
                "proxyConfiguration": {"useApifyProxy": True},
                "proxyRotation": "RECOMMENDED",
                "useChrome": False,
                "headless": True,
                "ignoreSslErrors": False,
                "maxRequestRetries": 3,
                "maxPagesPerCrawl": 1,
                "maxResultsPerCrawl": 1,
                "maxCrawlingDepth": 0,
                "maxConcurrency": 1,
                "pageLoadTimeoutSecs": 60,
                "pageFunctionTimeoutSecs": 60,
                "waitUntil": ["networkidle2"],
                "closeCookieModals": True,
                "debugLog": False,
                "browserLog": False
            }

            # Run the scraper
            run = self.client.actor(self.ACTOR_ID).call(run_input=run_input)

            # Get results
            items = list(self.client.dataset(run["defaultDatasetId"]).iterate_items())

            if items and len(items) > 0:
                result = items[0]
                actual_url = result.get('url', '')

                # Validate returned URL contains expected state — reject cross-state matches.
                # Zillow search can return a same-named address in a different state when the
                # search query lacks a zip code or the city name is ambiguous.
                if actual_url and state:
                    state_marker = f'-{state.upper()}-'
                    if state_marker not in actual_url.upper():
                        self.logger.warning(
                            f"Zillow state mismatch for '{address}': expected '{state}' "
                            f"in returned URL '{actual_url}' — discarding result"
                        )
                        return None

                result['zillow_url'] = actual_url
                self.logger.info(f"Found Zillow data: sqft={result.get('sqft')}, beds={result.get('bedrooms')}, baths={result.get('bathrooms')}")
                return result
            else:
                self.logger.warning(f"No Zillow data found for {address}")
                return None

        except Exception as e:
            self.logger.error(f"Error scraping Zillow for {address}: {e}")
            return None

    def scrape_publicsurplus_listings(self, county: str, state: str) -> List[Dict]:
        """
        Scrape individual auction listing URLs from PublicSurplus.com.

        Args:
            county: County name (e.g., "Faribault")
            state: State code (e.g., "MN")

        Returns:
            List of dicts: [{
                'parcel_id': str,
                'address': str,
                'auction_url': str,
                'current_bid': float,
                'auction_id': str
            }]
        """
        try:
            # Format PublicSurplus URL for county
            county_lower = county.lower().replace(' ', '')
            ps_url = f"https://www.publicsurplus.com/sms/{county_lower}core,{state.lower()}/list/current?orgid=1072366"

            self.logger.info(f"Scraping PublicSurplus for {county}, {state}")

            # Configure Web Scraper for PublicSurplus
            run_input = {
                "runMode": "PRODUCTION",
                "startUrls": [{"url": ps_url}],
                "keepUrlFragments": False,
                "respectRobotsTxtFile": True,
                "linkSelector": "a[href*='/auction/view']",  # Follow auction links
                "globs": [{"glob": f"https://www.publicsurplus.com/sms/{county_lower}core,{state.lower()}/auction/view?auc=*"}],
                "pseudoUrls": [],
                "excludes": [{"glob": "/**/*.{png,jpg,jpeg,pdf}"}],
                "pageFunction": """
async function pageFunction(context) {
    const $ = context.jQuery;

    // Check if this is a listing page or individual auction page
    const isListingPage = context.request.url.includes('/list/current');
    const isAuctionPage = context.request.url.includes('/auction/view');

    if (isListingPage) {
        // Extract links to individual auctions
        const links = [];
        $('a[href*="/auction/view"]').each(function() {
            const href = $(this).attr('href');
            if (href && href.includes('auc=')) {
                const fullUrl = href.startsWith('http') ? href : `https://www.publicsurplus.com${href}`;
                links.push(fullUrl);
            }
        });

        context.log.info(`Found ${links.length} auction links on listing page`);

        // Enqueue individual auction pages
        for (const link of links) {
            await context.enqueueRequest({ url: link });
        }

        return null; // Don't save listing page data
    }

    if (isAuctionPage) {
        // Extract auction details from individual page
        const data = {
            auction_url: context.request.url,
            auction_id: null,
            parcel_id: null,
            address: null,
            current_bid: null,
            time_remaining: null
        };

        // Extract auction ID from URL
        const match = context.request.url.match(/auc=(\\d+)/);
        if (match) {
            data.auction_id = match[1];
        }

        // Extract parcel ID - search entire page text
        const pageText = $('body').text();
        const parcelMatch = pageText.match(/(?:Parcel|Tax|PIN)\\s*(?:ID|#|Number)?:?\\s*([\\d.-]+)/i);
        if (parcelMatch) {
            data.parcel_id = parcelMatch[1];
        }

        // Extract address - search entire page text
        const addressMatch = pageText.match(/(\\d+\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*\\s+(?:St|Ave|Rd|Dr|Ln|Blvd|Way|Ct|Street|Avenue|Road|Drive|Lane|Boulevard|Court))/i);
        if (addressMatch) {
            data.address = addressMatch[1];
        }

        // Extract current bid - search entire page text
        const bidMatch = pageText.match(/(?:Current\\s+Bid|Bid|Price).*?\\$([0-9,]+(?:\\.\\d{2})?)/i);
        if (bidMatch) {
            data.current_bid = parseFloat(bidMatch[1].replace(/,/g, ''));
        }

        context.log.info(`Auction ${data.auction_id}: parcel=${data.parcel_id}, address=${data.address}`);

        return data;
    }

    return null;
}
                """,
                "injectJQuery": True,
                "proxyConfiguration": {"useApifyProxy": True},
                "proxyRotation": "RECOMMENDED",
                "useChrome": False,
                "headless": True,
                "ignoreSslErrors": False,
                "maxRequestRetries": 2,  # Reduced from 3 for speed
                "maxPagesPerCrawl": 50,  # Reduced from 100 to limit scope
                "maxResultsPerCrawl": 50,
                "maxCrawlingDepth": 1,  # Follow links one level deep
                "maxConcurrency": 10,  # Increased from 5 for parallel processing
                "pageLoadTimeoutSecs": 20,  # Reduced from 60
                "pageFunctionTimeoutSecs": 15,  # Reduced from 60
                "waitUntil": ["domcontentloaded"],  # Changed from networkidle2 (faster)
                "closeCookieModals": True,
                "debugLog": False,
                "browserLog": False
            }

            # Run the scraper
            run = self.client.actor(self.ACTOR_ID).call(run_input=run_input)

            # Get results
            items = list(self.client.dataset(run["defaultDatasetId"]).iterate_items())

            # Filter out None results (from listing page)
            listings = [item for item in items if item is not None]

            self.logger.info(f"Found {len(listings)} auction listings for {county}, {state}")

            return listings

        except Exception as e:
            self.logger.error(f"Error scraping PublicSurplus for {county}: {e}")
            return []
