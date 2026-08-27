import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: false,
  retries: 2,
  workers: 1,
  timeout: 30000,
  reporter: [
    ['html', { outputFolder: '../output/playwright-report', open: 'never' }],
    ['json', { outputFile: '../output/test-results.json' }],
    ['list'],
  ],
  use: {
    // Target origin from env; defaults to a staging placeholder, never prod.
    baseURL: (process.env.BASE_URL ?? 'https://staging.bidwiseinvest.com').replace(/\/+$/, ''),
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: 'chromium-tablet',
      use: { ...devices['iPad Pro'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['iPhone 12'], viewport: { width: 375, height: 667 } },
    },
  ],
  outputDir: '../output/test-artifacts',
});
