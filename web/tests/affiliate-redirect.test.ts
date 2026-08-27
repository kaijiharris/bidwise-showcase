import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'crypto'

// ── What this route does (read app/a/[code]/route.ts before editing) ───────────
// GET /a/[code] — affiliate QR redirect (dynamic-QR pattern):
//   • malformed code                       -> 302 to / (no cookie, no log)
//   • unknown / non-active affiliate       -> 302 to / (no cookie, no log)
//   • active affiliate                     -> log `scan` event, set 60-day
//     httpOnly bw_aff cookie, 302 to /?utm_source=<code>&utm_medium=qr&
//     utm_campaign=affiliate
//   • rate-limited IP                      -> redirect still happens (no event,
//     no cookie — bot territory; the human still lands)
//   • DB failure                           -> redirect + cookie still happen
//     (attribution is re-validated at every consumption point)
//
// Everything a hoisted vi.mock factory needs lives inside vi.hoisted().
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>

  // Minimal supabase-js fake covering exactly the query shapes the route uses:
  //   from('affiliates').select().eq('code', X).maybeSingle()
  //   from('affiliate_events').select().eq()x3.gte().limit(1)  (thenable)
  //   from('affiliate_events').insert(row)
  class FakeQuery {
    private filters: Array<[string, unknown]> = []
    private gteFilters: Array<[string, string]> = []
    private limitN: number | null = null
    constructor(private store: FakeStore, private name: string) {}
    select() {
      return this
    }
    eq(col: string, val: unknown) {
      this.filters.push([col, val])
      return this
    }
    gte(col: string, val: string) {
      this.gteFilters.push([col, val])
      return this
    }
    limit(n: number) {
      this.limitN = n
      return this
    }
    private matched(): Row[] {
      const rows = this.store.tables[this.name] ?? []
      return rows
        .filter(r => this.filters.every(([c, v]) => r[c] === v))
        .filter(r =>
          this.gteFilters.every(([c, v]) => String(r[c] ?? '') >= v),
        )
    }
    async maybeSingle() {
      // Simulate a slow/unreachable DB: the query never resolves. The route's
      // withDeadline must abandon the await and still redirect.
      if (this.store.hangReads) return new Promise(() => {}) as never
      return { data: this.matched()[0] ?? null, error: null }
    }
    async insert(row: Row) {
      if (this.store.failWrites) {
        return { error: { code: 'XX000', message: 'insert failed' } }
      }
      // Emulate the DB's created_at DEFAULT NOW().
      ;(this.store.tables[this.name] ??= []).push({
        created_at: new Date().toISOString(),
        ...row,
      })
      return { error: null }
    }
    // Awaiting the builder resolves the filtered rows (list query).
    then(resolve: (v: { data: Row[]; error: null }) => void) {
      let rows = this.matched()
      if (this.limitN !== null) rows = rows.slice(0, this.limitN)
      resolve({ data: rows, error: null })
    }
  }

  class FakeStore {
    tables: Record<string, Row[]> = {}
    failReads = false
    failWrites = false
    hangReads = false
    from(name: string) {
      if (this.failReads) throw new Error('db unavailable')
      return new FakeQuery(this, name)
    }
  }

  return {
    FakeStore,
    store: { value: new FakeStore() },
    checkRateLimit: vi.fn(),
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => h.store.value,
  SupabaseClient: class {},
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a),
}))

// Import AFTER mocks are registered.
import { GET } from '@/app/a/[code]/route'

const ORIGIN = 'https://app.bidwise.test'
const CODE = 'AJ-7K2MQ4'
const IP_SALT = 'test-salt'

function expectedIpHash(ip: string): string {
  return createHash('sha256').update(ip + IP_SALT).digest('hex')
}

function makeRequest(code: string, headers: Record<string, string> = {}) {
  const request = new Request(`${ORIGIN}/a/${code}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': '203.0.113.9', ...headers },
  })
  return { request, ctx: { params: Promise.resolve({ code }) } }
}

function seedAffiliate(overrides: Record<string, unknown> = {}) {
  h.store.value.tables['affiliates'] = [
    {
      id: 'aff_1',
      code: CODE,
      email: 'aj@example.com',
      user_id: null,
      status: 'active',
      ...overrides,
    },
  ]
}

function events() {
  return h.store.value.tables['affiliate_events'] ?? []
}

beforeEach(() => {
  h.store.value = new h.FakeStore()
  h.checkRateLimit.mockReset()
  h.checkRateLimit.mockResolvedValue({ ok: true })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
  process.env.AFF_IP_SALT = IP_SALT
})

describe('affiliate redirect — valid active code', () => {
  it('302s to / with UTM params identifying the partner', async () => {
    seedAffiliate()
    const { request, ctx } = makeRequest(CODE)

    const res = await GET(request, ctx)

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const loc = new URL(res.headers.get('location') ?? '')
    expect(loc.pathname).toBe('/')
    expect(loc.searchParams.get('utm_source')).toBe(CODE)
    expect(loc.searchParams.get('utm_medium')).toBe('qr')
    expect(loc.searchParams.get('utm_campaign')).toBe('affiliate')
  })

  it('sets a 60-day httpOnly last-touch bw_aff cookie', async () => {
    seedAffiliate()
    const { request, ctx } = makeRequest(CODE)

    const res = await GET(request, ctx)

    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`bw_aff=${CODE}`)
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 60}`)
    expect(cookie.toLowerCase()).toContain('path=/')
  })

  it('logs a scan event with a SALTED ip hash — never the raw IP', async () => {
    seedAffiliate()
    const { request, ctx } = makeRequest(CODE)

    await GET(request, ctx)

    const evs = events()
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({
      affiliate_id: 'aff_1',
      event_type: 'scan',
      ip_hash: expectedIpHash('203.0.113.9'),
    })
    expect(JSON.stringify(evs[0])).not.toContain('203.0.113.9')
  })

  it('uppercases a lowercase scanned code before lookup and cookie', async () => {
    seedAffiliate()
    const { request, ctx } = makeRequest('aj-7k2mq4')

    const res = await GET(request, ctx)

    expect(res.headers.get('set-cookie') ?? '').toContain(`bw_aff=${CODE}`)
    expect(events()).toHaveLength(1)
  })

  it('flags a same-IP same-day repeat scan as dedup but still inserts the row', async () => {
    seedAffiliate()

    const first = makeRequest(CODE)
    await GET(first.request, first.ctx)
    const second = makeRequest(CODE)
    await GET(second.request, second.ctx)

    const evs = events()
    expect(evs).toHaveLength(2)
    expect((evs[0].metadata as { dedup: boolean }).dedup).toBe(false)
    expect((evs[1].metadata as { dedup: boolean }).dedup).toBe(true)
  })
})

describe('affiliate redirect — invalid / inactive codes never attribute', () => {
  it('redirects a malformed code to / with no cookie and no event', async () => {
    seedAffiliate()
    const { request, ctx } = makeRequest('not-a-code')

    const res = await GET(request, ctx)

    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(events()).toHaveLength(0)
  })

  it('redirects an unknown (well-formed) code to / with no cookie', async () => {
    const { request, ctx } = makeRequest('ZZ-7K2MQ4')

    const res = await GET(request, ctx)

    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(events()).toHaveLength(0)
  })

  it('stops attributing a paused affiliate but still redirects cleanly', async () => {
    seedAffiliate({ status: 'paused' })
    const { request, ctx } = makeRequest(CODE)

    const res = await GET(request, ctx)

    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(events()).toHaveLength(0)
  })
})

describe('affiliate redirect — resilience', () => {
  it('rate-limited scans still redirect but skip the event insert', async () => {
    seedAffiliate()
    h.checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 30 })
    const { request, ctx } = makeRequest(CODE)

    const res = await GET(request, ctx)

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(events()).toHaveLength(0)
  })

  it('keys the rate limit by the salted ip hash, not the raw IP', async () => {
    seedAffiliate()
    const { request, ctx } = makeRequest(CODE)

    await GET(request, ctx)

    const key = h.checkRateLimit.mock.calls[0][0] as string
    expect(key).toContain(expectedIpHash('203.0.113.9'))
    expect(key).not.toContain('203.0.113.9')
  })

  it('a DB failure never strands the visitor: redirect + cookie still happen', async () => {
    h.store.value.failReads = true
    const { request, ctx } = makeRequest(CODE)

    const res = await GET(request, ctx)

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const loc = new URL(res.headers.get('location') ?? '')
    expect(loc.searchParams.get('utm_source')).toBe(CODE)
    // Cookie is set best-effort — every consumer re-validates the code.
    expect(res.headers.get('set-cookie') ?? '').toContain(`bw_aff=${CODE}`)
  })

  it('an event-insert failure still redirects with the cookie', async () => {
    seedAffiliate()
    h.store.value.failWrites = true
    const { request, ctx } = makeRequest(CODE)

    const res = await GET(request, ctx)

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('set-cookie') ?? '').toContain(`bw_aff=${CODE}`)
  })

  it('a slow/unreachable DB does not stall: redirects with cookie past the deadline', async () => {
    vi.useFakeTimers()
    try {
      seedAffiliate()
      h.store.value.hangReads = true // lookup never resolves
      const { request, ctx } = makeRequest(CODE)

      const pending = GET(request, ctx)
      // Advance past ATTRIBUTION_DEADLINE_MS (1500ms) so withDeadline fires.
      await vi.advanceTimersByTimeAsync(1600)
      const res = await pending

      expect(res.status).toBeGreaterThanOrEqual(300)
      expect(res.status).toBeLessThan(400)
      // Fail-open: visitor still lands attributed; code re-validated downstream.
      const loc = new URL(res.headers.get('location') ?? '')
      expect(loc.searchParams.get('utm_source')).toBe(CODE)
      expect(res.headers.get('set-cookie') ?? '').toContain(`bw_aff=${CODE}`)
    } finally {
      vi.useRealTimers()
    }
  })
})
