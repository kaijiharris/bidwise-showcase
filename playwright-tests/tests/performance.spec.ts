import { test, expect } from '@playwright/test';

test.describe('Performance & Network Health', () => {
  test('homepage load time < 3 seconds (LCP proxy)', async ({ page }) => {
    const metrics: { url: string; status: number; duration: number }[] = [];

    page.on('response', response => {
      metrics.push({
        url: response.url(),
        status: response.status(),
        duration: 0,
      });
    });

    const start = Date.now();
    await page.goto('/', { waitUntil: 'load' });
    const totalTime = Date.now() - start;

    const failed = metrics.filter(m => m.status >= 400);
    const status4xx = failed.filter(m => m.status >= 400 && m.status < 500);
    const status5xx = failed.filter(m => m.status >= 500);

    console.log(`  Page load time: ${totalTime}ms`);
    console.log(`  Total network requests: ${metrics.length}`);
    console.log(`  4xx errors: ${status4xx.length}`);
    console.log(`  5xx errors: ${status5xx.length}`);

    if (status4xx.length > 0) {
      console.log('  4xx URLs:');
      status4xx.slice(0, 10).forEach(r => console.log(`    ${r.status} ${r.url}`));
    }
    if (status5xx.length > 0) {
      console.log('  5xx URLs:');
      status5xx.forEach(r => console.log(`    ${r.status} ${r.url}`));
    }

    expect(totalTime, `Homepage took ${totalTime}ms (threshold: 3000ms)`).toBeLessThan(3000);
    expect(status5xx.length, `${status5xx.length} server errors on load`).toBe(0);
  });

  test('no failed API calls on homepage', async ({ page }) => {
    const apiErrors: { url: string; status: number }[] = [];

    page.on('response', response => {
      const url = response.url();
      if (/api\.|\/api\/|\.json/i.test(url) && response.status() >= 400) {
        apiErrors.push({ url, status: response.status() });
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    if (apiErrors.length > 0) {
      console.log('  Failed API calls:');
      apiErrors.forEach(e => console.log(`    ${e.status} ${e.url}`));
    }

    expect(apiErrors.length, `Failed API calls: ${apiErrors.map(e => `${e.status} ${e.url}`).join('; ')}`).toBe(0);
  });

  test('JavaScript bundle loads without errors', async ({ page }) => {
    const jsErrors: string[] = [];
    const networkErrors: string[] = [];

    page.on('pageerror', err => jsErrors.push(err.message));
    page.on('requestfailed', req => {
      if (/\.js/.test(req.url())) {
        networkErrors.push(`${req.failure()?.errorText}: ${req.url()}`);
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    console.log(`  JS runtime errors: ${jsErrors.length}`);
    jsErrors.forEach(e => console.log(`    ✗ ${e}`));

    console.log(`  JS load failures: ${networkErrors.length}`);
    networkErrors.forEach(e => console.log(`    ✗ ${e}`));

    expect(jsErrors.length, `JS errors: ${jsErrors.join('; ')}`).toBe(0);
  });

  test('CSS and fonts load correctly', async ({ page }) => {
    const styleErrors: string[] = [];

    page.on('requestfailed', req => {
      if (/\.css|fonts\.|googleapis\.com\/css/.test(req.url())) {
        styleErrors.push(`${req.failure()?.errorText}: ${req.url()}`);
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    if (styleErrors.length > 0) {
      console.log('  CSS/Font failures:');
      styleErrors.forEach(e => console.log(`    ✗ ${e}`));
    }

    expect(styleErrors.length, `CSS/font load failures: ${styleErrors.join('; ')}`).toBe(0);
  });

  test('data JSON files load correctly (county data)', async ({ page }) => {
    const jsonResponses: { url: string; status: number; size?: number }[] = [];

    page.on('response', async response => {
      const url = response.url();
      if (/\.json/i.test(url)) {
        try {
          const body = await response.body();
          jsonResponses.push({ url, status: response.status(), size: body.length });
        } catch {
          jsonResponses.push({ url, status: response.status() });
        }
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    console.log(`  JSON files loaded: ${jsonResponses.length}`);
    jsonResponses.forEach(r => {
      const sizeKb = r.size ? `${(r.size / 1024).toFixed(1)}KB` : 'unknown';
      console.log(`    ${r.status} ${r.url.split('/').pop()} (${sizeKb})`);
    });

    const failedJson = jsonResponses.filter(r => r.status >= 400);
    expect(failedJson.length, `Failed JSON requests: ${failedJson.map(r => r.url).join(', ')}`).toBe(0);
  });
});
