// mobile/lib/analytics.ts
//
// PostHog product analytics, gated entirely on EXPO_PUBLIC_POSTHOG_KEY. When
// the key is absent every function is a no-op — analytics must never break the
// app or block a build. Keys are read from env and NEVER hardcoded.

import PostHog from 'posthog-react-native'

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

let client: PostHog | null = null

export function initAnalytics(): void {
  if (client || !POSTHOG_KEY) return
  try {
    client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST })
  } catch {
    client = null
  }
}

export function isAnalyticsEnabled(): boolean {
  return client != null
}

// Canonical event names instrumented across the app. Keep this list small and
// intentional so funnels stay clean.
export type AnalyticsEvent =
  | 'app_open'
  | 'sign_up'
  | 'paywall_viewed'
  | 'purchase_completed'
  | 'deal_viewed'

// PostHog only accepts JSON-serializable property values.
type JsonValue = string | number | boolean | null
type EventProperties = Record<string, JsonValue>

export function track(event: AnalyticsEvent, properties?: EventProperties): void {
  if (!client) return
  try {
    client.capture(event, properties)
  } catch {
    // Swallow — analytics is best-effort.
  }
}

export function identifyUser(userId: string, properties?: EventProperties): void {
  if (!client) return
  try {
    client.identify(userId, properties)
  } catch {
    // ignore
  }
}

export function resetAnalytics(): void {
  if (!client) return
  try {
    client.reset()
  } catch {
    // ignore
  }
}
