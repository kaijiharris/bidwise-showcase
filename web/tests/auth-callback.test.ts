import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── What this route does (read app/auth/callback/route.ts before editing) ──────
// GET /auth/callback?code= — post-email-confirm exchange. After a successful
// exchangeCodeForSession it ALSO stamps affiliate attribution:
//   • reads the httpOnly bw_aff cookie (server route — the client never can)
//   • validates the code against an ACTIVE affiliate (service role)
//   • stamps user_profiles.referred_by_code / referred_at — FIRST write wins;
//     a later scan of a different code never overwrites an attributed user
//   • inserts a `signup` affiliate_events row (only when the stamp happened)
//   • any attribution failure is logged and swallowed — auth must never break
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>

  class FakeQuery {
    private filters: Array<[string, unknown]> = []
    constructor(private store: FakeStore, private name: string) {}
    select() {
      return this
    }
    eq(col: string, val: unknown) {
      this.filters.push([col, val])
      return this
    }
    private matched(): Row[] {
      const rows = this.store.tables[this.name] ?? []
      return rows.filter(r => this.filters.every(([c, v]) => r[c] === v))
    }
    async maybeSingle() {
      return { data: this.matched()[0] ?? null, error: null }
    }
    async insert(row: Row) {
      ;(this.store.tables[this.name] ??= []).push({ ...row })
      return { error: null }
    }
    // .update(patch).eq(...).is(...).select('id') — thenable returning the
    // updated rows, which is how the route detects first-write-wins.
    update(patch: Row) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture builder `this` for the nested thenable
      const self = this
      return {
        _filters: [] as Array<[string, unknown]>,
        _isFilters: [] as Array<[string, unknown]>,
        eq(col: string, val: unknown) {
          this._filters.push([col, val])
          return this
        },
        is(col: string, val: unknown) {
          this._isFilters.push([col, val])
          return this
        },
        select() {
          return this
        },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          const rows = self.store.tables[self.name] ?? []
          const hit = rows
            .filter(r => this._filters.every(([c, v]) => r[c] === v))
            .filter(r =>
              this._isFilters.every(([c, v]) => (r[c] ?? null) === v),
            )
          hit.forEach(r => Object.assign(r, patch))
          resolve({ data: hit.map(r => ({ id: r.id })), error: null })
        },
      }
    }
  }

  class FakeStore {
    tables: Record<string, Row[]> = {}
    failAll = false
    from(name: string) {
      if (this.failAll) throw new Error('db unavailable')
      return new FakeQuery(this, name)
    }
  }

  return {
    FakeStore,
    store: { value: new FakeStore() },
    exchange: vi.fn(),
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => h.store.value,
  SupabaseClient: class {},
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: (...a: unknown[]) => h.exchange(...a),
    },
  }),
}))

// Import AFTER mocks are registered.
import { GET } from '@/app/auth/callback/route'

const ORIGIN = 'https://app.bidwise.test'
const CODE = 'AJ-7K2MQ4'
const USER_ID = 'user_abc'

function makeRequest(opts: { cookie?: string; query?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers['cookie'] = opts.cookie
  return new Request(
    `${ORIGIN}/auth/callback?code=auth_code_123${opts.query ?? ''}`,
    { headers },
  )
}

function seedAffiliate(overrides: Record<string, unknown> = {}) {
  h.store.value.tables['affiliates'] = [
    { id: 'aff_1', code: CODE, email: 'aj@example.com', user_id: null, status: 'active', ...overrides },
  ]
}

function seedProfile(overrides: Record<string, unknown> = {}) {
  h.store.value.tables['user_profiles'] = [
    { id: USER_ID, email: 'buyer@example.com', referred_by_code: null, ...overrides },
  ]
}

function profile() {
  return (h.store.value.tables['user_profiles'] ?? [])[0]
}

function events() {
  return h.store.value.tables['affiliate_events'] ?? []
}

beforeEach(() => {
  h.store.value = new h.FakeStore()
  h.exchange.mockReset()
  h.exchange.mockResolvedValue({
    data: { user: { id: USER_ID, email: 'buyer@example.com' }, session: {} },
    error: null,
  })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
})

describe('auth callback — affiliate attribution stamp', () => {
  it('stamps referred_by_code + referred_at and logs a signup event', async () => {
    seedAffiliate()
    seedProfile()

    const res = await GET(makeRequest({ cookie: `bw_aff=${CODE}` }))

    // Auth flow unchanged: continue to checkout.
    expect(res.headers.get('location')).toContain('/api/stripe/checkout')
    expect(profile().referred_by_code).toBe(CODE)
    expect(profile().referred_at).toBeTruthy()
    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({
      affiliate_id: 'aff_1',
      event_type: 'signup',
      user_id: USER_ID,
    })
  })

  it('first write wins: an already-attributed profile is never overwritten', async () => {
    seedAffiliate()
    seedProfile({ referred_by_code: 'ZZ-AAAAAA', referred_at: '2026-01-01T00:00:00Z' })

    await GET(makeRequest({ cookie: `bw_aff=${CODE}` }))

    expect(profile().referred_by_code).toBe('ZZ-AAAAAA')
    // No signup event either — the stamp did not happen.
    expect(events()).toHaveLength(0)
  })

  it('does nothing without a bw_aff cookie', async () => {
    seedAffiliate()
    seedProfile()

    const res = await GET(makeRequest())

    expect(res.headers.get('location')).toContain('/api/stripe/checkout')
    expect(profile().referred_by_code).toBeNull()
    expect(events()).toHaveLength(0)
  })

  it('ignores a cookie whose code is unknown', async () => {
    seedProfile()

    await GET(makeRequest({ cookie: 'bw_aff=ZZ-999999' }))

    expect(profile().referred_by_code).toBeNull()
    expect(events()).toHaveLength(0)
  })

  it('ignores a cookie for a paused affiliate (attribution stops, auth continues)', async () => {
    seedAffiliate({ status: 'paused' })
    seedProfile()

    const res = await GET(makeRequest({ cookie: `bw_aff=${CODE}` }))

    expect(res.headers.get('location')).toContain('/api/stripe/checkout')
    expect(profile().referred_by_code).toBeNull()
  })

  it('ignores a malformed cookie value (tampering)', async () => {
    seedAffiliate()
    seedProfile()

    await GET(makeRequest({ cookie: 'bw_aff=<script>alert(1)</script>' }))

    expect(profile().referred_by_code).toBeNull()
    expect(events()).toHaveLength(0)
  })
})

describe('auth callback — attribution must never break auth', () => {
  it('still redirects to checkout when the attribution DB is down', async () => {
    h.store.value.failAll = true

    const res = await GET(makeRequest({ cookie: `bw_aff=${CODE}` }))

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('location')).toContain('/api/stripe/checkout')
  })

  it('a failed exchange still lands on the login error path (no attribution)', async () => {
    seedAffiliate()
    seedProfile()
    h.exchange.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'bad code' } })

    const res = await GET(makeRequest({ cookie: `bw_aff=${CODE}` }))

    expect(res.headers.get('location')).toContain('/login')
    expect(profile().referred_by_code).toBeNull()
    expect(events()).toHaveLength(0)
  })

  it('honors ?next= redirects while still stamping attribution', async () => {
    seedAffiliate()
    seedProfile()

    const res = await GET(
      makeRequest({ cookie: `bw_aff=${CODE}`, query: '&next=/reset-password' }),
    )

    expect(res.headers.get('location')).toContain('/reset-password')
    expect(profile().referred_by_code).toBe(CODE)
  })
})
