import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site'
import { TRIAL_LABEL } from '@/lib/trial'

// Metadata-only layout: signup/page.tsx is a client component and cannot
// export metadata. Self-canonical keeps /signup indexable as a conversion
// landing page instead of inheriting the homepage canonical.
export const metadata: Metadata = {
  title: `Start Your ${TRIAL_LABEL} Free Trial — BidWise`,
  description:
    `Create your BidWise account and start a ${TRIAL_LABEL} free trial: analyzed ` +
    `Georgia tax sale lists with deal scores, comps, and max-bid numbers.`,
  alternates: { canonical: `${SITE_URL}/signup` },
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children
}
