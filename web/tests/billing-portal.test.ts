import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Billing-portal route under test ──────────────────────────────────────────
// GET /api/stripe/billing-portal creates a Stripe billing-portal session for the
// AUTHENTICATED user, scoping the Stripe customer id to that user's own
// subscriptions row (server-derived — never client-supplied).
//
// Observable behaviour of the route (verified against the source):
//   • not signed in            → NextResponse.redirect('/login')                 (307)
//   • signed in, no customer   → redirect('/pricing?error=no_stripe_customer')   (307)
//   • signed in, has customer  → redirect(portalSession.url) + Cache-Control: no-store (307)
//
// The route returns REDIRECTS, not JSON status codes — so "401/400/404" map onto
// the corresponding redirect targets, which is what these tests assert.
//
// Everything a hoisted vi.mock factory needs is built inside vi.hoisted so it is
// initialized before the (hoisted) factories run.
const h = vi.hoisted(() => ({
  // Stripe billing-portal session creator. Returns a fake hosted-portal url and
  // records the args so we can assert the customer id passed to Stripe.
  portalCreate: vi.fn(async (args: { customer: string; return_url: string }) => ({
    id: 'bps_test_123',
    url: `https://billing.stripe.com/p/session/${args.customer}`,
  })),
  // supabase.auth.getUser() result — overridden per test.
  getUser: vi.fn(),
  // The single subscriptions row the route's query chain resolves to.
  subRow: { value: null as Record<string, unknown> | null },
}))

const portalCreate = h.portalCreate
const getUser = h.getUser

// @/lib/stripe — stub ONLY billingPortal.sessions.create (the one method the
// route calls). PLANS is provided for parity even though this route never reads it.
vi.mock('@/lib/stripe', () => ({
  stripe: {
    billingPortal: {
      sessions: { create: (...a: unknown[]) => h.portalCreate(...(a as [never])) },
    },
  },
  PLANS: {},
}))

// @/lib/supabase/server — the route awaits createClient() then uses:
//   supabase.auth.getUser()
//   supabase.from('subscriptions').select(...).eq(...).not(...).order(...).limit(...).maybeSingle()
// We hand back a fake client whose query chain is fully chainable and resolves to
// the per-test subscriptions row.
vi.mock('@/lib/supabase/server', () => {
  const makeQuery = (resolved: { data: unknown; error: null }) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'order', 'limit']) {
      q[m] = () => q
    }
    q.maybeSingle = async () => resolved
    return q
  }
  return {
    createClient: async () => ({
      auth: { getUser: (...a: unknown[]) => h.getUser(...a) },
      from: () => makeQuery({ data: h.subRow.value, error: null }),
    }),
  }
})

// Import the handler AFTER the mocks are registered.
import { GET } from '@/app/api/stripe/billing-portal/route'

const APP_URL = 'https://app.bidwise.test'
const ROUTE_URL = 'https://app.bidwise.test/api/stripe/billing-portal'

function makeRequest(): Request {
  return new Request(ROUTE_URL, { method: 'GET' })
}

function setUser(user: Record<string, unknown> | null) {
  h.getUser.mockResolvedValue({ data: { user }, error: null })
}

function setSub(row: Record<string, unknown> | null) {
  h.subRow.value = row
}

beforeEach(() => {
  portalCreate.mockClear()
  getUser.mockReset()
  setSub(null)
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
  process.env.NEXT_PUBLIC_APP_URL = APP_URL
})

describe('billing-portal — authenticated subscriber (happy path)', () => {
  it('creates a portal session for the user\'s own stripe_customer_id and redirects to it', async () => {
    setUser({ id: 'user_abc' })
    setSub({ stripe_customer_id: 'cus_owned_123', user_id: 'user_abc' })

    const res = await GET(makeRequest())

    // Stripe was called with the SERVER-DERIVED customer id, scoped to this user.
    expect(portalCreate).toHaveBeenCalledTimes(1)
    expect(portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_owned_123',
        return_url: `${APP_URL}/dashboard`,
      }),
    )

    // Route redirects (307) to the Stripe-hosted portal url and forbids caching.
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://billing.stripe.com/p/session/cus_owned_123',
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('billing-portal — unauthenticated (maps to 401)', () => {
  it('redirects to /login and never calls Stripe when there is no user', async () => {
    setUser(null)

    const res = await GET(makeRequest())

    // new URL('/login', request.url) resolves against the request origin.
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(`${APP_URL}/login`)
    expect(portalCreate).not.toHaveBeenCalled()
  })
})

describe('billing-portal — no Stripe customer (maps to 400/404)', () => {
  it('redirects to /pricing when the user has no subscriptions row', async () => {
    setUser({ id: 'user_no_sub' })
    setSub(null)

    const res = await GET(makeRequest())

    expect(res.status).toBe(307)
    // Redirect target carries the no_stripe_customer error.
    const loc = res.headers.get('location') ?? ''
    expect(loc).toBe(`${APP_URL}/pricing?error=no_stripe_customer`)
    expect(portalCreate).not.toHaveBeenCalled()
  })

  it('redirects to /pricing when the row exists but stripe_customer_id is null', async () => {
    setUser({ id: 'user_invited' })
    setSub({ stripe_customer_id: null, user_id: 'user_invited' })

    const res = await GET(makeRequest())

    expect(res.status).toBe(307)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toContain('/pricing')
    expect(loc).toContain('error=no_stripe_customer')
    expect(portalCreate).not.toHaveBeenCalled()
  })

  it('refuses to open the portal when the row belongs to a different user (ownership guard)', async () => {
    // Defense-in-depth: even with a non-null customer id, if the row\'s user_id
    // does not match the caller, the route must NOT hand the id to Stripe.
    setUser({ id: 'user_caller' })
    setSub({ stripe_customer_id: 'cus_someone_else', user_id: 'user_OTHER' })

    const res = await GET(makeRequest())

    expect(res.status).toBe(307)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toContain('/pricing')
    expect(loc).toContain('error=no_stripe_customer')
    expect(portalCreate).not.toHaveBeenCalled()
  })
})
