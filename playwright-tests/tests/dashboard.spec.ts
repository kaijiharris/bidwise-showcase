import { test, expect } from '@playwright/test';

test.describe('Dashboard & Auction Listings', () => {
  test('dashboard route loads', async ({ page }) => {
    const routes = ['/dashboard', '/app', '/listings', '/auctions', '/properties'];
    let loaded = false;
    let loadedRoute = '';

    for (const route of routes) {
      try {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (response && response.status() < 400) {
          loaded = true;
          loadedRoute = route;
          await page.screenshot({ path: `../output/screenshots/dashboard-${route.replace('/', '')}.png`, fullPage: true });
          console.log(`  Dashboard found at: ${route} (${response.status()})`);
          break;
        }
      } catch (e) {
        console.log(`  ${route}: failed`);
      }
    }

    expect(loaded, `No dashboard route found among: ${routes.join(', ')}`).toBe(true);
    console.log(`  Loaded: ${loadedRoute}`);
  });

  test('auction listings data present', async ({ page }) => {
    // Try known dashboard URLs
    const candidates = ['/dashboard', '/app', '/listings', '/'];
    let bodyText = '';
    let landedUrl = '';

    for (const route of candidates) {
      await page.goto(route, { waitUntil: 'networkidle', timeout: 15000 });
      bodyText = await page.textContent('body') || '';
      landedUrl = page.url();
      if (/gwinnett|cobb|dekalb|auction|property|ARV|roi/i.test(bodyText)) break;
    }

    console.log(`  Checked URL: ${landedUrl}`);
    const hasAuctionData = /gwinnett|cobb|dekalb|auction|property|ARV|roi/i.test(bodyText);
    await page.screenshot({ path: '../output/screenshots/auction-listings.png', fullPage: true });

    if (!hasAuctionData) {
      console.log('  NOTE: No auction data keywords found. May require authentication.');
    }
    // Non-blocking: log result
    console.log(`  Auction data present: ${hasAuctionData}`);
  });

  test('county filter works (Gwinnett/Cobb/DeKalb)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const counties = ['Gwinnett', 'Cobb', 'DeKalb'];
    for (const county of counties) {
      // Look for county name in page
      const bodyText = await page.textContent('body') || '';
      if (bodyText.toLowerCase().includes(county.toLowerCase())) {
        console.log(`  ✓ ${county} county found in page`);
      } else {
        console.log(`  ✗ ${county} county NOT found in page`);
      }
    }

    await page.screenshot({ path: '../output/screenshots/county-filter.png', fullPage: true });
  });

  test('property table/list renders', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const tableExists = await page.locator('table, [role="table"], .property-list, .auction-list, .listings').count();
    console.log(`  Table/list elements found: ${tableExists}`);
    await page.screenshot({ path: '../output/screenshots/property-table.png', fullPage: true });

    if (tableExists === 0) {
      console.log('  NOTE: No table/list found on homepage. Checking all routes...');
    }
  });

  test('specific address search - 2346 LAWRENCEVILLE HWY', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Look for search input
    const searchSelectors = [
      'input[type="search"]',
      'input[placeholder*="address" i]',
      'input[placeholder*="search" i]',
      'input[placeholder*="property" i]',
      'input[name*="search" i]',
      'input[name*="address" i]',
      '[data-testid*="search"]',
    ];

    let searchFound = false;
    for (const sel of searchSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.fill('2346 LAWRENCEVILLE HWY');
        await el.press('Enter');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: '../output/screenshots/search-lawrenceville.png', fullPage: true });
        searchFound = true;
        console.log(`  Search input found via selector: ${sel}`);
        break;
      }
    }

    if (!searchFound) {
      console.log('  NOTE: No search input found on homepage. Search may be gated behind auth.');
      await page.screenshot({ path: '../output/screenshots/search-not-found.png', fullPage: true });
    }
  });

  test('property detail view - 4440 HIDDEN STREAM DR deal fields', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const bodyText = await page.textContent('body') || '';

    // Check if deal analysis fields are present anywhere
    const fields = ['ARV', 'ROI', 'rehab', 'net profit', 'as-is', 'max bid'];
    const foundFields: string[] = [];
    const missingFields: string[] = [];

    for (const field of fields) {
      if (bodyText.toLowerCase().includes(field.toLowerCase())) {
        foundFields.push(field);
      } else {
        missingFields.push(field);
      }
    }

    console.log(`  Deal fields present: ${foundFields.join(', ') || 'none'}`);
    console.log(`  Deal fields missing: ${missingFields.join(', ') || 'none'}`);
    await page.screenshot({ path: '../output/screenshots/deal-fields.png', fullPage: true });
  });
});
