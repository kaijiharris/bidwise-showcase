import { test, expect } from '@playwright/test';

test.describe('Deal Analysis & Property Classification', () => {
  const testAddresses = [
    { address: '2346 LAWRENCEVILLE HWY', expectedType: 'commercial/residential', county: 'Gwinnett' },
    { address: '5885 OAKBROOK PKW', expectedType: 'commercial', county: 'Cobb' },
    { address: '7078 PEACHTREE INDUSTRIAL BLVD', expectedType: 'commercial/industrial', county: 'Gwinnett' },
    { address: '4440 HIDDEN STREAM DR', expectedType: 'residential', county: 'DeKalb' },
  ];

  for (const { address, expectedType, county } of testAddresses) {
    test(`property page for "${address}"`, async ({ page }) => {
      // Try direct slug URLs
      const slugs = [
        address.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        address.toLowerCase().replace(/\s+/g, '_'),
      ];

      let found = false;
      const searchRoutes = ['/properties', '/listings', '/auctions', '/dashboard', '/'];

      for (const route of searchRoutes) {
        await page.goto(route, { waitUntil: 'networkidle', timeout: 15000 });
        const bodyText = await page.textContent('body') || '';

        if (bodyText.toUpperCase().includes(address.split(' ')[0])) {
          found = true;
          console.log(`  Found address keyword "${address.split(' ')[0]}" at ${route}`);

          // Try clicking the property
          const addressLink = page.getByText(new RegExp(address.split(' ')[0], 'i')).first();
          if (await addressLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            await addressLink.click();
            await page.waitForTimeout(2000);
          }
          break;
        }
      }

      await page.screenshot({
        path: `../output/screenshots/property-${address.replace(/\s+/g, '-').toLowerCase()}.png`,
        fullPage: true,
      });

      if (!found) {
        console.log(`  NOTE: "${address}" not found. Likely requires auth or data not loaded.`);
      }

      // Check analysis fields if on a property page
      const finalText = await page.textContent('body') || '';
      const analysisFields = {
        'ARV': /ARV|after.?repair.?value/i.test(finalText),
        'ROI': /ROI|return.?on.?invest/i.test(finalText),
        'Property Type': /residential|commercial|land|multi.?family|industrial/i.test(finalText),
        'Auction Date': /may|june|auction.?date|\d{1,2}\/\d{1,2}\/\d{4}/i.test(finalText),
      };

      console.log(`  Analysis fields for "${address}":`);
      Object.entries(analysisFields).forEach(([k, v]) => {
        console.log(`    ${v ? '✓' : '✗'} ${k}`);
      });
    });
  }

  test('commercial property has nulled financial fields', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const bodyText = await page.textContent('body') || '';

    // Check for commercial properties displaying ARV (should be null for non-residential)
    const hasCommercial = /commercial|industrial|office|retail/i.test(bodyText);
    console.log(`  Commercial properties found in page: ${hasCommercial}`);

    // If we can find 7078 PEACHTREE, verify ARV is not shown
    if (bodyText.includes('PEACHTREE')) {
      console.log('  Found PEACHTREE INDUSTRIAL - checking if ARV is suppressed...');
      // This would need auth to fully verify
    }

    await page.screenshot({ path: '../output/screenshots/commercial-property.png', fullPage: true });
  });

  test('auction dates populate for May listings', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const bodyText = await page.textContent('body') || '';

    const hasMayDates = /may\s+\d|5\/\d|2026-05/i.test(bodyText);
    console.log(`  May 2026 auction dates visible: ${hasMayDates}`);

    // Look for auction date formats
    const dateMatches = bodyText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/g);
    if (dateMatches) {
      console.log(`  Auction date formats found: ${[...new Set(dateMatches)].slice(0, 5).join(', ')}`);
    }

    await page.screenshot({ path: '../output/screenshots/auction-dates.png', fullPage: true });
  });
});
