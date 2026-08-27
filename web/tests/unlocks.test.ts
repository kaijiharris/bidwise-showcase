import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── What this guards ────────────────────────────────────────────────────────
// POST /api/unlocks is the paywall/unlock gate. The entitlement decision is made
// SERVER-SIDE: the route calls the Postgres RPC `consume_content_unlock_for_user`
// with the authenticated user's id and the requested content, and only the RPC's
// `unlocked` flag decides 200 (granted) vs 403 (blocked). The client cannot send
// an "entitled: true" flag to unlock anything — there is no such field in the
// request shape, and the route never trusts request body for entitlement.
//
// We mock exactly what the route imports:
//   * @/lib/supabase/server   → createClient() returning a server client whose
//                                auth.getUser() yields the cookie-session user.
//   * @supabase/supabase-js    → createClient() returning the SERVICE client used
//                                for (a) the Bearer-token auth fallback and
//                                (b) the rpc() entitlement gate.
//
// Everything a hoisted vi.mock factory needs is built in vi.hoisted().

const h = vi.hoisted(() => ({
  // Server (cookie-session) client auth.getUser() result. Defaults to no user.
  serverGetUser: vi.fn(async () => ({ data: { user: null as { id: string } | null } })),
  // Service client auth.getUser(token) result (Bearer fallback). Defaults: no user.
  serviceGetUser: vi.fn(async (_token: string) => ({ data: { user: null as { id: string } | null } })),
  // Service client rpc() — the server-side entitlement gate. Tests set this.
  serviceRpc: vi.fn(async () => ({ data: null as unknown, error: null as unknown })),
}))

// @/lib/supabase/server: the cookie-session client. await createClient() in the
// route resolves to an object exposing auth.getUser().
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: (...a: unknown[]) => h.serverGetUser(...(a as [])) },
  }),
}))

// @supabase/supabase-js: the service-role client. Exposes auth.getUser(token)
// (Bearer fallback) and rpc() (the entitlement gate).
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: (token: string) => h.serviceGetUser(token) },
    rpc: (...a: unknown[]) => h.serviceRpc(...(a as [])),
  }),
  SupabaseClient: class {},
}))

// Import AFTER mocks are registered.
import { POST } from '@/app/api/unlocks/route'

const VALID_UUID = '11111111-1111-4111-8111-111111111111'
const SECOND_UUID = '22222222-2222-4222-8222-222222222222'

function makeRequest(
  body: unknown,
  opts: { headers?: Record<string, string>; raw?: string } = {},
): Request {
  return new Request('https://example.com/api/unlocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.raw ?? JSON.stringify(body),
  })
}

beforeEach(() => {
  h.serverGetUser.mockReset()
  h.serviceGetUser.mockReset()
  h.serviceRpc.mockReset()
  // Default: no cookie-session user, no Bearer user, no rpc result.
  h.serverGetUser.mockResolvedValue({ data: { user: null } })
  h.serviceGetUser.mockResolvedValue({ data: { user: null } })
  h.serviceRpc.mockResolvedValue({ data: null, error: null })

  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
})

describe('POST /api/unlocks — authentication', () => {
  it('returns 401 when there is no session user and no Bearer token', async () => {
    const res = await POST(
      makeRequest({ contentType: 'auction_property', contentId: VALID_UUID }) as never,
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/Authentication required/i)
    // No entitlement check happened — nothing was granted.
    expect(h.serviceRpc).not.toHaveBeenCalled()
  })

  it('returns 401 when the Bearer token is invalid (service getUser yields no user)', async () => {
    h.serviceGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(
      makeRequest(
        { contentType: 'auction_property', contentId: VALID_UUID },
        { headers: { authorization: 'Bearer not-a-real-token' } },
      ) as never,
    )
    expect(res.status).toBe(401)
    expect(h.serviceGetUser).toHaveBeenCalledWith('not-a-real-token')
    expect(h.serviceRpc).not.toHaveBeenCalled()
  })

  it('authenticates via Bearer token when there is no cookie session', async () => {
    h.serverGetUser.mockResolvedValue({ data: { user: null } })
    h.serviceGetUser.mockResolvedValue({ data: { user: { id: 'user_bearer' } } })
    h.serviceRpc.mockResolvedValue({ data: { unlocked: true }, error: null })

    const res = await POST(
      makeRequest(
        { contentType: 'auction_property', contentId: VALID_UUID },
        { headers: { authorization: 'Bearer good-token' } },
      ) as never,
    )
    expect(res.status).toBe(200)
    // Entitlement was checked for the token-derived user id, not anything client-sent.
    expect(h.serviceRpc).toHaveBeenCalledWith(
      'consume_content_unlock_for_user',
      expect.objectContaining({ p_user_id: 'user_bearer' }),
    )
  })
})

describe('POST /api/unlocks — entitled user can unlock', () => {
  beforeEach(() => {
    h.serverGetUser.mockResolvedValue({ data: { user: { id: 'user_entitled' } } })
  })

  it('returns 200 and the unlock result when the server RPC grants the unlock', async () => {
    h.serviceRpc.mockResolvedValue({
      data: { unlocked: true, remaining: 4, message: 'Unlocked' },
      error: null,
    })
    const res = await POST(
      makeRequest({ contentType: 'auction_property', contentId: VALID_UUID }) as never,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unlocked).toBe(true)
    expect(body.remaining).toBe(4)
  })

  it('derives entitlement server-side from the session user id, not the request body', async () => {
    h.serviceRpc.mockResolvedValue({ data: { unlocked: true }, error: null })
    // The client tries to smuggle entitlement + a different user id in the body.
    const res = await POST(
      makeRequest({
        contentType: 'off_market_lead',
        contentId: SECOND_UUID,
        unlocked: true,
        entitled: true,
        userId: 'attacker',
        p_user_id: 'attacker',
      }) as never,
    )
    expect(res.status).toBe(200)
    // The RPC was called with the AUTHENTICATED id, never the client-supplied one.
    expect(h.serviceRpc).toHaveBeenCalledWith('consume_content_unlock_for_user', {
      p_user_id: 'user_entitled',
      p_content_type: 'off_market_lead',
      p_content_id: SECOND_UUID,
    })
  })

  it('unwraps an array RPC result and uses the first row', async () => {
    h.serviceRpc.mockResolvedValue({ data: [{ unlocked: true, remaining: 2 }], error: null })
    const res = await POST(
      makeRequest({ contentType: 'auction_property', contentId: VALID_UUID }) as never,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.remaining).toBe(2)
  })
})

describe('POST /api/unlocks — unentitled / over-quota user is blocked and granted nothing', () => {
  beforeEach(() => {
    h.serverGetUser.mockResolvedValue({ data: { user: { id: 'user_broke' } } })
  })

  it('returns 403 when the server RPC reports unlocked=false (no entitlement / over quota)', async () => {
    h.serviceRpc.mockResolvedValue({
      data: { unlocked: false, message: 'Upgrade to unlock more' },
      error: null,
    })
    const res = await POST(
      makeRequest({ contentType: 'auction_property', contentId: VALID_UUID }) as never,
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    // Blocked: the response does NOT grant the unlock.
    expect(body.unlocked).toBe(false)
  })

  it('returns 403 for an array result whose first row is unlocked=false', async () => {
    h.serviceRpc.mockResolvedValue({ data: [{ unlocked: false }], error: null })
    const res = await POST(
      makeRequest({ contentType: 'off_market_lead', contentId: SECOND_UUID }) as never,
    )
    expect(res.status).toBe(403)
  })

  it('returns 403 and grants nothing when the RPC returns no result at all', async () => {
    h.serviceRpc.mockResolvedValue({ data: null, error: null })
    const res = await POST(
      makeRequest({ contentType: 'auction_property', contentId: VALID_UUID }) as never,
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.unlocked).toBe(false)
  })

  it('returns 500 (and grants nothing) when the entitlement RPC errors', async () => {
    h.serviceRpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const res = await POST(
      makeRequest({ contentType: 'auction_property', contentId: VALID_UUID }) as never,
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/Unable to unlock/i)
  })
})

describe('POST /api/unlocks — input validation (authenticated)', () => {
  beforeEach(() => {
    h.serverGetUser.mockResolvedValue({ data: { user: { id: 'user_ok' } } })
  })

  it('returns 400 on invalid JSON body and never checks entitlement', async () => {
    const res = await POST(
      makeRequest(undefined, { raw: '{not json' }) as never,
    )
    expect(res.status).toBe(400)
    expect(h.serviceRpc).not.toHaveBeenCalled()
  })

  it('returns 400 for an unsupported content type', async () => {
    const res = await POST(
      makeRequest({ contentType: 'premium_secret', contentId: VALID_UUID }) as never,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Unsupported content type/i)
    expect(h.serviceRpc).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed (non-UUID) contentId', async () => {
    const res = await POST(
      makeRequest({ contentType: 'auction_property', contentId: 'not-a-uuid' }) as never,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/valid contentId/i)
    expect(h.serviceRpc).not.toHaveBeenCalled()
  })

  it('accepts snake_case content_type / content_id aliases', async () => {
    h.serviceRpc.mockResolvedValue({ data: { unlocked: true }, error: null })
    const res = await POST(
      makeRequest({ content_type: 'auction_property', content_id: VALID_UUID }) as never,
    )
    expect(res.status).toBe(200)
    expect(h.serviceRpc).toHaveBeenCalledWith(
      'consume_content_unlock_for_user',
      expect.objectContaining({
        p_content_type: 'auction_property',
        p_content_id: VALID_UUID,
      }),
    )
  })
})
