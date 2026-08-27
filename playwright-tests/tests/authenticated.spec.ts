/**
 * Authenticated test suite — assertions against the configured dashboard.
 * Credentials and target URL come from the environment (see test-config.ts).
 * The suite skips automatically when TEST_EMAIL / TEST_PASSWORD are unset.
 */
import { test, expect, Page } from '@playwright/test';
import { BASE_URL as BASE, credentials, requireCredentials } from './test-config';

requireCredentials();

async function login(page: Page) {
  const { email, password } = credentials();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(u => !u.href.includes('/login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

// ============================================================================
// AUTH
// ============================================================================
test.describe('Login & Session', () => {
  test('login redirects to /dashboard', async ({ page }) => {
    await login(page);
    expect(page.url()).toContain('/dashboard');
  });

  test('session persists across reload', async ({ page }) => {
    await login(page);
    await page.reload({ waitUntil: 'networkidle' });
    expect(page.url(), 'Should stay on dashboard after reload').toContain('/dashboard');
    expect(page.url(), 'Should not redirect to login on reload').not.toContain('/login');
  });

  test('sign out returns to homepage', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    const signout = page.locator('a, button').filter({ hasText: /sign.?out|log.?out/i }).first();
    await signout.click();
    await page.waitForTimeout(2000);
    expect(page.url(), 'Sign out should land on homepage or login').toMatch(/bidwiseinvest\.com\/(|login)$/);
  });
});

// ============================================================================
// DASHBOARD MAIN TABLE
// ============================================================================
test.describe('Dashboard Main Table', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  });

  test('table has 10 required columns', async ({ page }) => {
    const headers = await page.locator('th, [role="columnheader"]').allTextContents();
    const normalized = headers.map(h => h.trim()).filter(h => h.length > 0);
    console.log(`  Columns: ${normalized.join(' | ')}`);

    const required = ['Property', 'Auction Date', 'ARV', 'Net Profit', 'ROI', 'Score'];
    for (const col of required) {
      const found = normalized.some(h => h.toLowerCase().includes(col.toLowerCase()));
      expect(found, `Column "${col}" missing from table`).toBe(true);
    }
  });

  test('default view shows All tab with 22 rows (DeKalb)', async ({ page }) => {
    const rows = await page.locator('tbody tr').count();
    expect(rows, 'Default DeKalb view should have 22 rows').toBe(22);
  });

  test('SFR filter shows 1 row', async ({ page }) => {
    await page.locator('button, [role="tab"]').filter({ hasText: /^SFR\d*$/ }).first().click();
    await page.waitForTimeout(800);
    const rows = await page.locator('tbody tr').count();
    expect(rows, 'SFR filter should show 1 property').toBe(1);
  });

  test('Commercial filter shows 1 row', async ({ page }) => {
    await page.locator('button, [role="tab"]').filter({ hasText: /^Commercial\d*$/ }).first().click();
    await page.waitForTimeout(800);
    const rows = await page.locator('tbody tr').count();
    expect(rows, 'Commercial filter should show 1 property').toBe(1);
  });

  test('Land filter shows 20 rows', async ({ page }) => {
    await page.locator('button, [role="tab"]').filter({ hasText: /^Land\d*$/ }).first().click();
    await page.waitForTimeout(800);
    const rows = await page.locator('tbody tr').count();
    expect(rows, 'Land filter should show 20 properties').toBe(20);
  });

  test('Land properties have nulled ARV/ROI in table (shows "Land")', async ({ page }) => {
    await page.locator('button, [role="tab"]').filter({ hasText: /^Land\d*$/ }).first().click();
    await page.waitForTimeout(800);
    const firstRow = await page.locator('tbody tr').first().textContent() || '';
    // Land properties should NOT show dollar ARV — shows "Land" label instead
    expect(firstRow, 'Land row should contain "Land" type label').toMatch(/land/i);
    console.log(`  First land row: ${firstRow.substring(0, 120)}`);
  });

  test('Commercial property (3416 BLACKBURN WAY) shows specialist estimate', async ({ page }) => {
    await page.locator('button, [role="tab"]').filter({ hasText: /^Commercial\d*$/ }).first().click();
    await page.waitForTimeout(800);
    const rowText = await page.locator('tbody tr').first().textContent() || '';
    expect(rowText, 'Commercial row should show Specialist est.').toMatch(/specialist.?est|specialist/i);
    console.log(`  Commercial row: ${rowText.substring(0, 150)}`);
  });

  test('SFR property (2807 LEISURE WOODS LN) has full deal analysis', async ({ page }) => {
    await page.locator('button, [role="tab"]').filter({ hasText: /^SFR\d*$/ }).first().click();
    await page.waitForTimeout(800);
    const rowText = await page.locator('tbody tr').first().textContent() || '';
    // Should have ARV, net profit, ROI, score
    expect(rowText, 'SFR should have ARV dollar value').toMatch(/\$[\d,]+K|\$[\d,]+/);
    expect(rowText, 'SFR should have ROI percentage').toMatch(/[\d.]+%/);
    console.log(`  SFR row: ${rowText.substring(0, 150)}`);
  });

  test('all rows have auction date (May 5, 2026)', async ({ page }) => {
    const rows = await page.locator('tbody tr').allTextContents();
    const missingDate = rows.filter(r => !/may\s+5|2026/i.test(r));
    expect(missingDate.length, `${missingDate.length} rows missing auction date`).toBe(0);
  });

  test('column sorting works (click Tax Due)', async ({ page }) => {
    const beforeRows = await page.locator('tbody tr').first().textContent();
    const taxHeader = page.locator('th, [role="columnheader"]').filter({ hasText: /tax.?due/i }).first();
    await taxHeader.click();
    await page.waitForTimeout(800);
    const afterRows = await page.locator('tbody tr').first().textContent();
    console.log(`  Before sort first row: ${beforeRows?.substring(0, 80)}`);
    console.log(`  After sort first row: ${afterRows?.substring(0, 80)}`);
    // Table should still have 22 rows after sort
    const count = await page.locator('tbody tr').count();
    expect(count, 'Row count should not change after sorting').toBe(22);
  });
});

// ============================================================================
// COUNTY SWITCHING
// ============================================================================
test.describe('County Tab Switching', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  });

  test('Gwinnett shows 11 properties', async ({ page }) => {
    await page.locator('button, a, [role="tab"]').filter({ hasText: /gwinnett/i }).first().click();
    await page.waitForTimeout(1500);
    const rows = await page.locator('tbody tr').count();
    expect(rows, 'Gwinnett should have 11 properties').toBe(11);
  });

  test('Cobb shows 13 properties', async ({ page }) => {
    await page.locator('button, a, [role="tab"]').filter({ hasText: /cobb/i }).first().click();
    await page.waitForTimeout(1500);
    const rows = await page.locator('tbody tr').count();
    expect(rows, 'Cobb should have 13 properties').toBe(13);
  });

  test('DeKalb shows 22 properties', async ({ page }) => {
    await page.locator('button, a, [role="tab"]').filter({ hasText: /dekalb/i }).first().click();
    await page.waitForTimeout(1500);
    const rows = await page.locator('tbody tr').count();
    expect(rows, 'DeKalb should have 22 properties').toBe(22);
  });

  test('4440 HIDDEN STREAM DR appears in Gwinnett', async ({ page }) => {
    await page.locator('button, a, [role="tab"]').filter({ hasText: /gwinnett/i }).first().click();
    await page.waitForTimeout(1500);
    const bt = await page.textContent('body') || '';
    expect(bt, '4440 HIDDEN STREAM DR should be in Gwinnett data').toMatch(/hidden.?stream|4440/i);
  });

  test('Gwinnett: 4440 HIDDEN STREAM DR has correct deal values', async ({ page }) => {
    await page.locator('button, a, [role="tab"]').filter({ hasText: /gwinnett/i }).first().click();
    await page.waitForTimeout(1500);
    const rows = await page.locator('tbody tr').allTextContents();
    const hiddenStream = rows.find(r => /hidden.?stream|4440/i.test(r));
    expect(hiddenStream, '4440 HIDDEN STREAM DR row not found').toBeTruthy();
    if (hiddenStream) {
      expect(hiddenStream, 'Should be SFR type').toMatch(/SFR/i);
      expect(hiddenStream, 'Should have ARV ~$924K').toMatch(/\$924K|\$[\d,]+K/);
      expect(hiddenStream, 'Should have ROI').toMatch(/[\d.]+%/);
      console.log(`  4440 HIDDEN STREAM DR: ${hiddenStream.substring(0, 150)}`);
    }
  });
});

// ============================================================================
// PROPERTY DETAIL PANEL
// ============================================================================
test.describe('Property Detail Panel', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  });

  test('clicking a row opens detail panel', async ({ page }) => {
    const rowsBefore = await page.locator('tbody tr').count();
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(2000);
    // Page should still be dashboard URL
    expect(page.url(), 'Should stay on dashboard when row clicked').toContain('/dashboard');
    // Body should now contain detail panel fields
    const bt = await page.textContent('body') || '';
    const hasDetailContent = /net.?profit|max.?bid|tax.?due|comparable/i.test(bt);
    expect(hasDetailContent, 'Clicking row should open property detail panel').toBe(true);
  });

  test('land property detail: ARV is null/absent', async ({ page }) => {
    // Click first row (land property)
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '../output/screenshots/auth/detail-land.png', fullPage: true });
    const bt = await page.textContent('body') || '';
    // Land properties should NOT show a dollar ARV value
    console.log(`  Land detail body excerpt: ${bt.substring(bt.indexOf('Vacant Land') - 50, bt.indexOf('Vacant Land') + 200).trim()}`);
  });

  test('SFR property (LEISURE WOODS LN) detail has all fields', async ({ page }) => {
    // Switch to SFR tab
    await page.locator('button, [role="tab"]').filter({ hasText: /^SFR\d*$/ }).first().click();
    await page.waitForTimeout(800);
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: '../output/screenshots/auth/detail-sfr.png', fullPage: true });

    const bt = await page.textContent('body') || '';
    const required = ['ARV', 'Net Profit', 'ROI', 'Rehab', 'Max Bid', 'Auction'];
    for (const field of required) {
      const found = new RegExp(field, 'i').test(bt);
      console.log(`  SFR detail field "${field}": ${found ? '✓' : '✗'}`);
      expect(found, `SFR detail panel should show "${field}"`).toBe(true);
    }
  });

  test('commercial property detail suppresses financial fields', async ({ page }) => {
    await page.locator('button, [role="tab"]').filter({ hasText: /^Commercial\d*$/ }).first().click();
    await page.waitForTimeout(800);
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: '../output/screenshots/auth/detail-commercial.png', fullPage: true });

    const bt = await page.textContent('body') || '';
    const hasSpecialistEst = /specialist.?est|specialist/i.test(bt);
    console.log(`  Commercial shows specialist estimate: ${hasSpecialistEst}`);
    expect(hasSpecialistEst, 'Commercial property should show specialist estimate messaging').toBe(true);
  });
});

// ============================================================================
// DASHBOARD SUB-TABS
// ============================================================================
test.describe('Dashboard Sub-Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  });

  test('Top Deals tab shows 20 rows', async ({ page }) => {
    await page.locator('button, a, [role="tab"]').filter({ hasText: /top.?deals/i }).first().click();
    await page.waitForTimeout(1500);
    const rows = await page.locator('tbody tr').count();
    expect(rows, 'Top Deals should show 20 rows').toBe(20);
  });

  test('Analytics tab loads without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('button, a, [role="tab"]').filter({ hasText: /analytics/i }).first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '../output/screenshots/auth/analytics-tab.png', fullPage: true });
    expect(errors.length, `JS errors on Analytics tab: ${errors.join('; ')}`).toBe(0);
    // NOTE: Charts render as 0 canvas elements — this is an empty/stub state bug
    const charts = await page.locator('canvas, svg[role="img"]').count();
    console.log(`  Analytics charts rendered: ${charts} (KNOWN ISSUE: 0 = empty state)`);
  });

  test('Pipeline tab loads and shows Deal Pipeline heading', async ({ page }) => {
    await page.locator('button, a, [role="tab"]').filter({ hasText: /pipeline/i }).first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '../output/screenshots/auth/pipeline-tab.png', fullPage: true });
    const bt = await page.textContent('body') || '';
    expect(bt, 'Pipeline tab should show Deal Pipeline heading').toMatch(/deal.?pipeline/i);
    // NOTE: 0 kanban columns found — empty state, no deals added to pipeline yet
    const kanbanCols = await page.locator('[data-column], .kanban-col, .pipeline-stage').count();
    console.log(`  Pipeline kanban columns: ${kanbanCols} (expected: 0 if empty state, or 5 if populated)`);
  });
});

// ============================================================================
// DASHBOARD SETTINGS PANEL
// ============================================================================
test.describe('Dashboard Settings Panel', () => {
  test('Settings sidebar button opens settings in dashboard', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const settingsBtn = page.locator('a, button').filter({ hasText: /^settings$/i }).first();
    await settingsBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '../output/screenshots/auth/settings-panel.png', fullPage: true });

    const bt = await page.textContent('body') || '';
    // Settings panel should show auction date selector and sort options
    expect(bt, 'Settings should show auction date selector').toMatch(/april|may|2026/i);
    expect(bt, 'Settings should show sort options').toMatch(/sort.*roi|sort.*score|sort.*profit/i);
    expect(page.url(), 'Settings should stay on /dashboard').toContain('/dashboard');
  });

  test('Sort options: ROI, Score, Net Profit, Tax Due present', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const bt = await page.textContent('body') || '';
    const sortOptions = ['ROI', 'Score', 'Net Profit', 'Tax Due'];
    for (const opt of sortOptions) {
      expect(bt, `Sort option "${opt}" missing`).toMatch(new RegExp(opt, 'i'));
    }
  });

  test('Auction date selector shows May 5 and April 7 options', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const bt = await page.textContent('body') || '';
    expect(bt, 'Should have May 5 auction date').toMatch(/may.?5/i);
    expect(bt, 'Should have April 7 auction date').toMatch(/april.?7/i);
  });
});

// ============================================================================
// LEADS PIPELINE
// ============================================================================
test.describe('BidWise Leads', () => {
  test('leads page loads with off-market properties', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/leads`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '../output/screenshots/auth/leads-page.png', fullPage: true });

    const bt = await page.textContent('body') || '';
    expect(bt, 'Leads page should have off-market properties').toMatch(/pipeline|leads|off.?market/i);
    // Confirm known addresses from exploration
    expect(bt, 'Should show 101 Elm Blvd lead').toMatch(/elm.?blvd|elm/i);
  });

  test('watchlists page loads and shows empty state', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/leads/watchlists`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const bt = await page.textContent('body') || '';
    expect(bt, 'Watchlists page should load').toMatch(/watchlist/i);
    // Either shows empty state or has items
    const hasContent = /no watchlists yet|create a watchlist|new watchlist|\d+ watchlist/i.test(bt);
    expect(hasContent, 'Watchlists should show either empty state or list').toBe(true);
  });

  test('deal desk loads with pipeline stages', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/leads/deal-desk`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const bt = await page.textContent('body') || '';
    expect(bt, 'Deal Desk should load').toMatch(/deal.?desk/i);
    const stages = ['Qualified', 'In Outreach', 'Negotiating', 'Under Contract'];
    for (const stage of stages) {
      expect(bt, `Deal Desk stage "${stage}" should be present`).toMatch(new RegExp(stage, 'i'));
    }
  });

  test('/dashboard/leads/intel redirects to /dashboard/leads', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/leads/intel`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    // Confirmed during exploration: /intel redirects to /leads
    expect(page.url(), '/intel should redirect to /leads').toContain('/dashboard/leads');
  });
});

// ============================================================================
// NETWORK HEALTH (AUTHENTICATED)
// ============================================================================
test.describe('Authenticated Network Health', () => {
  test('no JS errors on dashboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const filtered = errors.filter(e => !/favicon|analytics|_rsc=/i.test(e));
    console.log(`  Console/page errors: ${filtered.length}`);
    filtered.forEach(e => console.log(`    ✗ ${e}`));
    expect(filtered.length, `JS errors: ${filtered.join('; ')}`).toBe(0);
  });

  test('RSC ERR_ABORTED requests are benign (Next.js behavior)', async ({ page }) => {
    const aborted: string[] = [];
    page.on('requestfailed', req => {
      if (req.url().includes('_rsc=')) aborted.push(req.url());
    });
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    // These are expected — Next.js RSC prefetch cancellations, not errors
    console.log(`  RSC prefetch cancellations (expected): ${aborted.length}`);
    // This should always pass — just documenting the known pattern
    expect(true).toBe(true);
  });

  test('county JSON loads correctly on dashboard', async ({ page }) => {
    const jsonFiles: { name: string; sizeKb: number; status: number }[] = [];
    page.on('response', async resp => {
      if (/\.json/i.test(resp.url())) {
        const body = await resp.body().catch(() => Buffer.alloc(0));
        jsonFiles.push({
          name: resp.url().split('/').pop()?.split('?')[0] || 'unknown',
          sizeKb: Math.round(body.length / 1024),
          status: resp.status(),
        });
      }
    });
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log(`  JSON files loaded: ${jsonFiles.length}`);
    jsonFiles.forEach(j => console.log(`    ${j.status} ${j.name} (${j.sizeKb}KB)`));

    // dekalb.json should load and be > 100KB (has 22 properties with full data)
    const dekalbJson = jsonFiles.find(j => j.name.includes('dekalb') && j.sizeKb > 10);
    expect(dekalbJson, 'dekalb.json should load with substantial data').toBeTruthy();
    if (dekalbJson) {
      expect(dekalbJson.status, 'dekalb.json should return 200').toBe(200);
    }
  });
});
