/**
 * Verify Stripe price IDs are correct after Vercel env var update.
 *
 * Creates a confirmed test user via Supabase admin API (bypasses email
 * confirmation), logs in via the UI, then navigates to the checkout endpoint
 * for 3 plan/cycle combos. Stops as soon as checkout.stripe.com loads.
 *
 * DOES NOT enter card details. DOES NOT complete checkout.
 * Real money is never at risk.
 *
 * Usage:
 *   cd web
 *   npx tsx scripts/verify-stripe-price-ids.ts
 */

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { chromium, type Browser, type Page } from 'playwright'

loadEnv({ path: '.env.local' })
loadEnv()

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://bidwiseinvest.com'
const SCREENSHOT_DIR = '.'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in web/.env.local')
  process.exit(1)
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TEST_EMAIL = `bidwise.qa+stripetest${Date.now()}@gmail.com`
const TEST_PASSWORD = `StripeVerify2026!`

const PLANS_TO_TEST: Array<{ plan: string; cycle: string }> = [
  { plan: 'starter', cycle: 'monthly' },
  { plan: 'pro', cycle: 'annual' },
  { plan: 'expert', cycle: 'monthly' },
]

interface TestResult {
  plan: string
  cycle: string
  success: boolean
  landedUrl: string
  httpStatus: number | null
  errorText: string
  screenshotPath: string
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
}

async function testCheckout(
  page: Page,
  plan: string,
  cycle: string,
  index: number,
): Promise<TestResult> {
  const checkoutUrl = `${BASE_URL}/api/stripe/checkout?plan=${plan}&cycle=${cycle}`
  log(`Testing checkout: plan=${plan} cycle=${cycle}`)

  let httpStatus: number | null = null
  let landedUrl = ''
  let errorText = ''
  let success = false

  try {
    // Use domcontentloaded — networkidle never fires on checkout.stripe.com
    // because it loads persistent third-party resources. If timeout fires,
    // check the landed URL before treating it as a failure.
    const response = await page.goto(checkoutUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    }).catch(async (err: unknown) => {
      // On timeout, capture what we can and continue
      landedUrl = page.url()
      if (landedUrl.includes('checkout.stripe.com')) {
        // Stripe page loaded — timeout was just networkidle never resolving
        return null
      }
      throw err
    })
    httpStatus = response?.status() ?? null
    landedUrl = page.url()

    if (landedUrl.includes('checkout.stripe.com')) {
      success = true
      log(`  PASS — Stripe checkout loaded (HTTP ${httpStatus ?? 'redirected'})`)
    } else {
      errorText = await page.locator('body').innerText().catch(() => '').then(t => t.slice(0, 600))
      log(`  FAIL — Landed at ${landedUrl} (HTTP ${httpStatus})`)
      log(`  Error preview: ${errorText.slice(0, 150)}`)
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err)
    landedUrl = page.url()
    // Final check: even on exception, if we're on Stripe it's a pass
    if (landedUrl.includes('checkout.stripe.com')) {
      success = true
      log(`  PASS — Stripe checkout loaded (caught timeout after redirect)`)
    } else {
      log(`  FAIL — Exception: ${errorText.slice(0, 150)}`)
    }
  }

  const screenshotPath = `${SCREENSHOT_DIR}/stripe-verify-${plan}-${cycle}-${index}.png`
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {})
  log(`  Screenshot: ${screenshotPath}`)

  return { plan, cycle, success, landedUrl, httpStatus, errorText, screenshotPath }
}

async function main(): Promise<void> {
  log('='.repeat(60))
  log('Stripe Price ID Verification — Live Production')
  log(`Target: ${BASE_URL}`)
  log('='.repeat(60))

  let userId: string | null = null
  let signupSucceeded = false
  let loginSucceeded = false
  const results: TestResult[] = []

  const browser: Browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  try {
    // Step 1: Create confirmed test user via Supabase admin API
    log(`\n--- Step 1: Create confirmed test user via Supabase admin API ---`)
    log(`Email: ${TEST_EMAIL}`)
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    if (createErr || !created.user) {
      throw new Error(`Failed to create test user: ${createErr?.message ?? 'unknown'}`)
    }
    userId = created.user.id
    signupSucceeded = true
    log(`  Created user id: ${userId}`)

    // Step 2: Log in via the UI
    log(`\n--- Step 2: Login via UI ---`)
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.locator('input[type="email"]').fill(TEST_EMAIL)
    await page.locator('input[type="password"]').fill(TEST_PASSWORD)
    await page.locator('button[type="submit"]').first().click()

    try {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
      loginSucceeded = true
      log(`  Logged in, landed on: ${page.url()}`)
    } catch {
      const bodyText = await page.locator('body').innerText().catch(() => '').then(t => t.slice(0, 300))
      log(`  Login failed — still on login. Body: ${bodyText.slice(0, 200)}`)
    }

    if (!loginSucceeded) {
      log('Cannot proceed with checkout tests — login failed.')
      return
    }

    // Step 3: Test checkout endpoints
    log(`\n--- Step 3: Stripe Checkout Tests ---`)
    for (let i = 0; i < PLANS_TO_TEST.length; i++) {
      const { plan, cycle } = PLANS_TO_TEST[i]
      const result = await testCheckout(page, plan, cycle, i + 1)
      results.push(result)

      // Navigate back to dashboard between tests to reset context
      if (result.success) {
        await page.goto(`${BASE_URL}/dashboard`, {
          waitUntil: 'networkidle',
          timeout: 15_000,
        }).catch(() => {})
      }
    }

  } finally {
    await browser.close()

    // Cleanup: delete the test user
    if (userId) {
      log(`\n--- Cleanup: Deleting test user ${userId} ---`)
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
      if (delErr) {
        log(`  Warning: Failed to delete test user: ${delErr.message}`)
      } else {
        log(`  Test user deleted`)
      }
    }
  }

  // Summary
  log('\n' + '='.repeat(60))
  log('RESULTS SUMMARY')
  log('='.repeat(60))
  log(`Account creation (Supabase admin): ${signupSucceeded ? 'PASS' : 'FAIL'}`)
  log(`Login via UI:                      ${loginSucceeded ? 'PASS' : 'FAIL'}`)
  log('')

  for (const r of results) {
    const status = r.success ? 'PASS' : 'FAIL'
    log(`[${status}] plan=${r.plan} cycle=${r.cycle}`)
    log(`       HTTP ${r.httpStatus ?? 'N/A'} → ${r.landedUrl.slice(0, 90)}`)
    if (!r.success && r.errorText) {
      log(`       Error: ${r.errorText.slice(0, 250)}`)
    }
    log(`       Screenshot: ${r.screenshotPath}`)
  }

  const allPassed = results.every((r) => r.success)
  log('')
  log(allPassed ? 'Overall: ALL CHECKOUT TESTS PASSED' : 'Overall: ONE OR MORE CHECKOUT TESTS FAILED')

  process.exitCode = allPassed ? 0 : 1
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`\nFATAL: ${message}`)
  process.exit(1)
})
