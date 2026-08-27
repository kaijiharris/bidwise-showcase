/**
 * Deep authenticated exploration — every tab, panel, sub-page, and property detail.
 */
import { test, expect, Page } from '@playwright/test';
import { BASE_URL as BASE, credentials, requireCredentials } from './test-config';

requireCredentials();

const SS    = (name: string) => `../output/screenshots/auth/deep-${name}.png`;

async function login(page: Page) {
  const { email, password } = credentials();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(u => !u.href.includes('/login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

async function capture(page: Page, name: string) {
  await page.waitForTimeout(1500);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: SS(name), fullPage: true });
}

async function bodyText(page: Page) {
  return page.textContent('body').then(t => t || '');
}

test.describe('Deep Dashboard Exploration', () => {
  test.setTimeout(120000);

  // -----------------------------------------------------------------------
  test('A1 - Dashboard main view + full table scroll', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await capture(page, 'A1-dashboard-full');

    // Scroll to see full table
    await page.keyboard.press('End');
    await page.waitForTimeout(500);
    await page.screenshot({ path: SS('A1-dashboard-scrolled'), fullPage: false });

    const bt = await bodyText(page);
    const rowCount = await page.locator('tbody tr').count();
    console.log(`  Dashboard table rows: ${rowCount}`);
    console.log(`  First property: ${bt.match(/1\.\s+([^\n]+)/)?.[1] || 'not found'}`);

    // Capture all table row text
    const rows = await page.locator('tbody tr').allTextContents();
    console.log(`  All ${rows.length} rows:`);
    rows.forEach((r, i) => console.log(`    ${i + 1}. ${r.trim().substring(0, 100)}`));
  });

  // -----------------------------------------------------------------------
  test('A2 - Top Deals tab', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const topDealsBtn = page.locator('button, a, [role="tab"]').filter({ hasText: /top.?deals/i }).first();
    if (await topDealsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await topDealsBtn.click();
      await page.waitForTimeout(2000);
      await capture(page, 'A2-top-deals');
      const bt = await bodyText(page);
      const rows = await page.locator('tbody tr').count();
      console.log(`  Top Deals rows: ${rows}`);
      console.log(`  Top Deals keywords: score=${/score/i.test(bt)}, arv=${/ARV/i.test(bt)}, roi=${/ROI/i.test(bt)}`);
      const content = await page.locator('tbody tr').allTextContents();
      content.slice(0, 5).forEach((r, i) => console.log(`    ${i+1}. ${r.trim().substring(0,100)}`));
    } else {
      console.log('  Top Deals tab not found as button/tab');
      // Try as link
      await page.locator('a').filter({ hasText: /top.?deals/i }).first().click().catch(() => {});
      await capture(page, 'A2-top-deals-fallback');
    }
  });

  // -----------------------------------------------------------------------
  test('A3 - Analytics tab', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const analyticsBtn = page.locator('button, a, [role="tab"]').filter({ hasText: /analytics/i }).first();
    if (await analyticsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await analyticsBtn.click();
      await page.waitForTimeout(2000);
      await capture(page, 'A3-analytics');
      const bt = await bodyText(page);
      const content = await page.evaluate(() =>
        Array.from(document.querySelectorAll('h1,h2,h3,h4,p,label,canvas,[role="figure"]'))
          .map(e => e.textContent?.trim()).filter(t => t && t.length > 1).slice(0, 20)
      );
      console.log('  Analytics content:');
      content.forEach(t => console.log(`    • ${t}`));
      // Check for charts/canvas
      const charts = await page.locator('canvas, svg[role="img"], [data-testid*="chart"]').count();
      console.log(`  Charts/canvases found: ${charts}`);
    } else {
      console.log('  Analytics tab not found');
    }
  });

  // -----------------------------------------------------------------------
  test('A4 - Pipeline tab', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const pipelineBtn = page.locator('button, a, [role="tab"]').filter({ hasText: /pipeline/i }).first();
    if (await pipelineBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pipelineBtn.click();
      await page.waitForTimeout(2000);
      await capture(page, 'A4-pipeline');
      const bt = await bodyText(page);
      const content = await page.evaluate(() =>
        Array.from(document.querySelectorAll('h1,h2,h3,h4,p,label,[data-column],[data-lane]'))
          .map(e => e.textContent?.trim()).filter(t => t && t.length > 1).slice(0, 20)
      );
      console.log('  Pipeline content:');
      content.forEach(t => console.log(`    • ${t}`));
      const kanbanCols = await page.locator('[data-column], .kanban-col, .pipeline-stage, .lane').count();
      console.log(`  Pipeline/kanban columns: ${kanbanCols}`);
    } else {
      console.log('  Pipeline tab not found');
    }
  });

  // -----------------------------------------------------------------------
  test('A5 - Property detail panel (first row click)', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Click first row
    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();
    await page.waitForTimeout(2500);
    await capture(page, 'A5-property-detail-panel');

    const bt = await bodyText(page);
    const checks = {
      'Address': /\d+\s+[A-Z\s]+(?:RD|ST|AVE|DR|BLVD|HWY|PKY|WAY|CT|LN|PL)/i.test(bt),
      'ARV': /ARV/i.test(bt),
      'Post-Rehab ROI': /post.?rehab|ROI/i.test(bt),
      'Net Profit': /net.?profit/i.test(bt),
      'Rehab cost': /rehab/i.test(bt),
      'As-is value': /as.?is/i.test(bt),
      'Max bid': /max.?bid/i.test(bt),
      'Auction date': /auction.?date|may|june/i.test(bt),
      'Comparable sales': /comp|comparable/i.test(bt),
      'Tax due': /tax.?due/i.test(bt),
      'Property type tag': /vacant.?land|residential|commercial|sfr|multi/i.test(bt),
      'County': /dekalb|gwinnett|cobb/i.test(bt),
      'Risk flags': /risk/i.test(bt),
      'Deal score number': /score\s*[:\s]\s*\d|[A-F][+-]?\s*(score|grade)/i.test(bt),
    };

    console.log('  Property detail panel fields:');
    Object.entries(checks).forEach(([k, v]) => console.log(`    ${v ? '✓' : '✗'} ${k}`));

    // Try to extract the actual values
    const scoreEl = page.locator('[data-testid*="score"], .score, .deal-score').first();
    if (await scoreEl.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log(`  Deal score element text: "${await scoreEl.textContent()}"`);
    }

    // Scroll the panel
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(500);
    await page.screenshot({ path: SS('A5-property-detail-scrolled'), fullPage: false });
  });

  // -----------------------------------------------------------------------
  test('A6 - Click through first 5 properties, log key fields', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const rows = await page.locator('tbody tr').all();
    const toTest = rows.slice(0, 5);

    for (let i = 0; i < toTest.length; i++) {
      // Re-fetch rows each time (DOM may update)
      const row = page.locator('tbody tr').nth(i);
      const rowText = await row.textContent() || '';
      await row.click();
      await page.waitForTimeout(2000);

      // Extract key values from the detail panel
      const bt = await bodyText(page);
      const arv = bt.match(/ARV[^\$]*\$[\d,]+/)?.[0] || 'N/A';
      const roi = bt.match(/ROI[^\d]*[\d.]+%/)?.[0] || bt.match(/[\d.]+%\s*ROI/)?.[0] || 'N/A';
      const propType = bt.match(/vacant.?land|residential|commercial|sfr|multi.?family|land/i)?.[0] || 'N/A';

      console.log(`  Property ${i+1}: ${rowText.trim().substring(0, 60)}`);
      console.log(`    Type: ${propType} | ARV: ${arv} | ROI: ${roi}`);

      await page.screenshot({ path: SS(`A6-property-${i+1}`), fullPage: true });

      // Close panel if there's a close button
      const closeBtn = page.locator('button[aria-label*="close" i], button[aria-label*="dismiss" i], .close-btn, [data-testid="close"]').first();
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(500);
      } else {
        // Click elsewhere to close
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }
  });

  // -----------------------------------------------------------------------
  test('A7 - SFR and Commercial filter (property type tabs)', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const filters = [
      { label: 'SFR', expected: 1 },
      { label: 'Commercial', expected: 1 },
      { label: 'Land', expected: 20 },
      { label: 'All', expected: 22 },
    ];

    for (const f of filters) {
      const btn = page.locator('button, [role="tab"]').filter({ hasText: new RegExp(`^${f.label}\\d*$`, 'i') }).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(1000);
        const count = await page.locator('tbody tr').count();
        const match = count === f.expected ? '✓' : `✗ (expected ${f.expected}, got ${count})`;
        console.log(`  ${f.label} filter: ${count} rows ${match}`);
        await page.screenshot({ path: SS(`A7-filter-${f.label.toLowerCase()}`), fullPage: false });
      } else {
        console.log(`  ${f.label} filter button not found`);
      }
    }
  });

  // -----------------------------------------------------------------------
  test('A8 - BidWise Leads page', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/leads`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await capture(page, 'A8-leads');

    const bt = await bodyText(page);
    const content = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,p,label,button,[role="tab"]'))
        .map(e => e.textContent?.trim()).filter(t => t && t.length > 1).slice(0, 30)
    );
    console.log(`  Leads URL: ${page.url()}`);
    console.log('  Leads page content:');
    content.forEach(t => console.log(`    • ${t}`));
  });

  // -----------------------------------------------------------------------
  test('A9 - Watchlists page', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/leads/watchlists`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await capture(page, 'A9-watchlists');

    const content = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,p,button,label'))
        .map(e => e.textContent?.trim()).filter(t => t && t.length > 1).slice(0, 20)
    );
    console.log('  Watchlists content:');
    content.forEach(t => console.log(`    • ${t}`));

    const watchlistItems = await page.locator('[data-testid*="watchlist"], .watchlist-item, li').count();
    console.log(`  Watchlist items: ${watchlistItems}`);
  });

  // -----------------------------------------------------------------------
  test('A10 - Deal Desk page', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/leads/deal-desk`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await capture(page, 'A10-deal-desk');

    const content = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,p,button,label,[role="tab"]'))
        .map(e => e.textContent?.trim()).filter(t => t && t.length > 1).slice(0, 25)
    );
    console.log('  Deal Desk content:');
    content.forEach(t => console.log(`    • ${t}`));
  });

  // -----------------------------------------------------------------------
  test('A11 - Settings sidebar item', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Click Settings in sidebar
    const settingsBtn = page.locator('a, button').filter({ hasText: /^settings$/i }).first();
    if (await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(2000);
      await capture(page, 'A11-settings');
      const content = await page.evaluate(() =>
        Array.from(document.querySelectorAll('h1,h2,h3,h4,label,input,select'))
          .map(e => e.textContent?.trim() || (e as HTMLInputElement).placeholder || '').filter(t => t && t.length > 1).slice(0, 20)
      );
      console.log(`  Settings URL: ${page.url()}`);
      console.log('  Settings content:');
      content.forEach(t => console.log(`    • ${t}`));
    } else {
      console.log('  Settings sidebar button not visible, trying route...');
      for (const route of ['/dashboard/settings', '/settings']) {
        const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
        if (resp && resp.status() < 400 && !page.url().includes('/login')) {
          await capture(page, 'A11-settings-route');
          const bt = await bodyText(page);
          console.log(`  Settings at ${route}: ${bt.substring(0, 200)}`);
          break;
        }
      }
    }
  });

  // -----------------------------------------------------------------------
  test('A12 - Add County flow', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const addCountyBtn = page.locator('button, a').filter({ hasText: /add.?county/i }).first();
    if (await addCountyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addCountyBtn.click();
      await page.waitForTimeout(1500);
      await capture(page, 'A12-add-county-modal');
      const bt = await bodyText(page);
      const modalContent = await page.locator('[role="dialog"], .modal, [data-testid*="modal"]').textContent().catch(() => '');
      console.log(`  Add County modal text: "${modalContent?.trim().substring(0, 200)}"`);
    } else {
      console.log('  Add County button not found');
    }
  });

  // -----------------------------------------------------------------------
  test('A13 - Export button', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const exportBtn = page.locator('button, a').filter({ hasText: /export/i }).first();
    if (await exportBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('  Export button found — clicking...');
      await exportBtn.click();
      await page.waitForTimeout(1500);
      await capture(page, 'A13-export');
      const bt = await bodyText(page);
      const modalOrDropdown = await page.locator('[role="dialog"], .dropdown-menu, [data-testid*="export"]').textContent().catch(() => '');
      console.log(`  Export UI: "${modalOrDropdown?.substring(0, 200)}"`);
    } else {
      console.log('  Export button not found');
    }
  });

  // -----------------------------------------------------------------------
  test('A14 - Gwinnett county data check', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const gwinnettBtn = page.locator('button, a, [role="tab"]').filter({ hasText: /gwinnett/i }).first();
    if (await gwinnettBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await gwinnettBtn.click();
      await page.waitForTimeout(2000);
      await capture(page, 'A14-gwinnett');

      const rows = await page.locator('tbody tr').allTextContents();
      console.log(`  Gwinnett rows: ${rows.length}`);
      rows.slice(0, 5).forEach((r, i) => console.log(`    ${i+1}. ${r.trim().substring(0, 120)}`));

      // Check all columns have data
      const firstRow = rows[0] || '';
      const columnChecks = {
        'Has address': /\d+\s+[A-Z]/i.test(firstRow),
        'Has auction date': /may|june|2026/i.test(firstRow),
        'Has ARV value': /\$[\d,]+/.test(firstRow),
        'Has ROI %': /[\d.]+%/.test(firstRow),
      };
      Object.entries(columnChecks).forEach(([k, v]) => console.log(`    ${v ? '✓' : '✗'} ${k}`));
    }
  });

  // -----------------------------------------------------------------------
  test('A15 - Cobb county data check', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const cobbBtn = page.locator('button, a, [role="tab"]').filter({ hasText: /cobb/i }).first();
    if (await cobbBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cobbBtn.click();
      await page.waitForTimeout(2000);
      await capture(page, 'A15-cobb');

      const rows = await page.locator('tbody tr').allTextContents();
      console.log(`  Cobb rows: ${rows.length}`);
      rows.slice(0, 5).forEach((r, i) => console.log(`    ${i+1}. ${r.trim().substring(0, 120)}`));
    }
  });

  // -----------------------------------------------------------------------
  test('A16 - DeKalb county data check (all 22 rows)', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const dekalbBtn = page.locator('button, a, [role="tab"]').filter({ hasText: /dekalb/i }).first();
    if (await dekalbBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dekalbBtn.click();
      await page.waitForTimeout(2000);
      await capture(page, 'A16-dekalb');

      const rows = await page.locator('tbody tr').allTextContents();
      console.log(`  DeKalb rows: ${rows.length}`);
      rows.forEach((r, i) => console.log(`    ${i+1}. ${r.trim().substring(0, 120)}`));
    }
  });

  // -----------------------------------------------------------------------
  test('A17 - Sign out flow', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const signoutBtn = page.locator('a, button').filter({ hasText: /sign.?out|log.?out/i }).first();
    if (await signoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await signoutBtn.click();
      await page.waitForTimeout(2000);
      const finalUrl = page.url();
      const loggedOut = !finalUrl.includes('/dashboard') || finalUrl.includes('/login');
      console.log(`  Sign out → ${finalUrl}`);
      console.log(`  Successfully logged out: ${loggedOut}`);
      await capture(page, 'A17-signout');
    } else {
      console.log('  Sign out button not found');
    }
  });
});
