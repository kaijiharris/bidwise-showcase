'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { ArrowRight, Eye, EyeOff, CheckCircle, BarChart3, Target, TrendingUp } from 'lucide-react'
import GoogleButton from '@/components/GoogleButton'
import ParcelLines from '@/components/blueprint/ParcelLines'
import { sanitizeNext } from '@/lib/sanitize-next'
import { TRIAL_DAYS, TRIAL_LABEL } from '@/lib/trial'

/* ── Blueprint Instrument rollout (cohesion 4) — /login ────────────────────────
   Restyle only: the survey-sheet auth surface mirrors the merged homepage and
   /pricing (bp tokens, mono labels, hairline framing, one form "sheet"). Every
   Supabase call, form-state hook, validation branch, resend/cooldown flow, and
   redirect is preserved verbatim — markup and classes are the only change. The
   root keeps `bg-navy-900` purely so the globals.css `.bg-navy-900 input:-webkit-
   autofill` guard still scopes autofill on this dark form; the visible base is
   the Blueprint base via the inline style. */

// Blueprint form input — recessed into the sheet, hairline border, blue focus.
const BP_INPUT =
  'w-full rounded-md border border-[var(--bp-hairline-strong)] bg-[var(--bp-base)] px-4 py-3 text-sm text-[var(--bp-text-1)] placeholder:text-[var(--bp-text-3)] transition-colors focus:border-[var(--bp-accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.35)]'

// ── Left panel value props ────────────────────────────────────────────────────
const VALUE_POINTS = [
  { icon: <BarChart3 size={16} className="text-[var(--bp-accent)]" />, text: 'Investor-grade deal analysis in under 5 minutes' },
  { icon: <Target size={16} className="text-[var(--bp-accent)]" />, text: 'Objective deal scoring — no gut feelings required' },
  { icon: <TrendingUp size={16} className="text-[var(--bp-accent)]" />, text: 'Know your max bid before the auction starts' },
]

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  // Validate the `?next=` target so a crafted /login?next=... link cannot open
  // a redirect off-origin after sign-in. Falls back to the dashboard.
  const next = sanitizeNext(params.get('next')) || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resending, setResending] = useState(false)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sent' | 'error'>('idle')
  const [resendError, setResendError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  const needsConfirmation = error.toLowerCase().includes('not confirmed')

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function handleResend() {
    if (cooldown > 0 || resending || !email) return
    setResending(true)
    setResendError('')
    const supabase = createClient()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    if (error) {
      setResendStatus('error')
      setResendError(error.message)
    } else {
      setResendStatus('sent')
      setCooldown(60)
    }
    setResending(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    router.push(next)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <label className="bp-label mb-2 block !text-[var(--bp-text-2)]">Email address</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={BP_INPUT}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="bp-label !text-[var(--bp-text-2)]">Password</label>
          <Link href="/forgot-password" className="text-xs font-medium text-[var(--bp-accent)] transition-colors hover:text-[var(--bp-accent-bright)]">
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
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

      {error && !needsConfirmation && (
        <div className="flex items-start gap-2.5 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {needsConfirmation && (
        <div className="space-y-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <div className="flex items-start gap-2.5 text-amber-200">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>Your email isn&apos;t confirmed yet. Check your inbox for the confirmation link.</span>
          </div>
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            className="bp-btn-ghost w-full py-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resending
              ? 'Sending…'
              : cooldown > 0
                ? `Resend in ${cooldown}s`
                : 'Resend confirmation email'}
          </button>
          {resendStatus === 'sent' && (
            <p className="text-xs text-[var(--bp-accent-bright)]">Email sent — check your inbox and spam folder.</p>
          )}
          {resendStatus === 'error' && (
            <p className="text-xs text-red-300">{resendError || 'Something went wrong. Try again in a minute.'}</p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="group bp-btn-primary w-full py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Signing in…</>
        ) : (
          <>Sign In <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" /></>
        )}
      </button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--bp-hairline)]" />
        <span className="bp-label">or</span>
        <div className="h-px flex-1 bg-[var(--bp-hairline)]" />
      </div>

      <GoogleButton
        callbackPath="/auth/callback?next=/dashboard"
        className="bp-btn-ghost w-full py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      />

      <p className="text-center text-sm text-[var(--bp-text-2)]">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-semibold text-[var(--bp-accent)] transition-colors hover:text-[var(--bp-accent-bright)]">
          Start your free trial
        </Link>
      </p>

      <p className="text-center text-xs text-[var(--bp-text-3)]">
        <Link href="/terms" className="transition-colors hover:text-[var(--bp-text-2)]">Terms of Service</Link>
        {' '}·{' '}
        <Link href="/privacy" className="transition-colors hover:text-[var(--bp-text-2)]">Privacy Policy</Link>
      </p>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen bg-navy-900" style={{ backgroundColor: 'var(--bp-base)' }}>
      {/* ── LEFT — brand panel ─────────────────────────────────────────────── */}
      <div className="relative hidden w-[44%] shrink-0 flex-col justify-between overflow-hidden border-r border-[var(--bp-hairline)] bg-[var(--bp-panel-deep)] p-12 lg:flex">
        <ParcelLines className="opacity-[0.18]" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-28 -top-28 h-[440px] w-[440px] rounded-full"
          style={{ background: 'radial-gradient(circle, var(--bp-accent-soft) 0%, transparent 70%)' }}
        />

        <div className="relative">
          <Link href="/" className="w-fit">
            <Image
              src="/logo-wordmark.png"
              alt="BidWise"
              width={1536}
              height={1024}
              className="-ml-2 h-14 w-auto object-contain"
              priority
            />
          </Link>
        </div>

        <div className="relative">
          <p className="bp-label mb-6 !text-[var(--bp-accent)]">FIELD NOTE</p>
          <blockquote className="mb-8 text-2xl font-bold leading-snug tracking-tight text-[var(--bp-text-1)]">
            &quot;Know your number before you raise a paddle.&quot;
          </blockquote>
          <ul className="space-y-4">
            {VALUE_POINTS.map((p, i) => (
              <li key={i} className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--bp-hairline-strong)] bg-[var(--bp-base)]">
                  {p.icon}
                </div>
                <span className="text-sm text-[var(--bp-text-2)]">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="bp-frame flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-[var(--bp-accent-line)] bg-[var(--bp-accent-soft)]">
              <CheckCircle size={18} className="text-[var(--bp-accent)]" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--bp-text-1)]">{TRIAL_LABEL} free trial active</p>
              <p className="text-xs text-[var(--bp-text-3)]">No charge until day {TRIAL_DAYS}. Cancel anytime.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT — form panel ─────────────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="mb-8 flex justify-center lg:hidden">
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

          <div className="mb-8">
            <p className="bp-label mb-4 !text-[var(--bp-accent)]">MEMBER ACCESS · SIGN IN</p>
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--bp-text-1)]">Welcome back</h1>
            <p className="text-sm text-[var(--bp-text-2)]">Sign in to your investor membership</p>
          </div>

          <div className="bp-frame p-6 sm:p-7">
            <span aria-hidden="true" className="bp-tick bp-tick-tl" />
            <span aria-hidden="true" className="bp-tick bp-tick-tr" />
            <span aria-hidden="true" className="bp-tick bp-tick-bl" />
            <span aria-hidden="true" className="bp-tick bp-tick-br" />
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
