'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { CheckCircle, ArrowRight, Search, Layers, Download, Zap } from 'lucide-react'
import ParcelLines from '@/components/blueprint/ParcelLines'

/* ── Blueprint Instrument rollout (cohesion 4) — /onboarding ───────────────────
   Restyle only. The STEPS content, the completed-set toggle, progress math
   (pct / allDone), and every router/Link destination are preserved verbatim —
   markup and classes are the only change. Accents move to the blue instrument
   (emerald stays reserved for dashboard deal scores); the undefined legacy
   `grid-pattern` class is replaced with the ParcelLines survey atmosphere. */

// Only steps that map to features that actually ship today. (Removed the
// address-paste "analysis", PDF reports, and auction alerts — none of those
// exist yet, and advertising them on day one erodes trust.)
const STEPS = [
  {
    id: 'browse',
    icon: <Search size={18} />,
    title: 'Browse scored auction listings',
    desc: 'Open the dashboard to see upcoming county auctions with comps, rehab estimates, and a deal score already calculated for every property.',
    cta: 'Open the Dashboard',
    href: '/dashboard',
    time: '2 min',
  },
  {
    id: 'pipeline',
    icon: <Layers size={18} />,
    title: 'Add a property to your pipeline',
    desc: 'Unlock a listing, then add it to your deal pipeline to track it through watchlist, due diligence, bidding, and pass.',
    cta: 'Go to Dashboard',
    href: '/dashboard',
    time: '1 min',
  },
  {
    id: 'export',
    icon: <Download size={18} />,
    title: 'Export your pipeline to CSV',
    desc: 'On the Expert plan, export the properties in your pipeline to a CSV to share with a partner, lender, or advisor.',
    cta: 'Go to Dashboard',
    href: '/dashboard',
    time: '1 min',
    pro: true,
  },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [completed, setCompleted] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setCompleted(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const pct = Math.round((completed.size / STEPS.length) * 100)
  const allDone = completed.size === STEPS.length

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--bp-base)] px-4 py-16">
      <ParcelLines className="opacity-[0.08]" />
      <div className="relative w-full max-w-2xl">

        {/* Header */}
        <div className="mb-10 text-center">
          <Link href="/" className="inline-block">
            <Image
              src="/logo-wordmark.png"
              alt="BidWise"
              width={1536}
              height={1024}
              className="mx-auto h-12 w-auto object-contain"
            />
          </Link>
          <p className="bp-label mt-6 !text-[var(--bp-accent)]">GETTING STARTED · FIRST SESSION</p>
          <h1 className="mb-2 mt-3 text-3xl font-bold tracking-tight text-[var(--bp-text-1)]">
            {allDone ? 'You\'re all set.' : 'Welcome to BidWise.'}
          </h1>
          <p className="text-[var(--bp-text-2)]">
            {allDone
              ? 'Your trial is active. Go find your next deal.'
              : 'Complete these steps to get the most out of your first session.'}
          </p>
        </div>

        {/* Progress bar */}
        <div className="bp-frame mb-6 p-5">
          <span aria-hidden="true" className="bp-tick bp-tick-tl" />
          <span aria-hidden="true" className="bp-tick bp-tick-tr" />
          <span aria-hidden="true" className="bp-tick bp-tick-bl" />
          <span aria-hidden="true" className="bp-tick bp-tick-br" />
          <div className="mb-3 flex items-center justify-between">
            <span className="bp-label !text-[var(--bp-text-2)]">Getting started</span>
            <span className="bp-label !text-[var(--bp-accent)]">{completed.size} of {STEPS.length} done</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bp-hairline)]">
            <div
              className="h-full rounded-full bg-[var(--bp-accent)] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="mb-8 space-y-3">
          {STEPS.map((step) => {
            const done = completed.has(step.id)
            return (
              <div
                key={step.id}
                className={`bp-frame p-5 transition-all ${done ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-4">
                  {/* Checkbox */}
                  <button
                    onClick={() => toggle(step.id)}
                    aria-pressed={done}
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(59,130,246,0.5)] ${
                      done
                        ? 'border-[var(--bp-accent)] bg-[var(--bp-accent)]'
                        : 'border-[var(--bp-hairline-strong)] hover:border-[var(--bp-accent-line)]'
                    }`}
                  >
                    {done && <CheckCircle size={14} className="text-white" />}
                  </button>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`${done ? 'text-[var(--bp-text-3)]' : 'text-[var(--bp-accent)]'}`}>{step.icon}</span>
                      <h3 className={`text-sm font-bold ${done ? 'text-[var(--bp-text-3)] line-through' : 'text-[var(--bp-text-1)]'}`}>
                        {step.title}
                      </h3>
                      {step.pro && (
                        <span className="bp-label rounded border border-[var(--bp-accent-line)] bg-[var(--bp-accent-soft)] px-1.5 py-0.5 !tracking-widest !text-[var(--bp-accent)]">
                          Pro+
                        </span>
                      )}
                      <span className="ml-auto text-xs text-[var(--bp-text-3)]">{step.time}</span>
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-[var(--bp-text-2)]">{step.desc}</p>
                    {!done && (
                      <Link
                        href={step.href}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--bp-accent)] transition-colors hover:text-[var(--bp-accent-bright)]"
                      >
                        {step.cta} <ArrowRight size={12} />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Bottom CTA */}
        {allDone ? (
          <div className="text-center">
            <button
              onClick={() => router.push('/dashboard')}
              className="group bp-btn-primary px-8 py-4 text-sm font-bold"
            >
              Go to Dashboard <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        ) : (
          <div className="text-center">
            <Link
              href="/dashboard"
              className="text-sm text-[var(--bp-text-2)] transition-colors hover:text-[var(--bp-text-1)]"
            >
              Skip for now — go straight to the dashboard →
            </Link>
          </div>
        )}

        {/* Upgrade nudge */}
        <div className="bp-frame mt-8 flex items-center gap-4 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--bp-accent-line)] bg-[var(--bp-accent-soft)]">
            <Zap size={16} className="text-[var(--bp-accent)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-xs font-bold text-[var(--bp-text-1)]">More unlocks and analytics on Pro &amp; Expert</p>
            <p className="text-xs text-[var(--bp-text-2)]">Higher monthly auction unlocks, advanced deal analytics, and CSV export (Expert) come with the paid plans.</p>
          </div>
          <Link href="/pricing" className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--bp-accent)] transition-colors hover:text-[var(--bp-accent-bright)]">
            See plans →
          </Link>
        </div>
      </div>
    </div>
  )
}
