import type { MetadataRoute } from 'next'
import { getAllGuides } from '@/lib/guides'
import { FREE_LIST_COUNTIES } from '@/lib/free-list'
import { KNOWN_COUNTIES } from '@/lib/county-data'
import { countyPageSlug } from '@/lib/county-pages'

// Emitted at /sitemap.xml. Must stay allowlisted in middleware.ts PUBLIC_ROUTES.
// Host matches app/layout.tsx metadataBase (www canonical) — keep them in sync
// so canonical + sitemap don't disagree on www vs. non-www.
const SITE_URL = 'https://www.bidwiseinvest.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  // Public marketing + auth entry pages. Only routes that are public in
  // middleware.ts belong here — never dashboard/account/api.
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/how-it-works`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/resources`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/signup`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    // /login is deliberately absent: it is noindexed (app/login/layout.tsx) —
    // a sitemap must only list indexable URLs or Search Console flags it.
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]

  // Investor guides (/resources/<slug>) — highest-intent SEO content.
  const guideEntries: MetadataRoute.Sitemap = getAllGuides().map(g => ({
    url: `${SITE_URL}/resources/${g.slug}`,
    lastModified: g.date ? new Date(g.date) : now,
    changeFrequency: 'monthly',
    priority: 0.7,
  }))

  // Free-list lead-magnet teasers (/free-list/<county>) — county-list search
  // intent, the channel BidWise must win from LienSuite.
  const freeListEntries: MetadataRoute.Sitemap = FREE_LIST_COUNTIES.map(county => ({
    url: `${SITE_URL}/free-list/${county}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  // Programmatic county tax-sale pages (/tax-sale/<county>-county-ga) — the
  // primary organic-search surface for "<county> tax sale" queries — plus the
  // Georgia hub (head term) and the free calculator tool.
  const countyEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/tax-sale`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    ...KNOWN_COUNTIES.map(county => ({
      url: `${SITE_URL}/tax-sale/${countyPageSlug(county)}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/tools/redemption-calculator`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
  ]

  return [...staticEntries, ...guideEntries, ...freeListEntries, ...countyEntries]
}
