import { describe, it, expect, beforeEach, vi } from 'vitest'

// lib/pipeline-api — the web client for the mobile-shared auction_pipeline
// table. Pins: the cross-device parcel identity (must match mobile's
// convention or the unique key can't dedupe), the upsert contract, row
// mapping, and the legacy localStorage migration.

interface QueryState {
  table: string
  select: string
  order: [string, unknown] | null
  eq: Array<[string, unknown]>
  upsert: { rows: unknown; opts: unknown } | null
  update: Record<string, unknown> | null
  delete: boolean
}

const h = vi.hoisted(() => ({
  user: { value: { id: 'user_1' } as null | { id: string } },
  rows: { value: [] as Array<Record<string, unknown>> },
  singleRow: { value: null as Record<string, unknown> | null },
  queries: { value: [] as QueryState[] },
}))

function makeBuilder(table: string) {
  const state: QueryState = { table, select: '', order: null, eq: [], upsert: null, update: null, delete: false }
  h.queries.value.push(state)
  /* eslint-disable @typescript-eslint/no-explicit-any -- chainable supabase query fake */
  const b: any = {
    select(s: string) { state.select = s; return b },
    order(c: string, o: unknown) { state.order = [c, o]; return b },
    eq(c: string, v: unknown) { state.eq.push([c, v]); return b },
    upsert(rows: unknown, opts: unknown) { state.upsert = { rows, opts }; return b },
    update(patch: Record<string, unknown>) { state.update = patch; return b },
    delete() { state.delete = true; return b },
    single: async () => ({ data: h.singleRow.value, error: null }),
    then(resolve: (v: unknown) => void) { resolve({ data: h.rows.value, error: null }) },
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return b
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.user.value }, error: null }) },
    from: (table: string) => makeBuilder(table),
  }),
}))

import {
  parcelIdFor,
  isServerDealId,
  fetchPipeline,
  addToPipelineServer,
  clearPipelineServer,
  syncLegacyDeals,
  updatePipelineStatusServer,
  removeFromPipelineServer,
} from '@/lib/pipeline-api'

const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    county: 'dekalb',
    parcel_id: 'TAX123',
    address: '123 Real St',
    city: 'Decatur',
    zip: '30030',
    auction_date: '2026-09-01',
    roi: 248,
    deal_score: 91,
    status: 'watchlist',
    added_at: '2026-07-14T12:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  h.user.value = { id: 'user_1' }
  h.rows.value = []
  h.singleRow.value = null
  h.queries.value = []
})

describe('parcel identity (must match mobile)', () => {
  it('prefers the real tax id, trimmed', () => {
    expect(parcelIdFor({ taxId: ' TAX123 ', county: 'dekalb', id: 7 })).toBe('TAX123')
  })
  it('falls back to the county-propId composite mobile also uses', () => {
    expect(parcelIdFor({ taxId: '', county: 'dekalb', id: 7 })).toBe('dekalb-7')
    expect(parcelIdFor({ county: 'clayton', id: 3 })).toBe('clayton-3')
  })
  it('isServerDealId separates server uuids from local composites', () => {
    expect(isServerDealId(UUID)).toBe(true)
    expect(isServerDealId('local-dekalb-7-1789000000')).toBe(false)
    expect(isServerDealId('dekalb-7-1789000000')).toBe(false)
  })
})

describe('addToPipelineServer', () => {
  it('upserts on (user_id, parcel_id) with the caller identity and maps the returned row', async () => {
    h.singleRow.value = serverRow()
    const deal = await addToPipelineServer({
      parcelId: 'TAX123', addr: '123 Real St', county: 'dekalb',
      city: 'Decatur', zip: '30030', auctionDate: '2026-09-01', roi: 248, score: 91,
    })

    const q = h.queries.value.find(x => x.table === 'auction_pipeline' && x.upsert)
    expect(q?.upsert?.opts).toEqual({ onConflict: 'user_id,parcel_id' })
    expect(q?.upsert?.rows).toMatchObject({
      user_id: 'user_1', county: 'dekalb', parcel_id: 'TAX123',
      address: '123 Real St', deal_score: 91, status: 'watchlist',
    })
    // Server row mapped into the web deal shape.
    expect(deal).toEqual({
      id: UUID, parcelId: 'TAX123', addr: '123 Real St', county: 'dekalb',
      roi: 248, score: 91, status: 'watchlist', addedAt: '2026-07-14T12:00:00Z',
    })
  })

  it('throws when nobody is signed in (caller owns the fallback)', async () => {
    h.user.value = null
    await expect(
      addToPipelineServer({ parcelId: 'X', addr: 'A', county: 'dekalb', roi: null, score: null }),
    ).rejects.toThrow(/signed in/i)
  })
})

describe('fetchPipeline', () => {
  it('maps rows and coerces an unknown status to watchlist', async () => {
    h.rows.value = [serverRow(), serverRow({ id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', parcel_id: 'TAX999', status: 'won???' })]
    const deals = await fetchPipeline()
    expect(deals).toHaveLength(2)
    expect(deals[0].parcelId).toBe('TAX123')
    expect(deals[1].status).toBe('watchlist')
    const q = h.queries.value.find(x => x.table === 'auction_pipeline')
    expect(q?.order).toEqual(['added_at', { ascending: false }])
  })
})

describe('status / remove / clear', () => {
  it('updates status by row id', async () => {
    await updatePipelineStatusServer(UUID, 'bidding')
    const q = h.queries.value.find(x => x.table === 'auction_pipeline' && x.update)
    expect(q?.update).toEqual({ status: 'bidding' })
    expect(q?.eq).toContainEqual(['id', UUID])
  })

  it('deletes by row id', async () => {
    await removeFromPipelineServer(UUID)
    const q = h.queries.value.find(x => x.table === 'auction_pipeline' && x.delete)
    expect(q?.eq).toContainEqual(['id', UUID])
  })

  it('clear scopes the delete to the signed-in user', async () => {
    await clearPipelineServer()
    const q = h.queries.value.find(x => x.table === 'auction_pipeline' && x.delete)
    expect(q?.eq).toContainEqual(['user_id', 'user_1'])
  })
})

describe('syncLegacyDeals (localStorage-era migration)', () => {
  it('derives the mobile-compatible parcel id from legacy propId rows and upserts them', async () => {
    const sent = await syncLegacyDeals([
      // legacy shape: composite id, numeric propId, no parcelId
      { id: 'dekalb-7-1700000000', propId: 7, addr: '123 Real St', county: 'dekalb', roi: 248, score: 91, status: 'diligence', addedAt: '2026-07-01T00:00:00Z' },
    ])
    expect(sent).toBe(1)
    const q = h.queries.value.find(x => x.table === 'auction_pipeline' && x.upsert)
    expect(q?.upsert?.opts).toEqual({ onConflict: 'user_id,parcel_id' })
    expect(q?.upsert?.rows).toEqual([
      expect.objectContaining({
        user_id: 'user_1', county: 'dekalb', parcel_id: 'dekalb-7',
        address: '123 Real St', deal_score: 91, status: 'diligence',
        added_at: '2026-07-01T00:00:00Z',
      }),
    ])
  })

  it('skips already-synced rows (server uuid ids) and garbage; returns 0 with no network call', async () => {
    const sent = await syncLegacyDeals([
      { id: UUID, parcelId: 'TAX123', addr: 'X', county: 'dekalb' }, // synced
      { id: 'local-x', addr: '', county: 'dekalb' },                 // unusable: no addr
      { id: 'local-y', addr: 'A St' },                               // unusable: no county
    ])
    expect(sent).toBe(0)
    expect(h.queries.value.find(x => x.upsert)).toBeUndefined()
  })

  it('sanitizes an unknown legacy status to watchlist', async () => {
    await syncLegacyDeals([
      { id: 'local-1', parcelId: 'TAXZ', addr: 'A St', county: 'dekalb', status: 'archived' },
    ])
    const q = h.queries.value.find(x => x.table === 'auction_pipeline' && x.upsert)
    expect((q?.upsert?.rows as Array<Record<string, unknown>>)[0].status).toBe('watchlist')
  })
})
