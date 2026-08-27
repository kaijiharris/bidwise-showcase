// Single source of truth for the site's canonical origin.
//
// The site serves on the www host (Vercel redirects apex → www). Every
// canonical, og:url, JSON-LD url, robots and sitemap entry must be built from
// THIS constant — a canonical that points at the apex host points into a
// redirect, which search engines treat as a duplicate-content signal (the
// exact bug the 2026-07-12 audit flagged on /pricing and Cycle 7 found on
// seven more pages).
//
// tests/seo-canonical.test.ts enforces this: any `https://bidwiseinvest.com`
// (no www) literal under app/ fails the suite.

export const SITE_URL = 'https://www.bidwiseinvest.com'
