import { describe, it, expect, beforeEach, vi } from 'vitest'

// Minimal shape of the object the route passes to stripe.checkout.sessions.create,
// covering exactly the fields these tests assert on (avoids `any` on mock args).
type CheckoutArg = {
  line_items: { price: string; quantity: number }[]
  mode: string
  customer_email?: string
  customer?: string
  client_reference_id: string
  metadata: { user_id: string; plan: string; cycle: string; affiliate_code: string }
  subscription_data: {
    trial_period_days?: number
    metadata: { user_id: string; affiliate_code: string }
  }
}

// ── What this route actually does (read route.ts before editing) ───────────────
// GET /api/stripe/checkout?plan=&cycle=
//   • cross-site sec-fetch-site            -> 400 (badRequest JSON)
//   • invalid plan / cycle                 -> 400 (badRequest JSON)
//   • no authenticated user                -> 302 redirect to /login
//   • rate-limit exceeded                  -> redirect to /pricing?error=rate_limit
//   • happy path                           -> 302 redirect to the Stripe session.url
//
// The price id is derived SERVER-SIDE from PLANS[plan][cycle]; the client only
// supplies the plan/cycle *labels*. customer_email + metadata.user_id come from
// the authenticated Supabase user, never from the request body — so there is no
// way for client input to elevate a tier or impersonate another customer.
//
// Everything a hoisted vi.mock factory needs is built inside vi.hoisted() so it
// exists before the factories run (mocks are hoisted above imports).
const h = vi.hoisted(() => {
  // Server-derived price ids. The route looks these up from PLANS, so a correct
  // implementation must put exactly these into stripe.checkout.sessions.create.
  const PRICE_STARTER_MONTHLY = 'price_starter_monthly'
  const PRICE_STARTER_ANNUAL = 'price_starter_annual'
  const PRICE_PRO_MONTHLY = 'price_pro_monthly'
  const PRICE_PRO_ANNUAL = 'price_pro_annual'
  const PRICE_EXPERT_MONTHLY = 'price_expert_monthly'
  const PRICE_EXPERT_ANNUAL = 'price_expert_annual'

  const TEST_PLANS = {
    starter: { name: 'Starter', monthly: PRICE_STARTER_MONTHLY, annual: PRICE_STARTER_ANNUAL, monthlyPrice: 39, annualPrice: 329 },
    pro: { name: 'Pro', monthly: PRICE_PRO_MONTHLY, annual: PRICE_PRO_ANNUAL, monthlyPrice: 109, annualPrice: 899 },
    expert: { name: 'Expert', monthly: PRICE_EXPERT_MONTHLY, annual: PRICE_EXPERT_ANNUAL, monthlyPrice: 249, annualPrice: 1999 },
  } as const

  return {
    TEST_PLANS,
    PRICE_STARTER_MONTHLY,
    PRICE_PRO_MONTHLY,
    PRICE_EXPERT_ANNUAL,
    // The currently-authenticated user (or null). Mutated per test.
    authUser: { value: null as null | { id: string; email: string } },
    // Prior-subscription rows for the repeat-trial guard (route reads
    // subscriptions: status + stripe_customer_id, newest first). Mutated per test.
    subscriptions: {
      value: [] as Array<{ status: string; stripe_customer_id: string | null }>,
    },
    // When set, the subscriptions lookup returns this error (fail-open path).
    subLookupError: { value: null as null | { message: string } },
    // Affiliate attribution state: the user's profile row (referred_by_code
    // fallback) and the affiliates table the SERVICE client reads.
    profile: { value: null as null | { referred_by_code: string | null } },
    affiliates: {
      value: [] as Array<{
        id: string
        code: string
        email: string
        user_id: string | null
        status: string
      }>,
    },
    // Stubbed Stripe + rate-limit calls.
    sessionsCreate: vi.fn(),
    checkRateLimit: vi.fn(),
  }
})

const PRICE_STARTER_MONTHLY = h.PRICE_STARTER_MONTHLY
const PRICE_PRO_MONTHLY = h.PRICE_PRO_MONTHLY
const PRICE_EXPERT_ANNUAL = h.PRICE_EXPERT_ANNUAL
const sessionsCreate = h.sessionsCreate
const checkRateLimit = h.checkRateLimit

function setUser(user: null | { id: string; email: string }) {
  h.authUser.value = user
}

// @/lib/supabase/server — the route calls `await createClient()` then
// `supabase.auth.getUser()`, and (for the affiliate profile fallback)
// `.from('user_profiles').select(...).eq(...).maybeSingle()`.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.authUser.value }, error: null }),
    },
    // Two query shapes: user_profiles -> .select().eq().maybeSingle()
    // (affiliate fallback) and subscriptions -> .select().eq().order()
    // (repeat-trial guard).
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: h.profile.value, error: null }),
          order: async () =>
            table === 'subscriptions'
              ? h.subLookupError.value
                ? { data: null, error: h.subLookupError.value }
                : { data: h.subscriptions.value, error: null }
              : { data: [], error: null },
        }),
      }),
    }),
  }),
}))

// @supabase/supabase-js — the SERVICE client used to validate the affiliate
// code (the affiliates table has no anon read policy).
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, val: unknown) => ({
          maybeSingle: async () => ({
            data:
              table === 'affiliates'
                ? h.affiliates.value.find(a => a.code === val) ?? null
                : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
  SupabaseClient: class {},
}))

// @/lib/stripe — stub only the method the route calls plus the PLANS map it
// reads for the server-side price-id derivation.
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: {
      sessions: { create: (...a: unknown[]) => h.sessionsCreate(...a) },
    },
  },
  PLANS: h.TEST_PLANS,
}))

// @/lib/rate-limit — default to "allowed"; individual tests override.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a),
}))

// Import AFTER mocks are registered.
import { GET } from '@/app/api/stripe/checkout/route'
import { TRIAL_DAYS } from '@/lib/trial'

const APP_URL = 'https://app.bidwise.test'
const ORIGIN = 'https://app.bidwise.test'

function makeRequest(
  query = '',
  headers: Record<string, string> = {},
): Request {
  const url = `${ORIGIN}/api/stripe/checkout${query}`
  return new Request(url, { method: 'GET', headers })
}

beforeEach(() => {
  setUser(null)
  h.profile.value = null
  h.affiliates.value = []
  h.subscriptions.value = []
  h.subLookupError.value = null
  sessionsCreate.mockReset()
  checkRateLimit.mockReset()
  checkRateLimit.mockResolvedValue({ ok: true })
  sessionsCreate.mockResolvedValue({
    id: 'cs_test_123',
    url: 'https://checkout.stripe.com/c/pay/cs_test_123',
  })
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
  process.env.NEXT_PUBLIC_APP_URL = APP_URL
})

describe('checkout — happy path (authenticated user, valid plan/cycle)', () => {
  it('creates a Stripe Checkout session and redirects to its url', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    const res = await GET(makeRequest('?plan=pro&cycle=monthly'))

    // NextResponse.redirect → 3xx redirect to the session url.
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('location')).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_123',
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(sessionsCreate).toHaveBeenCalledTimes(1)
  })

  it('passes the SERVER-derived price id, never a client-supplied one', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    // Attacker tries to smuggle a cheaper/foreign price + a forged user id via
    // query string. The route ignores all of it and derives from PLANS.
    await GET(
      makeRequest(
        '?plan=pro&cycle=monthly&price=price_FREE&priceId=price_FREE&user_id=victim',
      ),
    )

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.line_items[0].price).toBe(PRICE_PRO_MONTHLY)
    expect(arg.line_items).toHaveLength(1)
    expect(arg.line_items[0].quantity).toBe(1)
    expect(arg.mode).toBe('subscription')
  })

  it('links the session to the authenticated user (email + metadata.user_id), not client input', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    await GET(makeRequest('?plan=pro&cycle=monthly&user_id=victim&email=evil@x.com'))

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.customer_email).toBe('buyer@example.com')
    expect(arg.metadata.user_id).toBe('user_abc')
    expect(arg.metadata.plan).toBe('pro')
    expect(arg.metadata.cycle).toBe('monthly')
    expect(arg.subscription_data.metadata.user_id).toBe('user_abc')
  })

  it('derives the annual price id when cycle=annual (no tier/cycle elevation)', async () => {
    setUser({ id: 'user_xyz', email: 'expert@example.com' })

    await GET(makeRequest('?plan=expert&cycle=annual'))

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.line_items[0].price).toBe(PRICE_EXPERT_ANNUAL)
    expect(arg.metadata.plan).toBe('expert')
    expect(arg.metadata.cycle).toBe('annual')
  })

  it('defaults to starter/monthly when no plan/cycle is supplied', async () => {
    setUser({ id: 'user_def', email: 'default@example.com' })

    await GET(makeRequest(''))

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.line_items[0].price).toBe(PRICE_STARTER_MONTHLY)
    expect(arg.metadata.plan).toBe('starter')
    expect(arg.metadata.cycle).toBe('monthly')
  })
})

describe('checkout — authentication', () => {
  it('redirects an unauthenticated request to /login and never touches Stripe', async () => {
    setUser(null)

    const res = await GET(makeRequest('?plan=pro&cycle=monthly'))

    // The route uses NextResponse.redirect('/login') for anonymous callers
    // rather than a 401 JSON body.
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('location')).toContain('/login')
    expect(sessionsCreate).not.toHaveBeenCalled()
  })
})

describe('checkout — invalid input → 400', () => {
  it('rejects an unknown plan with 400 and does not create a session', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    const res = await GET(makeRequest('?plan=enterprise&cycle=monthly'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid plan')
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects an unknown billing cycle with 400', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    const res = await GET(makeRequest('?plan=pro&cycle=weekly'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid cycle')
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('validates plan/cycle BEFORE auth (anonymous + bad plan still 400)', async () => {
    setUser(null)

    const res = await GET(makeRequest('?plan=enterprise'))

    expect(res.status).toBe(400)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })
})

describe('checkout — cross-site guard', () => {
  it('rejects a cross-site request (Sec-Fetch-Site: cross-site) with 400', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    const res = await GET(
      makeRequest('?plan=pro&cycle=monthly', { 'sec-fetch-site': 'cross-site' }),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('cross-site request not allowed')
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('allows a same-origin request (Sec-Fetch-Site: same-origin)', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    const res = await GET(
      makeRequest('?plan=pro&cycle=monthly', { 'sec-fetch-site': 'same-origin' }),
    )

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('location')).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_123',
    )
  })
})

describe('checkout — rate limiting', () => {
  it('redirects to /pricing?error=rate_limit when the per-user limit is exceeded', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 42 })

    const res = await GET(makeRequest('?plan=pro&cycle=monthly'))

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toContain('/pricing')
    expect(loc).toContain('error=rate_limit')
    expect(res.headers.get('retry-after')).toBe('42')
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('keys the rate limit by the authenticated user id', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    await GET(makeRequest('?plan=pro&cycle=monthly'))

    expect(checkRateLimit).toHaveBeenCalledWith('checkout:user_abc')
  })
})

describe('checkout — affiliate attribution', () => {
  const CODE = 'AJ-7K2MQ4'

  function seedAffiliate(overrides: Partial<(typeof h.affiliates.value)[0]> = {}) {
    h.affiliates.value = [
      { id: 'aff_1', code: CODE, email: 'aj@example.com', user_id: null, status: 'active', ...overrides },
    ]
  }

  it('always sets client_reference_id to the authenticated user id', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    await GET(makeRequest('?plan=pro&cycle=monthly'))

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.client_reference_id).toBe('user_abc')
    expect(arg.metadata.affiliate_code).toBe('')
    expect(arg.subscription_data.metadata.affiliate_code).toBe('')
  })

  it('propagates the bw_aff cookie code into both metadata objects', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })
    seedAffiliate()

    await GET(
      makeRequest('?plan=pro&cycle=monthly', { cookie: `bw_aff=${CODE}` }),
    )

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.metadata.affiliate_code).toBe(CODE)
    expect(arg.subscription_data.metadata.affiliate_code).toBe(CODE)
  })

  it('falls back to user_profiles.referred_by_code when the cookie is gone', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })
    seedAffiliate()
    h.profile.value = { referred_by_code: CODE }

    await GET(makeRequest('?plan=pro&cycle=monthly'))

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.metadata.affiliate_code).toBe(CODE)
  })

  it('prefers the cookie (last touch) over the profile fallback', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })
    h.affiliates.value = [
      { id: 'aff_1', code: CODE, email: 'aj@example.com', user_id: null, status: 'active' },
      { id: 'aff_2', code: 'BK-9NRT2S', email: 'bk@example.com', user_id: null, status: 'active' },
    ]
    h.profile.value = { referred_by_code: 'BK-9NRT2S' }

    await GET(
      makeRequest('?plan=pro&cycle=monthly', { cookie: `bw_aff=${CODE}` }),
    )

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.metadata.affiliate_code).toBe(CODE)
  })

  it('SELF-REFERRAL GUARD: drops the code when the affiliate email matches the buyer', async () => {
    setUser({ id: 'user_abc', email: 'AJ@example.com' })
    seedAffiliate({ email: 'aj@example.com' })

    await GET(
      makeRequest('?plan=pro&cycle=monthly', { cookie: `bw_aff=${CODE}` }),
    )

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.metadata.affiliate_code).toBe('')
    expect(arg.subscription_data.metadata.affiliate_code).toBe('')
    // The purchase itself must still go through.
    expect(sessionsCreate).toHaveBeenCalledTimes(1)
  })

  it('SELF-REFERRAL GUARD: drops the code when the affiliate user_id matches the buyer', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })
    seedAffiliate({ user_id: 'user_abc' })

    await GET(
      makeRequest('?plan=pro&cycle=monthly', { cookie: `bw_aff=${CODE}` }),
    )

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.metadata.affiliate_code).toBe('')
  })

  it('drops an unknown or inactive affiliate code instead of forwarding it', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })
    seedAffiliate({ status: 'terminated' })

    await GET(
      makeRequest('?plan=pro&cycle=monthly', { cookie: `bw_aff=${CODE}` }),
    )

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.metadata.affiliate_code).toBe('')
  })

  it('ignores a malformed cookie value entirely', async () => {
    setUser({ id: 'user_abc', email: 'buyer@example.com' })

    await GET(
      makeRequest('?plan=pro&cycle=monthly', { cookie: 'bw_aff=DROP TABLE' }),
    )

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.metadata.affiliate_code).toBe('')
    expect(sessionsCreate).toHaveBeenCalledTimes(1)
  })
})

describe('checkout — repeat-trial guard & customer reuse', () => {
  it('documents the product decision: the trial is exactly 14 days', () => {
    // Changing lib/trial.ts TRIAL_DAYS is a pricing decision — this test makes
    // it a conscious one. Copy interpolates the same constant, so site text
    // and the Stripe charge date can never disagree.
    expect(TRIAL_DAYS).toBe(14)
  })

  it('grants the trial to a first-time user (no prior subscriptions row)', async () => {
    setUser({ id: 'user_new', email: 'new@example.com' })

    await GET(makeRequest('?plan=pro&cycle=monthly'))

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.subscription_data.trial_period_days).toBe(TRIAL_DAYS)
    expect(arg.customer_email).toBe('new@example.com')
    expect(arg.customer).toBeUndefined()
  })

  it('DENIES a second trial to a user with a prior (canceled) subscription', async () => {
    setUser({ id: 'user_return', email: 'return@example.com' })
    h.subscriptions.value = [{ status: 'canceled', stripe_customer_id: null }]

    const res = await GET(makeRequest('?plan=pro&cycle=monthly'))

    // Checkout still proceeds — they can re-subscribe — but pay from day 1.
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.subscription_data.trial_period_days).toBeUndefined()
  })

  it('reuses the prior Stripe customer instead of minting a new one', async () => {
    setUser({ id: 'user_return', email: 'return@example.com' })
    h.subscriptions.value = [{ status: 'canceled', stripe_customer_id: 'cus_prior_123' }]

    await GET(makeRequest('?plan=pro&cycle=monthly'))

    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.customer).toBe('cus_prior_123')
    expect(arg.customer_email).toBeUndefined()
  })

  it('bounces a user with an ACTIVE subscription to /dashboard (no duplicate sub)', async () => {
    setUser({ id: 'user_active', email: 'active@example.com' })
    h.subscriptions.value = [{ status: 'active', stripe_customer_id: 'cus_a' }]

    const res = await GET(makeRequest('?plan=expert&cycle=annual'))

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('location')).toContain('/dashboard')
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('bounces a TRIALING user to /dashboard too', async () => {
    setUser({ id: 'user_trialing', email: 'trialing@example.com' })
    h.subscriptions.value = [{ status: 'trialing', stripe_customer_id: 'cus_t' }]

    const res = await GET(makeRequest('?plan=pro&cycle=monthly'))

    expect(res.headers.get('location')).toContain('/dashboard')
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('fails OPEN toward first-time behavior when the lookup errors (never blocks a sale)', async () => {
    setUser({ id: 'user_glitch', email: 'glitch@example.com' })
    h.subLookupError.value = { message: 'connection reset' }

    const res = await GET(makeRequest('?plan=starter&cycle=monthly'))

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const arg = sessionsCreate.mock.calls[0][0] as CheckoutArg
    expect(arg.subscription_data.trial_period_days).toBe(TRIAL_DAYS)
  })
})
