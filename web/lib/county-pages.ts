// Config + live-stats loader for the public programmatic county pages
// (/tax-sale/<county>-county-ga). These pages compete for "<county> tax sale
// list" search intent, so everything user-visible must stay HONEST:
// auction dates and property counts are read from the live published dataset
// at render time — never hardcoded — and each page links the county's own
// official listing (same URLs the tax-sale monitor watches in
// supabase/functions/notify-tax-sale/sources.ts).

import { type CountySlug, KNOWN_COUNTIES, resolveDataFile, readCountyDataset } from './county-data'
import { isFreeListCounty, teaserStats } from './free-list'

export interface CountyPageConfig {
  slug: CountySlug
  /** "DeKalb" */
  name: string
  /** County seat — where the courthouse-steps sale happens. */
  seat: string
  /** The county's own tax-sale listing page (official source of truth). */
  officialUrl: string
  officialLabel: string
}

export const COUNTY_PAGES: Record<CountySlug, CountyPageConfig> = {
  dekalb: {
    slug: 'dekalb',
    name: 'DeKalb',
    seat: 'Decatur',
    // The county migrated dekalbtax.org → dekalbtaxga.gov in July 2026 and the
    // legacy publicaccess listing host went dark. Link the live tax-sales page
    // (its listing deep-link can move again while the migration settles).
    officialUrl: 'https://dekalbtaxga.gov/property-tax/tax-sales/',
    officialLabel: 'DeKalb Tax Commissioner — tax sales',
  },
  gwinnett: {
    slug: 'gwinnett',
    name: 'Gwinnett',
    seat: 'Lawrenceville',
    officialUrl:
      'https://www.gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales',
    officialLabel: 'Gwinnett Tax Commissioner — tax liens & tax sales',
  },
  cobb: {
    slug: 'cobb',
    name: 'Cobb',
    seat: 'Marietta',
    officialUrl: 'https://www.cobbtax.gov/property/tax_sale/index.php',
    officialLabel: 'Cobb Tax Commissioner — tax sale',
  },
  clayton: {
    slug: 'clayton',
    name: 'Clayton',
    seat: 'Jonesboro',
    officialUrl: 'https://publicaccess.claytoncountyga.gov/content/PDF/',
    officialLabel: 'Clayton County — tax sale documents',
  },
}

// SEO slugs match the search phrasing ("dekalb county ga tax sale") and the
// pattern that already ranks in this niche.
export function countyPageSlug(county: CountySlug): string {
  return `${county}-county-ga`
}

export function countyFromPageSlug(slug: string): CountySlug | null {
  const m = slug.match(/^([a-z]+)-county-ga$/)
  if (!m) return null
  const county = m[1]
  return (KNOWN_COUNTIES as readonly string[]).includes(county) ? (county as CountySlug) : null
}

export interface CountyLiveStats {
  /** ISO date of the dataset's auction, e.g. "2026-09-01" (null when unknown). */
  auctionDateISO: string | null
  /** "September 1, 2026" */
  auctionDateLabel: string | null
  /** True when that date is today or later — i.e. the list is the UPCOMING sale. */
  isUpcoming: boolean
  totalProperties: number
  strongDeals: number
  /** ISO date (YYYY-MM-DD) our published analysis was run, or null. */
  analysisDateISO: string | null
  /** "July 12, 2026" — the date the count/scores reflect, NOT the live list. */
  analysisDateLabel: string | null
  /**
   * True when the published analysis is older than STALE_ANALYSIS_DAYS. The
   * county keeps revising its list until sale day, so once our snapshot ages
   * out we must stop asserting the count as the current list and say "as of
   * <date>" instead (honesty: the live list may already differ, and the source
   * can be temporarily down — as DeKalb's was for days in July 2026).
   */
  analysisStale: boolean
  /** Whether a public /free-list teaser exists for this county. */
  hasFreeList: boolean
}

function labelFor(iso: string): string | null {
  const d = new Date(`${iso}T12:00:00`)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/** A published analysis older than this reads as "as of <date>", not "current". */
export const STALE_ANALYSIS_DAYS = 7

export interface AnalysisMeta {
  analysisDateISO: string | null
  analysisDateLabel: string | null
  analysisStale: boolean
}

/**
 * Derive the honest presentation facts for a dataset's analysis date. Pure and
 * clock-injectable so it is deterministic under test. Tolerates a full ISO
 * timestamp ("2026-07-12T02:01:51.34") by reading the date portion. A missing
 * or unparseable date is neither labeled nor stale (the page falls back to its
 * generic "analyzed by BidWise" copy).
 */
export function analysisMeta(rawAnalysisDate: string | null, now: Date = new Date()): AnalysisMeta {
  const none: AnalysisMeta = { analysisDateISO: null, analysisDateLabel: null, analysisStale: false }
  if (!rawAnalysisDate) return none
  const datePart = rawAnalysisDate.slice(0, 10)
  const d = new Date(`${datePart}T12:00:00`)
  if (isNaN(d.getTime())) return none
  const ageDays = (now.getTime() - d.getTime()) / 86_400_000
  return {
    analysisDateISO: datePart,
    analysisDateLabel: labelFor(datePart),
    analysisStale: ageDays > STALE_ANALYSIS_DAYS,
  }
}

/**
 * Read the county's currently-published dataset and derive the page's live
 * facts. Fail soft: any read problem renders the "next list pending" state
 * rather than an error page — these are public marketing surfaces.
 */
export async function loadCountyLiveStats(county: CountySlug): Promise<CountyLiveStats> {
  const empty: CountyLiveStats = {
    auctionDateISO: null,
    auctionDateLabel: null,
    isUpcoming: false,
    totalProperties: 0,
    strongDeals: 0,
    analysisDateISO: null,
    analysisDateLabel: null,
    analysisStale: false,
    hasFreeList: isFreeListCounty(county),
  }
  try {
    const resolved = await resolveDataFile(county)
    if (!resolved) return empty
    const dataset = await readCountyDataset(county, resolved.fileName)
    const iso = dataset.auction_date ?? resolved.entry?.auction_date ?? null
    const stats = teaserStats(dataset.properties)
    const today = new Date()
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const analysis = analysisMeta(dataset.analysis_date, today)
    return {
      auctionDateISO: iso,
      auctionDateLabel: iso ? labelFor(iso) : null,
      isUpcoming: Boolean(iso && iso >= todayISO),
      totalProperties: stats.totalProperties,
      strongDeals: stats.strongDeals,
      analysisDateISO: analysis.analysisDateISO,
      analysisDateLabel: analysis.analysisDateLabel,
      analysisStale: analysis.analysisStale,
      hasFreeList: isFreeListCounty(county),
    }
  } catch (err) {
    console.error(`[county-pages] live stats failed for ${county}:`, err)
    return empty
  }
}
