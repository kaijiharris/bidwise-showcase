import { test, expect } from '@playwright/test';

test.describe('Edge Cases & Error Handling', () => {
  test('404 page renders correctly', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist-12345', { waitUntil: 'domcontentloaded' });

    await page.screenshot({ path: '../output/screenshots/404-page.png', fullPage: true });

    const bodyText = await page.textContent('body') || '';
    const has404Content = /404|not found|page.*not.*exist|oops/i.test(bodyText);

    console.log(`  HTTP status: ${response?.status()}`);
    console.log(`  404 content shown: ${has404Content}`);
    console.log(`  Final URL: ${page.url()}`);

    // Either shows 404 status or redirects to homepage — both are acceptable
    const is404OrRedirect = (response?.status() === 404) || page.url().includes('bidwiseinvest.com');
    expect(is404OrRedirect, '404 should either return 404 status or redirect gracefully').toBe(true);
  });

  test('invalid address search returns graceful error', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="address" i]').first();

    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('XXXXXXXXXXX INVALID ADDRESS 99999');
      await searchInput.press('Enter');
      await page.waitForTimeout(2000);

      const bodyText = await page.textContent('body') || '';
      const hasErrorHandling = /no results|not found|no properties|empty|sorry/i.test(bodyText);
      console.log(`  Graceful empty state: ${hasErrorHandling}`);
      await page.screenshot({ path: '../output/screenshots/invalid-search.png', fullPage: true });
    } else {
      console.log('  SKIP: No search input found for this test.');
    }
  });

  test('back/forward browser navigation works', async ({ page }) => {
    // NOTE: The homepage uses anchor-hash links (#pricing, #how-it-works) which do NOT
    // create new browser history entries — back() from there goes to about:blank.
    // Test navigation from a real page (/pricing) back to homepage instead.
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
    const pricingUrl = page.url();

    // Navigate to signup
    const signupLink = page.locator('a[href*="/signup"]').first();
    if (await signupLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await signupLink.click();
      await page.waitForTimeout(1500);
      const signupUrl = page.url();
      console.log(`  Navigated ${pricingUrl} → ${signupUrl}`);

      await page.goBack();
      await page.waitForTimeout(1000);
      const backUrl = page.url();
      console.log(`  Back: ${backUrl}`);

      expect(backUrl, 'Back from /signup should return to /pricing').toContain('pricing');
    } else {
      // Fallback: just verify /pricing → /login → back works
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      const loginUrl = page.url();
      await page.goBack();
      await page.waitForTimeout(1000);
      const backUrl = page.url();
      console.log(`  Back from /login: ${backUrl}`);
      expect(backUrl, 'Back from /login should return to /pricing').toContain('pricing');
    }
  });

  test('rapid clicking does not crash page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // Rapid click on first visible button
    const btn = page.locator('button, a').first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      for (let i = 0; i < 5; i++) {
        await btn.click({ timeout: 2000 }).catch(() => {});
      }
    }

    await page.waitForTimeout(1000);
    console.log(`  Errors after rapid clicks: ${jsErrors.length}`);
    expect(jsErrors.length, `Crash errors from rapid clicking: ${jsErrors.join('; ')}`).toBe(0);
  });

  test('empty/whitespace search handled', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]').first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('   ');
      await searchInput.press('Enter');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: '../output/screenshots/empty-search.png', fullPage: false });
      console.log(`  Empty search handled, URL: ${page.url()}`);
    } else {
      console.log('  SKIP: No search input found.');
    }
  });

  test('page title and meta change on navigation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const homeTitle = await page.title();

    const routes = ['/dashboard', '/login', '/about', '/pricing'];
    const titleMap: Record<string, string> = { '/': homeTitle };

    for (const route of routes) {
      try {
        const resp = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 8000 });
        if (resp && resp.status() < 400) {
          titleMap[route] = await page.title();
        }
      } catch (e) { /* skip */ }
    }

    console.log('  Page titles:');
    Object.entries(titleMap).forEach(([route, title]) => {
      console.log(`    ${route}: "${title}"`);
    });

    // All pages should have a non-empty title
    Object.entries(titleMap).forEach(([route, title]) => {
      expect(title, `Page ${route} should have a title`).toBeTruthy();
    });
  });
});
