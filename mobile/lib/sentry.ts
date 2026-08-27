// mobile/lib/sentry.ts
//
// Crash + error reporting via @sentry/react-native, gated on
// EXPO_PUBLIC_SENTRY_DSN. When the DSN is absent Sentry is never initialized
// and every helper degrades to a no-op, so builds and dev runs without a DSN
// behave normally. DSN is read from env and NEVER hardcoded.

import * as Sentry from '@sentry/react-native'

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN

let enabled = false

export function initSentry(): void {
  if (enabled || !SENTRY_DSN) return
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      // Keep tracing modest on mobile to limit overhead; tune later in dashboard.
      tracesSampleRate: 0.2,
      enableAutoSessionTracking: true,
    })
    enabled = true
  } catch {
    enabled = false
  }
}

export function isSentryEnabled(): boolean {
  return enabled
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined)
  } catch {
    // ignore
  }
}

// Re-export the SDK so _layout can wrap the root component with Sentry's
// ErrorBoundary even when the DSN is absent (the boundary still renders its
// fallback; it just won't ship the report).
export { Sentry }
