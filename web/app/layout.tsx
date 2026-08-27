import type { Metadata } from 'next'
import { Inter, Space_Grotesk, IBM_Plex_Mono } from 'next/font/google'
import { GoogleAnalytics } from '@next/third-parties/google'
import '@/lib/env'  // boot-time env validation; throws on missing required vars
import { ThemeProvider } from '@/components/ThemeProvider'
import { TRIAL_LABEL } from '@/lib/trial'
import { PostHogProvider } from '@/components/PostHogProvider'
import { GA_MEASUREMENT_ID } from '@/lib/observability'
import './globals.css'

// Self-hosted fonts via next/font — no render-blocking Google Fonts CDN.
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})
// Blueprint Instrument direction (2026-07-06): mono for all data labels.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
})

// The site serves on the www host; canonical/OG URLs and the next/og image URLs
// resolve against this base. (Fixes the apex-vs-www og:url drift flagged in the
// pre-demo audit.)
const SITE_URL = 'https://www.bidwiseinvest.com'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'BidWise — Auction Property Analysis for Real Estate Investors',
  description: `Find better auction deals faster with investor-grade analysis, smarter comps, and a system built to help you make more informed buying decisions. Start your ${TRIAL_LABEL} free trial.`,
  keywords: 'auction property analysis, tax deed investing, real estate investor tools, comparable sales, deal scoring',
  // NO canonical here: a layout-level canonical is INHERITED by every page
  // that doesn't override it, silently marking them duplicates of the
  // homepage (the /pricing bug from the 2026-07-12 audit). Each page owns
  // its own canonical; the homepage's lives in app/page.tsx.
  openGraph: {
    title: 'BidWise — Analyze Auction Properties Like a Pro',
    description: 'Investor-grade analysis for auction properties. Comparable sales, deal scoring, risk checks.',
    url: SITE_URL,
    siteName: 'BidWise',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BidWise — Analyze Auction Properties Like a Pro',
    description: 'Investor-grade analysis for auction properties. Comparable sales, deal scoring, risk checks.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${spaceGrotesk.variable} ${plexMono.variable}`}>
      <body>
        <PostHogProvider>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
            {children}
          </ThemeProvider>
        </PostHogProvider>
        {/* Google Analytics 4 — strictly optional, same posture as PostHog:
            without the env var nothing loads. Feeds Google Ads conversion
            import (begin_checkout / purchase / generate_lead via trackEvent
            in lib/observability). */}
        {GA_MEASUREMENT_ID && <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />}
      </body>
    </html>
  )
}
