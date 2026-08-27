import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { stripe, PLANS, type PlanKey } from '@/lib/stripe'
import { createClient as createServiceClient, SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { normalizeAffiliateCode } from '@/lib/affiliates'
import { sendTrialEndingEmail, sendWelcomeEmail } from '@/lib/lifecycle-emails'

function getServiceClient(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Reverse map of Stripe PRICE ID -> canonical plan key, built from the PLANS
// config. Entitlement MUST be derived from the price the customer actually
// pays for — never from sub.metadata.plan, which a checkout caller can set to
// any value and would otherwise let someone self-elevate to 'expert' while
// paying the 'starter' price.
function buildPriceToPlanMap(): Map<string, PlanKey> {
  const map = new Map<string, PlanKey>()
  for (const key of Object.keys(PLANS) as PlanKey[]) {
    const tier = PLANS[key]
    for (const priceId of [tier.monthly, tier.annual]) {
      if (priceId) map.set(priceId, key)
    }
  }
  return map
}

function planFromPriceId(priceId: string | undefined): PlanKey | null {
  if (!priceId) return null
  return buildPriceToPlanMap().get(priceId) ?? null
}

async function alreadyProcessed(supabase: SupabaseClient, eventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('processed_stripe_events')
    .select('event_id')
    .eq('event_id', eventId)
    .maybeSingle()
  if (error) throw new Error(`processed_stripe_events lookup failed: ${error.message}`)
  return data !== null
}

async function markProcessed(
  supabase: SupabaseClient,
  eventId: string,
  eventType: string,
): Promise<void> {
  const { error } = await supabase
    .from('processed_stripe_events')
    .insert({ event_id: eventId, event_type: eventType })
  // 23505 = unique_violation. Two webhook deliveries racing past alreadyProcessed
  // can both reach this insert; the second one collides, which is the dedup
  // working, not a real failure.
  if (error && error.code !== '23505') {
    throw new Error(`processed_stripe_events insert failed: ${error.message}`)
  }
}

// Current status of OUR row for this Stripe subscription (null when the event
// is the first we've seen it). Read BEFORE the upsert/update mutates the row so
// subscription_status_history captures the true old_status -> new_status edge.
async function fetchCurrentStatus(
  supabase: SupabaseClient,
  stripeSubscriptionId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle()
  if (error) throw new Error(`subscriptions status lookup failed: ${error.message}`)
  return (data?.status as string | undefined) ?? null
}

// Append one launch-test instrumentation row (migration 018) per
// customer.subscription.created/updated/deleted event. Precise churn timing is
// unrecoverable after the fact, so this must never be skipped silently — errors
// throw (→ 500 → Stripe retries), matching the rest of the handler.
async function recordStatusHistory(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
  oldStatus: string | null,
  newStatus: string,
  eventId: string,
): Promise<void> {
  const priceId = sub.items?.data?.[0]?.price?.id
  const { error } = await supabase.from('subscription_status_history').insert({
    user_id: sub.metadata?.user_id ?? null,
    stripe_subscription_id: sub.id,
    plan: planFromPriceId(priceId),
    stripe_price_id: priceId ?? null,
    old_status: oldStatus,
    new_status: newStatus,
    stripe_event_id: eventId,
  })
  // 23505 = unique_violation on stripe_event_id. A Stripe retry after a partial
  // failure (history written, event not yet marked processed) re-runs the
  // handler; the collision is the dedup working, not a real failure — same
  // contract as markProcessed above.
  if (error && error.code !== '23505') {
    throw new Error(`subscription_status_history insert failed: ${error.message}`)
  }
}

async function upsertSubscription(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<void> {
  const userId = sub.metadata?.user_id
  if (!userId) {
    console.warn(`[stripe-webhook] subscription ${sub.id} missing metadata.user_id; skipping`)
    return
  }

  const firstItem = sub.items.data[0]

  // Derive the entitlement plan from the PRICE the customer is on, not from
  // sub.metadata.plan. Unknown price IDs throw (→ 500) so Stripe retries and we
  // get alerted rather than silently granting an unverified tier.
  const plan = planFromPriceId(firstItem?.price?.id)
  if (!plan) {
    throw new Error(
      `subscription ${sub.id} has unrecognized price id ${firstItem?.price?.id ?? '(none)'} for user ${userId}`,
    )
  }

  const billingCycle =
    firstItem?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly'

  // Stripe Node 18 moved current_period_end from the Subscription to each
  // SubscriptionItem (subscriptions can now have items on different cadences).
  // For our single-item subscriptions, take it off item[0].
  const currentPeriodEnd = firstItem?.current_period_end
  if (!currentPeriodEnd) {
    throw new Error(`subscription ${sub.id} has no items[0].current_period_end`)
  }

  const { error: subErr } = await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: sub.customer as string,
      plan,
      status: sub.status,
      billing_cycle: billingCycle,
      trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      current_period_end: new Date(currentPeriodEnd * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_subscription_id' },
  )
  if (subErr) throw new Error(`subscriptions upsert failed: ${subErr.message}`)

  const { error: metaErr } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { plan, subscription_status: sub.status },
  })
  if (metaErr) throw new Error(`auth.admin.updateUserById failed: ${metaErr.message}`)

  await recordSubscriptionStarted(supabase, sub, plan, billingCycle)
}

// Affiliate ledger: record subscription_started once per subscription when the
// checkout stamped metadata.affiliate_code. The partial unique index
// uq_affiliate_events_sub_started makes webhook retries collide with 23505 —
// that is the dedup working (same pattern as markProcessed), not a failure.
async function recordSubscriptionStarted(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
  plan: PlanKey,
  billingCycle: string,
): Promise<void> {
  const code = normalizeAffiliateCode(sub.metadata?.affiliate_code)
  if (!code) return

  const { data: affiliate, error: affErr } = await supabase
    .from('affiliates')
    .select('id')
    .eq('code', code)
    .maybeSingle()
  if (affErr) throw new Error(`affiliates lookup failed: ${affErr.message}`)
  if (!affiliate) {
    console.warn(`[stripe-webhook] unknown affiliate code ${code} on ${sub.id}; skipping ledger`)
    return
  }

  const { error } = await supabase.from('affiliate_events').insert({
    affiliate_id: affiliate.id,
    event_type: 'subscription_started',
    user_id: sub.metadata?.user_id ?? null,
    stripe_subscription_id: sub.id,
    plan,
    billing_cycle: billingCycle,
  })
  if (error && error.code !== '23505') {
    throw new Error(`affiliate_events subscription_started insert failed: ${error.message}`)
  }
}

// Number of months a pct_first_n_months affiliate keeps earning on a referred
// customer's collected invoices. Frozen per event via commission_months, but
// this constant bounds the window when computing it at write time.
const PCT_COMMISSION_WINDOW_MONTHS = 12

// Payout trigger: conversion_paid fires on EACH PAID invoice (amount_paid > 0)
// for a referred customer, so the pct-of-collected model can pay 20% of every
// invoice inside the commission window. Trials that cancel never cost a
// commission; Stripe's $0 trial invoices are filtered out. Commission fields
// are FROZEN from the affiliates row on each event so later config changes
// never rewrite payout history.
//
//   * pct_first_n_months (launch model): record one conversion_paid per paid
//     invoice, deduped on metadata.invoice_id, but only while the invoice is
//     inside commission_months of the customer's FIRST conversion_paid.
//   * flat_bounty (back-compat): record exactly once — the first paid invoice.
//
// No Stripe API call needed: the subscription_started ledger row is the
// affiliate-involvement marker, and the subscriptions table holds the current
// plan snapshot.
async function recordConversionPaid(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionId = (invoice as { subscription?: string }).subscription
  const amountPaid = (invoice as { amount_paid?: number }).amount_paid ?? 0
  const invoiceId = invoice.id
  if (!subscriptionId || amountPaid <= 0 || !invoiceId) return

  const { data: started, error: startErr } = await supabase
    .from('affiliate_events')
    .select('id, affiliate_id, user_id, plan, billing_cycle')
    .eq('stripe_subscription_id', subscriptionId)
    .eq('event_type', 'subscription_started')
    .maybeSingle()
  if (startErr) throw new Error(`subscription_started lookup failed: ${startErr.message}`)
  if (!started) return // no affiliate involvement for this subscription

  const { data: affiliate, error: affErr } = await supabase
    .from('affiliates')
    .select('id, commission_model, commission_flat_cents, commission_pct, commission_months')
    .eq('id', started.affiliate_id)
    .maybeSingle()
  if (affErr) throw new Error(`affiliates lookup failed: ${affErr.message}`)
  if (!affiliate) {
    console.warn(`[stripe-webhook] affiliate ${started.affiliate_id} missing for ${subscriptionId}`)
    return
  }

  // Existing conversion_paid rows for this subscription: dedup source (per
  // invoice) and window anchor (earliest created_at = first conversion).
  const { data: priorPaid, error: paidErr } = await supabase
    .from('affiliate_events')
    .select('created_at, metadata')
    .eq('stripe_subscription_id', subscriptionId)
    .eq('event_type', 'conversion_paid')
  if (paidErr) throw new Error(`conversion_paid lookup failed: ${paidErr.message}`)
  const priorRows = priorPaid ?? []

  // Per-invoice idempotency: this exact invoice already recorded → no-op. The
  // DB unique index (stripe_subscription_id, metadata.invoice_id) is the
  // backstop; this pre-check avoids a redundant insert on retries.
  if (priorRows.some(r => (r.metadata as { invoice_id?: string })?.invoice_id === invoiceId)) {
    return
  }

  const isFlat = affiliate.commission_model === 'flat_bounty'
  if (isFlat) {
    // Flat model pays once: if any conversion_paid exists, later invoices are
    // renewals with no additional bounty.
    if (priorRows.length > 0) return
  } else {
    // Percent model: only record invoices inside the commission window
    // (measured from the customer's FIRST conversion_paid). The first paid
    // invoice always records (no prior rows → open window); later invoices
    // record only if collected within the window.
    const windowMonths = affiliate.commission_months ?? PCT_COMMISSION_WINDOW_MONTHS
    if (priorRows.length > 0) {
      const firstAt = priorRows
        .map(r => new Date(r.created_at as string).getTime())
        .reduce((min, t) => (t < min ? t : min), Infinity)
      const windowEnd = new Date(firstAt)
      windowEnd.setMonth(windowEnd.getMonth() + windowMonths)
      if (Date.now() > windowEnd.getTime()) return // window closed
    }
  }

  // Prefer the live subscriptions row (plan may have changed during trial);
  // fall back to the subscription_started snapshot.
  const { data: subRow } = await supabase
    .from('subscriptions')
    .select('user_id, plan, billing_cycle')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()

  const { error } = await supabase.from('affiliate_events').insert({
    affiliate_id: affiliate.id,
    event_type: 'conversion_paid',
    user_id: subRow?.user_id ?? started.user_id ?? null,
    stripe_subscription_id: subscriptionId,
    plan: subRow?.plan ?? started.plan ?? null,
    billing_cycle: subRow?.billing_cycle ?? started.billing_cycle ?? null,
    commission_model: affiliate.commission_model,
    commission_flat_cents: affiliate.commission_flat_cents,
    commission_pct: affiliate.commission_pct,
    commission_months: affiliate.commission_months,
    metadata: { invoice_id: invoiceId, amount_paid: amountPaid },
  })
  if (error && error.code !== '23505') {
    throw new Error(`affiliate_events conversion_paid insert failed: ${error.message}`)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text()
  const headersList = await headers()
  const sig = headersList.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = getServiceClient()

  try {
    if (await alreadyProcessed(supabase, event.id)) {
      return NextResponse.json({ received: true, deduped: true })
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string)
          await upsertSubscription(supabase, sub)
          // Welcome email — states the trial terms (plan, exact charge date,
          // how to cancel) in writing. Courtesy only: sendWelcomeEmail never
          // throws, so a mail hiccup can't 500 the entitlement write above.
          const email = session.customer_details?.email ?? session.customer_email ?? null
          if (email) {
            await sendWelcomeEmail({
              to: email,
              plan: planFromPriceId(sub.items?.data?.[0]?.price?.id),
              trialEndEpoch: sub.trial_end ?? null,
            })
          }
        }
        break
      }
      case 'customer.subscription.trial_will_end': {
        // Stripe fires this ~3 days before a trial ends. The reminder is the
        // dispute killer for a card-up-front trial with non-refundable terms.
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        let email: string | null = null
        if (userId) {
          const { data, error: userErr } = await supabase.auth.admin.getUserById(userId)
          if (userErr) {
            console.error(`[stripe-webhook] trial_will_end user lookup failed for ${userId}:`, userErr)
          }
          email = data?.user?.email ?? null
        }
        if (email) {
          await sendTrialEndingEmail({
            to: email,
            plan: planFromPriceId(sub.items?.data?.[0]?.price?.id),
            trialEndEpoch: sub.trial_end ?? null,
          })
        } else {
          console.warn(`[stripe-webhook] trial_will_end: no email resolvable for sub ${sub.id}; reminder skipped`)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const oldStatus = await fetchCurrentStatus(supabase, sub.id)
        await upsertSubscription(supabase, sub)
        // History AFTER the upsert: if the upsert 500s, Stripe's retry re-runs
        // both, and UNIQUE(stripe_event_id) dedupes the history side.
        await recordStatusHistory(supabase, sub, oldStatus, sub.status, event.id)
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        const oldStatus = await fetchCurrentStatus(supabase, sub.id)
        // Scope the cancel to THIS subscription row. Scoping by user_id would
        // cancel every subscription the user has ever had (and could clobber an
        // unrelated active one); stripe_subscription_id is the exact row.
        const { error: updErr } = await supabase
          .from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id)
        if (updErr) throw new Error(`subscriptions update (deleted) failed: ${updErr.message}`)
        // 'canceled' (not sub.status) so history matches the row we just wrote.
        await recordStatusHistory(supabase, sub, oldStatus, 'canceled', event.id)
        // Only touch user metadata when we actually know the owning user.
        if (userId) {
          const { error: metaErr } = await supabase.auth.admin.updateUserById(userId, {
            user_metadata: { plan: null, subscription_status: 'cancelled' },
          })
          if (metaErr) throw new Error(`auth.admin updateUserById (deleted) failed: ${metaErr.message}`)
        }
        break
      }
      case 'invoice.payment_failed': {
        // Scope to the specific subscription on the invoice and only flip rows
        // that are currently active/trialing — never reactivate or mutate a
        // canceled row (which a customer-wide scope could otherwise reach).
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = (invoice as { subscription?: string }).subscription
        if (subscriptionId) {
          const { error: updErr } = await supabase
            .from('subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subscriptionId)
            .in('status', ['active', 'trialing'])
          if (updErr) throw new Error(`subscriptions update (payment_failed) failed: ${updErr.message}`)
        }
        break
      }
      case 'invoice.payment_succeeded': {
        // Recovery: past_due subscriptions that paid the invoice should flip
        // back to active. Scope to the invoice's own subscription and only from
        // past_due so a canceled row can never be reactivated.
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = (invoice as { subscription?: string }).subscription
        if (subscriptionId) {
          const { error: updErr } = await supabase
            .from('subscriptions')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subscriptionId)
            .eq('status', 'past_due')
          if (updErr) throw new Error(`subscriptions update (payment_succeeded) failed: ${updErr.message}`)
        }
        // Affiliate payout trigger: each PAID invoice inside the commission
        // window earns the referring affiliate their pct of what we collected.
        await recordConversionPaid(supabase, invoice)
        break
      }
    }

    await markProcessed(supabase, event.id, event.type)
    return NextResponse.json({ received: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[stripe-webhook] handler failed for event ${event.id} (${event.type}):`, message)
    // 500 so Stripe retries. event.id is intentionally NOT marked processed —
    // the retry should run the handler again.
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
