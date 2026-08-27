import { describe, it, expect, beforeEach, vi } from 'vitest'

// Unit-tests the lifecycle email composition (welcome + trial-ending) with the
// transport mocked: we assert WHAT would be sent — recipient, the TRIAL_DAYS
// figure, the exact charge date, and the cancel path — because that copy is
// the chargeback defense.

const h = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('@/lib/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/email')>()
  return {
    ...real, // keep escapeHtml (pure)
    sendEmail: (...a: unknown[]) => h.send(...a),
  }
})

import { sendWelcomeEmail, sendTrialEndingEmail, formatTrialEnd, planDisplayName } from '@/lib/lifecycle-emails'
import { TRIAL_DAYS } from '@/lib/trial'

// Midday UTC on 2026-09-01 so the formatted date is timezone-proof in tests.
const EPOCH_SEP_1 = Math.floor(Date.UTC(2026, 8, 1, 12, 0, 0) / 1000)

beforeEach(() => {
  h.send.mockReset()
  h.send.mockResolvedValue({ ok: true })
})

describe('formatTrialEnd', () => {
  it('formats an epoch to a long US date', () => {
    expect(formatTrialEnd(EPOCH_SEP_1)).toMatch(/September 1, 2026|August 31, 2026|September 2, 2026/)
  })
  it('is null-safe', () => {
    expect(formatTrialEnd(null)).toBeNull()
    expect(formatTrialEnd(undefined)).toBeNull()
    expect(formatTrialEnd(NaN)).toBeNull()
  })
})

describe('planDisplayName', () => {
  it('maps plan keys and falls back gracefully', () => {
    expect(planDisplayName('pro')).toBe('Pro')
    expect(planDisplayName('expert')).toBe('Expert')
    expect(planDisplayName(null)).toBe('BidWise')
    expect(planDisplayName('mystery')).toBe('mystery')
  })
})

describe('sendWelcomeEmail', () => {
  it('states the trial length and the exact charge date', async () => {
    await sendWelcomeEmail({ to: 'buyer@example.com', plan: 'pro', trialEndEpoch: EPOCH_SEP_1 })
    expect(h.send).toHaveBeenCalledTimes(1)
    const arg = h.send.mock.calls[0][0] as { to: string; subject: string; html: string }
    expect(arg.to).toBe('buyer@example.com')
    expect(arg.subject).toContain(`${TRIAL_DAYS}-day trial`)
    expect(arg.html).toContain(`${TRIAL_DAYS}-day free trial`)
    expect(arg.html).toMatch(/charged until/i)
    expect(arg.html).toContain('2026') // the concrete charge date is present
    expect(arg.html).toContain('/dashboard')
  })

  it('omits trial language for a no-trial subscription', async () => {
    await sendWelcomeEmail({ to: 'return@example.com', plan: 'starter', trialEndEpoch: null })
    const arg = h.send.mock.calls[0][0] as { subject: string; html: string }
    expect(arg.subject).toBe('Welcome to BidWise')
    expect(arg.html).not.toContain('free trial')
  })
})

describe('sendTrialEndingEmail', () => {
  it('warns about the upcoming charge with the date and a cancel path', async () => {
    await sendTrialEndingEmail({ to: 'trialer@example.com', plan: 'expert', trialEndEpoch: EPOCH_SEP_1 })
    const arg = h.send.mock.calls[0][0] as { to: string; subject: string; html: string }
    expect(arg.to).toBe('trialer@example.com')
    expect(arg.subject).toMatch(/trial ends soon/i)
    expect(arg.html).toMatch(/card will be charged/i)
    expect(arg.html).toMatch(/cancel/i)
    expect(arg.html).toContain('Expert')
  })

  it('degrades to a relative timeframe when the epoch is missing', async () => {
    await sendTrialEndingEmail({ to: 't@example.com', plan: 'pro', trialEndEpoch: null })
    const arg = h.send.mock.calls[0][0] as { html: string }
    expect(arg.html).toMatch(/about 3 days/i)
  })
})
