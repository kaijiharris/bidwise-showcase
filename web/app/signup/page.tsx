'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TRIAL_DAYS, TRIAL_LABEL } from '@/lib/trial'
import Image from 'next/image'
import { ArrowRight, Eye, EyeOff, CheckCircle, Shield, Star, Zap } from 'lucide-react'
import GoogleButton from '@/components/GoogleButton'
import ParcelLines from '@/components/blueprint/ParcelLines'
import { trackEvent } from '@/lib/observability'

/* ── Blueprint Instrument rollout (cohesion 4) — /signup ───────────────────────
   Restyle only. Every Supabase signUp/resend call, the plan/cycle wiring, the
   password-strength meter, the anti-enumeration `emailTaken` detection, the
   `trackEvent`, the cooldown timer, and the "check your inbox" done state are
   preserved verbatim — markup and classes are the only change. `bg-navy-900`
   stays on the root solely to keep the globals.css autofill guard scoped to
   this dark form; the visible base is the Blueprint base via inline style. */

// Blueprint form input — recessed into the sheet, hairline border, blue focus.
const BP_INPUT =
  'w-full rounded-md border border-[var(--bp-hairline-strong)] bg-[var(--bp-base)] px-4 py-3 text-sm text-[var(--bp-text-1)] placeholder:text-[var(--bp-text-3)] transition-colors focus:border-[var(--bp-accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.35)]'

const PLAN_DISPLAY: Record<string, { label: string; price: string; color: string }> = {
  starter: { label: 'Starter', price: '$39/mo', color: 'text-[var(--bp-text-2)]' },
  pro:     { label: 'Pro',     price: '$109/mo', color: 'text-[var(--bp-accent)]' },
  expert:  { label: 'Expert',  price: '$249/mo', color: 'text-[var(--bp-accent-bright)]' },
}

const TRUST_ITEMS = [
  { icon: <Shield size={13} className="text-[var(--bp-accent)]" />, text: 'SSL secured checkout' },
  { icon: <Star size={13} className="text-[var(--bp-accent)]" />,   text: `${TRIAL_LABEL} free trial` },
  { icon: <Zap size={13} className="text-[var(--bp-accent)]" />,    text: 'Cancel anytime' },
]

function SignupForm() {
  const router = useRouter()
  const params = useSearchParams()
  const plan = params.get('plan') || 'pro'
  const cycle = params.get('cycle') || 'monthly'
  const planMeta = PLAN_DISPLAY[plan] || PLAN_DISPLAY.pro

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [emailTaken, setEmailTaken] = useState(false)
  const [done, setDone] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sent' | 'error'>('idle')
  const [resendError, setResendError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function handleResend() {
    if (cooldown > 0 || resending) return
    setResending(true)
    setResendError('')
    const supabase = createClient()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?plan=${plan}&cycle=${cycle}`,
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

  // Inline password strength
  const strength = password.length === 0 ? 0 : password.length < 8 ? 1 : password.length < 12 ? 2 : 3
  const strengthLabel = ['', 'Weak', 'Fair', 'Strong']
  const strengthColor = ['', 'bg-red-500', 'bg-yellow-500', 'bg-emerald-500']

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setEmailTaken(false)
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?plan=${plan}&cycle=${cycle}`,
        data: { plan, billing_cycle: cycle },
      },
    })
    // Explicit error path — e.g. "User already registered" (when email
    // confirmation is OFF), weak password, or rate limit.
    if (error) {
      if (/already registered|already exists/i.test(error.message)) {
        setEmailTaken(true)
      } else {
        setError(error.message)
      }
      setLoading(false)
      return
    }
    // With email confirmation ON, Supabase does NOT error on a duplicate email
    // (anti-enumeration): it returns a user with an empty `identities` array and
    // sends no email. Detect that so someone who already has an account and
    // clicks "free trial" is told to sign in — not shown a fake "check inbox".
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setEmailTaken(true)
      setLoading(false)
      return
    }
    trackEvent('sign_up', { plan, billing_cycle: cycle })
    setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--bp-accent-line)] bg-[var(--bp-accent-soft)]">
          <CheckCircle size={28} className="text-[var(--bp-accent)]" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-[var(--bp-text-1)]">Check your inbox</h2>
        <p className="mb-1 text-sm leading-relaxed text-[var(--bp-text-2)]">
          We sent a confirmation link to
        </p>
        <p className="mb-4 text-sm font-semibold text-[var(--bp-text-1)]">{email}</p>
        <p className="mb-6 text-xs leading-relaxed text-[var(--bp-text-3)]">
          Click the link to activate your account and start your {TRIAL_LABEL} free trial. The link expires in 1 hour. Check your spam folder if it doesn&apos;t arrive within 2 minutes.
        </p>

        <div className="space-y-3 border-t border-[var(--bp-hairline)] pt-5">
          <p className="text-xs text-[var(--bp-text-3)]">Didn&apos;t get the email?</p>
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            className="bp-btn-ghost w-full py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resending
              ? 'Sending…'
              : cooldown > 0
                ? `Resend in ${cooldown}s`
                : 'Resend confirmation email'}
          </button>
          {resendStatus === 'sent' && (
            <p className="text-xs text-[var(--bp-accent-bright)]">
              Email sent. If you still don&apos;t see it, double-check the address and your spam folder.
            </p>
          )}
          {resendStatus === 'error' && (
            <p className="text-xs text-red-300">{resendError || 'Something went wrong. Try again in a minute.'}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Plan pill */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--bp-hairline-strong)] bg-[var(--bp-base)] px-4 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="shrink-0 text-[var(--bp-accent)]" />
          <span className="text-xs font-semibold text-[var(--bp-text-2)]">
            <span className={planMeta.color}>{planMeta.label}</span> — {planMeta.price}
          </span>
        </div>
        <Link href="/pricing" className="text-xs text-[var(--bp-text-3)] underline underline-offset-2 transition-colors hover:text-[var(--bp-text-1)]">
          Change
        </Link>
      </div>

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
        <label className="bp-label mb-2 block !text-[var(--bp-text-2)]">Password</label>
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
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
        {/* Password strength bar */}
        {password.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3].map(i => (
                <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= strength ? strengthColor[strength] : 'bg-[var(--bp-hairline)]'}`} />
              ))}
            </div>
            <span className={`text-xs font-medium ${strength === 3 ? 'text-emerald-400' : strength === 2 ? 'text-yellow-400' : 'text-red-400'}`}>
              {strengthLabel[strength]}
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {emailTaken && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span>
            An account with <span className="font-semibold">{email}</span> already exists, so we didn&apos;t create a new one.
          </span>
          <Link
            href={`/login?email=${encodeURIComponent(email)}`}
            className="inline-flex items-center gap-1 font-semibold text-[var(--bp-accent)] transition-colors hover:text-[var(--bp-accent-bright)]"
          >
            Sign in to your account <ArrowRight size={14} />
          </Link>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="group bp-btn-primary w-full py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Creating account…</>
        ) : (
          <>Start My Free Trial <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" /></>
        )}
      </button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--bp-hairline)]" />
        <span className="bp-label">or</span>
        <div className="h-px flex-1 bg-[var(--bp-hairline)]" />
      </div>

      <GoogleButton
        callbackPath={`/auth/callback?plan=${plan}&cycle=${cycle}`}
        label="Sign up with Google"
        className="bp-btn-ghost w-full py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      />

      <p className="text-center text-xs leading-relaxed text-[var(--bp-text-3)]">
        By signing up you agree to our{' '}
        <Link href="/terms" className="text-[var(--bp-text-2)] transition-colors hover:text-[var(--bp-text-1)]">Terms</Link>
        {' '}&{' '}
        <Link href="/privacy" className="text-[var(--bp-text-2)] transition-colors hover:text-[var(--bp-text-1)]">Privacy Policy</Link>.
        {' '}Your card won&apos;t be charged until day {TRIAL_DAYS}.
      </p>

      {/* Trust row */}
      <div className="flex items-center justify-center gap-4 pt-1">
        {TRUST_ITEMS.map((t, i) => (
          <span key={i} className="flex items-center gap-1.5 text-xs text-[var(--bp-text-3)]">
            {t.icon} {t.text}
          </span>
        ))}
      </div>
    </form>
  )
}

export default function SignupPage() {
  return (
    <div className="flex min-h-screen bg-navy-900" style={{ backgroundColor: 'var(--bp-base)' }}>
      {/* ── LEFT — social proof panel ──────────────────────────────────────── */}
      <div className="relative hidden w-[44%] shrink-0 flex-col justify-between overflow-hidden border-r border-[var(--bp-hairline)] bg-[var(--bp-panel-deep)] p-12 lg:flex">
        <ParcelLines className="opacity-[0.18]" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-[420px] w-[420px] rounded-full"
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

        <div className="relative space-y-5">
          <p className="bp-label !text-[var(--bp-accent)]">FIELD BRIEF</p>
          <h2 className="text-2xl font-bold leading-snug tracking-tight text-[var(--bp-text-1)]">
            Research smarter at auction.
          </h2>

          {/* Product facts only — no testimonials. Every claim below restates
              facts substantiated elsewhere in the product (county coverage,
              scoring pipeline, Stripe trial via lib/trial.ts). Real customer quotes can
              replace these post-launch, once they exist. */}
          {[
            { title: 'Every listing scored before auction day', detail: 'Comps, rehab estimates, and a deal score on every parcel in DeKalb, Gwinnett, Cobb, and Clayton — the research is done before you open the county list.' },
            { title: 'Back-tax exposure on every parcel', detail: 'Opening bid and back-tax depth surfaced before you commit a dollar.' },
          ].map((t, i) => (
            <div key={i} className="bp-frame p-5">
              <div className="mb-2 text-sm font-bold text-[var(--bp-text-1)]">{t.title}</div>
              <p className="text-sm leading-relaxed text-[var(--bp-text-2)]">{t.detail}</p>
            </div>
          ))}
        </div>

        <div className="relative text-xs text-[var(--bp-text-3)]">
          Your data is encrypted and never sold. Analysis powered by public records and compliant data sources.
        </div>
      </div>

      {/* ── RIGHT — form panel ─────────────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[400px]">
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
            <p className="bp-label mb-4 !text-[var(--bp-accent)]">NEW MEMBERSHIP · FREE TRIAL</p>
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--bp-text-1)]">Start your free trial</h1>
            <p className="text-sm text-[var(--bp-text-2)]">{TRIAL_DAYS} days free. No charge until you&apos;re ready.</p>
          </div>

          <div className="bp-frame p-6 sm:p-7">
            <span aria-hidden="true" className="bp-tick bp-tick-tl" />
            <span aria-hidden="true" className="bp-tick bp-tick-tr" />
            <span aria-hidden="true" className="bp-tick bp-tick-bl" />
            <span aria-hidden="true" className="bp-tick bp-tick-br" />
            <Suspense>
              <SignupForm />
            </Suspense>
          </div>

          <p className="mt-8 text-center text-sm text-[var(--bp-text-2)]">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-[var(--bp-accent)] transition-colors hover:text-[var(--bp-accent-bright)]">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
