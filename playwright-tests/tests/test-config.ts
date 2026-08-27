/**
 * Shared test configuration — credentials and target URL read from the
 * environment. NEVER hardcode live credentials in test files (committed
 * secrets are a credential leak).
 *
 * Set these before running the authenticated suite:
 *   TEST_EMAIL     — login email
 *   TEST_PASSWORD  — login password
 *   BASE_URL       — target origin (defaults to a staging placeholder)
 *
 * Example (PowerShell):
 *   $env:TEST_EMAIL='you@example.com'; $env:TEST_PASSWORD='...'; \
 *   $env:BASE_URL='https://staging.example.com'; npm run test
 */
import { test } from '@playwright/test';

/** Target origin under test. Defaults to a staging placeholder, NOT prod. */
export const BASE_URL: string =
  process.env.BASE_URL?.replace(/\/+$/, '') ?? 'https://staging.bidwiseinvest.com';

export const TEST_EMAIL: string | undefined = process.env.TEST_EMAIL;
export const TEST_PASSWORD: string | undefined = process.env.TEST_PASSWORD;

/** True only when both credentials are supplied via the environment. */
export const HAS_CREDENTIALS: boolean = Boolean(TEST_EMAIL && TEST_PASSWORD);

/**
 * Skip-guard for credential-dependent suites. Call inside `test.describe`
 * (or `test.beforeEach`) so the suite is skipped — not failed — when
 * TEST_EMAIL / TEST_PASSWORD are absent (e.g. on a fork PR with no secrets).
 */
export function requireCredentials(): void {
  test.skip(
    !HAS_CREDENTIALS,
    'TEST_EMAIL and TEST_PASSWORD must be set to run authenticated tests.',
  );
}

/** Non-null credentials accessor. Only call after requireCredentials(). */
export function credentials(): { email: string; password: string } {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error(
      'Missing TEST_EMAIL / TEST_PASSWORD. Set them in the environment before running authenticated tests.',
    );
  }
  return { email: TEST_EMAIL, password: TEST_PASSWORD };
}
