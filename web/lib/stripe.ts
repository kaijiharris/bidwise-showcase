import Stripe from 'stripe'

// API version is pinned to match Stripe Node SDK 18's default. After upgrading,
// verify Stripe Dashboard → Developers → Webhooks → endpoint API version is
// set to 'Latest' or '2025-08-27.basil' — otherwise webhook payloads will be
// shaped for an older version while this SDK expects the new one.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
  typescript: true,
})

export const PLANS = {
  starter: {
    name: 'Starter',
    monthly: process.env.STRIPE_STARTER_MONTHLY!,
    annual: process.env.STRIPE_STARTER_ANNUAL!,
    monthlyPrice: 39,
    annualPrice: 329,
  },
  pro: {
    name: 'Pro',
    monthly: process.env.STRIPE_PRO_MONTHLY!,
    annual: process.env.STRIPE_PRO_ANNUAL!,
    monthlyPrice: 109,
    annualPrice: 899,
  },
  expert: {
    name: 'Expert',
    monthly: process.env.STRIPE_EXPERT_MONTHLY!,
    annual: process.env.STRIPE_EXPERT_ANNUAL!,
    monthlyPrice: 249,
    annualPrice: 1999,
  },
} as const

export type PlanKey = keyof typeof PLANS
export type BillingCycle = 'monthly' | 'annual'
