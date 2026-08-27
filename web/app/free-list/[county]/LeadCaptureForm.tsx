'use client'

import { useState } from 'react'
import { CheckCircle, Mail } from 'lucide-react'
import type { FreeListCounty } from '@/lib/free-list'
import { trackEvent } from '@/lib/observability'

// Inline email capture for visitors not ready to start a trial: "send me the
// full <county> list". POSTs to /api/lead-capture (public, validated +
// rate-limited server-side). UTM params are read from the CURRENT page URL at
// submit time so the link the operator drops at the auction (e.g.
// ?utm_source=auction_day&utm_campaign=dekalb_2026-07-07) attributes the lead.

type Status = 'idle' | 'submitting' | 'done' | 'error'

export default function LeadCaptureForm({
  county,
  countyLabel,
}: {
  county: FreeListCounty
  countyLabel: string
}) {
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot — humans never see it
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'submitting') return
    setStatus('submitting')
    setErrorMessage(null)

    try {
      const params = new URLSearchParams(window.location.search)
      const res = await fetch('/api/lead-capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          county,
          source: 'free-list',
          website,
          utm_source: params.get('utm_source') ?? null,
          utm_medium: params.get('utm_medium') ?? null,
          utm_campaign: params.get('utm_campaign') ?? null,
        }),
      })

      if (res.ok) {
        // The ads-facing conversion (maps to GA4 generate_lead). Email is PII —
        // deliberately NOT sent; county + UTM are enough to attribute the ad.
        trackEvent('lead_captured', {
          county,
          utm_source: params.get('utm_source') ?? undefined,
          utm_campaign: params.get('utm_campaign') ?? undefined,
        })
        setStatus('done')
        return
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setErrorMessage(body.error ?? 'Something went wrong — please try again.')
      setStatus('error')
    } catch {
      setErrorMessage('Network error — please try again.')
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div
        className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3.5"
        role="status"
      >
        <CheckCircle size={18} className="shrink-0 mt-0.5 text-emerald-400" />
        <div>
          <p className="text-sm font-bold text-emerald-300">You&apos;re on the list.</p>
          <p className="text-sm text-slate-400">
            We&apos;ll email the full {countyLabel} list to{' '}
            <span className="text-slate-200 font-semibold">{email}</span>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="w-full" noValidate>
      <div className="flex flex-col sm:flex-row gap-3">
        <label htmlFor="lead-email" className="sr-only">
          Email address
        </label>
        <div className="relative flex-1">
          <Mail
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
            aria-hidden
          />
          <input
            id="lead-email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded-xl bg-white/5 border border-white/15 pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-[#10A7FF]/60 focus:ring-2 focus:ring-[#10A7FF]/20 transition-colors"
          />
        </div>
        {/* Honeypot: hidden from humans (and from tab order / screen readers);
            bots that autofill every field reveal themselves server-side. */}
        <input
          type="text"
          name="website"
          value={website}
          onChange={e => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px] h-0 w-0 opacity-0"
        />
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="btn-primary px-6 py-3 text-sm whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === 'submitting' ? 'Sending…' : `Send me the full ${countyLabel.replace(' County', '')} list`}
        </button>
      </div>
      {status === 'error' && errorMessage && (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {errorMessage}
        </p>
      )}
      <p className="mt-2.5 text-xs text-slate-600">
        No spam — one email with the full analyzed list. Unsubscribe any time.
      </p>
    </form>
  )
}
