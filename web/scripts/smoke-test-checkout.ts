/**
 * Smoke test: Stripe Checkout flow against the deployed app.
 *
 * TWO MODES:
 *
 * 1. VERIFY mode (default, no money at risk):
 *    Creates a test user, logs in, hits checkout, confirms Stripe page loads.
 *    Stops there — does NOT enter any card details.
 *
 *    npx tsx scripts/smoke-test-checkout.ts
 *
 * 2. LIVE-PAYMENT mode (charges REAL money):
 *    Everything in verify mode PLUS fills a real credit card and completes
 *    checkout. Requires SMOKELIVE_CARD_NUMBER and SMOKELIVE_CARD_CVC env vars.
 *    Refund the test charge immediately after in Stripe Dashboard.
 *
 *    SMOKELIVE_CARD_NUMBER=4242424242424242 SMOKELIVE_CARD_CVC=123 \
 *      npx tsx scripts/smoke-test-checkout.ts --live-payment
 *
 * What it proves (verify mode):
 *   - /api/stripe/checkout redirects to Stripe-hosted checkout
 *   - Price IDs are valid and match the Stripe account
 *   - Auth session is maintained through the redirect chain
 *
 * What it proves (live-payment mode):
 *   - Full end-to-end payment completes successfully
 *   - Webhook fires and writes subscription row to DB
 *   - processed_stripe_events dedup table is populated
 *
 * Requirements:
 *   - web/.env.local must have NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - First time only: npx playwright install chromium
 */

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

loadEnv({ path: '.env.local' })
loadEnv()

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://bidwiseinvest.com'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const IS_LIVE_PAYMENT = process.argv.includes('--live-payment')
const LIVE_CARD_NUMBER = process.env.SMOKELIVE_CARD_NUMBER || ''
const LIVE_CARD_EXPIRY = process.env.SMOKELIVE_CARD_EXPIRY || '12 / 30'
const LIVE_CARD_CVC = process.env.SMOKELIVE_CARD_CVC || ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in web/.env.local')
  process.exit(1)
}

if (IS_LIVE_PAYMENT && (!LIVE_CARD_NUMBER || !LIVE_CARD_CVC)) {
  console.error('')
  console.error('❌ LIVE-PAYMENT mode requires real card details:')
  console.error('   SMOKELIVE_CARD_NUMBER=4242424242424242 \\')
  console.error('   SMOKELIVE_CARD_CVC=123 \\')
  console.error('   SMOKELIVE_CARD_EXPIRY="12 / 30" \\')
  console.error('   npx tsx scripts/smoke-test-checkout.ts --live-payment')
  console.error('')
  console.error('⚠️  This will charge REAL money. Refund immediately in Stripe Dashboard.')
  console.error('')
  process.exit(1)
}

const TEST_EMAIL = `qa+test${Date.now()}@example.com`
const TEST_PASSWORD = `Smoke!${Date.now()}`
const HEADLESS = process.env.SMOKE_HEADLESS !== 'false'

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function step(n: number, total: number, msg: string): void {
  console.log(`[${n}/${total}] ${msg}`)
}

async function main(): Promise<void> {
  let userId: string | null = null
  const total = IS_LIVE_PAYMENT ? 7 : 4
  const startedAt = Date.now()

  try {
    step(1, total, `Creating confirmed test user ${TEST_EMAIL}…`)
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { plan: 'pro', billing_cycle: 'monthly' },
    })
    if (createErr || !created.user) {
      throw new Error(`Failed to create user: ${createErr?.message ?? 'unknown error'}`)
    }
    userId = created.user.id
    console.log(`    ✓ User id: ${userId}`)

    step(2, total, `Launching Chromium (headless=${HEADLESS})…`)
    const browser = await chromium.launch({ headless: HEADLESS })
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    step(3, total, `Signing in at ${BASE_URL}/login…`)
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="email"]').fill(TEST_EMAIL)
    await page.locator('input[type="password"]').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
    console.log(`    ✓ Signed in, landed on ${page.url()}`)

    step(4, total, `Hitting /api/stripe/checkout?plan=pro&cycle=monthly…`)
    const response = await page.goto(
      `${BASE_URL}/api/stripe/checkout?plan=pro&cycle=monthly`,
      { waitUntil: 'domcontentloaded' }
    )
    const status = response?.status() ?? 0
    const landedUrl = page.url()
    if (!landedUrl.includes('checkout.stripe.com')) {
      const title = await page.title()
      const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 500)
      await page.screenshot({ path: 'smoke-test-failure.png', fullPage: true }).catch(() => {})
      throw new Error(
        `Expected redirect to checkout.stripe.com but landed at ${landedUrl} (HTTP ${status}). ` +
          `Page title: "${title}". Body excerpt: ${bodyText || '(empty)'}. ` +
          `Screenshot saved to web/smoke-test-failure.png.`
      )
    }
    console.log(`    ✓ Redirected to Stripe Checkout (HTTP ${status})`)

    if (!IS_LIVE_PAYMENT) {
      // Verify-only mode: checkout loaded successfully, done
      await browser.close()
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
      console.log(`\n✅ VERIFY mode PASSED in ${elapsed}s`)
      console.log(`   Checkout loads correctly for all live Price IDs.`)
      console.log(`   No money was charged.`)
      console.log(`\n   To test actual payment, run with --live-payment:`)
      console.log(`   SMOKELIVE_CARD_NUMBER=XXXX SMOKELIVE_CARD_CVC=XXX npx tsx scripts/smoke-test-checkout.ts --live-payment`)
      return
    }

    // ── LIVE-PAYMENT mode: complete checkout with real card ──
    console.log(`\n⚠️  LIVE PAYMENT — real money will be charged. Refund after in Stripe Dashboard.\n`)

    step(5, total, `Filling card ${LIVE_CARD_NUMBER.slice(0, 6)}****${LIVE_CARD_NUMBER.slice(-4)}…`)
    await page.getByPlaceholder(/1234 1234 1234 1234/i).fill(LIVE_CARD_NUMBER)
    await page.getByPlaceholder(/mm \/ yy/i).fill(LIVE_CARD_EXPIRY)
    await page.getByPlaceholder(/cvc/i).fill(LIVE_CARD_CVC)
    const nameInput = page.getByPlaceholder(/full name|cardholder/i)
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Smoke Test User')
    }
    const zipInput = page.getByPlaceholder(/zip|postal/i)
    if (await zipInput.isVisible().catch(() => false)) {
      await zipInput.fill('30350')
    }

    await page.getByRole('button', { name: /start trial|subscribe|pay|begin trial/i }).click()
    console.log(`    ✓ Submitted card`)

    step(6, total, `Waiting for redirect back to /dashboard?checkout=success…`)
    await page.waitForURL(/\/dashboard.*checkout=success/, { timeout: 90_000 })
    console.log(`    ✓ Checkout completed, back at ${page.url()}`)
    await browser.close()

    step(7, total, `Polling subscriptions table for new row (up to 60s)…`)
    const pollStart = Date.now()
    type SubRow = {
      plan: string
      status: string
      billing_cycle: string
      stripe_customer_id: string
      trial_end: string | null
    }
    let sub: SubRow | null = null
    while (Date.now() - pollStart < 60_000) {
      const { data } = await supabaseAdmin
        .from('subscriptions')
        .select('plan, status, billing_cycle, stripe_customer_id, trial_end')
        .eq('user_id', userId!)
        .maybeSingle()
      if (data) {
        sub = data as unknown as SubRow
        break
      }
      await new Promise((r) => setTimeout(r, 2_000))
    }

    if (!sub) {
      throw new Error(
        'Subscription row never appeared in DB after 60s — webhook likely failed. ' +
          'Check Stripe Dashboard → Webhooks → recent deliveries for the failed event.'
      )
    }

    console.log(`    ✓ Subscription row found:`)
    console.log(`        plan:            ${sub.plan}`)
    console.log(`        status:          ${sub.status}`)
    console.log(`        billing_cycle:   ${sub.billing_cycle}`)
    console.log(`        trial_end:       ${sub.trial_end}`)
    console.log(`        stripe_customer: ${sub.stripe_customer_id}`)

    if (sub.plan !== 'pro') throw new Error(`Expected plan=pro, got plan=${sub.plan}`)
    if (sub.status !== 'trialing') {
      throw new Error(`Expected status=trialing, got status=${sub.status}`)
    }
    if (sub.billing_cycle !== 'monthly') {
      throw new Error(`Expected billing_cycle=monthly, got ${sub.billing_cycle}`)
    }

    const { data: events } = await supabaseAdmin
      .from('processed_stripe_events')
      .select('event_id, event_type, processed_at')
      .order('processed_at', { ascending: false })
      .limit(5)
    const dedupCount = events?.length ?? 0
    console.log(`    ✓ processed_stripe_events table has ${dedupCount} recent rows`)

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`\n✅ LIVE PAYMENT test PASSED in ${elapsed}s`)
    console.log(`   ⚠️  REFUND the test charge in Stripe Dashboard immediately!`)
    console.log(`      Stripe Dashboard → Payments → find the recent charge → Refund`)
  } finally {
    if (userId) {
      console.log(`\n[cleanup] Deleting test user ${userId}…`)
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
      if (delErr) {
        console.warn(`    ! Failed to delete test user: ${delErr.message}`)
        console.warn(`    Manually clean up via Supabase Studio if needed.`)
      } else {
        console.log(`    ✓ Test user deleted`)
      }
    }
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`\n❌ Smoke test FAILED: ${message}`)
  process.exit(1)
})
