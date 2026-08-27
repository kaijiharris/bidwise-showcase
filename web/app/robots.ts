import type { MetadataRoute } from 'next'

// Emitted at /robots.txt. Must stay allowlisted in middleware.ts PUBLIC_ROUTES —
// otherwise the default-deny wall 307s crawlers to /login and the site never
// indexes. Host matches app/layout.tsx metadataBase (www canonical).
const SITE_URL = 'https://www.bidwiseinvest.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Never index authenticated app surfaces, API routes, auth callbacks,
        // or the account area. Public marketing + guide + free-list pages stay
        // crawlable so BidWise can compete for county-list search intent.
        disallow: ['/dashboard', '/api/', '/account', '/auth/', '/onboarding', '/reset-password'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
