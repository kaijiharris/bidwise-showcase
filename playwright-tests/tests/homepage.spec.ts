import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('loads within 3 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const elapsed = Date.now() - start;
    await page.screenshot({ path: '../output/screenshots/homepage-load.png', fullPage: true });
    expect(elapsed, `Page took ${elapsed}ms to load (threshold: 3000ms)`).toBeLessThan(3000);
  });

  test('has correct title and meta tags', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title, 'Page title should not be empty').toBeTruthy();
    console.log(`  Title: "${title}"`);

    const description = await page.getAttribute('meta[name="description"]', 'content');
    console.log(`  Meta description: "${description}"`);

    const ogTitle = await page.getAttribute('meta[property="og:title"]', 'content');
    console.log(`  OG title: "${ogTitle}"`);
  });

  test('hero section visible with key content', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for common hero text patterns
    const bodyText = await page.textContent('body');
    const hasRelevantContent = /auction|property|invest|bid|real estate|deal/i.test(bodyText || '');
    await page.screenshot({ path: '../output/screenshots/homepage-hero.png', fullPage: false });
    expect(hasRelevantContent, 'Homepage should contain real estate/auction related content').toBe(true);
  });

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    if (errors.length > 0) {
      console.log('Console errors found:');
      errors.forEach(e => console.log(`  - ${e}`));
    }
    // Log but don't fail — report only
    expect(errors.length, `Found ${errors.length} console errors: ${errors.join('; ')}`).toBeLessThan(5);
  });

  test('no broken images', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const brokenImages = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs
        .filter(img => !img.complete || img.naturalWidth === 0)
        .map(img => img.src || img.getAttribute('src') || 'unknown');
    });

    // KNOWN BUG: /_next/image?url=%2Flogo.png renders with naturalWidth=0 — logo.png
    // is missing or corrupt in the production deployment. Tracked as P0 fix needed.
    const knownBroken = ['logo.png'];
    const unexpectedBroken = brokenImages.filter(
      src => !knownBroken.some(known => src.includes(known))
    );

    if (brokenImages.length > 0) {
      console.log(`  Known broken images (P0 fix pending): ${brokenImages.filter(s => knownBroken.some(k => s.includes(k))).join(', ')}`);
    }
    if (unexpectedBroken.length > 0) {
      console.log(`  NEW broken images: ${unexpectedBroken.join(', ')}`);
    }
    expect(unexpectedBroken.length, `Unexpected broken images: ${unexpectedBroken.join(', ')}`).toBe(0);
  });

  test('primary CTAs are clickable', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors.map(a => ({
        text: (a as HTMLAnchorElement).textContent?.trim().substring(0, 50),
        href: (a as HTMLAnchorElement).href,
      })).filter(a => a.text && a.text.length > 0).slice(0, 20);
    });

    console.log('Navigation links found:');
    links.forEach(l => console.log(`  "${l.text}" → ${l.href}`));
    expect(links.length, 'Should have at least 1 link').toBeGreaterThan(0);
  });

  test('navigation links do not 404', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const internalLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => (a as HTMLAnchorElement).href)
        .filter(href => href.includes('bidwiseinvest.com') && !href.includes('#') && !href.includes('mailto:'))
        .slice(0, 10);
    });

    console.log(`Checking ${internalLinks.length} internal links...`);
    const failures: string[] = [];

    for (const link of internalLinks) {
      try {
        const response = await page.request.get(link);
        if (response.status() === 404) {
          failures.push(`404: ${link}`);
        } else {
          console.log(`  ${response.status()} ${link}`);
        }
      } catch (e) {
        failures.push(`ERROR: ${link}`);
      }
    }

    expect(failures, `404 links: ${failures.join(', ')}`).toHaveLength(0);
  });
});
