// Static site scraper using CheerioCrawler
// Fast and efficient for sites that don't require JavaScript

import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';
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
    maxConcurrency = 5,
} = input;

console.log('Starting static scraper with config:', {
    startUrls: startUrls.length,
    maxRequestsPerCrawl,
    followLinks,
    maxConcurrency,
});

// Initialize the crawler
const crawler = new CheerioCrawler({
    maxRequestsPerCrawl,
    maxConcurrency,

    // Function called for each URL
    async requestHandler({ request, $, enqueueLinks }) {
        console.log(`Processing: ${request.url}`);

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
                    const elements = $(elemSelector);
                    data[fieldName] = elements.map((i, el) => $(el).attr(attr)).get();
                } else {
                    // Extract text content
                    const elements = $(selector);
                    if (elements.length === 1) {
                        data[fieldName] = $(selector).text().trim();
                    } else {
                        data[fieldName] = elements.map((i, el) => $(el).text().trim()).get();
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
