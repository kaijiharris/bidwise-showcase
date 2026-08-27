// Server + edge Sentry initialization (Next.js App Router instrumentation hook).
// Gated on NEXT_PUBLIC_SENTRY_DSN — when the DSN is absent this is a no-op and
// the app runs normally without Sentry. Dynamic import keeps the SDK out of the
// hot path when disabled.

export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return

  try {
    const Sentry = await import('@sentry/nextjs')
    if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
      Sentry.init({
        dsn,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
        enabled: true,
      })
    }
  } catch (err) {
    // SDK not installed or failed to init — never block server boot for telemetry.
    console.warn('[sentry] server init skipped:', err)
  }
}

// Forward server-side React render errors to Sentry when available.
export async function onRequestError(
  ...args: unknown[]
): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return
  try {
    const Sentry = await import('@sentry/nextjs')
    const captureRequestError = (
      Sentry as unknown as { captureRequestError?: (...a: unknown[]) => void }
    ).captureRequestError
    if (captureRequestError) captureRequestError(...args)
  } catch {
    /* no-op */
  }
}
