import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Real signature verification ────────────────────────────────────────────────
// We use a REAL Stripe instance for webhooks.constructEvent so the test actually
// exercises signature verification against the RAW request body (the previous
// version stubbed constructEvent, which made a raw-body regression invisible).
// We generate a valid signature with the same secret using
// stripe.webhooks.generateTestHeaderString. Only the network call
// (subscriptions.retrieve) is stubbed.
//
// Everything the hoisted vi.mock factories need is created inside vi.hoisted so
// it is initialized before the factories run.
const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require('stripe').default ?? require('stripe')
  const WEBHOOK_SECRET = 'whsec_test_secret'
  const realStripe = new Stripe('sk_test_dummy', { apiVersion: '2025-08-27.basil' })

  // Price ids -> plans. The route derives entitlement from the PRICE id via the
  // PLANS reverse map, so the test PLANS must contain the ids used in fixtures.
  const PRICE_PRO_MONTHLY = 'price_pro_monthly'
  const PRICE_EXPERT_ANNUAL = 'price_expert_annual'
  const PRICE_STARTER_MONTHLY = 'price_starter_monthly'
  const TEST_PLANS = {
    starter: { name: 'Starter', monthly: PRICE_STARTER_MONTHLY, annual: 'price_starter_annual', monthlyPrice: 39, annualPrice: 329 },
    pro: { name: 'Pro', monthly: PRICE_PRO_MONTHLY, annual: 'price_pro_annual', monthlyPrice: 109, annualPrice: 899 },
    expert: { name: 'Expert', monthly: 'price_expert_monthly', annual: PRICE_EXPERT_ANNUAL, monthlyPrice: 249, annualPrice: 1999 },
  } as const

  return {
    WEBHOOK_SECRET,
    realStripe,
    TEST_PLANS,
    PRICE_PRO_MONTHLY,
    PRICE_EXPERT_ANNUAL,
    PRICE_STARTER_MONTHLY,
    subscriptionsRetrieve: vi.fn(),
    sig: { value: null as string | null },
    // Lifecycle email spies (module mocked below) — the webhook must call
    // these as a courtesy without ever letting them fail the handler.
    sendWelcome: vi.fn(),
    sendTrialEnding: vi.fn(),
  }
})

const WEBHOOK_SECRET = h.WEBHOOK_SECRET
const realStripe = h.realStripe
const PRICE_PRO_MONTHLY = h.PRICE_PRO_MONTHLY
const PRICE_EXPERT_ANNUAL = h.PRICE_EXPERT_ANNUAL
const subscriptionsRetrieve = h.subscriptionsRetrieve

// @/lib/lifecycle-emails: spied so tests assert the courtesy sends without
// composing real HTML or touching Resend.
vi.mock('@/lib/lifecycle-emails', () => ({
  sendWelcomeEmail: (...a: unknown[]) => h.sendWelcome(...a),
  sendTrialEndingEmail: (...a: unknown[]) => h.sendTrialEnding(...a),
}))

// next/headers: the route reads the stripe-signature header from here. We hand
// back the per-request signature computed in makeRequest().
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'stripe-signature' ? h.sig.value : null,
  }),
}))

// @/lib/stripe: real webhooks (signature verification), stubbed network calls,
// and the test PLANS map for the price-id → plan derivation.
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: h.realStripe.webhooks,
    subscriptions: { retrieve: (...a: unknown[]) => h.subscriptionsRetrieve(...a) },
  },
  PLANS: h.TEST_PLANS,
}))

// Convenience accessor so test bodies read/write the shared signature slot.
const signature = h.sig
function setSig(value: string | null) {
  signature.value = value
}

// @supabase/supabase-js: an in-memory fake so we can assert what the webhook
// persisted (subscriptions rows, processed-event dedup, user metadata).
type Row = Record<string, unknown>

class FakeTable {
  constructor(public store: FakeStore, public name: string) {}
  private filters: Array<[string, unknown]> = []

  select() {
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }
  private match(rows: Row[]): Row[] {
    return rows.filter(r => this.filters.every(([c, v]) => r[c] === v))
  }
  async maybeSingle() {
    const rows = this.match(this.store.tables[this.name] ?? [])
    return { data: rows[0] ?? null, error: null }
  }
  // A bare `await table.select().eq(...).eq(...)` resolves to the full filtered
  // list (Supabase returns { data: Row[] } when neither .single/.maybeSingle
  // is chained). recordConversionPaid awaits the conversion_paid list this way.
  then(resolve: (v: { data: Row[]; error: null }) => void) {
    resolve({ data: this.match(this.store.tables[this.name] ?? []), error: null })
  }
  async insert(row: Row) {
    const rows = (this.store.tables[this.name] ??= [])
    // Emulate a UNIQUE(event_id) constraint on processed_stripe_events.
    if (
      this.name === 'processed_stripe_events' &&
      rows.some(r => r.event_id === row.event_id)
    ) {
      return { error: { code: '23505', message: 'duplicate key' } }
    }
    // Emulate uq_affiliate_events_sub_started: one subscription_started per
    // subscription.
    if (
      this.name === 'affiliate_events' &&
      row.stripe_subscription_id &&
      row.event_type === 'subscription_started' &&
      rows.some(
        r =>
          r.stripe_subscription_id === row.stripe_subscription_id &&
          r.event_type === 'subscription_started',
      )
    ) {
      return { error: { code: '23505', message: 'duplicate key' } }
    }
    // Emulate uq_affiliate_events_conv_invoice: conversion_paid is unique per
    // (subscription, metadata.invoice_id) — a subscription can have many paid
    // invoices, but each invoice records at most once.
    if (
      this.name === 'affiliate_events' &&
      row.stripe_subscription_id &&
      row.event_type === 'conversion_paid' &&
      rows.some(
        r =>
          r.stripe_subscription_id === row.stripe_subscription_id &&
          r.event_type === 'conversion_paid' &&
          (r.metadata as { invoice_id?: string })?.invoice_id ===
            (row.metadata as { invoice_id?: string })?.invoice_id,
      )
    ) {
      return { error: { code: '23505', message: 'duplicate key' } }
    }
    // Emulate UNIQUE(stripe_event_id) on subscription_status_history (018).
    if (
      this.name === 'subscription_status_history' &&
      rows.some(r => r.stripe_event_id === row.stripe_event_id)
    ) {
      return { error: { code: '23505', message: 'duplicate key' } }
    }
    rows.push({ ...row })
    return { error: null }
  }
  async upsert(row: Row, opts?: { onConflict?: string }) {
    const rows = (this.store.tables[this.name] ??= [])
    const key = opts?.onConflict
    if (key) {
      const existing = rows.find(r => r[key] === row[key])
      if (existing) Object.assign(existing, row)
      else rows.push({ ...row })
    } else {
      rows.push({ ...row })
    }
    return { error: null }
  }
  // .update({...}).eq(...).eq(...).in(...) — apply once the filter chain resolves.
  update(patch: Row) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture mock query-builder `this` for the nested thenable
    const self = this
    const thenable = {
      _filters: [] as Array<[string, unknown]>,
      _inFilters: [] as Array<[string, unknown[]]>,
      eq(col: string, val: unknown) {
        this._filters.push([col, val])
        return this
      },
      in(col: string, vals: unknown[]) {
        this._inFilters.push([col, vals])
        return this
      },
      not() {
        // Only used on selects in prod code; no-op for update chains.
        return this
      },
      then(resolve: (v: { error: null }) => void) {
        const rows = self.store.tables[self.name] ?? []
        rows
          .filter(r => this._filters.every(([c, v]) => r[c] === v))
          .filter(r => this._inFilters.every(([c, vals]) => vals.includes(r[c])))
          .forEach(r => Object.assign(r, patch))
        resolve({ error: null })
      },
    }
    return thenable
  }
}

class FakeStore {
  tables: Record<string, Row[]> = {}
  auth = {
    admin: {
      updateUserById: vi.fn(async (userId: string, attrs: Row) => {
        const users = (this.tables['__users'] ??= [])
        const u = users.find(x => x.id === userId)
        if (u) Object.assign(u, attrs)
        else users.push({ id: userId, ...attrs })
        return { data: { user: { id: userId } }, error: null }
      }),
      // trial_will_end resolves the recipient through here.
      getUserById: vi.fn(async (userId: string) => ({
        data: { user: { id: userId, email: `${userId}@example.com` } },
        error: null,
      })),
    },
  }
  from(name: string) {
    return new FakeTable(this, name)
  }
}

let store: FakeStore
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => store,
  SupabaseClient: class {},
}))

// Import AFTER mocks are registered.
import { POST } from '@/app/api/stripe/webhook/route'

// Build a request whose stripe-signature header is a VALID signature over the
// exact raw body bytes. The route reads request.text() and verifies against
// this header, so any raw-body mismatch (e.g. re-serializing a parsed object)
// would fail verification — which is the regression this guards against.
function makeRequest(event: object): Request {
  const payload = JSON.stringify(event)
  setSig(
    realStripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  )
  return new Request('https://example.com/api/stripe/webhook', {
    method: 'POST',
    body: payload,
  })
}

function makeSub(overrides: Partial<Row> = {}): Row {
  return {
    id: 'sub_123',
    customer: 'cus_123',
    status: 'active',
    metadata: { user_id: 'user_abc' },
    trial_end: null,
    items: {
      data: [
        {
          price: { id: PRICE_PRO_MONTHLY, recurring: { interval: 'month' } },
          current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 30,
        },
      ],
    },
    ...overrides,
  }
}

beforeEach(() => {
  store = new FakeStore()
  setSig(null)
  subscriptionsRetrieve.mockReset()
  h.sendWelcome.mockReset()
  h.sendWelcome.mockResolvedValue({ ok: true })
  h.sendTrialEnding.mockReset()
  h.sendTrialEnding.mockResolvedValue({ ok: true })
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
})

describe('stripe webhook — lifecycle emails', () => {
  it('sends the welcome email on checkout.session.completed (plan + trial end from the sub)', async () => {
    const trialEnd = Math.floor(Date.now() / 1000) + 86_400 * 14
    subscriptionsRetrieve.mockResolvedValue(
      makeSub({ status: 'trialing', trial_end: trialEnd }),
    )
    const res = await POST(
      makeRequest({
        id: 'evt_welcome_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            subscription: 'sub_123',
            customer_details: { email: 'buyer@example.com' },
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(h.sendWelcome).toHaveBeenCalledTimes(1)
    expect(h.sendWelcome).toHaveBeenCalledWith({
      to: 'buyer@example.com',
      plan: 'pro',
      trialEndEpoch: trialEnd,
    })
  })

  it('skips the welcome email when the session carries no email (still 200)', async () => {
    subscriptionsRetrieve.mockResolvedValue(makeSub())
    const res = await POST(
      makeRequest({
        id: 'evt_welcome_noemail',
        type: 'checkout.session.completed',
        data: { object: { subscription: 'sub_123' } },
      }),
    )
    expect(res.status).toBe(200)
    expect(h.sendWelcome).not.toHaveBeenCalled()
  })

  it('sends the trial-ending reminder on customer.subscription.trial_will_end', async () => {
    const trialEnd = Math.floor(Date.now() / 1000) + 86_400 * 3
    const res = await POST(
      makeRequest({
        id: 'evt_twe_1',
        type: 'customer.subscription.trial_will_end',
        data: { object: makeSub({ status: 'trialing', trial_end: trialEnd }) },
      }),
    )
    expect(res.status).toBe(200)
    // Recipient resolved via auth.admin.getUserById(metadata.user_id).
    expect(h.sendTrialEnding).toHaveBeenCalledTimes(1)
    expect(h.sendTrialEnding).toHaveBeenCalledWith({
      to: 'user_abc@example.com',
      plan: 'pro',
      trialEndEpoch: trialEnd,
    })
    // The event is still marked processed (email is a courtesy, not a gate).
    expect(
      store.tables['processed_stripe_events']?.some(r => r.event_id === 'evt_twe_1'),
    ).toBe(true)
  })

  it('skips the reminder (still 200) when the sub has no metadata.user_id', async () => {
    const res = await POST(
      makeRequest({
        id: 'evt_twe_nouser',
        type: 'customer.subscription.trial_will_end',
        data: { object: makeSub({ metadata: {} }) },
      }),
    )
    expect(res.status).toBe(200)
    expect(h.sendTrialEnding).not.toHaveBeenCalled()
  })
})

describe('stripe webhook — signature verification (raw body)', () => {
  it('rejects a request with no stripe-signature header (400)', async () => {
    const req = makeRequest({ id: 'evt_x', type: 'checkout.session.completed', data: { object: {} } })
    setSig(null) // force-remove after makeRequest set it
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects an invalid signature (400) and does not process the event', async () => {
    makeRequest({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: {} } })
    setSig('t=1,v1=deadbeef') // valid shape, wrong signature
    const res = await POST(
      new Request('https://example.com/api/stripe/webhook', {
        method: 'POST',
        body: JSON.stringify({ tampered: true }),
      }),
    )
    expect(res.status).toBe(400)
    expect(store.tables['subscriptions']).toBeUndefined()
    expect(store.tables['processed_stripe_events']).toBeUndefined()
  })

  it('rejects a tampered body even with an otherwise-valid header (400)', async () => {
    // Sign the original payload, then send a DIFFERENT body. A route that
    // re-serialized a parsed object instead of verifying the raw bytes would
    // wrongly accept this.
    const original = { id: 'evt_orig', type: 'checkout.session.completed', data: { object: { subscription: 'sub_123' } } }
    const payload = JSON.stringify(original)
    setSig(realStripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }))
    const tampered = new Request('https://example.com/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify({ ...original, data: { object: { subscription: 'sub_EVIL' } } }),
    })
    const res = await POST(tampered)
    expect(res.status).toBe(400)
    expect(store.tables['subscriptions']).toBeUndefined()
  })
})

describe('stripe webhook — entitlement derived from PRICE id', () => {
  it('grants the plan that matches the price id, ignoring metadata.plan', async () => {
    // metadata.plan claims "expert" but the price id is the PRO monthly price —
    // the route must persist "pro" (no metadata-driven tier elevation).
    subscriptionsRetrieve.mockResolvedValue(
      makeSub({ metadata: { user_id: 'user_abc', plan: 'expert' } }),
    )
    const res = await POST(
      makeRequest({ id: 'evt_price_1', type: 'checkout.session.completed', data: { object: { subscription: 'sub_123' } } }),
    )
    expect(res.status).toBe(200)

    const subs = store.tables['subscriptions'] ?? []
    expect(subs).toHaveLength(1)
    expect(subs[0]).toMatchObject({ user_id: 'user_abc', plan: 'pro', status: 'active' })
    expect(store.auth.admin.updateUserById).toHaveBeenCalledWith(
      'user_abc',
      expect.objectContaining({
        user_metadata: expect.objectContaining({ plan: 'pro', subscription_status: 'active' }),
      }),
    )
  })

  it('derives expert from the expert annual price id on subscription.updated', async () => {
    const sub = makeSub({
      metadata: { user_id: 'user_xyz' },
      items: { data: [{ price: { id: PRICE_EXPERT_ANNUAL, recurring: { interval: 'year' } }, current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 365 }] },
    })
    const res = await POST(
      makeRequest({ id: 'evt_price_2', type: 'customer.subscription.updated', data: { object: sub } }),
    )
    expect(res.status).toBe(200)
    const subs = store.tables['subscriptions'] ?? []
    expect(subs[0]).toMatchObject({ user_id: 'user_xyz', plan: 'expert', billing_cycle: 'annual' })
  })

  it('returns 500 (Stripe retries) for an unrecognized price id and grants nothing', async () => {
    const sub = makeSub({
      items: { data: [{ price: { id: 'price_UNKNOWN', recurring: { interval: 'month' } }, current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 30 }] },
    })
    const res = await POST(
      makeRequest({ id: 'evt_price_bad', type: 'customer.subscription.updated', data: { object: sub } }),
    )
    expect(res.status).toBe(500)
    expect(store.tables['subscriptions']).toBeUndefined()
    // Not marked processed → Stripe retry will re-run the handler.
    expect(store.tables['processed_stripe_events']).toBeUndefined()
  })
})

describe('stripe webhook — cancellation scoped to stripe_subscription_id', () => {
  it('cancels only the matching subscription row, leaving the user\'s other sub intact', async () => {
    store.tables['subscriptions'] = [
      { user_id: 'user_abc', stripe_subscription_id: 'sub_123', status: 'active' },
      { user_id: 'user_abc', stripe_subscription_id: 'sub_999', status: 'active' },
    ]
    const res = await POST(
      makeRequest({
        id: 'evt_deleted_1',
        type: 'customer.subscription.deleted',
        data: { object: makeSub({ status: 'canceled' }) },
      }),
    )
    expect(res.status).toBe(200)
    const subs = store.tables['subscriptions']
    expect(subs.find(s => s.stripe_subscription_id === 'sub_123')?.status).toBe('canceled')
    // The unrelated subscription must NOT be touched.
    expect(subs.find(s => s.stripe_subscription_id === 'sub_999')?.status).toBe('active')
  })
})

describe('stripe webhook — invoice reactivation never resurrects a canceled row', () => {
  it('payment_succeeded only flips past_due → active, scoped to the invoice subscription', async () => {
    store.tables['subscriptions'] = [
      { user_id: 'user_abc', stripe_subscription_id: 'sub_123', stripe_customer_id: 'cus_123', status: 'past_due' },
      { user_id: 'user_other', stripe_subscription_id: 'sub_777', stripe_customer_id: 'cus_123', status: 'canceled' },
    ]
    const res = await POST(
      makeRequest({
        id: 'evt_paid_1',
        type: 'invoice.payment_succeeded',
        data: { object: { customer: 'cus_123', subscription: 'sub_123' } },
      }),
    )
    expect(res.status).toBe(200)
    const subs = store.tables['subscriptions']
    expect(subs.find(s => s.stripe_subscription_id === 'sub_123')?.status).toBe('active')
    // The canceled row sharing the customer id must stay canceled.
    expect(subs.find(s => s.stripe_subscription_id === 'sub_777')?.status).toBe('canceled')
  })
})

describe('stripe webhook — affiliate subscription_started ledger', () => {
  const CODE = 'AJ-7K2MQ4'

  function seedAffiliate() {
    store.tables['affiliates'] = [
      {
        id: 'aff_1',
        code: CODE,
        email: 'aj@example.com',
        user_id: null,
        status: 'active',
        commission_model: 'flat_bounty',
        commission_flat_cents: 10000,
        commission_pct: null,
        commission_months: null,
      },
    ]
  }

  function affEvents() {
    return store.tables['affiliate_events'] ?? []
  }

  it('records subscription_started when the sub metadata carries an affiliate code', async () => {
    seedAffiliate()
    const sub = makeSub({ metadata: { user_id: 'user_abc', affiliate_code: CODE } })

    const res = await POST(
      makeRequest({ id: 'evt_aff_1', type: 'customer.subscription.created', data: { object: sub } }),
    )

    expect(res.status).toBe(200)
    expect(affEvents()).toHaveLength(1)
    expect(affEvents()[0]).toMatchObject({
      affiliate_id: 'aff_1',
      event_type: 'subscription_started',
      user_id: 'user_abc',
      stripe_subscription_id: 'sub_123',
      plan: 'pro',
      billing_cycle: 'monthly',
    })
  })

  it('is idempotent across redelivered/updated events (unique per subscription)', async () => {
    seedAffiliate()
    const sub = makeSub({ metadata: { user_id: 'user_abc', affiliate_code: CODE } })

    // Two DIFFERENT Stripe events for the same subscription (created + updated).
    const r1 = await POST(
      makeRequest({ id: 'evt_aff_2a', type: 'customer.subscription.created', data: { object: sub } }),
    )
    const r2 = await POST(
      makeRequest({ id: 'evt_aff_2b', type: 'customer.subscription.updated', data: { object: sub } }),
    )

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(affEvents().filter(e => e.event_type === 'subscription_started')).toHaveLength(1)
  })

  it('records nothing when the metadata has no affiliate code', async () => {
    seedAffiliate()

    const res = await POST(
      makeRequest({ id: 'evt_aff_3', type: 'customer.subscription.created', data: { object: makeSub() } }),
    )

    expect(res.status).toBe(200)
    expect(affEvents()).toHaveLength(0)
  })

  it('skips (still 200) when the affiliate code is unknown', async () => {
    const sub = makeSub({ metadata: { user_id: 'user_abc', affiliate_code: 'ZZ-999999' } })

    const res = await POST(
      makeRequest({ id: 'evt_aff_4', type: 'customer.subscription.created', data: { object: sub } }),
    )

    expect(res.status).toBe(200)
    expect(affEvents()).toHaveLength(0)
  })
})

describe('stripe webhook — conversion_paid on each PAID invoice (pct-of-collected)', () => {
  const CODE = 'AJ-7K2MQ4'

  // Launch model: 20% of each collected invoice, first 12 months, pay-on-collection.
  function seedConvertedTrial(model: 'pct_first_n_months' | 'flat_bounty' = 'pct_first_n_months') {
    store.tables['affiliates'] = [
      model === 'pct_first_n_months'
        ? {
            id: 'aff_1',
            code: CODE,
            email: 'aj@example.com',
            user_id: null,
            status: 'active',
            commission_model: 'pct_first_n_months',
            commission_flat_cents: 0,
            commission_pct: 20.0,
            commission_months: 12,
          }
        : {
            id: 'aff_1',
            code: CODE,
            email: 'aj@example.com',
            user_id: null,
            status: 'active',
            commission_model: 'flat_bounty',
            commission_flat_cents: 10000,
            commission_pct: null,
            commission_months: null,
          },
    ]
    store.tables['affiliate_events'] = [
      {
        affiliate_id: 'aff_1',
        event_type: 'subscription_started',
        user_id: 'user_abc',
        stripe_subscription_id: 'sub_123',
        plan: 'pro',
        billing_cycle: 'monthly',
      },
    ]
    store.tables['subscriptions'] = [
      {
        user_id: 'user_abc',
        stripe_subscription_id: 'sub_123',
        plan: 'pro',
        billing_cycle: 'monthly',
        status: 'active',
      },
    ]
  }

  function conversions() {
    return (store.tables['affiliate_events'] ?? []).filter(
      e => e.event_type === 'conversion_paid',
    )
  }

  it('records conversion_paid with the FROZEN pct commission fields + collected amount', async () => {
    seedConvertedTrial()

    const res = await POST(
      makeRequest({
        id: 'evt_conv_1',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_1', customer: 'cus_123', subscription: 'sub_123', amount_paid: 10900 } },
      }),
    )

    expect(res.status).toBe(200)
    expect(conversions()).toHaveLength(1)
    expect(conversions()[0]).toMatchObject({
      affiliate_id: 'aff_1',
      user_id: 'user_abc',
      stripe_subscription_id: 'sub_123',
      plan: 'pro',
      billing_cycle: 'monthly',
      commission_model: 'pct_first_n_months',
      commission_pct: 20.0,
      commission_months: 12,
      // amount_paid is frozen in metadata so the payout query can compute
      // amount_paid * commission_pct/100 (here 10900c * 20% = $21.80).
      metadata: { invoice_id: 'in_1', amount_paid: 10900 },
    })
  })

  it('a $0 trial invoice never converts', async () => {
    seedConvertedTrial()

    const res = await POST(
      makeRequest({
        id: 'evt_conv_2',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_0', customer: 'cus_123', subscription: 'sub_123', amount_paid: 0 } },
      }),
    )

    expect(res.status).toBe(200)
    expect(conversions()).toHaveLength(0)
  })

  it('records a SEPARATE conversion_paid for each distinct paid invoice in the window', async () => {
    seedConvertedTrial()

    // Three distinct monthly invoices → three commissionable events (the whole
    // point of the pct model; the flat model would have stopped after one).
    for (const [evt, inv, amt] of [
      ['evt_conv_3a', 'in_1', 10900],
      ['evt_conv_3b', 'in_2', 10900],
      ['evt_conv_3c', 'in_3', 10900],
    ] as const) {
      const res = await POST(
        makeRequest({
          id: evt,
          type: 'invoice.payment_succeeded',
          data: { object: { id: inv, customer: 'cus_123', subscription: 'sub_123', amount_paid: amt } },
        }),
      )
      expect(res.status).toBe(200)
    }

    expect(conversions()).toHaveLength(3)
    expect(conversions().map(c => (c.metadata as { invoice_id: string }).invoice_id)).toEqual([
      'in_1',
      'in_2',
      'in_3',
    ])
  })

  it('is idempotent PER INVOICE — the same invoice id records at most once', async () => {
    seedConvertedTrial()

    // Two different Stripe event ids delivering the SAME invoice (retry/redeliver).
    await POST(
      makeRequest({
        id: 'evt_conv_dup_a',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_1', customer: 'cus_123', subscription: 'sub_123', amount_paid: 10900 } },
      }),
    )
    const res = await POST(
      makeRequest({
        id: 'evt_conv_dup_b',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_1', customer: 'cus_123', subscription: 'sub_123', amount_paid: 10900 } },
      }),
    )

    expect(res.status).toBe(200)
    expect(conversions()).toHaveLength(1)
  })

  it('does NOT record an invoice collected after the 12-month window closes', async () => {
    seedConvertedTrial()
    // Pre-seed the FIRST conversion_paid 13 months ago (window anchor). A new
    // invoice today is outside the 12-month window → skipped.
    const thirteenMonthsAgo = new Date()
    thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13)
    store.tables['affiliate_events'].push({
      affiliate_id: 'aff_1',
      event_type: 'conversion_paid',
      stripe_subscription_id: 'sub_123',
      commission_model: 'pct_first_n_months',
      commission_pct: 20.0,
      commission_months: 12,
      created_at: thirteenMonthsAgo.toISOString(),
      metadata: { invoice_id: 'in_old', amount_paid: 10900 },
    })

    const res = await POST(
      makeRequest({
        id: 'evt_conv_late',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_late', customer: 'cus_123', subscription: 'sub_123', amount_paid: 10900 } },
      }),
    )

    expect(res.status).toBe(200)
    // Only the pre-seeded old row; the late invoice was not added.
    expect(conversions()).toHaveLength(1)
    expect(conversions()[0].metadata).toMatchObject({ invoice_id: 'in_old' })
  })

  it('flat_bounty (back-compat) still pays exactly once — later invoices are no-ops', async () => {
    seedConvertedTrial('flat_bounty')

    await POST(
      makeRequest({
        id: 'evt_flat_a',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_1', customer: 'cus_123', subscription: 'sub_123', amount_paid: 10900 } },
      }),
    )
    const res = await POST(
      makeRequest({
        id: 'evt_flat_b',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_2', customer: 'cus_123', subscription: 'sub_123', amount_paid: 10900 } },
      }),
    )

    expect(res.status).toBe(200)
    expect(conversions()).toHaveLength(1)
    expect(conversions()[0]).toMatchObject({
      commission_model: 'flat_bounty',
      commission_flat_cents: 10000,
    })
  })

  it('a paid invoice for a subscription with no affiliate involvement records nothing', async () => {
    store.tables['subscriptions'] = [
      { user_id: 'user_abc', stripe_subscription_id: 'sub_123', plan: 'pro', billing_cycle: 'monthly', status: 'active' },
    ]

    const res = await POST(
      makeRequest({
        id: 'evt_conv_4',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_9', customer: 'cus_123', subscription: 'sub_123', amount_paid: 10900 } },
      }),
    )

    expect(res.status).toBe(200)
    expect(store.tables['affiliate_events']).toBeUndefined()
  })
})

describe('stripe webhook — subscription status history (launch-test instrumentation)', () => {
  it('records old_status NULL → status on subscription.created (first sighting)', async () => {
    const res = await POST(
      makeRequest({
        id: 'evt_hist_created',
        type: 'customer.subscription.created',
        data: { object: makeSub({ status: 'trialing' }) },
      }),
    )
    expect(res.status).toBe(200)

    const history = store.tables['subscription_status_history'] ?? []
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      user_id: 'user_abc',
      stripe_subscription_id: 'sub_123',
      plan: 'pro',
      stripe_price_id: PRICE_PRO_MONTHLY,
      old_status: null,
      new_status: 'trialing',
      stripe_event_id: 'evt_hist_created',
    })
  })

  it('captures the old_status → new_status edge on subscription.updated', async () => {
    store.tables['subscriptions'] = [
      { user_id: 'user_abc', stripe_subscription_id: 'sub_123', status: 'trialing' },
    ]
    const res = await POST(
      makeRequest({
        id: 'evt_hist_updated',
        type: 'customer.subscription.updated',
        data: { object: makeSub({ status: 'active' }) },
      }),
    )
    expect(res.status).toBe(200)

    const history = store.tables['subscription_status_history'] ?? []
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      old_status: 'trialing',
      new_status: 'active',
      stripe_event_id: 'evt_hist_updated',
    })
  })

  it('records old_status → canceled on subscription.deleted', async () => {
    store.tables['subscriptions'] = [
      { user_id: 'user_abc', stripe_subscription_id: 'sub_123', status: 'active' },
    ]
    const res = await POST(
      makeRequest({
        id: 'evt_hist_deleted',
        type: 'customer.subscription.deleted',
        data: { object: makeSub({ status: 'canceled' }) },
      }),
    )
    expect(res.status).toBe(200)

    const history = store.tables['subscription_status_history'] ?? []
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      user_id: 'user_abc',
      stripe_subscription_id: 'sub_123',
      old_status: 'active',
      new_status: 'canceled',
      stripe_event_id: 'evt_hist_deleted',
    })
  })

  it('tolerates a Stripe retry that already wrote history (UNIQUE dedup, no duplicate row)', async () => {
    // Simulate a partial failure: the first delivery wrote the history row but
    // crashed before markProcessed, so the retry re-runs the whole handler.
    store.tables['subscription_status_history'] = [
      { stripe_event_id: 'evt_hist_retry', stripe_subscription_id: 'sub_123', new_status: 'active' },
    ]
    const res = await POST(
      makeRequest({
        id: 'evt_hist_retry',
        type: 'customer.subscription.updated',
        data: { object: makeSub({ status: 'active' }) },
      }),
    )
    expect(res.status).toBe(200)
    // Still exactly one row — the 23505 collision is the dedup working.
    expect(store.tables['subscription_status_history']).toHaveLength(1)
  })

  it('does not write history when the upsert fails (whole event retries)', async () => {
    const sub = makeSub({
      items: { data: [{ price: { id: 'price_UNKNOWN', recurring: { interval: 'month' } }, current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 30 }] },
    })
    const res = await POST(
      makeRequest({ id: 'evt_hist_fail', type: 'customer.subscription.updated', data: { object: sub } }),
    )
    expect(res.status).toBe(500)
    expect(store.tables['subscription_status_history']).toBeUndefined()
  })

  it('does not write history for checkout.session.completed (subscription.* events own it)', async () => {
    subscriptionsRetrieve.mockResolvedValue(makeSub())
    const res = await POST(
      makeRequest({
        id: 'evt_hist_checkout',
        type: 'checkout.session.completed',
        data: { object: { subscription: 'sub_123' } },
      }),
    )
    expect(res.status).toBe(200)
    // Stripe sends customer.subscription.created alongside checkout completion;
    // that event records the transition — checkout must not double-record it.
    expect(store.tables['subscription_status_history']).toBeUndefined()
  })
})

describe('stripe webhook — idempotency', () => {
  it('processes a given event id only once', async () => {
    subscriptionsRetrieve.mockResolvedValue(makeSub())

    const first = await POST(
      makeRequest({ id: 'evt_dupe_1', type: 'checkout.session.completed', data: { object: { subscription: 'sub_123' } } }),
    )
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.deduped).toBeUndefined()

    subscriptionsRetrieve.mockClear()
    const second = await POST(
      makeRequest({ id: 'evt_dupe_1', type: 'checkout.session.completed', data: { object: { subscription: 'sub_123' } } }),
    )
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.deduped).toBe(true)
    expect(subscriptionsRetrieve).not.toHaveBeenCalled()
    expect(store.tables['subscriptions']).toHaveLength(1)
  })
})
