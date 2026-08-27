import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'

/**
 * Stripe Billing Portal — creates a portal session for the authenticated
 * user to manage their subscription, payment methods, and invoices.
 *
 * GET /api/stripe/billing-portal
 *
 * Redirects to Stripe-hosted portal upon success.
 * Returns 401 if not signed in.
 * Returns 404 if no Stripe customer record exists.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // OWNERSHIP: the Stripe customer id is derived SERVER-SIDE from the
  // authenticated user's own subscriptions row — never from a client-supplied
  // value. Scoping by user_id guarantees a caller can only ever open the portal
  // for a customer that belongs to them.
  // Users created directly via invite_user.py (bypassing Stripe) have no Stripe
  // customer; in that case we redirect them to pricing instead.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id, user_id')
    .eq('user_id', user.id)
    .not('stripe_customer_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const customerId = sub?.stripe_customer_id
  // Defense in depth: re-verify the row we read is actually owned by the caller
  // before handing its customer id to Stripe.
  if (!customerId || sub?.user_id !== user.id) {
    return NextResponse.redirect(
      new URL('/pricing?error=no_stripe_customer', request.url),
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard`,
  })

  const res = NextResponse.redirect(portalSession.url)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
