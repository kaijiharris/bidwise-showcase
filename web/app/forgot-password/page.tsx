'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, ArrowLeft, BarChart3, Target, TrendingUp, CheckCircle, Mail } from 'lucide-react'
import ParcelLines from '@/components/blueprint/ParcelLines'
import { TRIAL_DAYS, TRIAL_LABEL } from '@/lib/trial'

/* ── Blueprint Instrument rollout (cohesion 4) — /forgot-password ──────────────
   Restyle only. The `?error=` callback read, the normalizedEmail + configured-
   origin redirect logic, the resetPasswordForEmail call, and the sent/error
   states are preserved verbatim — markup and classes are the only change.
   `bg-navy-900` stays on the root solely to keep the globals.css autofill guard
   scoped to this dark form; the visible base is the Blueprint base inline. */

// Blueprint form input — recessed into the sheet, hairline border, blue focus.
const BP_INPUT =
  'w-full rounded-md border border-[var(--bp-hairline-strong)] bg-[var(--bp-base)] px-4 py-3 text-sm text-[var(--bp-text-1)] placeholder:text-[var(--bp-text-3)] transition-colors focus:border-[var(--bp-accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.35)]'

const VALUE_POINTS = [
  { icon: <BarChart3 size={16} className="text-[var(--bp-accent)]" />, text: 'Investor-grade deal analysis in under 5 minutes' },
  { icon: <Target size={16} className="text-[var(--bp-accent)]" />, text: 'Objective deal scoring — no gut feelings required' },
  { icon: <TrendingUp size={16} className="text-[var(--bp-accent)]" />, text: 'Know your max bid before the auction starts' },
]

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const callbackError = new URLSearchParams(window.location.search).get('error')
    if (callbackError) setError(callbackError)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const normalizedEmail = email.trim().toLowerCase()
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
    const redirectOrigin = configuredOrigin || window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${redirectOrigin}/auth/callback?next=/reset-password`,
    })
    if (error) { setError(error.message); setLoading(false); return }
    setEmail(normalizedEmail)
    setSent(true)
    setLoading(false)
  }

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

          {sent ? (
            <div className="bp-frame p-7 text-center sm:p-8">
              <span aria-hidden="true" className="bp-tick bp-tick-tl" />
              <span aria-hidden="true" className="bp-tick bp-tick-tr" />
              <span aria-hidden="true" className="bp-tick bp-tick-bl" />
              <span aria-hidden="true" className="bp-tick bp-tick-br" />
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--bp-accent-line)] bg-[var(--bp-accent-soft)]">
                <Mail size={24} className="text-[var(--bp-accent)]" />
              </div>
              <h1 className="mb-2 text-2xl font-bold tracking-tight text-[var(--bp-text-1)]">Check your email</h1>
              <p className="mb-8 text-sm leading-relaxed text-[var(--bp-text-2)]">
                We sent a password reset link to <span className="font-semibold text-[var(--bp-text-1)]">{email}</span>.
                Check your spam folder if it doesn&apos;t arrive within a minute.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 text-sm text-[var(--bp-accent)] transition-colors hover:text-[var(--bp-accent-bright)]"
              >
                <ArrowLeft size={14} /> Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <p className="bp-label mb-4 !text-[var(--bp-accent)]">MEMBER ACCESS · RESET</p>
                <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--bp-text-1)]">Reset your password</h1>
                <p className="text-sm text-[var(--bp-text-2)]">Enter your email and we&apos;ll send you a reset link.</p>
              </div>

              <div className="bp-frame p-6 sm:p-7">
                <span aria-hidden="true" className="bp-tick bp-tick-tl" />
                <span aria-hidden="true" className="bp-tick bp-tick-tr" />
                <span aria-hidden="true" className="bp-tick bp-tick-bl" />
                <span aria-hidden="true" className="bp-tick bp-tick-br" />
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

                  {error && (
                    <div className="flex items-start gap-2.5 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                      <span className="mt-0.5 shrink-0">⚠</span>
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="group bp-btn-primary w-full py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? (
                      <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Sending…</>
                    ) : (
                      <>Send reset link <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" /></>
                    )}
                  </button>

                  <p className="text-center text-sm text-[var(--bp-text-2)]">
                    Remember your password?{' '}
                    <Link href="/login" className="font-semibold text-[var(--bp-accent)] transition-colors hover:text-[var(--bp-accent-bright)]">
                      Sign in
                    </Link>
                  </p>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
