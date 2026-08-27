import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── What this route actually does ───────────────────────────────────────────
// POST /api/lead-capture is the PUBLIC email-capture endpoint behind the
// /free-list/[county] teaser pages. It imports:
//   * @/lib/data-access  (serviceClient — the ONLY writer to lead_captures;
//     RLS on the table denies everyone else, so route validation IS the
//     security boundary)
//   * @/lib/rate-limit   (checkRateLimit — per-IP fixed window)
//   * @/lib/free-list    (county allowlist — real module, not mocked)
// It: parses JSON → drops honeypot hits → validates email/county/utm →
// rate-limits per IP → upserts (email,county) with ignoreDuplicates.
//
// We mock the service client with an in-memory lead_captures "table" keyed by
// (email, county) that reproduces the UNIQUE index + ON CONFLICT DO NOTHING
// contract from migration 017, so idempotency emerges from state.

const h = vi.hoisted(() => {
  return {
    // in-memory lead_captures keyed `${email}|${county}`
    store: new Map<string, Record<string, unknown>>(),
    upsert: vi.fn(),
    rateLimit: vi.fn(),
    // fulfillment sender spy (module mocked below)
    sendFreeList: vi.fn(),
  }
})

vi.mock('@/lib/data-access', () => ({
  serviceClient: () => ({
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) =>
        h.upsert(table, row, opts),
    }),
  }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => h.rateLimit(...args),
}))

// @/lib/free-list-email: spied so tests assert fulfillment without touching
// fs-backed county data or Resend.
vi.mock('@/lib/free-list-email', () => ({
  sendFreeListEmail: (...args: unknown[]) => h.sendFreeList(...args),
}))

// Import the handler AFTER the mocks are registered.
import { POST } from '@/app/api/lead-capture/route'

function makeRequest(body?: unknown, headers?: Record<string, string>): Request {
  return new Request('https://example.com/api/lead-capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? '{not json' : JSON.stringify(body),
  })
}

beforeEach(() => {
  h.store.clear()
  h.upsert.mockReset()
  h.rateLimit.mockReset()

  // Faithful re-implementation of the 017 contract: UNIQUE (email, county) +
  // ON CONFLICT DO NOTHING via ignoreDuplicates → duplicate insert is a
  // silent no-op, not an error.
  h.upsert.mockImplementation(
    async (table: string, row: Record<string, unknown>) => {
      if (table !== 'lead_captures') throw new Error(`unexpected table: ${table}`)
      const key = `${row.email}|${row.county}`
      if (!h.store.has(key)) h.store.set(key, { ...row })
      return { error: null }
    },
  )
  h.rateLimit.mockResolvedValue({ ok: true })
  h.sendFreeList.mockReset()
  h.sendFreeList.mockResolvedValue({ ok: true })
})

describe('POST /api/lead-capture — happy path', () => {
  it('stores a normalized capture and returns success', async () => {
    const res = await POST(
      makeRequest({
        email: '  Investor@Example.COM ',
        county: 'dekalb',
        source: 'free-list',
        utm_source: 'auction_day',
        utm_medium: 'qr',
        utm_campaign: 'dekalb_2026-07-07',
      }) as never,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })

    // Email is trimmed + lowercased before it touches the DB.
    expect(h.store.size).toBe(1)
    const row = h.store.get('investor@example.com|dekalb')
    expect(row).toBeTruthy()
    expect(row).toMatchObject({
      email: 'investor@example.com',
      county: 'dekalb',
      source: 'free-list',
      utm_source: 'auction_day',
      utm_medium: 'qr',
      utm_campaign: 'dekalb_2026-07-07',
    })
    // The upsert targets the (email, county) unique key with duplicates ignored.
    expect(h.upsert).toHaveBeenCalledWith(
      'lead_captures',
      expect.any(Object),
      { onConflict: 'email,county', ignoreDuplicates: true },
    )
  })

  it('defaults source to free-list and utm fields to null when omitted', async () => {
    const res = await POST(
      makeRequest({ email: 'a@b.co', county: 'gwinnett' }) as never,
    )
    expect(res.status).toBe(200)
    expect(h.store.get('a@b.co|gwinnett')).toMatchObject({
      source: 'free-list',
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
    })
  })

  it('is idempotent: a double-submit stores exactly one lead and still succeeds', async () => {
    const body = { email: 'repeat@example.com', county: 'dekalb' }
    const first = await POST(makeRequest(body) as never)
    const second = await POST(makeRequest(body) as never)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(h.store.size).toBe(1)
  })
})

describe('POST /api/lead-capture — validation rejects bad input', () => {
  it('rejects a non-JSON body', async () => {
    const res = await POST(makeRequest(undefined) as never)
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['missing email', { county: 'dekalb' }],
    ['empty email', { email: '', county: 'dekalb' }],
    ['no @', { email: 'not-an-email', county: 'dekalb' }],
    ['no TLD', { email: 'a@b', county: 'dekalb' }],
    ['spaces', { email: 'a b@c.co', county: 'dekalb' }],
    ['overlong', { email: `${'a'.repeat(250)}@example.com`, county: 'dekalb' }],
    ['non-string', { email: 42, county: 'dekalb' }],
  ])('rejects invalid email (%s) with 400 and no insert', async (_name, body) => {
    const res = await POST(makeRequest(body) as never)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/valid email/i)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', {}],
    ['unknown county', { county: 'fulton' }],
    ['not yet live county', { county: 'cobb' }],
    ['path junk', { county: '../dekalb' }],
    ['non-string', { county: 7 }],
  ])('rejects county outside the allowlist (%s) with 400', async (_name, extra) => {
    const res = await POST(
      makeRequest({ email: 'a@b.co', ...extra }) as never,
    )
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects overlong tracking fields instead of truncating them', async () => {
    const res = await POST(
      makeRequest({
        email: 'a@b.co',
        county: 'dekalb',
        utm_campaign: 'x'.repeat(129),
      }) as never,
    )
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})

describe('POST /api/lead-capture — abuse controls', () => {
  it('silently drops honeypot submissions (bot fills the hidden field)', async () => {
    const res = await POST(
      makeRequest({
        email: 'bot@spam.com',
        county: 'dekalb',
        website: 'https://spam.example',
      }) as never,
    )
    // The bot sees success…
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    // …but nothing was stored and no DB call was made.
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.store.size).toBe(0)
  })

  it('returns 429 with Retry-After when the per-IP window is exhausted', async () => {
    h.rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 42 })
    const res = await POST(
      makeRequest(
        { email: 'a@b.co', county: 'dekalb' },
        { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      ) as never,
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(h.upsert).not.toHaveBeenCalled()
    // The limiter is keyed on the FIRST hop of x-forwarded-for.
    expect(h.rateLimit).toHaveBeenCalledWith('lead-capture:203.0.113.9', 60, 5)
  })
})

describe('POST /api/lead-capture — DB failure', () => {
  it('returns a generic 500 that never leaks DB internals', async () => {
    h.upsert.mockResolvedValueOnce({ error: { message: 'relation exploded' } })
    const res = await POST(
      makeRequest({ email: 'a@b.co', county: 'dekalb' }) as never,
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/try again/i)
    expect(JSON.stringify(body)).not.toMatch(/relation exploded/)
  })
})

describe('POST /api/lead-capture — fulfillment email', () => {
  it('sends the promised list email after a successful capture', async () => {
    const res = await POST(
      makeRequest({ email: '  Investor@Example.COM ', county: 'dekalb' }) as never,
    )
    expect(res.status).toBe(200)
    expect(h.sendFreeList).toHaveBeenCalledTimes(1)
    // Normalized (trimmed + lowercased) email, allowlisted county.
    expect(h.sendFreeList).toHaveBeenCalledWith({
      to: 'investor@example.com',
      county: 'dekalb',
    })
  })

  it('still returns success when fulfillment fails — the lead is stored', async () => {
    h.sendFreeList.mockResolvedValueOnce({ ok: false })
    const res = await POST(
      makeRequest({ email: 'a@b.co', county: 'gwinnett' }) as never,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(h.store.size).toBe(1)
  })

  it('resends on a duplicate submit (user did not get the first email)', async () => {
    const body = { email: 'again@example.com', county: 'dekalb' }
    await POST(makeRequest(body) as never)
    await POST(makeRequest(body) as never)
    // Lead stored once (unique index), email attempted both times — the
    // rate limiter, not dedup, bounds abuse here.
    expect(h.store.size).toBe(1)
    expect(h.sendFreeList).toHaveBeenCalledTimes(2)
  })

  it('never sends for honeypot hits', async () => {
    await POST(
      makeRequest({ email: 'bot@spam.com', county: 'dekalb', website: 'x' }) as never,
    )
    expect(h.sendFreeList).not.toHaveBeenCalled()
  })

  it('never sends for invalid input', async () => {
    await POST(makeRequest({ email: 'not-an-email', county: 'dekalb' }) as never)
    expect(h.sendFreeList).not.toHaveBeenCalled()
  })

  it('never sends when the DB insert fails', async () => {
    h.upsert.mockResolvedValueOnce({ error: { message: 'boom' } })
    await POST(makeRequest({ email: 'a@b.co', county: 'dekalb' }) as never)
    expect(h.sendFreeList).not.toHaveBeenCalled()
  })
})
