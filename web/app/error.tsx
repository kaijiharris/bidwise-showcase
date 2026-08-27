'use client'

// Route-segment error boundary for the marketing/app shell. Catches render and
// data errors in any non-dashboard route and shows a friendly recovery UI
// instead of a blank screen. Errors are reported to Sentry (if configured).
//
// Blueprint Instrument rollout (cohesion 4): restyle only — the captureException
// reporting, the reset() retry, and the dashboard link are unchanged.

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { captureException } from '@/lib/observability'
import ParcelLines from '@/components/blueprint/ParcelLines'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error)
  }, [error])

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--bp-base)] px-4">
      <ParcelLines className="opacity-[0.08]" />
      <div className="relative w-full max-w-md">
        <div className="bp-frame p-8 text-center">
          <span aria-hidden="true" className="bp-tick bp-tick-tl" />
          <span aria-hidden="true" className="bp-tick bp-tick-tr" />
          <span aria-hidden="true" className="bp-tick bp-tick-bl" />
          <span aria-hidden="true" className="bp-tick bp-tick-br" />

          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center border border-red-500/25 bg-red-500/10">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <p className="bp-label mb-3 !text-[var(--bp-accent)]">SYSTEM · UNEXPECTED ERROR</p>
          <h1 className="mb-2 text-xl font-bold tracking-tight text-[var(--bp-text-1)]">Something went wrong</h1>
          <p className="mb-8 text-sm leading-relaxed text-[var(--bp-text-2)]">
            We hit an unexpected error. You can try again, or head back to the
            dashboard. If this keeps happening, please contact support.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={reset}
              className="bp-btn-primary px-5 py-2.5 text-sm"
            >
              Try again
            </button>
            <Link
              href="/dashboard"
              className="bp-btn-ghost px-5 py-2.5 text-sm"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
