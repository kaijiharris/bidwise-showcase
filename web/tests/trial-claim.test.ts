import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── What this route actually does ───────────────────────────────────────────
// POST /api/trial/claim only imports `@/lib/supabase/server` (createClient) and
// next/server. It:
//   1. createClient() -> supabase
//   2. supabase.auth.getUser() -> 401 if no user
//   3. supabase.rpc('claim_trial_for_user', { p_user_id, p_platform })
//   4. maps the RPC's { status, trial, message } JSONB to an HTTP response.
//
// The interesting trial logic (first-claim vs already-used vs idempotent
// double-claim) lives inside the Postgres function `claim_trial_for_user`, which
// the route trusts. So we mock createClient and back the RPC with an in-memory
// trial table that reproduces that function's contract: the SAME user_id only
// ever gets ONE trial row, and re-claiming returns `already_claimed` with the
// SAME (unextended) dates. That makes idempotency emerge from state instead of
// being hardcoded.
//
// Everything a vi.mock factory needs is built in vi.hoisted (mocks hoist above
// imports).

const TRIAL_DAYS = 7
const DAY_MS = 86_400_000

const h = vi.hoisted(() => {
  return {
    // The currently-authenticated user. null => unauthenticated (401 path).
    currentUser: { value: null as { id: string } | null },
    // In-memory `user_trials` table, keyed by user_id. One row per user, ever.
    trials: new Map<string, Record<string, unknown>>(),
    // Set of user_ids that already have an active subscription (already_subscribed path).
    subscribed: new Set<string>(),
    getUser: vi.fn(),
    rpc: vi.fn(),
  }
})

// Mock the only module the route imports for auth + DB.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: (...a: unknown[]) => h.getUser(...a),
    },
    rpc: (...a: unknown[]) => h.rpc(...a),
  }),
}))

// Import the handler AFTER the mock is registered.
import { POST } from '@/app/api/trial/claim/route'

// ── Fake RPC: faithful re-implementation of claim_trial_for_user's contract ──
// Mirrors the documented JSONB statuses: created | already_claimed |
// already_subscribed | unauthorized. Idempotency lives here: a second call for
// the same user returns the EXISTING row's dates, never new ones.
function fakeClaimTrial(args: {
  p_user_id: string
  p_platform: string
}): { data: unknown; error: null } {
  const { p_user_id, p_platform } = args

  if (!p_user_id) {
    return { data: { status: 'unauthorized', message: 'No user.' }, error: null }
  }

  if (h.subscribed.has(p_user_id)) {
    return {
      data: { status: 'already_subscribed', message: 'Active subscription.' },
      error: null,
    }
  }

  const existing = h.trials.get(p_user_id)
  if (existing) {
    // Already used a trial -> reject the second one, return the UNCHANGED row.
    return {
      data: { status: 'already_claimed', trial: { ...existing } },
      error: null,
    }
  }

  // First-time claim: grant the trial and stamp the dates.
  const startedAt = new Date('2026-06-29T00:00:00.000Z')
  const endsAt = new Date(startedAt.getTime() + TRIAL_DAYS * DAY_MS)
  const row = {
    user_id: p_user_id,
    trial_started_at: startedAt.toISOString(),
    trial_ends_at: endsAt.toISOString(),
    unlocks_used: 0,
    unlocks_limit: 3,
    platform: p_platform,
  }
  h.trials.set(p_user_id, row)
  return { data: { status: 'created', trial: { ...row } }, error: null }
}

function makeRequest(body?: object): Request {
  return new Request('https://example.com/api/trial/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  h.currentUser.value = null
  h.trials.clear()
  h.subscribed.clear()
  h.getUser.mockReset()
  h.rpc.mockReset()

  // Default auth: return whatever currentUser is set to for this test.
  h.getUser.mockImplementation(async () => ({
    data: { user: h.currentUser.value },
    error: null,
  }))
  // Default RPC: route the single RPC the handler calls into the fake DB function.
  h.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'claim_trial_for_user') {
      return fakeClaimTrial(args as { p_user_id: string; p_platform: string })
    }
    throw new Error(`unexpected rpc: ${fn}`)
  })

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
})

describe('POST /api/trial/claim — first-time claim', () => {
  it('grants the trial with start/end dates 7 days apart for a first-time user', async () => {
    h.currentUser.value = { id: 'user_new' }

    const res = await POST(makeRequest({ platform: 'ios' }) as never)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.message).toMatch(/started/i)
    expect(body.trial).toBeTruthy()
    expect(body.trial.user_id).toBe('user_new')
    expect(body.trial.platform).toBe('ios')

    // Dates are set and exactly the trial window apart.
    const started = new Date(body.trial.trial_started_at as string).getTime()
    const ends = new Date(body.trial.trial_ends_at as string).getTime()
    expect(Number.isNaN(started)).toBe(false)
    expect(Number.isNaN(ends)).toBe(false)
    expect(ends - started).toBe(TRIAL_DAYS * DAY_MS)

    // The RPC was called with the authenticated user's id and platform.
    expect(h.rpc).toHaveBeenCalledWith('claim_trial_for_user', {
      p_user_id: 'user_new',
      p_platform: 'ios',
    })
    // Exactly one trial row now exists for this user.
    expect(h.trials.size).toBe(1)
  })

  it('defaults the platform to "ios" when the body omits it', async () => {
    h.currentUser.value = { id: 'user_default_platform' }

    const res = await POST(makeRequest({}) as never)
    expect(res.status).toBe(200)
    expect(h.rpc).toHaveBeenCalledWith('claim_trial_for_user', {
      p_user_id: 'user_default_platform',
      p_platform: 'ios',
    })
  })

  it('tolerates a completely empty (non-JSON) body and still claims', async () => {
    h.currentUser.value = { id: 'user_empty_body' }

    // No body at all -> request.json() throws -> route falls back to default platform.
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(h.rpc).toHaveBeenCalledWith('claim_trial_for_user', {
      p_user_id: 'user_empty_body',
      p_platform: 'ios',
    })
  })
})

describe('POST /api/trial/claim — already used a trial', () => {
  it('rejects a user who already claimed a trial (409, no second trial granted)', async () => {
    h.currentUser.value = { id: 'user_repeat' }

    // First claim succeeds.
    const first = await POST(makeRequest({ platform: 'ios' }) as never)
    expect(first.status).toBe(200)
    expect(h.trials.size).toBe(1)

    // Second claim by the SAME user is rejected.
    const second = await POST(makeRequest({ platform: 'ios' }) as never)
    expect(second.status).toBe(409)
    const body = await second.json()
    expect(body.success).toBe(false)
    expect(body.alreadyClaimed).toBe(true)
    expect(body.message).toMatch(/already claimed/i)

    // Still exactly one trial row — no second trial was created.
    expect(h.trials.size).toBe(1)
  })

  it('rejects with 409 already_subscribed when the user has an active subscription', async () => {
    h.currentUser.value = { id: 'user_sub' }
    h.subscribed.add('user_sub')

    const res = await POST(makeRequest({ platform: 'ios' }) as never)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.alreadySubscribed).toBe(true)
    // No trial row created for an already-subscribed user.
    expect(h.trials.size).toBe(0)
  })
})

describe('POST /api/trial/claim — unauthenticated', () => {
  it('returns 401 when there is no authenticated user', async () => {
    h.currentUser.value = null

    const res = await POST(makeRequest({ platform: 'ios' }) as never)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/authentication required/i)

    // The route must short-circuit before touching the trial RPC.
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.trials.size).toBe(0)
  })
})

describe('POST /api/trial/claim — double-claim is idempotent', () => {
  it('does not extend or reset the trial dates on a repeat claim', async () => {
    h.currentUser.value = { id: 'user_idem' }

    const first = await POST(makeRequest({ platform: 'ios' }) as never)
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    const firstEnds = firstBody.trial.trial_ends_at as string
    const firstStarts = firstBody.trial.trial_started_at as string

    // Re-claim. The 409 already_claimed body echoes the EXISTING trial row.
    const second = await POST(makeRequest({ platform: 'ios' }) as never)
    expect(second.status).toBe(409)
    const secondBody = await second.json()
    expect(secondBody.alreadyClaimed).toBe(true)

    // Same dates as the original — the window was neither extended nor reset.
    expect(secondBody.trial.trial_ends_at).toBe(firstEnds)
    expect(secondBody.trial.trial_started_at).toBe(firstStarts)

    // And still only one underlying trial row.
    expect(h.trials.size).toBe(1)
  })
})

describe('POST /api/trial/claim — RPC failure', () => {
  it('returns 500 with a generic message when the RPC errors', async () => {
    h.currentUser.value = { id: 'user_err' }
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'db exploded' },
    })

    const res = await POST(makeRequest({ platform: 'ios' }) as never)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/unable to claim trial/i)
    // Must not leak the raw DB error to the client.
    expect(JSON.stringify(body)).not.toMatch(/db exploded/)
  })
})
