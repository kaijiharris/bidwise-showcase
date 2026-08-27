import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── What this route does ────────────────────────────────────────────────────
// GET /api/trial/status is a thin pass-through:
//   1. createClient() → supabase.auth.getUser()  (401 if no user)
//   2. supabase.rpc('get_user_trial_status', { p_user_id: user.id })
//   3. returns the RPC JSONB verbatim (500 on RPC error)
//
// The trial-status computation itself lives in the Postgres function
// `get_user_trial_status` (deployed to the DB; not in this repo). For a route
// unit test we model that function faithfully in an in-memory fake keyed off
// STORED trial dates, then assert the route returns exactly what the dates
// imply. The 7-day cardless window + JSONB shape come from the route's own
// docstring and migration 012 (user_trials).
//
// We mock ONLY @/lib/supabase/server — the single dependency the route imports.
// Everything a vi.mock factory needs is built inside vi.hoisted (mocks hoist
// above imports).

const UNLOCKS_LIMIT = 5
const DAY_MS = 86_400_000

type TrialRow = {
  user_id: string
  trial_ends_at: string // ISO
  unlocks_used: number
}

const h = vi.hoisted(() => {
  // The user the route's auth.getUser() resolves to for this request.
  const auth = { user: null as { id: string } | null }
  // Stored user_trials rows, keyed by user_id. The fake RPC reads these.
  const trials = new Map<string, { user_id: string; trial_ends_at: string; unlocks_used: number }>()
  // When set, the RPC returns this error instead of a result (drives the 500 path).
  const rpcError = { value: null as { message: string } | null }

  return { auth, trials, rpcError }
})

const UNLOCKS = UNLOCKS_LIMIT

// Faithful port of the DB function get_user_trial_status(p_user_id):
//   - no trial row            → default: inactive, never-started, full limit free
//   - trial_ends_at  > now()  → is_active = true,  is_expired = false
//   - trial_ends_at <= now()  → is_active = false, is_expired = true
// remaining is the unused unlock budget (never negative).
function computeTrialStatus(userId: string) {
  const row = h.trials.get(userId)
  if (!row) {
    return {
      is_active: false,
      trial_ends_at: null,
      unlocks_used: 0,
      unlocks_limit: UNLOCKS,
      remaining: UNLOCKS,
      is_expired: null,
      message: 'No trial started',
    }
  }
  const isActive = new Date(row.trial_ends_at).getTime() > Date.now()
  const remaining = Math.max(UNLOCKS - row.unlocks_used, 0)
  return {
    is_active: isActive,
    trial_ends_at: row.trial_ends_at,
    unlocks_used: row.unlocks_used,
    unlocks_limit: UNLOCKS,
    remaining,
    is_expired: !isActive,
  }
}

// @/lib/supabase/server: the route calls createClient() then auth.getUser()
// and rpc('get_user_trial_status', { p_user_id }). We hand back exactly those.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.auth.user }, error: null }),
    },
    rpc: async (fn: string, args: { p_user_id: string }) => {
      if (fn !== 'get_user_trial_status') {
        throw new Error(`unexpected rpc: ${fn}`)
      }
      if (h.rpcError.value) {
        return { data: null, error: h.rpcError.value }
      }
      return { data: computeTrialStatus(args.p_user_id), error: null }
    },
  }),
}))

// Import AFTER the mock is registered.
import { GET } from '@/app/api/trial/status/route'

// ── Test helpers ────────────────────────────────────────────────────────────
function signInAs(userId: string) {
  h.auth.user = { id: userId }
}

function storeTrial(row: TrialRow) {
  h.trials.set(row.user_id, row)
}

function trialEndingInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString()
}

beforeEach(() => {
  h.auth.user = null
  h.trials.clear()
  h.rpcError.value = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
})

describe('GET /api/trial/status — auth gate', () => {
  it('returns 401 when there is no authenticated user', async () => {
    // No signInAs() → auth.getUser() resolves user = null.
    const res = await GET()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Authentication required' })
  })
})

describe('GET /api/trial/status — status derived from stored trial dates', () => {
  it('active trial: returns is_active=true, not expired, with correct remaining', async () => {
    // Trial ends 3 days from now (inside the 7-day window) and 2 unlocks spent.
    const trialEndsAt = trialEndingInDays(3)
    signInAs('user_active')
    storeTrial({ user_id: 'user_active', trial_ends_at: trialEndsAt, unlocks_used: 2 })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.is_active).toBe(true)
    expect(body.is_expired).toBe(false)
    expect(body.trial_ends_at).toBe(trialEndsAt) // echoes the stored end date
    expect(body.unlocks_used).toBe(2)
    expect(body.unlocks_limit).toBe(UNLOCKS_LIMIT)
    expect(body.remaining).toBe(UNLOCKS_LIMIT - 2) // 3 left of 5
  })

  it('expired trial: returns is_active=false and is_expired=true', async () => {
    // Trial ended 1 day ago → outside the window, fully spent.
    const trialEndsAt = trialEndingInDays(-1)
    signInAs('user_expired')
    storeTrial({ user_id: 'user_expired', trial_ends_at: trialEndsAt, unlocks_used: 5 })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.is_active).toBe(false)
    expect(body.is_expired).toBe(true)
    expect(body.trial_ends_at).toBe(trialEndsAt)
    expect(body.remaining).toBe(0) // 5 of 5 used
  })

  it('no trial: returns the default (inactive, null end date, full unlock budget)', async () => {
    // Authenticated but no user_trials row stored.
    signInAs('user_no_trial')

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.is_active).toBe(false)
    expect(body.trial_ends_at).toBeNull()
    expect(body.is_expired).toBeNull() // distinguishes "never started" from "expired"
    expect(body.unlocks_used).toBe(0)
    expect(body.unlocks_limit).toBe(UNLOCKS_LIMIT)
    expect(body.remaining).toBe(UNLOCKS_LIMIT)
  })

  it('queries the RPC with the authenticated user id (status is scoped per-user)', async () => {
    // Two users with different trials; signed-in user must get THEIR status.
    storeTrial({ user_id: 'user_active', trial_ends_at: trialEndingInDays(5), unlocks_used: 0 })
    storeTrial({ user_id: 'user_expired', trial_ends_at: trialEndingInDays(-2), unlocks_used: 5 })
    signInAs('user_active')

    const res = await GET()
    const body = await res.json()
    expect(body.is_active).toBe(true) // not the other user's expired trial
  })

  it('returns 500 when the RPC reports an error', async () => {
    signInAs('user_active')
    h.rpcError.value = { message: 'connection reset' }

    const res = await GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unable to check trial status' })
  })
})
