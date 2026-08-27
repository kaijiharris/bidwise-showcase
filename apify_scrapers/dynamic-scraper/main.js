// Dynamic site scraper using PlaywrightCrawler
// Handles JavaScript-heavy sites by running a full browser

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { readFileSync } from 'fs';

await Actor.init();

// Get input from Apify platform or local input.json
let input = await Actor.getInput();

// If running locally (input is null), read from input.json
if (!input) {
    try {
        const inputContent = readFileSync('./input.json', 'utf-8');
        input = JSON.parse(inputContent);
    } catch (error) {
        console.log('No input.json found, using defaults');
        input = {};
    }
}

const {
    startUrls = [{ url: 'https://example.com' }],
    maxRequestsPerCrawl = 100,
    selectors = {},
    followLinks = false,
    maxConcurrency = 3,  // Lower default for browser-based crawling
    waitForSelector = null,  // Optional: wait for specific element before scraping
    waitTime = 2000,  // Wait time in ms for page to load (default 2s)
} = input;

console.log('Starting dynamic scraper with config:', {
    startUrls: startUrls.length,
    maxRequestsPerCrawl,
    followLinks,
    maxConcurrency,
    waitTime,
});

// Initialize the crawler with Playwright
const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl,
    maxConcurrency,

    // Use headless browser
    launchContext: {
        launchOptions: {
            headless: true,
        },
    },

    // Function called for each URL
    async requestHandler({ request, page, enqueueLinks }) {
        console.log(`Processing: ${request.url}`);

        // Wait for specific selector if provided
        if (waitForSelector) {
            try {
                await page.waitForSelector(waitForSelector, { timeout: 10000 });
            } catch (error) {
                console.log(`Timeout waiting for selector: ${waitForSelector}`);
            }
        } else {
            // Default: wait for network to be idle
            await page.waitForLoadState('networkidle', { timeout: waitTime });
        }

        // Extract data based on provided selectors
        const data = {
            url: request.url,
            timestamp: new Date().toISOString(),
        };

        // Apply each selector from input
        for (const [fieldName, selector] of Object.entries(selectors)) {
            try {
                // Handle both text and attribute extraction
                if (selector.includes('@')) {
                    // Extract attribute (e.g., "a@href" for link URLs)
                    const [elemSelector, attr] = selector.split('@');
                    data[fieldName] = await page.$$eval(
                        elemSelector,
                        (elements, attribute) => elements.map(el => el.getAttribute(attribute)),
                        attr
                    );
                } else {
                    // Extract text content
                    const elements = await page.$$(selector);
                    if (elements.length === 1) {
                        data[fieldName] = await page.$eval(selector, el => el.textContent.trim());
                    } else {
                        data[fieldName] = await page.$$eval(
                            selector,
                            elements => elements.map(el => el.textContent.trim())
                        );
                    }
                }
            } catch (error) {
                console.log(`Error extracting ${fieldName}: ${error.message}`);
                data[fieldName] = null;
            }
        }

        // Save the scraped data
        await Actor.pushData(data);

        // Optionally follow links on the page
        if (followLinks) {
            await enqueueLinks({
                // Only follow links on the same domain
                strategy: 'same-domain',
            });
        }
    },

    // Error handling
    async failedRequestHandler({ request, error }) {
        console.error(`Request ${request.url} failed: ${error.message}`);
        await Actor.pushData({
            url: request.url,
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    },
});

// Run the crawler with start URLs
await crawler.run(startUrls);

console.log('Scraping completed!');

await Actor.exit();
