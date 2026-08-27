import { test, expect } from '@playwright/test';
import { BASE_URL } from './test-config';

test.describe('Authentication Flows', () => {
  test('login page exists and renders form', async ({ page }) => {
    const loginRoutes = ['/login', '/signin', '/auth', '/auth/login', '/sign-in'];
    let loginFound = false;
    let loginUrl = '';

    for (const route of loginRoutes) {
      try {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (response && response.status() < 400) {
          const bodyText = await page.textContent('body') || '';
          if (/login|sign.?in|email|password/i.test(bodyText)) {
            loginFound = true;
            loginUrl = page.url();
            await page.screenshot({ path: '../output/screenshots/login-page.png', fullPage: true });
            console.log(`  Login page found at: ${route}`);
            break;
          }
        }
      } catch (e) {
        // continue
      }
    }

    // Also check if homepage has login button that redirects
    if (!loginFound) {
      await page.goto('/', { waitUntil: 'networkidle' });
      const loginBtn = page.locator('a, button').filter({ hasText: /log.?in|sign.?in/i }).first();
      if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await loginBtn.click();
        await page.waitForTimeout(2000);
        loginFound = true;
        loginUrl = page.url();
        await page.screenshot({ path: '../output/screenshots/login-page-via-btn.png', fullPage: true });
        console.log(`  Login reached via button → ${loginUrl}`);
      }
    }

    if (!loginFound) {
      console.log('  NOTE: No login page found. May be embedded or use OAuth provider.');
    }
    console.log(`  Login found: ${loginFound}, URL: ${loginUrl}`);
  });

  test('signup/register page exists', async ({ page }) => {
    const signupRoutes = ['/signup', '/register', '/auth/signup', '/create-account', '/join'];
    let signupFound = false;

    for (const route of signupRoutes) {
      try {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (response && response.status() < 400) {
          const bodyText = await page.textContent('body') || '';
          if (/sign.?up|register|create.?account|email/i.test(bodyText)) {
            signupFound = true;
            await page.screenshot({ path: '../output/screenshots/signup-page.png', fullPage: true });
            console.log(`  Signup page found at: ${route}`);
            break;
          }
        }
      } catch (e) { /* continue */ }
    }

    // Check homepage for signup CTA
    if (!signupFound) {
      await page.goto('/', { waitUntil: 'networkidle' });
      const signupBtn = page.locator('a, button').filter({ hasText: /sign.?up|get.?started|create.?account|join/i }).first();
      if (await signupBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        const href = await signupBtn.getAttribute('href');
        await signupBtn.click();
        await page.waitForTimeout(2000);
        signupFound = true;
        await page.screenshot({ path: '../output/screenshots/signup-page-via-btn.png', fullPage: true });
        console.log(`  Signup reached via button (href: ${href}) → ${page.url()}`);
      }
    }

    if (!signupFound) {
      console.log('  NOTE: No signup page found.');
    }
    console.log(`  Signup found: ${signupFound}`);
  });

  test('protected routes redirect to login', async ({ page }) => {
    const protectedRoutes = ['/dashboard', '/app', '/properties', '/auctions'];
    const redirectResults: { route: string; redirected: boolean; finalUrl: string }[] = [];

    for (const route of protectedRoutes) {
      try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 10000 });
        const finalUrl = page.url();
        const redirected = /login|signin|auth/i.test(finalUrl) || finalUrl !== `${BASE_URL}${route}`;
        redirectResults.push({ route, redirected, finalUrl });
      } catch (e) {
        redirectResults.push({ route, redirected: false, finalUrl: 'error' });
      }
    }

    console.log('Protected route behavior:');
    redirectResults.forEach(r => {
      console.log(`  ${r.route}: ${r.redirected ? '🔒 redirected' : '🔓 accessible'} → ${r.finalUrl}`);
    });
  });

  test('login form validation (invalid credentials)', async ({ page }) => {
    // First find the login page
    const loginRoutes = ['/login', '/signin', '/auth/login'];
    let onLoginPage = false;

    for (const route of loginRoutes) {
      try {
        const resp = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 8000 });
        if (resp && resp.status() < 400) {
          const bodyText = await page.textContent('body') || '';
          if (/email|password/i.test(bodyText)) {
            onLoginPage = true;
            break;
          }
        }
      } catch (e) { /* continue */ }
    }

    if (!onLoginPage) {
      console.log('  SKIP: Login page not found for form validation test.');
      return;
    }

    // Fill invalid credentials
    const emailInput = page.locator('input[type="email"], input[name*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const submitBtn = page.locator('button[type="submit"], button').filter({ hasText: /login|sign.?in/i }).first();

    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill('invalid@test.com');
      await passwordInput.fill('wrongpassword');
      await submitBtn.click();
      await page.waitForTimeout(2000);

      const errorText = await page.textContent('body') || '';
      const hasError = /invalid|incorrect|error|wrong|failed/i.test(errorText);
      console.log(`  Error shown for invalid creds: ${hasError}`);
      await page.screenshot({ path: '../output/screenshots/login-invalid.png', fullPage: true });
    }
  });
});
