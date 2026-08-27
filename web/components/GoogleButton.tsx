'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  /** Path + query string only, e.g. "/auth/callback?next=/dashboard" */
  callbackPath: string
  label?: string
  /**
   * Optional full class override for the button. When provided it replaces the
   * default styling so pages can render the button in their own design system
   * (e.g. the Blueprint auth surfaces). Purely presentational — the OAuth flow
   * is unchanged. Include your own disabled: utilities when overriding.
   */
  className?: string
}

const DEFAULT_CLASS =
  'w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white text-sm font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed'

export default function GoogleButton({ callbackPath, label = 'Continue with Google', className }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${callbackPath}` },
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={className ?? DEFAULT_CLASS}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
          <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
        </svg>
      )}
      {label}
    </button>
  )
}
