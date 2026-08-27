// POST /api/vendor-applications — public vendor waitlist/application intake.
//
// Middleware-public; the route is its own security boundary: rate limit
// (5/hour/IP, Vercel-KV fail-open), honeypot (silent 200 discard — never tip
// bots), server-authoritative validation, and service-role writes only (the
// table has no anon/authenticated policies — migration 016).
//
// Resubmission semantics (one live application per email+category):
// mutable fields update; status reopens to 'pending' only from
// rejected/waitlisted — a re-application never downgrades approved/vetting.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIpFrom, getServiceClient, hashIp, normalizeAffiliateCode } from '@/lib/affiliates'
import { escapeHtml, sendEmail } from '@/lib/email'
import {
  validateVendorApplication,
  VENDOR_CATEGORY_LABELS,
  type VendorApplicationValues,
} from '@/lib/vendor-application'
import { KNOWN_COUNTIES } from '@/lib/county-data'

export const dynamic = 'force-dynamic'

const RATE_WINDOW_SECONDS = 3600
const RATE_MAX_PER_WINDOW = 5
const REOPENABLE_STATUSES = new Set(['rejected', 'waitlisted'])
const ALLOWED_COUNTIES: readonly string[] = [...KNOWN_COUNTIES, 'other']

type ExistingApplication = { id: string; status: string }

async function upsertApplication(
  supabase: SupabaseClient,
  values: VendorApplicationValues,
  ipHash: string,
): Promise<{ created: boolean }> {
  const { data: existing, error: selErr } = await supabase
    .from('vendor_applications')
    .select('id, status')
    .eq('email', values.email)
    .eq('category', values.category)
    .maybeSingle()
  if (selErr) throw new Error(`vendor_applications lookup failed: ${selErr.message}`)

  if (!existing) {
    const { error } = await supabase
      .from('vendor_applications')
      .insert({ ...values, status: 'pending', ip_hash: ipHash })
    if (error) throw new Error(`vendor_applications insert failed: ${error.message}`)
    return { created: true }
  }

  const row = existing as ExistingApplication
  const patch: Record<string, unknown> = { ...values, ip_hash: ipHash }
  // Reopen only rejected/waitlisted; never clobber approved/vetting/pending.
  if (REOPENABLE_STATUSES.has(row.status)) patch.status = 'pending'
  const { error } = await supabase
    .from('vendor_applications')
    .update(patch)
    .eq('id', row.id)
  if (error) throw new Error(`vendor_applications update failed: ${error.message}`)
  return { created: false }
}

async function sendNotifications(values: VendorApplicationValues): Promise<void> {
  const category = VENDOR_CATEGORY_LABELS[values.category]
  const applicant = sendEmail({
    to: values.email,
    subject: 'BidWise vendor application received',
    html: `<p>Hi ${escapeHtml(values.business_name)},</p>
<p>Your vendor application (${escapeHtml(category)}) is in. We vet every vendor
and will reply within a few business days — no action needed from you.</p>
<p>— The BidWise team</p>`,
  })

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)
  const admin =
    adminEmails.length === 0
      ? Promise.resolve({ ok: false })
      : sendEmail({
          to: adminEmails,
          subject: `New vendor application: ${values.business_name} (${category})`,
          html: `<p><strong>${escapeHtml(values.business_name)}</strong> — ${escapeHtml(category)}</p>
<ul>
  <li>Counties: ${escapeHtml(values.service_counties.join(', '))}</li>
  <li>Insured: ${values.is_insured ? 'yes' : 'no'} · Years: ${values.years_in_business}</li>
  <li>Phone: ${escapeHtml(values.phone)} · Email: ${escapeHtml(values.email)}</li>
  <li>Source code: ${escapeHtml(values.src_code ?? '(none)')}</li>
</ul>
<p>Review the row in Supabase Studio → vendor_applications.</p>`,
        })

  // sendEmail never throws; allSettled is belt-and-braces so a notification
  // problem can never turn a stored application into a user-facing error.
  await Promise.allSettled([applicant, admin])
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const ipHash = hashIp(clientIpFrom(request))
  const rl = await checkRateLimit(`vendor-app:${ipHash}`, RATE_WINDOW_SECONDS, RATE_MAX_PER_WINDOW)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'too many submissions — try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  // Honeypot: bots that fill the hidden field get a convincing success and
  // nothing is stored. Do not tip them off with an error.
  const honeypot = (body as Record<string, unknown> | null)?.['company_fax']
  if (typeof honeypot === 'string' && honeypot.trim() !== '') {
    console.warn('[vendor-applications] honeypot tripped — discarding submission')
    return NextResponse.json({ ok: true })
  }

  const result = validateVendorApplication(body, ALLOWED_COUNTIES)
  if (!result.ok) {
    return NextResponse.json(
      { error: 'validation_failed', fields: result.errors },
      { status: 400 },
    )
  }

  // src_code arrives from the form (?src / bw_vendor_src); re-validate format
  // here — an invalid value degrades to null, never a rejection.
  const srcCode = normalizeAffiliateCode(
    (body as Record<string, unknown>).src_code as string | undefined,
  )
  const values: VendorApplicationValues = { ...result.values, src_code: srcCode }

  try {
    const { created } = await upsertApplication(getServiceClient(), values, ipHash)
    await sendNotifications(values)
    return NextResponse.json({ ok: true }, { status: created ? 201 : 200 })
  } catch (err) {
    console.error('[vendor-applications] submission failed:', err)
    return NextResponse.json(
      { error: 'could not save your application — please try again' },
      { status: 500 },
    )
  }
}
