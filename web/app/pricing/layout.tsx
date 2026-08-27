import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site'
import { TRIAL_LABEL } from '@/lib/trial'

// Metadata-only layout: pricing/page.tsx is a client component and cannot
// export metadata. Without this, /pricing inherited the root layout's
// homepage canonical and Google treated it as a homepage duplicate (2026-07-12
// audit finding).
export const metadata: Metadata = {
  title: `Pricing — BidWise | Plans from $39/mo with a ${TRIAL_LABEL} free trial`,
  description:
    `Compare BidWise plans: analyzed Georgia tax sale lists, deal scores, comps, ` +
    `and max-bid numbers. Every plan starts with a ${TRIAL_LABEL} free trial.`,
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: {
    title: 'BidWise Pricing — Plans & Free Trial',
    description: `Analyzed auction lists, deal scores, and max-bid numbers. ${TRIAL_LABEL} free trial on every plan.`,
    url: `${SITE_URL}/pricing`,
    type: 'website',
  },
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children
}
