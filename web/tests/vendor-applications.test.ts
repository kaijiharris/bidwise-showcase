import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── What this route does (read app/api/vendor-applications/route.ts) ───────────
// POST /api/vendor-applications — public vendor waitlist/application intake:
//   • rate limit 5/hour/IP                  -> 429 + Retry-After
//   • honeypot (company_fax) filled         -> 200 { ok: true }, silently discarded
//   • invalid fields                        -> 400 with field-keyed errors
//   • new (email, category)                 -> service-role insert, status pending, 201
//   • resubmission (same email+category)    -> update mutable fields, 200;
//     status reopens to pending ONLY from rejected/waitlisted — never downgrades
//     approved/vetting
//   • confirmation + admin emails fire via lib/email (fail-open, non-fatal)
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
      if (this.store.failWrites) {
        return { error: { code: 'XX000', message: 'insert failed' } }
      }
      ;(this.store.tables[this.name] ??= []).push({ ...row })
      return { error: null }
    }
    update(patch: Row) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture builder `this` for the nested thenable
      const self = this
      return {
        _filters: [] as Array<[string, unknown]>,
        eq(col: string, val: unknown) {
          this._filters.push([col, val])
          return this
        },
        then(resolve: (v: { error: { message: string } | null }) => void) {
          if (self.store.failWrites) {
            resolve({ error: { message: 'update failed' } })
            return
          }
          const rows = self.store.tables[self.name] ?? []
          rows
            .filter(r => this._filters.every(([c, v]) => r[c] === v))
            .forEach(r => Object.assign(r, patch))
          resolve({ error: null })
        },
      }
    }
  }

  class FakeStore {
    tables: Record<string, Row[]> = {}
    failWrites = false
    from(name: string) {
      return new FakeQuery(this, name)
    }
  }

  return {
    FakeStore,
    store: { value: new FakeStore() },
    checkRateLimit: vi.fn(),
    sendEmail: vi.fn(),
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => h.store.value,
  SupabaseClient: class {},
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a),
}))

vi.mock('@/lib/email', () => ({
  sendEmail: (...a: unknown[]) => h.sendEmail(...a),
  escapeHtml: (v: string) => v,
}))

// Import AFTER mocks are registered.
import { POST } from '@/app/api/vendor-applications/route'

const ORIGIN = 'https://app.bidwise.test'

function validBody(): Record<string, unknown> {
  return {
    business_name: 'Peach State Roofing',
    category: 'roofing',
    service_counties: ['dekalb', 'gwinnett'],
    license_number: 'GA-RC-12345',
    is_insured: true,
    years_in_business: 12,
    website: 'https://peachstateroofing.example.com',
    phone: '(404) 555-0123',
    email: 'Owner@PeachState.example.com',
    referral_source: 'Met your team at the DeKalb auction',
    src_code: 'VD-M3XW9P',
    company_fax: '',
  }
}

function makeRequest(body: unknown): Request {
  return new Request(`${ORIGIN}/api/vendor-applications`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
    },
    body: JSON.stringify(body),
  })
}

function apps() {
  return h.store.value.tables['vendor_applications'] ?? []
}

beforeEach(() => {
  h.store.value = new h.FakeStore()
  h.checkRateLimit.mockReset()
  h.checkRateLimit.mockResolvedValue({ ok: true })
  h.sendEmail.mockReset()
  h.sendEmail.mockResolvedValue({ ok: true })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
  process.env.AFF_IP_SALT = 'test-salt'
  process.env.ADMIN_EMAILS = 'admin@bidwiseinvest.com'
})

describe('vendor applications — happy path', () => {
  it('inserts a pending application and returns 201', async () => {
    const res = await POST(makeRequest(validBody()))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(apps()).toHaveLength(1)
    expect(apps()[0]).toMatchObject({
      business_name: 'Peach State Roofing',
      category: 'roofing',
      status: 'pending',
      src_code: 'VD-M3XW9P',
      is_insured: true,
      years_in_business: 12,
    })
  })

  it('lowercases the email server-side and stores a salted ip hash, not the IP', async () => {
    await POST(makeRequest(validBody()))

    const row = apps()[0]
    expect(row.email).toBe('owner@peachstate.example.com')
    expect(typeof row.ip_hash).toBe('string')
    expect(JSON.stringify(row)).not.toContain('203.0.113.9')
  })

  it('sends the applicant confirmation and the admin notification', async () => {
    await POST(makeRequest(validBody()))

    expect(h.sendEmail).toHaveBeenCalledTimes(2)
    const recipients = h.sendEmail.mock.calls.map(
      c => (c[0] as { to: string | string[] }).to,
    )
    expect(recipients).toContainEqual('owner@peachstate.example.com')
    expect(recipients.flat()).toContain('admin@bidwiseinvest.com')
  })

  it('accepts a submission with only the required fields', async () => {
    const body = validBody()
    delete body.license_number
    delete body.website
    delete body.referral_source
    delete body.src_code

    const res = await POST(makeRequest(body))

    expect(res.status).toBe(201)
    expect(apps()).toHaveLength(1)
  })
})

describe('vendor applications — validation (server is authoritative)', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['missing business name', { business_name: '' }, 'business_name'],
    ['business name too short', { business_name: 'A' }, 'business_name'],
    ['unknown category', { category: 'crypto_consulting' }, 'category'],
    ['no service counties', { service_counties: [] }, 'service_counties'],
    ['county outside coverage', { service_counties: ['fulton'] }, 'service_counties'],
    ['bad email', { email: 'not-an-email' }, 'email'],
    ['phone too short', { phone: '555' }, 'phone'],
    ['phone with letters', { phone: '404-CALL-NOW' }, 'phone'],
    ['website not a URL', { website: 'javascript:alert(1)' }, 'website'],
    ['negative years in business', { years_in_business: -3 }, 'years_in_business'],
    ['implausible years in business', { years_in_business: 150 }, 'years_in_business'],
    ['is_insured not boolean', { is_insured: 'yes' }, 'is_insured'],
  ]

  it.each(cases)('%s -> 400 keyed on the field', async (_label, patch, field) => {
    const res = await POST(makeRequest({ ...validBody(), ...patch }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.fields).toHaveProperty(field)
    expect(apps()).toHaveLength(0)
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body with 400', async () => {
    const res = await POST(
      new Request(`${ORIGIN}/api/vendor-applications`, {
        method: 'POST',
        body: 'not json',
      }),
    )

    expect(res.status).toBe(400)
    expect(apps()).toHaveLength(0)
  })
})

describe('vendor applications — anti-abuse', () => {
  it('honeypot filled: returns 200 success but discards the submission', async () => {
    const res = await POST(
      makeRequest({ ...validBody(), company_fax: '555-0100' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(apps()).toHaveLength(0)
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('rate limit exceeded: 429 with Retry-After, nothing persisted', async () => {
    h.checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 1800 })

    const res = await POST(makeRequest(validBody()))

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('1800')
    expect(apps()).toHaveLength(0)
  })
})

describe('vendor applications — resubmission (email+category upsert)', () => {
  function seedExisting(status: string) {
    h.store.value.tables['vendor_applications'] = [
      {
        id: 'app_1',
        business_name: 'Old Name LLC',
        category: 'roofing',
        email: 'owner@peachstate.example.com',
        status,
      },
    ]
  }

  it('updates the existing row instead of inserting a duplicate (200)', async () => {
    seedExisting('pending')

    const res = await POST(makeRequest(validBody()))

    expect(res.status).toBe(200)
    expect(apps()).toHaveLength(1)
    expect(apps()[0].business_name).toBe('Peach State Roofing')
  })

  it('reopens a rejected application back to pending', async () => {
    seedExisting('rejected')

    await POST(makeRequest(validBody()))

    expect(apps()[0].status).toBe('pending')
  })

  it('reopens a waitlisted application back to pending', async () => {
    seedExisting('waitlisted')

    await POST(makeRequest(validBody()))

    expect(apps()[0].status).toBe('pending')
  })

  it('never downgrades an approved application', async () => {
    seedExisting('approved')

    await POST(makeRequest(validBody()))

    expect(apps()[0].status).toBe('approved')
  })

  it('never resets an application already in vetting', async () => {
    seedExisting('vetting')

    await POST(makeRequest(validBody()))

    expect(apps()[0].status).toBe('vetting')
  })

  it('a different category from the same email is a NEW application', async () => {
    seedExisting('pending')

    const res = await POST(
      makeRequest({ ...validBody(), category: 'plumbing' }),
    )

    expect(res.status).toBe(201)
    expect(apps()).toHaveLength(2)
  })
})
