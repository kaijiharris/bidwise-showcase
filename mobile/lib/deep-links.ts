// mobile/lib/deep-links.ts
//
// Handles Supabase auth deep links on native. Password-reset and email-
// verification emails redirect to `bidwise://reset-password` (or the auth
// callback) with the session tokens in the URL fragment/query. Because the
// Supabase client is created with `detectSessionInUrl: false` (correct for
// native), we parse the incoming URL ourselves and call setSession so the
// reset-password screen sees an authenticated session.

import { useEffect } from 'react'
import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { supabase } from './supabase'

interface AuthTokens {
  access_token?: string
  refresh_token?: string
  type?: string
  error_description?: string
}

// Supabase puts tokens after either `#` (implicit) or `?` (PKCE/code). Parse
// both and also support the `code` exchange flow.
function parseAuthParams(url: string): { tokens: AuthTokens; code: string | null } {
  const tokens: AuthTokens = {}
  let code: string | null = null

  const hashIndex = url.indexOf('#')
  const fragment = hashIndex >= 0 ? url.slice(hashIndex + 1) : ''
  const queryIndex = url.indexOf('?')
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined) : ''

  for (const segment of [query, fragment]) {
    if (!segment) continue
    const params = new URLSearchParams(segment)
    if (params.get('access_token')) tokens.access_token = params.get('access_token') ?? undefined
    if (params.get('refresh_token')) tokens.refresh_token = params.get('refresh_token') ?? undefined
    if (params.get('type')) tokens.type = params.get('type') ?? undefined
    if (params.get('error_description'))
      tokens.error_description = params.get('error_description') ?? undefined
    if (params.get('code')) code = params.get('code')
  }

  return { tokens, code }
}

async function handleUrl(url: string, onRecovery: () => void): Promise<void> {
  if (!url) return
  const { tokens, code } = parseAuthParams(url)

  try {
    if (tokens.access_token && tokens.refresh_token) {
      await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      })
    } else if (code) {
      await supabase.auth.exchangeCodeForSession(code)
    } else {
      return
    }
  } catch {
    return
  }

  // Password-recovery links should land the user on the new-password screen.
  if (tokens.type === 'recovery' || url.includes('reset-password')) {
    onRecovery()
  }
}

/**
 * Mounts a deep-link listener that establishes a Supabase session from an
 * incoming auth URL and routes recovery links to the reset-password screen.
 * Call once near the root (inside the router tree).
 */
export function useAuthDeepLinks(): void {
  const router = useRouter()

  useEffect(() => {
    const goToReset = () => router.replace('/(auth)/reset-password')

    // Cold start: the app was opened from a link.
    Linking.getInitialURL()
      .then((url) => {
        if (url) void handleUrl(url, goToReset)
      })
      .catch(() => {})

    // Warm start: a link arrived while the app was running.
    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url, goToReset)
    })

    return () => sub.remove()
  }, [router])
}
