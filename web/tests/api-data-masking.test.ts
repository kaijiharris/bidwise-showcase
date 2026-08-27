import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── The paywall's most security-critical path ─────────────────────────────────
// GET /api/data/[county] masks the paid dataset SERVER-SIDE per entitlement:
// locked rows have every financial field nulled, addresses replaced, owner PII
// and internal sourcing stripped; comparables are withheld below expert/admin.
// A regression here silently leaks the entire paid dataset — these tests are
// the CI tripwire the launch audit flagged as missing.

const h = vi.hoisted(() => ({
  bearerUser: { value: null as null | { id: string; email?: string } },
  cookieUser: { value: null as null | { id: string; email?: string } },
  // `provider` is optional so the pre-existing cases below stay untouched; only
  // the iOS/RevenueCat cases need to set it.
  access: {
    value: { plan: null, isAdmin: false, unlockLimit: 0 } as {
      plan: string | null
      isAdmin: boolean
      unlockLimit: number | null
      provider?: string | null
    },
  },
  unlockedKeys: { value: new Set<string>() },
  getUnlocked: vi.fn(),
  resolveFile: vi.fn(),
  readDataset: vi.fn(),
}))

vi.mock('@/lib/data-access', () => ({
  serviceClient: () => ({}),
  getUserFromBearer: async () => h.bearerUser.value,
  resolveAccessForUser: async () => h.access.value,
  getUnlockedKeysForMonth: (...a: unknown[]) => h.getUnlocked(...a),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.cookieUser.value }, error: null }) },
  }),
}))

vi.mock('@/lib/county-data', () => ({
  isKnownCounty: (slug: string) => ['dekalb', 'gwinnett', 'cobb', 'clayton'].includes(slug),
  resolveDataFile: (...a: unknown[]) => h.resolveFile(...a),
  readCountyDataset: (...a: unknown[]) => h.readDataset(...a),
}))

import { GET } from '@/app/api/data/[county]/route'

// A locked-eligible property carrying every category the route must handle:
// financials, comp-derived signals, owner PII, internal sourcing, address
// fields, and a raw `_`-prefixed pipeline key.
function makeProperty(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    county: 'dekalb',
    auction_date: '2026-09-01',
    tax_id: 'TAX123',
    full_address: '123 Real St',
    address: '123 Real St',
    city: 'Decatur',
    state: 'GA',
    zip_code: '30030',
    property_type: 'Residential',
    tax_due: 4321,
    // financials (must null when locked)
    arv: 198_000,
    deal_score: 91,
    recommended_max_bid: 34_500,
    roi_percent: 248,
    ranked_comps: [{ price: 192_000 }],
    avg_comp_price: 195_000,
    // PII (must NEVER ship)
    owner: 'JANE DOE',
    defendant: 'JANE DOE',
    raw_text: 'internal parse blob',
    // internal sourcing (must NEVER ship)
    comp_source: 'Zillow Scraper',
    propstream_open_liens: 2,
    _pipeline_internal: 'x',
    ...overrides,
  }
}

function makeDataset(props: Record<string, unknown>[]) {
  return {
    properties: props,
    comparables: [{ address: '2901 Henderson Rd', price: 192_000, source: 'Zillow Scraper' }],
    total_properties: props.length,
    county: 'dekalb',
    analysis_date: '2026-07-12',
    auction_date: '2026-09-01',
  }
}

function req(county = 'dekalb', headers: Record<string, string> = {}) {
  return new NextRequest(`https://example.com/api/data/${county}`, { headers })
}

function params(county = 'dekalb') {
  return { params: Promise.resolve({ county }) }
}

beforeEach(() => {
  h.bearerUser.value = null
  h.cookieUser.value = null
  h.access.value = { plan: null, isAdmin: false, unlockLimit: 0, provider: null }
  h.unlockedKeys.value = new Set()
  h.getUnlocked.mockReset()
  h.getUnlocked.mockImplementation(async () => h.unlockedKeys.value)
  h.resolveFile.mockReset()
  h.resolveFile.mockResolvedValue({ fileName: 'dekalb.json', entry: null })
  h.readDataset.mockReset()
  h.readDataset.mockResolvedValue(makeDataset([makeProperty()]))
})

describe('GET /api/data/[county] — routing & auth', () => {
  it('404s an unknown county before any auth work', async () => {
    const res = await GET(req('fulton'), params('fulton'))
    expect(res.status).toBe(404)
  })

  it('401s when neither bearer nor cookie session resolves a user', async () => {
    const res = await GET(req(), params())
    expect(res.status).toBe(401)
  })

  it('accepts a bearer-token user (mobile path) without a cookie session', async () => {
    h.bearerUser.value = { id: 'user_mobile' }
    h.access.value = { plan: 'expert', isAdmin: false, unlockLimit: null }
    const res = await GET(req('dekalb', { authorization: 'Bearer jwt' }), params())
    expect(res.status).toBe(200)
  })

  it('404s when no dataset resolves for the county', async () => {
    h.cookieUser.value = { id: 'user_web' }
    h.access.value = { plan: 'starter', isAdmin: false, unlockLimit: 10 }
    h.resolveFile.mockResolvedValue(null)
    const res = await GET(req(), params())
    expect(res.status).toBe(404)
  })

  it('500s (without leaking detail) when the dataset read throws', async () => {
    h.cookieUser.value = { id: 'user_web' }
    h.access.value = { plan: 'starter', isAdmin: false, unlockLimit: 10 }
    h.readDataset.mockRejectedValue(new Error('disk exploded'))
    const res = await GET(req(), params())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/disk exploded/)
  })
})

describe('GET /api/data/[county] — locked-row masking (the paywall)', () => {
  beforeEach(() => {
    h.cookieUser.value = { id: 'user_starter' }
    h.access.value = { plan: 'starter', isAdmin: false, unlockLimit: 10 }
  })

  it('nulls every financial field and masks the address on a locked row', async () => {
    const res = await GET(req(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    const p = body.properties[0]

    expect(p._unlocked).toBe(false)
    // The headline paywall numbers are literally absent from the payload.
    expect(p.arv).toBeNull()
    expect(p.deal_score).toBeNull()
    expect(p.recommended_max_bid).toBeNull()
    expect(p.roi_percent).toBeNull()
    expect(p.ranked_comps).toBeNull()
    expect(p.avg_comp_price).toBeNull()
    // Street identity is replaced server-side — nothing to un-blur in the DOM.
    expect(p.full_address).toBe('Unlock to view address')
    expect(p.address).toBe('Unlock to view address')
    // Context the user needs to decide on an unlock stays.
    expect(p.city).toBe('Decatur')
    expect(p.tax_due).toBe(4321)
  })

  it('strips owner PII, internal sourcing, and _-prefixed keys on EVERY row', async () => {
    const res = await GET(req(), params())
    const p = (await res.json()).properties[0]
    expect(p).not.toHaveProperty('owner')
    expect(p).not.toHaveProperty('defendant')
    expect(p).not.toHaveProperty('raw_text')
    expect(p).not.toHaveProperty('comp_source')
    expect(p).not.toHaveProperty('propstream_open_liens')
    expect(p).not.toHaveProperty('_pipeline_internal')
    expect(p).not.toHaveProperty('_unlockKey')
  })

  it('withholds the top-level comparables array from non-expert tiers', async () => {
    const res = await GET(req(), params())
    const body = await res.json()
    expect(body.comparables).toEqual([])
  })

  it('reports entitlement state in the access block', async () => {
    const res = await GET(req(), params())
    const body = await res.json()
    expect(body.access).toMatchObject({
      plan: 'starter',
      isAdmin: false,
      unlockLimit: 10,
      unlockedThisMonth: 0,
      unlockedInResponse: 0,
    })
  })
})

describe('GET /api/data/[county] — unlocked & full-access rows', () => {
  it('unmasks a row the user has unlocked, but PII/internal stay stripped', async () => {
    h.cookieUser.value = { id: 'user_starter' }
    h.access.value = { plan: 'starter', isAdmin: false, unlockLimit: 10 }
    h.unlockedKeys.value = new Set(['dekalb:2026-09-01:TAX123'])
    h.readDataset.mockResolvedValue(
      makeDataset([makeProperty(), makeProperty({ tax_id: 'TAX999', full_address: '999 Other Rd', address: '999 Other Rd' })]),
    )

    const res = await GET(req(), params())
    const body = await res.json()
    const [unlocked, locked] = body.properties

    expect(unlocked._unlocked).toBe(true)
    expect(unlocked.arv).toBe(198_000)
    expect(unlocked.full_address).toBe('123 Real St')
    // Even a paid-for row never carries PII or sourcing.
    expect(unlocked).not.toHaveProperty('owner')
    expect(unlocked).not.toHaveProperty('comp_source')

    expect(locked._unlocked).toBe(false)
    expect(locked.arv).toBeNull()
    expect(locked.full_address).toBe('Unlock to view address')

    expect(body.access.unlockedInResponse).toBe(1)
    // comparables stay expert-only even with row unlocks
    expect(body.comparables).toEqual([])
  })

  it('expert: every row unlocked and comparables ship with vendor source stripped', async () => {
    h.cookieUser.value = { id: 'user_expert' }
    h.access.value = { plan: 'expert', isAdmin: false, unlockLimit: null }

    const res = await GET(req(), params())
    const body = await res.json()
    expect(body.properties[0]._unlocked).toBe(true)
    expect(body.properties[0].arv).toBe(198_000)
    expect(body.comparables).toHaveLength(1)
    expect(body.comparables[0].price).toBe(192_000)
    expect(body.comparables[0]).not.toHaveProperty('source')
    // Expert never hits the per-month unlock ledger.
    expect(h.getUnlocked).not.toHaveBeenCalled()
  })

  it('admin (no plan) gets full access', async () => {
    h.cookieUser.value = { id: 'user_admin' }
    h.access.value = { plan: null, isAdmin: true, unlockLimit: null }
    const res = await GET(req(), params())
    const body = await res.json()
    expect(body.properties[0]._unlocked).toBe(true)
    expect(body.comparables).toHaveLength(1)
  })

  it('no active plan (and not admin): everything locked, ledger never queried', async () => {
    h.cookieUser.value = { id: 'user_lapsed' }
    h.access.value = { plan: null, isAdmin: false, unlockLimit: 0 }
    const res = await GET(req(), params())
    const body = await res.json()
    expect(body.properties[0]._unlocked).toBe(false)
    expect(body.properties[0].arv).toBeNull()
    expect(h.getUnlocked).not.toHaveBeenCalled()
  })
})

// ── iOS in-app purchases (RevenueCat) ────────────────────────────────────────
// The RevenueCat webhook labels EVERY iOS product 'pro', but the mobile app has
// no per-property unlock flow — it never calls POST /api/unlocks. Before this
// rule existed, a paying iOS subscriber inherited web 'pro''s 25/month
// allowance and therefore saw 171/171 masked cards: null financials and
// "Unlock to view address" everywhere. These tests pin the fix, and pin that
// web/Stripe 'pro' did NOT silently become unlimited alongside it.
describe('GET /api/data/[county] — iOS (RevenueCat) entitlement', () => {
  it("unlocks every row for a RevenueCat 'pro' subscriber (the launch blocker)", async () => {
    h.bearerUser.value = { id: 'user_ios' }
    h.access.value = { plan: 'pro', isAdmin: false, unlockLimit: null, provider: 'revenuecat' }

    const res = await GET(req('dekalb', { authorization: 'Bearer jwt' }), params())
    expect(res.status).toBe(200)
    const p = (await res.json()).properties[0]

    expect(p._unlocked).toBe(true)
    // The numbers the subscriber is paying for actually arrive.
    expect(p.arv).toBe(198_000)
    expect(p.full_address).toBe('123 Real St')
    expect(p.recommended_max_bid).not.toBeNull()
  })

  it('never spends the per-month unlock ledger for a RevenueCat subscriber', async () => {
    h.bearerUser.value = { id: 'user_ios' }
    h.access.value = { plan: 'pro', isAdmin: false, unlockLimit: null, provider: 'revenuecat' }
    await GET(req('dekalb', { authorization: 'Bearer jwt' }), params())
    expect(h.getUnlocked).not.toHaveBeenCalled()
  })

  it("REGRESSION: web/Stripe 'pro' keeps its metered allowance and stays locked", async () => {
    h.cookieUser.value = { id: 'user_web_pro' }
    h.access.value = { plan: 'pro', isAdmin: false, unlockLimit: 25, provider: 'stripe' }

    const res = await GET(req(), params())
    const body = await res.json()
    expect(body.properties[0]._unlocked).toBe(false)
    expect(body.properties[0].arv).toBeNull()
    expect(body.properties[0].full_address).toBe('Unlock to view address')
    // Metered tiers consult the ledger; unlimited ones must not.
    expect(h.getUnlocked).toHaveBeenCalled()
  })

  it('a lapsed RevenueCat row (no active plan) unlocks nothing', async () => {
    h.bearerUser.value = { id: 'user_ios_lapsed' }
    h.access.value = { plan: null, isAdmin: false, unlockLimit: 0, provider: 'revenuecat' }

    const res = await GET(req('dekalb', { authorization: 'Bearer jwt' }), params())
    const body = await res.json()
    expect(body.properties[0]._unlocked).toBe(false)
    expect(body.properties[0].arv).toBeNull()
  })

  it('WITHHOLDS comparables from a RevenueCat subscriber — expert tier only', async () => {
    h.bearerUser.value = { id: 'user_ios' }
    h.access.value = { plan: 'pro', isAdmin: false, unlockLimit: null, provider: 'revenuecat' }

    const body = await (await GET(req('dekalb', { authorization: 'Bearer jwt' }), params())).json()
    // Properties unlock for iOS...
    expect(body.properties[0]._unlocked).toBe(true)
    // ...but the raw comp-sales dataset does NOT. planForProduct() labels every
    // iOS product 'pro', so gating comparables on the unlock predicate would
    // hand the $249 Expert dataset to the cheapest iOS tier.
    expect(body.comparables).toEqual([])
  })

  it('still ships comparables to an admin on an iOS-provider row', async () => {
    h.bearerUser.value = { id: 'user_ios_admin' }
    h.access.value = { plan: 'expert', isAdmin: true, unlockLimit: null, provider: 'revenuecat' }

    const body = await (await GET(req('dekalb', { authorization: 'Bearer jwt' }), params())).json()
    expect(body.comparables).toHaveLength(1)
    expect(body.comparables[0]).not.toHaveProperty('source')
  })
})
