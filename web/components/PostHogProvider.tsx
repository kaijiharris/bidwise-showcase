'use client'

// Initializes PostHog product analytics in the browser, gated on
// NEXT_PUBLIC_POSTHOG_KEY. When the key is absent this renders children
// untouched and never loads the SDK — analytics is strictly optional and never
// blocks the app. posthog.init attaches the instance to window.posthog, which
// lib/observability reads.

import { useEffect } from 'react'
import { POSTHOG_KEY, POSTHOG_HOST, isPostHogEnabled } from '@/lib/observability'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!isPostHogEnabled || typeof window === 'undefined') return
    let cancelled = false
    import('posthog-js')
      .then(({ default: posthog }) => {
        if (cancelled) return
        posthog.init(POSTHOG_KEY as string, {
          api_host: POSTHOG_HOST,
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: false,
          persistence: 'localStorage+cookie',
        })
      })
      .catch(err => {
        console.warn('[posthog] init skipped:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return <>{children}</>
}
