/**
 * Authenticated exploration script.
 * Logs in with real credentials, then crawls every reachable dashboard
 * section, captures full-page screenshots, and logs what it finds.
 *
 * Run with:  npx playwright test explore-authenticated --project=chromium-desktop --headed
 */
import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import { BASE_URL as BASE, credentials, requireCredentials } from './test-config';

requireCredentials();

const SS    = (name: string) => `../output/screenshots/auth/${name}.png`;

// ---------------------------------------------------------------------------
// Helper: login once and reuse auth state across the suite
// ---------------------------------------------------------------------------
async function login(page: Page) {
  const { email: EMAIL, password: PASS } = credentials();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first()
    .waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  // Try every plausible email selector
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="email" i]',
    'input[id*="email" i]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
  ];
  const passSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="password" i]',
    'input[id*="password" i]',
  ];

  let emailFilled = false;
  for (const sel of emailSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.fill(EMAIL);
      emailFilled = true;
      console.log(`  Email filled via: ${sel}`);
      break;
    }
  }

  let passFilled = false;
  for (const sel of passSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.fill(PASS);
      passFilled = true;
      console.log(`  Password filled via: ${sel}`);
      break;
    }
  }

  if (!emailFilled || !passFilled) {
    await page.screenshot({ path: SS('login-form-debug'), fullPage: true });
    // Log the full DOM to diagnose selector issues
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type, name: i.name, id: i.id,
        placeholder: i.placeholder, autocomplete: i.autocomplete,
      }))
    );
    console.log('  All input elements found:', JSON.stringify(inputs, null, 2));
    throw new Error(`Could not fill login form. emailFilled=${emailFilled} passFilled=${passFilled}`);
  }

  await page.screenshot({ path: SS('login-filled'), fullPage: false });

  // Submit
  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Continue")',
    'input[type="submit"]',
  ];
  let submitted = false;
  for (const sel of submitSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click();
      submitted = true;
      console.log(`  Submit clicked via: ${sel}`);
      break;
    }
  }
  if (!submitted) {
    await page.keyboard.press('Enter');
    console.log('  Submit via Enter key');
  }

  // Wait for redirect away from /login
  await page.waitForURL(url => !url.href.includes('/login'), { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: SS('post-login'), fullPage: true });
  console.log(`  Post-login URL: ${page.url()}`);
}

// ---------------------------------------------------------------------------
// Helper: screenshot + log route
// ---------------------------------------------------------------------------
async function visitAndCapture(page: Page, route: string, label: string) {
  console.log(`\n  Visiting ${route}...`);
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000); // let JS hydrate
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const finalUrl = page.url();
  const status = finalUrl.includes('/login') ? 'AUTH-REDIRECT' : 'LOADED';
  console.log(`  ${status} → ${finalUrl}`);
  await page.screenshot({ path: SS(label), fullPage: true });
  return { finalUrl, redirected: finalUrl.includes('/login') };
}

// ---------------------------------------------------------------------------
// Helper: capture all visible text content for a section
// ---------------------------------------------------------------------------
async function captureContent(page: Page) {
  return page.evaluate(() => {
    // Get all text nodes in meaningful elements
    const els = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,th,td,label,button,[role="tab"],[role="columnheader"]'));
    return [...new Set(els.map(e => e.textContent?.trim()).filter(t => t && t.length > 1))].slice(0, 100);
  });
}

// ===========================================================================
// TEST SUITE
// ===========================================================================

test.describe('Authenticated Dashboard Exploration', () => {
  test.setTimeout(120000);

  // -------------------------------------------------------------------------
  test('01 - Login flow', async ({ page }) => {
    await login(page);
    expect(page.url(), 'Should redirect away from /login after successful login').not.toContain('/login');
    console.log(`  Logged in. Landing URL: ${page.url()}`);
  });

  // -------------------------------------------------------------------------
  test('02 - Dashboard overview', async ({ page }) => {
    await login(page);
    const { finalUrl } = await visitAndCapture(page, '/dashboard', '02-dashboard');

    const content = await captureContent(page);
    console.log('  Dashboard content headings/labels:');
    content.slice(0, 30).forEach(t => console.log(`    • ${t}`));

    // Check for key dashboard elements
    const bodyText = await page.textContent('body') || '';
    const checks = {
      'County data (Gwinnett/Cobb/DeKalb)': /gwinnett|cobb|dekalb/i.test(bodyText),
      'Property listings visible': /\d{1,5}\s+(properties|listings|results)/i.test(bodyText) || bodyText.includes('LAWRENCEVILLE') || bodyText.includes('PEACHTREE'),
      'ARV field': /ARV/i.test(bodyText),
      'ROI field': /ROI/i.test(bodyText),
      'Auction date column': /auction.?date|may|june/i.test(bodyText),
      'Deal score': /score|grade|rating/i.test(bodyText),
      'Filter controls': /filter|county|sort/i.test(bodyText),
    };
    console.log('  Dashboard element checks:');
    Object.entries(checks).forEach(([k, v]) => console.log(`    ${v ? '✓' : '✗'} ${k}`));
  });

  // -------------------------------------------------------------------------
  test('03 - Properties page', async ({ page }) => {
    await login(page);
    await visitAndCapture(page, '/properties', '03-properties');

    const bodyText = await page.textContent('body') || '';
    const content = await captureContent(page);
    console.log('  Properties page content:');
    content.slice(0, 20).forEach(t => console.log(`    • ${t}`));

    // Count property cards/rows
    const rowCount = await page.locator('tr, [data-testid*="property"], .property-card, .property-row').count();
    console.log(`  Property rows/cards found: ${rowCount}`);

    // Capture table headers
    const headers = await page.locator('th, [role="columnheader"]').allTextContents();
    if (headers.length > 0) console.log(`  Table columns: ${headers.join(' | ')}`);
  });

  // -------------------------------------------------------------------------
  test('04 - Auctions page', async ({ page }) => {
    await login(page);
    await visitAndCapture(page, '/auctions', '04-auctions');

    const content = await captureContent(page);
    console.log('  Auctions page content:');
    content.slice(0, 20).forEach(t => console.log(`    • ${t}`));

    const headers = await page.locator('th, [role="columnheader"]').allTextContents();
    if (headers.length > 0) console.log(`  Table columns: ${headers.join(' | ')}`);

    const rowCount = await page.locator('tbody tr').count();
    console.log(`  Table rows: ${rowCount}`);
  });

  // -------------------------------------------------------------------------
  test('05 - /app route', async ({ page }) => {
    await login(page);
    await visitAndCapture(page, '/app', '05-app');

    const content = await captureContent(page);
    console.log('  /app content:');
    content.slice(0, 20).forEach(t => console.log(`    • ${t}`));
  });

  // -------------------------------------------------------------------------
  test('06 - Individual property detail (first clickable)', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Try to click first property link/row
    const propertyLinks = [
      'a[href*="/properties/"]',
      'a[href*="/property/"]',
      'a[href*="/auction/"]',
      'tbody tr:first-child',
      '[data-testid*="property"]:first-child',
      '.property-card:first-child',
    ];

    let clicked = false;
    for (const sel of propertyLinks) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        const href = await el.getAttribute('href').catch(() => null);
        console.log(`  Clicking property via: ${sel} (href: ${href})`);
        await el.click();
        await page.waitForTimeout(2000);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.screenshot({ path: SS('06-property-detail'), fullPage: true });
        clicked = true;
        console.log(`  Property detail URL: ${page.url()}`);
        break;
      }
    }

    if (!clicked) {
      console.log('  No clickable property links found on dashboard.');
      await page.screenshot({ path: SS('06-property-detail-notfound'), fullPage: true });
    }

    const bodyText = await page.textContent('body') || '';
    const detailFields = {
      'Address': /\d+\s+[A-Z]/i.test(bodyText),
      'ARV': /ARV/i.test(bodyText),
      'ROI %': /ROI|return/i.test(bodyText),
      'Net profit': /net.?profit/i.test(bodyText),
      'Rehab estimate': /rehab/i.test(bodyText),
      'As-is value': /as.?is/i.test(bodyText),
      'Max bid': /max.?bid/i.test(bodyText),
      'Auction date': /auction.?date|may|june/i.test(bodyText),
      'Comps': /comp|comparable/i.test(bodyText),
      'Property type': /residential|commercial|land|multi.?family/i.test(bodyText),
      'Beds/Baths': /bed|bath/i.test(bodyText),
      'Sqft': /sq.?ft|square.?feet/i.test(bodyText),
    };
    console.log('  Property detail fields:');
    Object.entries(detailFields).forEach(([k, v]) => console.log(`    ${v ? '✓' : '✗'} ${k}`));
  });

  // -------------------------------------------------------------------------
  test('07 - Property detail: specific addresses', async ({ page }) => {
    await login(page);

    const addresses = [
      '4440-hidden-stream',
      '2346-lawrenceville',
      '7078-peachtree',
    ];

    for (const slug of addresses) {
      // Try common URL patterns
      for (const pattern of [`/properties/${slug}`, `/property/${slug}`, `/auctions/${slug}`]) {
        const resp = await page.goto(`${BASE}${pattern}`, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
        if (resp && resp.status() < 400 && !page.url().includes('/login')) {
          console.log(`  Found: ${page.url()}`);
          await page.waitForTimeout(1500);
          await page.screenshot({ path: SS(`07-detail-${slug}`), fullPage: true });
          break;
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  test('08 - Navigation: all sidebar/nav links', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    // Collect all nav links
    const navLinks = await page.evaluate(() => {
      const selectors = ['nav a', '[role="navigation"] a', '.sidebar a', '.nav a', 'aside a', 'header a'];
      const found: { text: string; href: string }[] = [];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(a => {
          const el = a as HTMLAnchorElement;
          if (el.href && !el.href.includes('#') && el.textContent?.trim()) {
            found.push({ text: el.textContent.trim().substring(0, 40), href: el.href });
          }
        });
      }
      return [...new Map(found.map(f => [f.href, f])).values()];
    });

    console.log(`  Nav links found: ${navLinks.length}`);
    navLinks.forEach(l => console.log(`    "${l.text}" → ${l.href}`));

    // Visit each unique internal nav link
    for (const link of navLinks.filter(l => l.href.includes('bidwiseinvest.com')).slice(0, 10)) {
      const route = new URL(link.href).pathname;
      await visitAndCapture(page, route, `08-nav-${route.replace(/\//g, '-').slice(1) || 'home'}`);
    }
  });

  // -------------------------------------------------------------------------
  test('09 - County filter/tab switching', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    const counties = ['Gwinnett', 'Cobb', 'DeKalb'];
    for (const county of counties) {
      const btn = page.locator(`button, a, [role="tab"]`).filter({ hasText: new RegExp(county, 'i') }).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`  Clicking ${county} filter...`);
        await btn.click();
        await page.waitForTimeout(1500);
        const rowCount = await page.locator('tbody tr').count();
        console.log(`  ${county}: ${rowCount} rows after filter`);
        await page.screenshot({ path: SS(`09-county-${county.toLowerCase()}`), fullPage: true });
      } else {
        console.log(`  ${county} filter button not found`);
      }
    }
  });

  // -------------------------------------------------------------------------
  test('10 - Sort columns / table interactions', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    const headers = await page.locator('th, [role="columnheader"]').all();
    console.log(`  Table headers found: ${headers.length}`);

    for (let i = 0; i < Math.min(headers.length, 5); i++) {
      const text = await headers[i].textContent();
      if (await headers[i].isVisible().catch(() => false)) {
        await headers[i].click().catch(() => {});
        await page.waitForTimeout(500);
        console.log(`  Clicked column: "${text?.trim()}"`);
      }
    }
    await page.screenshot({ path: SS('10-table-sort'), fullPage: true });
  });

  // -------------------------------------------------------------------------
  test('11 - Settings / account page', async ({ page }) => {
    await login(page);

    const settingsRoutes = ['/settings', '/account', '/profile', '/dashboard/settings'];
    for (const route of settingsRoutes) {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
      if (resp && resp.status() < 400 && !page.url().includes('/login')) {
        console.log(`  Settings found at: ${route}`);
        await page.waitForTimeout(1500);
        const content = await captureContent(page);
        console.log('  Settings content:');
        content.slice(0, 15).forEach(t => console.log(`    • ${t}`));
        await page.screenshot({ path: SS('11-settings'), fullPage: true });
        break;
      }
    }
  });

  // -------------------------------------------------------------------------
  test('12 - Pricing page (logged in)', async ({ page }) => {
    await login(page);
    await visitAndCapture(page, '/pricing', '12-pricing');
    const content = await captureContent(page);
    console.log('  Pricing content:');
    content.slice(0, 15).forEach(t => console.log(`    • ${t}`));
  });

  // -------------------------------------------------------------------------
  test('13 - Mobile view of dashboard (375px)', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: SS('13-dashboard-mobile'), fullPage: true });

    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    console.log(`  Mobile horizontal overflow: ${overflow}`);

    // Check hamburger/mobile menu
    const hamburger = page.locator('[aria-label*="menu" i], .hamburger, .mobile-menu-btn, button[aria-expanded]').first();
    if (await hamburger.isVisible({ timeout: 2000 }).catch(() => false)) {
      await hamburger.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: SS('13-dashboard-mobile-menu-open'), fullPage: false });
      console.log('  Mobile menu opened');
    }
  });

  // -------------------------------------------------------------------------
  test('14 - Console errors and network failures while authenticated', async ({ page }) => {
    const consoleErrors: string[] = [];
    const networkFails: string[] = [];
    const apiErrors: { url: string; status: number }[] = [];

    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`PAGE: ${err.message}`));
    page.on('requestfailed', req => networkFails.push(`${req.failure()?.errorText} — ${req.url()}`));
    page.on('response', resp => {
      if (resp.status() >= 400) {
        apiErrors.push({ url: resp.url(), status: resp.status() });
      }
    });

    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    console.log(`  Console errors: ${consoleErrors.length}`);
    consoleErrors.forEach(e => console.log(`    ✗ ${e}`));
    console.log(`  Network failures: ${networkFails.length}`);
    networkFails.forEach(e => console.log(`    ✗ ${e}`));
    console.log(`  HTTP errors (4xx/5xx): ${apiErrors.length}`);
    apiErrors.forEach(e => console.log(`    ${e.status} ${e.url}`));

    expect(consoleErrors.filter(e => !/favicon|analytics|third.?party/i.test(e)).length,
      `Console errors: ${consoleErrors.join('; ')}`).toBeLessThan(5);
  });

  // -------------------------------------------------------------------------
  test('15 - All JSON data files accessible while authenticated', async ({ page }) => {
    const jsonLoads: { url: string; status: number; sizeKb: number }[] = [];

    page.on('response', async resp => {
      const url = resp.url();
      if (/\.json/i.test(url)) {
        try {
          const body = await resp.body();
          jsonLoads.push({ url: url.split('/').pop() || url, status: resp.status(), sizeKb: Math.round(body.length / 1024) });
        } catch {
          jsonLoads.push({ url: url.split('/').pop() || url, status: resp.status(), sizeKb: 0 });
        }
      }
    });

    await login(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    console.log(`  JSON files loaded on dashboard: ${jsonLoads.length}`);
    jsonLoads.forEach(j => console.log(`    ${j.status} ${j.url} (${j.sizeKb}KB)`));

    const failed = jsonLoads.filter(j => j.status >= 400);
    expect(failed.length, `Failed JSON: ${failed.map(j => j.url).join(', ')}`).toBe(0);
  });
});
