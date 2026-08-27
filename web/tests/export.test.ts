import { describe, it, expect, beforeEach, vi } from 'vitest'

// POST /api/export — the Expert-tier CSV export. Scope per product direction:
// Expert exports ONLY their own auction_pipeline / lead_pipeline. These tests
// pin the plan gate, the pipeline→visible_properties_safe id mapping, the
// locked-row drop, rate limiting, and the admin-only explicit-ids path — the
// second untested paywall surface the launch audit flagged.

interface QueryState {
  table: string
  select: string
  eq: Array<[string, unknown]>
  in: [string, unknown[]] | null
  insert: Record<string, unknown> | null
  update: Record<string, unknown> | null
}

const h = vi.hoisted(() => ({
  user: { value: null as null | { id: string; email?: string } },
  access: { value: { effectivePlan: 'starter' as string, isAdmin: false } },
  entitlements: { value: { starter: false, pro: false, expert: true } as Record<string, boolean> },
  pipelineRows: { value: [] as Array<{ county: string; parcel_id: string }> },
  leadRows: { value: [] as Array<{ lead_id: string }> },
  safeRows: { value: [] as Array<Record<string, unknown>> },
  audits: { value: [] as Array<Record<string, unknown>> },
  rate: vi.fn(),
  queries: { value: [] as QueryState[] },
}))

function resolveList(state: QueryState): { data: unknown; error: null } {
  if (state.table === 'auction_pipeline') {
    const countyFilter = state.eq.find(([c]) => c === 'county')?.[1]
    const rows = h.pipelineRows.value.filter(r => !countyFilter || r.county === countyFilter)
    return { data: rows, error: null }
  }
  if (state.table === 'lead_pipeline') return { data: h.leadRows.value, error: null }
  if (state.table === 'visible_properties_safe' && state.in) {
    const [col, vals] = state.in
    const rows = h.safeRows.value.filter(r => (vals as unknown[]).includes(r[col]))
    return { data: rows, error: null }
  }
  return { data: [], error: null }
}

function resolveSingle(state: QueryState): { data: unknown; error: null } {
  if (state.table === 'plan_entitlements') {
    const plan = String(state.eq.find(([c]) => c === 'plan')?.[1])
    return { data: { csv_export: h.entitlements.value[plan] ?? false }, error: null }
  }
  if (state.table === 'export_audit_logs') {
    if (state.insert) h.audits.value.push(state.insert)
    return { data: { id: 'audit_1' }, error: null }
  }
  return { data: null, error: null }
}

function makeBuilder(table: string) {
  const state: QueryState = { table, select: '', eq: [], in: null, insert: null, update: null }
  h.queries.value.push(state)
  /* eslint-disable @typescript-eslint/no-explicit-any -- chainable supabase query fake */
  const b: any = {
    select(s: string) { state.select = s; return b },
    eq(c: string, v: unknown) { state.eq.push([c, v]); return b },
    in(c: string, v: unknown[]) { state.in = [c, v]; return b },
    insert(row: Record<string, unknown>) { state.insert = row; return b },
    update(patch: Record<string, unknown>) { state.update = patch; return b },
    single: async () => resolveSingle(state),
    then(resolve: (v: unknown) => void) { resolve(resolveList(state)) },
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user.value }, error: null }) },
    from: (table: string) => makeBuilder(table),
  }),
}))

vi.mock('@/lib/access', () => ({
  getCurrentUserAccess: async () => h.access.value,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => h.rate(...a),
}))

import { POST } from '@/app/api/export/route'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

function makeRequest(body: unknown = {}): Request {
  return new Request('https://example.com/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  h.user.value = null
  h.access.value = { effectivePlan: 'starter', isAdmin: false }
  h.entitlements.value = { starter: false, pro: false, expert: true }
  h.pipelineRows.value = []
  h.leadRows.value = []
  h.safeRows.value = []
  h.audits.value = []
  h.queries.value = []
  h.rate.mockReset()
  h.rate.mockResolvedValue({ ok: true })
})

describe('POST /api/export — gates', () => {
  it('401s an unauthenticated caller', async () => {
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(401)
  })

  it('403s a non-Expert plan with an upgrade pointer', async () => {
    h.user.value = { id: 'user_starter' }
    h.access.value = { effectivePlan: 'starter', isAdmin: false }
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
    expect(body.error.upgradeUrl).toBe('/pricing')
  })

  it('rejects an invalid contentType with 400', async () => {
    h.user.value = { id: 'user_expert' }
    h.access.value = { effectivePlan: 'expert', isAdmin: false }
    const res = await POST(makeRequest({ contentType: 'everything' }) as never)
    expect(res.status).toBe(400)
  })

  it('rejects a county outside the allowlist with 400', async () => {
    h.user.value = { id: 'user_expert' }
    h.access.value = { effectivePlan: 'expert', isAdmin: false }
    const res = await POST(makeRequest({ county: 'los-angeles' }) as never)
    expect(res.status).toBe(400)
  })

  it('403s explicit-id selection for non-admins', async () => {
    h.user.value = { id: 'user_expert' }
    h.access.value = { effectivePlan: 'expert', isAdmin: false }
    const res = await POST(makeRequest({ ids: [UUID_A] }) as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('DATA_ACCESS_DENIED')
  })

  it('429s with retry info when the 1/min limit is hit', async () => {
    h.user.value = { id: 'user_expert' }
    h.access.value = { effectivePlan: 'expert', isAdmin: false }
    h.rate.mockResolvedValue({ ok: false, retryAfterSeconds: 42 })
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(429)
    expect((await res.json()).error.retryAfterSeconds).toBe(42)
    expect(h.rate).toHaveBeenCalledWith('export:user_expert', 60, 1)
  })
})

describe('POST /api/export — Expert pipeline export', () => {
  beforeEach(() => {
    h.user.value = { id: 'user_expert', email: 'e@example.com' }
    h.access.value = { effectivePlan: 'expert', isAdmin: false }
    h.pipelineRows.value = [
      { county: 'dekalb', parcel_id: 'TAX123' },
      { county: 'dekalb', parcel_id: 'TAXLOCKED' },
    ]
    h.safeRows.value = [
      {
        id: UUID_A, county: 'dekalb', parcel_id: 'TAX123', locked: false,
        address: '123 Real St', city: 'Decatur', state: 'GA', zip: '30030',
        property_type: 'Residential', deal_score: 91, min_bid: 4321,
        arv: 198000, roi_pct: 248, max_bid: 34500,
      },
      {
        id: UUID_B, county: 'dekalb', parcel_id: 'TAXLOCKED', locked: true,
        address: 'Unlock to view address', deal_score: null, arv: null,
      },
    ]
  })

  it('streams a CSV of the pipeline properties and DROPS locked rows', async () => {
    const res = await POST(makeRequest({ format: 'compact' }) as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('attachment')

    const text = await res.text()
    expect(text).toContain('parcel_id,county,address') // compact header
    expect(text).toContain('TAX123')
    expect(text).toContain('123 Real St')
    // The locked pipeline row is mapped but never emitted.
    expect(text).not.toContain('TAXLOCKED')
  })

  it('maps pipeline (county, parcel_id) pairs to safe-view ids — cross-county collisions excluded', async () => {
    // Same parcel_id exists in another county; only the user's county row exports.
    h.safeRows.value.push({
      id: '33333333-3333-4333-8333-333333333333',
      county: 'gwinnett', parcel_id: 'TAX123', locked: false, address: '999 Wrong County Rd',
    })
    const res = await POST(makeRequest({ format: 'compact' }) as never)
    const text = await res.text()
    expect(text).toContain('123 Real St')
    expect(text).not.toContain('999 Wrong County Rd')
  })

  it('applies the county filter to the pipeline query', async () => {
    await POST(makeRequest({ county: 'dekalb' }) as never)
    const pipelineQuery = h.queries.value.find(q => q.table === 'auction_pipeline')
    expect(pipelineQuery?.eq).toContainEqual(['county', 'dekalb'])
  })

  it('writes an audit row with the result count', async () => {
    await POST(makeRequest({ format: 'compact' }) as never)
    expect(h.audits.value).toHaveLength(1)
    expect(h.audits.value[0]).toMatchObject({
      user_id: 'user_expert',
      plan: 'expert',
      content_type: 'auction',
      result_count: 2, // both pipeline rows resolve to ids; locked drop happens at stream time
      success: true,
    })
  })

  it('admin explicit-ids path streams exactly those ids', async () => {
    h.access.value = { effectivePlan: 'expert', isAdmin: true }
    const res = await POST(makeRequest({ ids: [UUID_A], format: 'compact' }) as never)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('TAX123')
    expect(text).not.toContain('TAXLOCKED')
  })
})
