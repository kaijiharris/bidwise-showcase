'use client'

// Global error boundary. Catches errors thrown in the root layout itself, where
// the normal error.tsx cannot render. It must supply its own <html>/<body>.
// Reports to Sentry (if configured) before rendering the fallback.
//
// Because this bypasses app/layout.tsx, globals.css and the font/CSS variables
// are NOT loaded here — so the Blueprint Instrument palette is applied with
// literal hex values inline (it cannot use the bp CSS custom properties or
// utility classes). Restyle only: captureException and reset() are unchanged.

import { useEffect } from 'react'
import { captureException } from '@/lib/observability'

export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0B0E14',
          color: '#F1F5F9',
          fontFamily:
            'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          padding: '1rem',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            textAlign: 'center',
            border: '1px solid rgba(148,163,184,0.30)',
            background: '#0D1320',
            padding: '2rem',
          }}
        >
          <p
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.6875rem',
              fontWeight: 500,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#3B82F6',
              margin: '0 0 0.75rem',
            }}
          >
            System · Unexpected Error
          </p>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px', color: '#F1F5F9' }}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: '#94A3B8',
              lineHeight: 1.6,
              margin: '0 0 24px',
            }}
          >
            We hit an unexpected error while loading the page. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.625rem 1.25rem',
              background: '#3B82F6',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              boxShadow: '0 8px 28px rgba(59,130,246,0.30)',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
