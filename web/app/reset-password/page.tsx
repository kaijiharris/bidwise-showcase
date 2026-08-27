'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, Eye, EyeOff, CheckCircle } from 'lucide-react'
import ParcelLines from '@/components/blueprint/ParcelLines'

/* ── Blueprint Instrument rollout (cohesion 4) — /reset-password ───────────────
   Restyle only. The password policy (MIN length, COMMON_PASSWORDS, validate-
   Password), the session/getSession + onAuthStateChange gating, the updateUser
   call, and the done/redirect flow are preserved verbatim — markup and classes
   are the only change. `bg-navy-900` stays on the root solely to keep the
   globals.css autofill guard scoped; the visible base is Blueprint base inline. */

// Blueprint form input — recessed into the sheet, hairline border, blue focus.
const BP_INPUT =
  'w-full rounded-md border border-[var(--bp-hairline-strong)] bg-[var(--bp-base)] px-4 py-3 text-sm text-[var(--bp-text-1)] placeholder:text-[var(--bp-text-3)] transition-colors focus:border-[var(--bp-accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.35)]'

// Defense in depth alongside the Supabase Auth dashboard policy.
// Server-side enforcement still happens at Supabase; this just avoids a
// round-trip for trivially weak inputs and surfaces clearer guidance.
const MIN_PASSWORD_LENGTH = 12
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password1!', 'passw0rd', 'passw0rd!',
  'welcome1', 'welcome1!', 'welcome123', 'qwerty123', 'qwerty123!',
  'letmein1', 'letmein1!', 'admin1234', 'admin1234!', 'iloveyou1',
  'monkey123', 'football1', 'baseball1', 'dragon123', 'sunshine1',
  '123456789012', 'abcdef123456', 'qwertyuiop12', 'zaq12wsxcde3',
  'changeme123', 'changeme1!',
])

function validatePassword(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (!/[0-9]/.test(pw)) {
    return 'Password must include at least one number.'
  }
  if (!/[^A-Za-z0-9]/.test(pw)) {
    return 'Password must include at least one symbol (e.g. ! @ # $).'
  }
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    return 'That password is too common. Choose something less guessable.'
  }
  return null
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(Boolean(data.session))
      setCheckingSession(false)
      if (!data.session) {
        setError('This reset link is expired or has already been used. Request a new reset link.')
      }
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setSessionReady(true)
        setCheckingSession(false)
        setError('')
      }
    })

    return () => {
      subscription.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!sessionReady) {
      setError('Open the latest reset link from your email before choosing a new password.')
      return
    }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    const pwError = validatePassword(password)
    if (pwError) { setError(pwError); return }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false); return }
    setDone(true)
    setTimeout(() => router.push('/dashboard'), 2500)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-900 px-6 py-16" style={{ backgroundColor: 'var(--bp-base)' }}>
      <ParcelLines className="opacity-[0.08]" />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image
              src="/logo-wordmark.png"
              alt="BidWise"
              width={1536}
              height={1024}
              className="h-12 w-auto object-contain"
            />
          </Link>
        </div>

        {done ? (
          <div className="bp-frame p-7 text-center sm:p-8">
            <span aria-hidden="true" className="bp-tick bp-tick-tl" />
            <span aria-hidden="true" className="bp-tick bp-tick-tr" />
            <span aria-hidden="true" className="bp-tick bp-tick-bl" />
            <span aria-hidden="true" className="bp-tick bp-tick-br" />
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--bp-accent-line)] bg-[var(--bp-accent-soft)]">
              <CheckCircle size={26} className="text-[var(--bp-accent)]" />
            </div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight text-[var(--bp-text-1)]">Password updated</h1>
            <p className="text-sm text-[var(--bp-text-2)]">Redirecting you to the dashboard…</p>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <p className="bp-label mb-4 !text-[var(--bp-accent)]">MEMBER ACCESS · NEW PASSWORD</p>
              <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--bp-text-1)]">Set a new password</h1>
              <p className="text-sm text-[var(--bp-text-2)]">Choose a strong password for your account.</p>
              {checkingSession && (
                <p className="mt-2 text-xs text-[var(--bp-text-3)]">Checking your reset link…</p>
              )}
            </div>

            <div className="bp-frame p-6 sm:p-7">
              <span aria-hidden="true" className="bp-tick bp-tick-tl" />
              <span aria-hidden="true" className="bp-tick bp-tick-tr" />
              <span aria-hidden="true" className="bp-tick bp-tick-bl" />
              <span aria-hidden="true" className="bp-tick bp-tick-br" />
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div>
                  <label className="bp-label mb-2 block !text-[var(--bp-text-2)]">New password</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 12 chars, 1 number, 1 symbol"
                      className={`${BP_INPUT} pr-11`}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--bp-text-3)] transition-colors hover:text-[var(--bp-text-1)]"
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="bp-label mb-2 block !text-[var(--bp-text-2)]">Confirm password</label>
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    className={BP_INPUT}
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    <span className="mt-0.5 shrink-0">⚠</span>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || checkingSession || !sessionReady}
                  className="group bp-btn-primary w-full py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Updating…</>
                  ) : (
                    <>Update password <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" /></>
                  )}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
