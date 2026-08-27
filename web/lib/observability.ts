// Safe, env-gated observability facade.
//
// Both Sentry and PostHog are OPTIONAL. If the relevant env var is absent these
// functions are no-ops — the app never crashes for want of a key. This module
// is import-safe from both client and server components: it only touches the
// browser SDKs in the browser, and never throws.
//
// Env vars (all NEXT_PUBLIC_ so they're available client-side):
//   NEXT_PUBLIC_SENTRY_DSN            — enables Sentry error reporting
//   NEXT_PUBLIC_POSTHOG_KEY           — enables PostHog product analytics
//   NEXT_PUBLIC_POSTHOG_HOST          — PostHog ingestion host (defaults to US cloud)
//   NEXT_PUBLIC_GA_MEASUREMENT_ID     — enables Google Analytics 4 (G-XXXXXXX);
//                                       required for Google Ads conversion import

import type { PostHog } from 'posthog-js'

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
export const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

export const isSentryEnabled = Boolean(SENTRY_DSN)
export const isPostHogEnabled = Boolean(POSTHOG_KEY)
export const isGaEnabled = Boolean(GA_MEASUREMENT_ID)

// ── Analytics events ────────────────────────────────────────────────────────
// A closed set of core events keeps naming consistent across the app.
export type AnalyticsEvent =
  | 'sign_up'
  | 'checkout_started'
  | 'checkout_completed'
  | 'subscription_active'
  | 'property_unlocked'
  | 'dashboard_viewed'
  | 'lead_captured'
  | 'calculator_used'

// GA4 gets its "recommended event" names (begin_checkout, purchase,
// generate_lead → enhanced ads reporting + one-click Google Ads conversion
// import). PostHog keeps the internal names so existing dashboards and
// historical data stay continuous. Events not in this map pass through as-is.
const GA_EVENT_NAMES: Partial<Record<AnalyticsEvent, string>> = {
  checkout_started: 'begin_checkout',
  checkout_completed: 'purchase',
  lead_captured: 'generate_lead',
}

let posthogClient: PostHog | null = null

// Lazily attach to the PostHog instance initialized by PostHogProvider. We do
// not initialize here to avoid double-init; the provider owns the lifecycle.
function getPostHog(): PostHog | null {
  if (typeof window === 'undefined' || !isPostHogEnabled) return null
  if (posthogClient) return posthogClient
  const w = window as unknown as { posthog?: PostHog }
  posthogClient = w.posthog ?? null
  return posthogClient
}

// gtag is defined on window by the GoogleAnalytics loader in app/layout.tsx
// (rendered only when isGaEnabled). Same lazy-attach posture as PostHog: this
// facade never loads the SDK itself.
type GtagFn = (
  command: 'event',
  eventName: string,
  params?: Record<string, unknown>,
) => void

function getGtag(): GtagFn | null {
  if (typeof window === 'undefined' || !isGaEnabled) return null
  const w = window as unknown as { gtag?: GtagFn }
  return w.gtag ?? null
}

export function trackEvent(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
): void {
  try {
    const ph = getPostHog()
    if (ph) ph.capture(event, properties)
  } catch {
    // analytics must never break a user flow
  }
  try {
    const ga = getGtag()
    if (ga) ga('event', GA_EVENT_NAMES[event] ?? event, properties)
  } catch {
    // analytics must never break a user flow
  }
}

export function identifyUser(
  userId: string,
  traits?: Record<string, unknown>,
): void {
  try {
    const ph = getPostHog()
    if (ph) ph.identify(userId, traits)
  } catch {
    /* no-op */
  }
}

// ── Error reporting ───────────────────────────────────────────────────────────
// Reports to Sentry when configured. Falls back to console.error so errors are
// never silently dropped in environments without a DSN.
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (isSentryEnabled && typeof window !== 'undefined') {
    // Sentry attaches `Sentry` to window via @sentry/nextjs client init. Use the
    // global so this facade has no hard dependency on the SDK at build time when
    // the DSN (and thus the package usage) is absent.
    try {
      const w = window as unknown as {
        Sentry?: { captureException: (e: unknown, c?: unknown) => void }
      }
      if (w.Sentry) {
        w.Sentry.captureException(error, context ? { extra: context } : undefined)
        return
      }
    } catch {
      /* fall through to console */
    }
  }
  // eslint-disable-next-line no-console
  console.error('[observability] captured error:', error, context ?? '')
}
