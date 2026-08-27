import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, PLANS, type PlanKey, type BillingCycle } from '@/lib/stripe'
import { checkRateLimit } from '@/lib/rate-limit'
import { TRIAL_DAYS } from '@/lib/trial'
import {
  AFFILIATE_COOKIE_NAME,
  getServiceClient,
  isSelfReferral,
  lookupActiveAffiliate,
  normalizeAffiliateCode,
  readCookieValue,
} from '@/lib/affiliates'

const VALID_PLANS: ReadonlySet<PlanKey> = new Set(['starter', 'pro', 'expert'])
const VALID_CYCLES: ReadonlySet<BillingCycle> = new Set(['monthly', 'annual'])

// Allowed values for Sec-Fetch-Site. Cross-site requests (e.g. <img src>
// from attacker.com, third-party prefetch, link-preview crawlers) are
// rejected before we touch Stripe — the only legitimate callers are the
// /auth/callback 302 redirect (same-origin) and direct top-level navigation
// from the confirmation email (none).
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'same-site', 'none'])

function badRequest(reason: string) {
  return NextResponse.json(
    { error: reason },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  )
}

// Resolve the affiliate code for attribution: bw_aff cookie first (last touch),
// then the durable user_profiles.referred_by_code stamp (covers cookie expiry
// and confirm-on-another-device). The code is re-validated against an ACTIVE
// affiliate and passed through the self-referral guard — an affiliate buying
// through their own QR is dropped BEFORE the session (never earns commission).
// Returns null on any failure: attribution must never block a purchase.
async function resolveAffiliateCode(
  request: Request,
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email?: string | null },
): Promise<string | null> {
  try {
    let code = normalizeAffiliateCode(
      readCookieValue(request.headers.get('cookie'), AFFILIATE_COOKIE_NAME),
    )
    if (!code) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('referred_by_code')
        .eq('id', user.id)
        .maybeSingle()
      code = normalizeAffiliateCode(profile?.referred_by_code)
    }
    if (!code) return null

    const affiliate = await lookupActiveAffiliate(getServiceClient(), code)
    if (!affiliate) return null
    if (isSelfReferral(affiliate, user)) {
      console.warn(
        `[checkout] self-referral blocked: user ${user.id} used their own code ${code}`,
      )
      return null
    }
    return code
  } catch (err) {
    console.error('[checkout] affiliate attribution failed (continuing without):', err)
    return null
  }
}

export async function GET(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    return badRequest('cross-site request not allowed')
  }

  const { searchParams } = new URL(request.url)
  const rawPlan = searchParams.get('plan') ?? 'starter'
  const rawCycle = searchParams.get('cycle') ?? 'monthly'

  if (!VALID_PLANS.has(rawPlan as PlanKey)) return badRequest('invalid plan')
  if (!VALID_CYCLES.has(rawCycle as BillingCycle)) return badRequest('invalid cycle')
  const plan = rawPlan as PlanKey
  const cycle = rawCycle as BillingCycle

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 5 checkout attempts per user per minute. No-ops in environments without
  // Vercel KV configured, so this is a flip-the-switch deploy-time control
  // rather than a code release.
  const rl = await checkRateLimit(`checkout:${user.id}`)
  if (!rl.ok) {
    const back = new URL('/pricing', request.url)
    back.searchParams.set('error', 'rate_limit')
    const res = NextResponse.redirect(back)
    res.headers.set('Retry-After', String(rl.retryAfterSeconds))
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

  const tierConfig = PLANS[plan]
  const priceId = cycle === 'annual' ? tierConfig.annual : tierConfig.monthly

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // ── REPEAT-TRIAL / DUPLICATE-SUBSCRIPTION GUARD ────────────────────────────
  // The webhook writes a subscriptions row the moment any checkout completes
  // (including trials), so this owner-scoped read is the durable "has this user
  // ever trialed or subscribed?" record:
  //   • active/trialing row  -> bounce to /dashboard. Creating a second
  //     subscription would double-bill; the billing portal handles plan changes.
  //   • any prior row        -> checkout WITHOUT a trial (returning/canceled
  //     users pay from day 1 — no infinite re-trial loop under paid traffic).
  //   • prior Stripe customer id -> reuse it, so Stripe sees one customer per
  //     user instead of minting a new customer per session (customer_email),
  //     which had also bypassed Stripe's own has-trialed protections.
  // The lookup failing must never block a purchase: fall back to first-time
  // behavior (trial granted) and log — a read hiccup costing a sale is worse
  // than one extra trial.
  let hasPriorSubscription = false
  let existingCustomerId: string | null = null
  const { data: subRows, error: subLookupErr } = await supabase
    .from('subscriptions')
    .select('status, stripe_customer_id')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
  if (subLookupErr) {
    console.error('[checkout] prior-subscription lookup failed (granting first-time flow):', subLookupErr)
  } else if (subRows && subRows.length > 0) {
    const hasLiveSubscription = subRows.some(
      r => r.status === 'active' || r.status === 'trialing',
    )
    if (hasLiveSubscription) {
      const res = NextResponse.redirect(new URL('/dashboard', request.url))
      res.headers.set('Cache-Control', 'no-store')
      return res
    }
    hasPriorSubscription = true
    existingCustomerId =
      subRows.find(
        r => typeof r.stripe_customer_id === 'string' && r.stripe_customer_id.length > 0,
      )?.stripe_customer_id ?? null
  }

  const affiliateCode = await resolveAffiliateCode(request, supabase, user)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    // Reuse the known Stripe customer when we have one; customer_email would
    // mint a brand-new customer per session.
    ...(existingCustomerId
      ? { customer: existingCustomerId }
      : { customer_email: user.email }),
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      // One free trial per user, ever. TRIAL_DAYS is the single source of
      // truth shared with all marketing copy (lib/trial.ts).
      ...(hasPriorSubscription ? {} : { trial_period_days: TRIAL_DAYS }),
      // subscription_data.metadata rides on the Subscription object for its
      // lifetime — the webhook reads affiliate_code from there.
      metadata: { user_id: user.id, plan, cycle, affiliate_code: affiliateCode ?? '' },
    },
    metadata: { user_id: user.id, plan, cycle, affiliate_code: affiliateCode ?? '' },
    success_url: `${appUrl}/dashboard?checkout=success&plan=${plan}`,
    cancel_url: `${appUrl}/pricing?checkout=cancelled`,
  })

  const res = NextResponse.redirect(session.url!)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
