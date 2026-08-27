// trackEvent's Google Analytics fan-out (lib/observability). These tests pin
// the ads-tracking contract:
//   1. GA is strictly optional — no env var, no gtag calls, never a throw.
//   2. Internal event names translate to GA4 recommended names at the gtag
//      boundary ONLY (checkout_started→begin_checkout, checkout_completed→
//      purchase, lead_captured→generate_lead); PostHog keeps internal names
//      so historical PostHog data stays continuous.
//   3. A throwing analytics SDK never breaks a user flow.
//
// The module reads env at import time, so every test re-imports it fresh via
// vi.resetModules after stubbing env/window (vitest runs in node — `window`
// is synthesized per test and removed after).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type TestWindow = {
  gtag?: (...args: unknown[]) => void
  posthog?: { capture: (...args: unknown[]) => void }
}

const globalRef = globalThis as unknown as { window?: TestWindow }

async function importObservability() {
  vi.resetModules()
  return await import('@/lib/observability')
}

beforeEach(() => {
  vi.unstubAllEnvs()
  delete globalRef.window
})

afterEach(() => {
  vi.unstubAllEnvs()
  delete globalRef.window
})

describe('isGaEnabled', () => {
  it('is false without NEXT_PUBLIC_GA_MEASUREMENT_ID', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '')
    const { isGaEnabled } = await importObservability()
    expect(isGaEnabled).toBe(false)
  })

  it('is true when the measurement id is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST123')
    const { isGaEnabled, GA_MEASUREMENT_ID } = await importObservability()
    expect(isGaEnabled).toBe(true)
    expect(GA_MEASUREMENT_ID).toBe('G-TEST123')
  })
})

describe('trackEvent → gtag fan-out', () => {
  it('never throws server-side (no window)', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST123')
    const { trackEvent } = await importObservability()
    expect(() => trackEvent('sign_up')).not.toThrow()
  })

  it('does NOT call gtag when GA is disabled, even if window.gtag exists', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '')
    const gtag = vi.fn()
    globalRef.window = { gtag }
    const { trackEvent } = await importObservability()
    trackEvent('checkout_started', { plan: 'pro' })
    expect(gtag).not.toHaveBeenCalled()
  })

  it('translates funnel events to GA4 recommended names', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST123')
    const gtag = vi.fn()
    globalRef.window = { gtag }
    const { trackEvent } = await importObservability()

    trackEvent('checkout_started', { plan: 'pro', cycle: 'annual' })
    trackEvent('checkout_completed', { plan: 'pro' })
    trackEvent('lead_captured', { county: 'gwinnett' })

    expect(gtag).toHaveBeenNthCalledWith(1, 'event', 'begin_checkout', {
      plan: 'pro',
      cycle: 'annual',
    })
    expect(gtag).toHaveBeenNthCalledWith(2, 'event', 'purchase', { plan: 'pro' })
    expect(gtag).toHaveBeenNthCalledWith(3, 'event', 'generate_lead', {
      county: 'gwinnett',
    })
  })

  it('passes unmapped events through with their internal names', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST123')
    const gtag = vi.fn()
    globalRef.window = { gtag }
    const { trackEvent } = await importObservability()

    trackEvent('sign_up', { plan: 'starter' })
    trackEvent('calculator_used')
    trackEvent('dashboard_viewed', { plan: 'pro' })

    expect(gtag).toHaveBeenNthCalledWith(1, 'event', 'sign_up', { plan: 'starter' })
    expect(gtag).toHaveBeenNthCalledWith(2, 'event', 'calculator_used', undefined)
    expect(gtag).toHaveBeenNthCalledWith(3, 'event', 'dashboard_viewed', { plan: 'pro' })
  })

  it('keeps INTERNAL names for PostHog while gtag gets GA4 names', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST123')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    const gtag = vi.fn()
    const capture = vi.fn()
    globalRef.window = { gtag, posthog: { capture } }
    const { trackEvent } = await importObservability()

    trackEvent('checkout_started', { plan: 'expert' })

    expect(capture).toHaveBeenCalledWith('checkout_started', { plan: 'expert' })
    expect(gtag).toHaveBeenCalledWith('event', 'begin_checkout', { plan: 'expert' })
  })

  it('swallows a throwing gtag — analytics never breaks a user flow', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST123')
    globalRef.window = {
      gtag: () => {
        throw new Error('gtag exploded')
      },
    }
    const { trackEvent } = await importObservability()
    expect(() => trackEvent('lead_captured', { county: 'clayton' })).not.toThrow()
  })

  it('still reaches PostHog when gtag is absent from window', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST123')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    const capture = vi.fn()
    globalRef.window = { posthog: { capture } }
    const { trackEvent } = await importObservability()
    trackEvent('property_unlocked', { county: 'dekalb' })
    expect(capture).toHaveBeenCalledWith('property_unlocked', { county: 'dekalb' })
  })
})
