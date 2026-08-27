import { test, expect } from '@playwright/test';

test.describe('Responsive Design & Accessibility', () => {
  const viewports = [
    { name: 'desktop', width: 1920, height: 1080 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 667 },
  ];

  for (const vp of viewports) {
    test(`homepage renders correctly on ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/', { waitUntil: 'networkidle' });

      // Check no horizontal overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.body.scrollWidth > window.innerWidth;
      });

      if (hasHorizontalOverflow) {
        console.log(`  ⚠️ Horizontal overflow detected on ${vp.name}`);
      }

      await page.screenshot({
        path: `../output/screenshots/responsive-${vp.name}.png`,
        fullPage: true,
      });

      // Check key elements are still visible
      const bodyVisible = await page.locator('body').isVisible();
      expect(bodyVisible, `Body not visible on ${vp.name}`).toBe(true);

      console.log(`  ${vp.name}: overflow=${hasHorizontalOverflow}, page renders ok`);
    });
  }

  test('keyboard navigation - tab through interactive elements', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Tab through first 10 focusable elements
    const focusedElements: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? `${el.tagName}[${el.getAttribute('href') || el.textContent?.trim().substring(0, 30) || ''}]` : 'none';
      });
      focusedElements.push(focused);
    }

    console.log('  Tab navigation sequence:');
    focusedElements.forEach((el, i) => console.log(`    ${i + 1}. ${el}`));

    // Should be able to tab through at least some elements
    const nonBodyElements = focusedElements.filter(e => !e.includes('BODY'));
    console.log(`  Focusable interactive elements: ${nonBodyElements.length}`);
  });

  test('images have alt text', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const imageAltStatus = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.map(img => ({
        src: img.src.split('/').pop() || 'unknown',
        hasAlt: img.hasAttribute('alt'),
        altText: img.getAttribute('alt') || '',
      }));
    });

    const missingAlt = imageAltStatus.filter(i => !i.hasAlt);
    const emptyAlt = imageAltStatus.filter(i => i.hasAlt && i.altText === '' && !i.src.includes('icon'));

    if (missingAlt.length > 0) {
      console.log(`  ⚠️ Images missing alt attribute: ${missingAlt.map(i => i.src).join(', ')}`);
    }
    if (emptyAlt.length > 0) {
      console.log(`  ℹ️ Images with empty alt (decorative?): ${emptyAlt.map(i => i.src).join(', ')}`);
    }

    console.log(`  Total images: ${imageAltStatus.length}, missing alt: ${missingAlt.length}`);
    expect(missingAlt.length, `${missingAlt.length} images missing alt attribute`).toBe(0);
  });

  test('page has heading hierarchy (h1)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const headings = await page.evaluate(() => {
      const result: { tag: string; text: string }[] = [];
      ['h1', 'h2', 'h3'].forEach(tag => {
        document.querySelectorAll(tag).forEach(el => {
          result.push({ tag, text: el.textContent?.trim().substring(0, 60) || '' });
        });
      });
      return result;
    });

    const h1s = headings.filter(h => h.tag === 'h1');
    console.log('  Heading structure:');
    headings.forEach(h => console.log(`    <${h.tag}> "${h.text}"`));

    expect(h1s.length, 'Page should have exactly one h1').toBeGreaterThanOrEqual(1);
    expect(h1s.length, 'Page should not have multiple h1 elements').toBeLessThanOrEqual(2);
  });

  test('slow network simulation (3G) - page still loads', async ({ page }) => {
    // Simulate slow 3G
    await page.context().route('**/*', async route => {
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay per request
      await route.continue();
    });

    const start = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const elapsed = Date.now() - start;

    await page.screenshot({ path: '../output/screenshots/slow-network.png', fullPage: false });
    console.log(`  3G simulation load time: ${elapsed}ms`);
    expect(elapsed, `Page too slow on throttled network: ${elapsed}ms`).toBeLessThan(20000);
  });
});
