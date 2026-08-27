import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── What this guards ───────────────────────────────────────────────────────────
// middleware.ts, the /signup?plan= branch: a signed-in user who lands on
// /signup?plan=X used to be redirected straight into Stripe checkout. An
// already-entitled user (a grant written by execution/invite_user.py, or an
// existing subscriber following a stale link) would be sent to buy a SECOND
// time. The fix calls hasActiveSubscriptionOrTrial() first and routes the
// entitled user to /dashboard instead. These tests pin both branches.
//
// Only @supabase/ssr is mocked; next/server (NextRequest/NextResponse) and
// @/lib/sanitize-next run for real. The signed-in /signup path never invokes
// sanitizeNext or the user_profiles query, so the supabase stub only needs
// auth.getUser + the subscriptions/user_trials reads.

const h = vi.hoisted(() => ({
  // Mutated per test: the authenticated user and their access rows.
  user: { value: null as null | { id: string; email: string } },
  sub: { value: null as null | { id: string } },
  trial: { value: null as null | { id: string } },
}))

function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gt', 'order', 'limit']) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data, error: null })
  return chain
}

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user.value }, error: null }),
    },
    from: (table: string) => {
      if (table === 'subscriptions') return makeChain(h.sub.value)
      if (table === 'user_trials') return makeChain(h.trial.value)
      return makeChain(null) // user_profiles etc. — not hit on the /signup path
    },
  }),
}))

// Import AFTER the mock is registered.
import { middleware } from '@/middleware'
import { NextRequest } from 'next/server'

const ORIGIN = 'https://app.bidwise.test'

function req(path: string): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`)
}

beforeEach(() => {
  h.user.value = null
  h.sub.value = null
  h.trial.value = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
})

describe('middleware — /signup?plan= for signed-in users', () => {
  it('sends an active SUBSCRIBER to /dashboard, never to checkout', async () => {
    h.user.value = { id: 'user_sub', email: 'sub@example.com' }
    h.sub.value = { id: 'sub_1' }

    const res = await middleware(req('/signup?plan=pro&cycle=annual'))
    const loc = res.headers.get('location') ?? ''

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(loc.endsWith('/dashboard')).toBe(true)
    expect(loc).not.toContain('/api/stripe/checkout')
  })

  it('sends a TRIALING user to /dashboard, never to checkout', async () => {
    h.user.value = { id: 'user_trial', email: 'trial@example.com' }
    h.trial.value = { id: 'trial_1' } // no subscription, active trial

    const res = await middleware(req('/signup?plan=expert&cycle=monthly'))
    const loc = res.headers.get('location') ?? ''

    expect(loc.endsWith('/dashboard')).toBe(true)
    expect(loc).not.toContain('/api/stripe/checkout')
  })

  it('still routes a signed-in NON-subscriber into checkout with plan + cycle', async () => {
    h.user.value = { id: 'user_new', email: 'new@example.com' }
    // no sub, no trial

    const res = await middleware(req('/signup?plan=pro&cycle=annual'))
    const loc = res.headers.get('location') ?? ''

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(loc).toContain('/api/stripe/checkout')
    expect(loc).toContain('plan=pro')
    expect(loc).toContain('cycle=annual')
  })

  it('defaults the cycle to annual when only a plan is supplied (non-subscriber)', async () => {
    h.user.value = { id: 'user_new', email: 'new@example.com' }

    const res = await middleware(req('/signup?plan=starter'))
    const loc = res.headers.get('location') ?? ''

    expect(loc).toContain('/api/stripe/checkout')
    expect(loc).toContain('plan=starter')
    expect(loc).toContain('cycle=annual')
  })
})
