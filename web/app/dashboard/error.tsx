'use client'

// Dashboard error boundary. Keeps a failed dashboard render from blanking the
// whole app and gives the user a clear recovery path. Reports to Sentry.
//
// Blueprint Instrument rollout (cohesion 5): restyle only — the captureException
// reporting, the reset() retry, and the /pricing link are unchanged. This is the
// dashboard chrome (a full-screen error shell with no data), so it adopts the
// same survey-sheet frame as the marketing/app error boundary; no data widget,
// deal-score, or status color is touched.

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { captureException } from '@/lib/observability'
import ParcelLines from '@/components/blueprint/ParcelLines'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error, { area: 'dashboard' })
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
          <p className="bp-label mb-3 !text-[var(--bp-accent)]">DASHBOARD · DISPLAY ERROR</p>
          <h1 className="mb-2 text-xl font-bold tracking-tight text-[var(--bp-text-1)]">
            The dashboard hit a snag
          </h1>
          <p className="mb-8 text-sm leading-relaxed text-[var(--bp-text-2)]">
            We couldn&apos;t finish loading your dashboard. Your data is safe — this
            is just a display error. Try reloading the view.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={reset}
              className="bp-btn-primary px-5 py-2.5 text-sm"
            >
              Reload
            </button>
            <Link
              href="/pricing"
              className="bp-btn-ghost px-5 py-2.5 text-sm"
            >
              View plans
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
