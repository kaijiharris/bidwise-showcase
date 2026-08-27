import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site'

// Metadata-only layout: login/page.tsx is a client component and cannot
// export metadata. Login has zero search value, so it is noindexed (and
// deliberately absent from sitemap.ts); the self-canonical stops it from
// inheriting the homepage canonical as a duplicate signal.
export const metadata: Metadata = {
  title: 'Log In — BidWise',
  alternates: { canonical: `${SITE_URL}/login` },
  robots: { index: false, follow: true },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
