// Browser Sentry initialization (Next.js App Router client instrumentation).
// Gated on NEXT_PUBLIC_SENTRY_DSN. Exposes the SDK on window.Sentry so the
// lib/observability captureException facade can report without a hard build-time
// dependency. No-op when the DSN is absent.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  import('@sentry/nextjs')
    .then(Sentry => {
      Sentry.init({
        dsn,
        tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
      })
      ;(window as unknown as { Sentry?: unknown }).Sentry = Sentry
    })
    .catch(err => {
      console.warn('[sentry] client init skipped:', err)
    })
}

// Required export for Next.js router-transition instrumentation. Safe to be a
// no-op resolver when Sentry isn't loaded.
export const onRouterTransitionStart = (
  ...args: unknown[]
): void => {
  const w = window as unknown as {
    Sentry?: { captureRouterTransitionStart?: (...a: unknown[]) => void }
  }
  w.Sentry?.captureRouterTransitionStart?.(...args)
}
