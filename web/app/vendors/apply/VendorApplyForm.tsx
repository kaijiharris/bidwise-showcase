'use client'

// Vendor application form (client). Server-side validation in
// /api/vendor-applications is authoritative — this form only mirrors it for
// fast feedback. The src attribution code comes from ?src (passed down by the
// server page) with the bw_vendor_src cookie as fallback (set by /v/[code],
// non-httpOnly by design so it is readable here).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, ArrowRight } from 'lucide-react'
import {
  VENDOR_CATEGORIES,
  VENDOR_CATEGORY_LABELS,
  VENDOR_SRC_COOKIE_NAME,
} from '@/lib/vendor-application'

export interface CountyOption {
  value: string
  label: string
}

const INPUT_CLASS =
  'w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-brand-blue/60 focus:ring-1 focus:ring-brand-blue/30 transition-all'
const LABEL_CLASS = 'block text-xs font-semibold text-slate-400 mb-2'

function readCookie(name: string): string | null {
  const match = document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

function DoneState() {
  return (
    <div className="text-center py-6">
      <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
        <CheckCircle size={28} className="text-emerald-400" />
      </div>
      <h2 className="text-xl font-black text-white mb-2">Application received</h2>
      <p className="text-sm text-slate-400 leading-relaxed mb-6">
        We vet every vendor and reply within a few business days. A confirmation
        is on its way to your inbox — no further action needed.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue hover:text-brand-cyan transition-colors"
      >
        Back to BidWise <ArrowRight size={14} />
      </Link>
    </div>
  )
}

export default function VendorApplyForm({
  counties,
  initialSrc,
}: {
  counties: CountyOption[]
  initialSrc: string | null
}) {
  const [src, setSrc] = useState(initialSrc)
  const [selectedCounties, setSelectedCounties] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    // Cookie fallback: the vendor may have navigated away and come back.
    if (!initialSrc) setSrc(readCookie(VENDOR_SRC_COOKIE_NAME))
  }, [initialSrc])

  function toggleCounty(value: string) {
    setSelectedCounties(prev =>
      prev.includes(value) ? prev.filter(c => c !== value) : [...prev, value],
    )
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setFieldErrors({})
    if (selectedCounties.length === 0) {
      setFieldErrors({ service_counties: 'Select at least one service county' })
      return
    }
    setSubmitting(true)

    const form = new FormData(e.currentTarget)
    const payload = {
      business_name: String(form.get('business_name') ?? ''),
      category: String(form.get('category') ?? ''),
      service_counties: selectedCounties,
      license_number: String(form.get('license_number') ?? ''),
      is_insured: form.get('is_insured') === 'yes',
      years_in_business: Number(form.get('years_in_business') ?? -1),
      website: String(form.get('website') ?? ''),
      phone: String(form.get('phone') ?? ''),
      email: String(form.get('email') ?? ''),
      referral_source: String(form.get('referral_source') ?? ''),
      src_code: src ?? '',
      company_fax: String(form.get('company_fax') ?? ''), // honeypot
    }

    try {
      const res = await fetch('/api/vendor-applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setDone(true)
      } else if (res.status === 400) {
        const body = await res.json().catch(() => null)
        setFieldErrors(body?.fields ?? {})
        setError('Please fix the highlighted fields and resubmit.')
      } else if (res.status === 429) {
        setError('Too many submissions from this connection — please try again later.')
      } else {
        setError('Something went wrong saving your application. Please try again.')
      }
    } catch {
      setError('Network error — check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-[520px]">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-black text-white mb-2">
            Join the BidWise vendor network
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            We connect vetted contractors and service providers with auction-property
            investors across metro Atlanta. Tell us about your business — every
            application is reviewed by a human.
          </p>
        </div>

        <div className="rounded-2xl p-6 bg-white/[0.03] border border-white/10">
          {done ? (
            <DoneState />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="business_name" className={LABEL_CLASS}>Business name</label>
                <input id="business_name" name="business_name" type="text" required minLength={2} maxLength={120} placeholder="Peach State Roofing LLC" className={INPUT_CLASS} />
                {fieldErrors.business_name && <p className="mt-1 text-xs text-red-400">{fieldErrors.business_name}</p>}
              </div>

              <div>
                <label htmlFor="category" className={LABEL_CLASS}>Service category</label>
                <select id="category" name="category" required defaultValue="" className={INPUT_CLASS}>
                  <option value="" disabled>Choose a category…</option>
                  {VENDOR_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{VENDOR_CATEGORY_LABELS[cat]}</option>
                  ))}
                </select>
                {fieldErrors.category && <p className="mt-1 text-xs text-red-400">{fieldErrors.category}</p>}
              </div>

              <div>
                <span className={LABEL_CLASS}>Service counties</span>
                <div className="flex flex-wrap gap-2">
                  {counties.map(county => {
                    const active = selectedCounties.includes(county.value)
                    return (
                      <button
                        key={county.value}
                        type="button"
                        onClick={() => toggleCounty(county.value)}
                        aria-pressed={active}
                        className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                          active
                            ? 'bg-brand-blue/15 border-brand-blue/50 text-white'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/25'
                        }`}
                      >
                        {county.label}
                      </button>
                    )
                  })}
                </div>
                {fieldErrors.service_counties && <p className="mt-1 text-xs text-red-400">{fieldErrors.service_counties}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="license_number" className={LABEL_CLASS}>License # (optional)</label>
                  <input id="license_number" name="license_number" type="text" maxLength={60} placeholder="GA-RC-12345" className={INPUT_CLASS} />
                </div>
                <div>
                  <label htmlFor="years_in_business" className={LABEL_CLASS}>Years in business</label>
                  <input id="years_in_business" name="years_in_business" type="number" required min={0} max={99} placeholder="5" className={INPUT_CLASS} />
                  {fieldErrors.years_in_business && <p className="mt-1 text-xs text-red-400">{fieldErrors.years_in_business}</p>}
                </div>
              </div>

              <fieldset>
                <legend className={LABEL_CLASS}>Are you insured?</legend>
                <div className="flex gap-4">
                  {(['yes', 'no'] as const).map(v => (
                    <label key={v} className="flex items-center gap-2 text-sm text-slate-300">
                      <input type="radio" name="is_insured" value={v} required className="accent-[#3b82f6]" />
                      {v === 'yes' ? 'Yes' : 'No'}
                    </label>
                  ))}
                </div>
                {fieldErrors.is_insured && <p className="mt-1 text-xs text-red-400">{fieldErrors.is_insured}</p>}
              </fieldset>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="phone" className={LABEL_CLASS}>Phone</label>
                  <input id="phone" name="phone" type="tel" required placeholder="(404) 555-0123" className={INPUT_CLASS} />
                  {fieldErrors.phone && <p className="mt-1 text-xs text-red-400">{fieldErrors.phone}</p>}
                </div>
                <div>
                  <label htmlFor="email" className={LABEL_CLASS}>Email</label>
                  <input id="email" name="email" type="email" required placeholder="you@company.com" className={INPUT_CLASS} />
                  {fieldErrors.email && <p className="mt-1 text-xs text-red-400">{fieldErrors.email}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="website" className={LABEL_CLASS}>Website (optional)</label>
                <input id="website" name="website" type="url" placeholder="https://yourcompany.com" className={INPUT_CLASS} />
                {fieldErrors.website && <p className="mt-1 text-xs text-red-400">{fieldErrors.website}</p>}
              </div>

              <div>
                <label htmlFor="referral_source" className={LABEL_CLASS}>How did you hear about us? (optional)</label>
                <input id="referral_source" name="referral_source" type="text" maxLength={300} placeholder="e.g. QR flyer at the DeKalb auction" className={INPUT_CLASS} />
              </div>

              {/* Honeypot — humans never see or fill this. */}
              <div className="absolute -left-[9999px] top-auto" aria-hidden="true">
                <label htmlFor="company_fax">Company fax</label>
                <input id="company_fax" name="company_fax" type="text" tabIndex={-1} autoComplete="off" />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <span className="shrink-0 mt-0.5">⚠</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="group w-full flex items-center justify-center gap-2 py-3.5 btn-primary disabled:opacity-60 disabled:cursor-not-allowed text-sm rounded-xl"
              >
                {submitting ? (
                  <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting…</>
                ) : (
                  <>Submit application <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" /></>
                )}
              </button>

              <p className="text-center text-xs text-slate-600 leading-relaxed">
                We only use this information to vet your business for the vendor
                network. See our{' '}
                <Link href="/privacy" className="text-slate-400 hover:text-white transition-colors">Privacy Policy</Link>.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
