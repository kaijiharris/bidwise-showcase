import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/site'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { ArrowRight, CalendarDays, Clock, ShieldCheck, Sparkles } from 'lucide-react'
import {
  resolveDataFile,
  readCountyDataset,
  type RawCountyDataset,
} from '@/lib/county-data'
import {
  COUNTY_LABELS,
  buildTeaserRows,
  formatAsOf,
  isFreeListCounty,
  teaserStats,
  type FreeListCounty,
} from '@/lib/free-list'
import TeaserTable from './TeaserTable'
import LeadCaptureForm from './LeadCaptureForm'
import { TRIAL_LABEL } from '@/lib/trial'

// Public lead-magnet teaser: a masked sample of the analyzed county auction
// list. The full values (addresses, ARVs, deal scores, max bids) never reach
// this page's HTML — masking happens server-side in lib/free-list before
// render, same principle as the tier-masking in /api/data/[county].
//
// force-dynamic: auction selection is date-relative (pickDefaultEntry inside
// resolveDataFile picks the soonest UPCOMING auction), so render per request
// rather than freezing the choice at build time.
export const dynamic = 'force-dynamic'

export async function generateMetadata(
  { params }: { params: Promise<{ county: string }> },
): Promise<Metadata> {
  const { county } = await params
  if (!isFreeListCounty(county)) {
    return { title: 'Free Auction Sample List | BidWise' }
  }
  const label = COUNTY_LABELS[county]
  const title = `Free ${label} Tax Sale Sample List | BidWise`
  const description =
    `A free sample of BidWise's analyzed ${label} tax sale list — property types, ` +
    `taxes due, and estimated value bands for every parcel on the auction. ` +
    `Unlock full addresses, ARVs, deal scores, and max-bid numbers with a free trial.`
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/free-list/${county}` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/free-list/${county}`,
      type: 'website',
    },
  }
}

export default async function FreeListPage(
  { params }: { params: Promise<{ county: string }> },
) {
  const { county } = await params
  if (!isFreeListCounty(county)) notFound()
  const countySlug: FreeListCounty = county
  const countyLabel = COUNTY_LABELS[countySlug]

  // Soonest upcoming populated auction for this county (same selection the
  // dashboard defaults to). Datasets ship with the deploy, so a missing file
  // here means the county has nothing published yet -> 404.
  const resolved = await resolveDataFile(countySlug)
  if (!resolved) notFound()

  let dataset: RawCountyDataset
  try {
    dataset = await readCountyDataset(countySlug, resolved.fileName)
  } catch (err) {
    console.error(`[free-list] failed to read ${countySlug}/${resolved.fileName}:`, err)
    notFound()
  }
  if (dataset.properties.length === 0) notFound()

  const rows = buildTeaserRows(dataset.properties)
  const stats = teaserStats(dataset.properties)
  const auctionLabel =
    resolved.entry?.label ??
    formatAsOf(resolved.entry?.auction_date ?? dataset.auction_date) ??
    'Upcoming auction'
  // "Data as of" freshness stamp — same source order as the dashboard header
  // (PR #17): dataset analysis date first, index `generated` as fallback.
  const dataAsOf = formatAsOf(dataset.analysis_date ?? resolved.entry?.generated)

  const showingAll = rows.length >= stats.totalProperties
  const sampleNote = showingAll
    ? `Showing all ${stats.totalProperties} analyzed properties — values masked`
    : `Showing ${rows.length} of ${stats.totalProperties} analyzed properties`

  const ctaHref = `/pricing?utm_source=free_list&utm_medium=teaser&utm_campaign=${countySlug}`

  return (
    <div className="min-h-screen bg-navy-900">
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-32 pb-10 px-4">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 mb-6 rounded-full border border-[#10A7FF]/30 bg-[#10A7FF]/10 text-xs font-bold text-[#2DE2FF] uppercase tracking-widest">
            <Sparkles size={12} aria-hidden />
            Free sample list
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight mb-4">
            {countyLabel} tax sale,
            <br className="hidden sm:block" />{' '}
            <span className="bg-brand-gradient bg-clip-text text-transparent">
              already analyzed.
            </span>
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto mb-8">
            Every property on the {auctionLabel} {countyLabel} auction list, run through
            the BidWise deal engine — comps, values, deal scores, and a max-bid number.
            Here&apos;s the masked sample. Members see everything.
          </p>

          {/* Stats strip */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm">
            <span className="inline-flex items-center gap-2 text-slate-300">
              <CalendarDays size={15} className="text-[#10A7FF]" aria-hidden />
              Auction: <strong className="text-white font-bold">{auctionLabel}</strong>
            </span>
            <div className="hidden sm:block w-px h-4 bg-white/15" />
            <span className="inline-flex items-center gap-2 text-slate-300">
              <ShieldCheck size={15} className="shrink-0 text-[#10A7FF]" aria-hidden />
              <span>
                <strong className="text-white font-bold">{stats.totalProperties}</strong>{' '}
                properties analyzed
                {stats.strongDeals > 0 && (
                  <>
                    {' '}·{' '}
                    <strong className="text-emerald-400 font-bold">{stats.strongDeals}</strong>{' '}
                    strong deals flagged
                  </>
                )}
              </span>
            </span>
            {dataAsOf && (
              <>
                <div className="hidden sm:block w-px h-4 bg-white/15" />
                <span className="inline-flex items-center gap-1.5 text-slate-500">
                  <Clock size={13} aria-hidden />
                  Data as of{' '}
                  <strong className="text-slate-300 font-semibold">{dataAsOf}</strong>
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── MASKED SAMPLE TABLE ──────────────────────────────────────────── */}
      <section className="px-4 pb-12">
        <div className="max-w-6xl mx-auto">
          <TeaserTable rows={rows} />
          <p className="mt-3 text-center text-xs text-slate-600">
            {sampleNote}. Sorted by parcel — members see the list ranked by deal score.
          </p>
        </div>
      </section>

      {/* ── UNLOCK CTA ───────────────────────────────────────────────────── */}
      <section className="px-4 pb-14">
        <div
          className="max-w-5xl mx-auto rounded-2xl border p-8 sm:p-10 text-center"
          style={{ borderColor: 'rgba(16,167,255,0.35)', background: 'rgba(16,167,255,0.05)' }}
        >
          <h2 className="text-2xl sm:text-3xl font-black text-white mb-3">
            Unlock the full {countyLabel} list
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto mb-7">
            Full street addresses, exact ARVs, deal scores, ROI estimates, comps, and a
            recommended max bid for every property — before the gavel drops.
          </p>
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-2 px-8 py-4 btn-primary text-white font-bold rounded-xl transition-all hover:-translate-y-0.5"
          >
            Unlock the full list — start free <ArrowRight size={18} aria-hidden />
          </Link>
          <p className="mt-3 text-xs text-slate-600">
            {TRIAL_LABEL} free trial. Cancel anytime before your trial ends.
          </p>
        </div>
      </section>

      {/* ── EMAIL CAPTURE ────────────────────────────────────────────────── */}
      <section className="px-4 pb-24">
        <div className="max-w-2xl mx-auto rounded-2xl border border-white/10 bg-white/3 p-8">
          <h2 className="text-xl font-black text-white mb-2">
            Not ready to subscribe?
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            Drop your email and we&apos;ll send you the full {countyLabel} list for the{' '}
            {auctionLabel} auction.
          </p>
          <LeadCaptureForm county={countySlug} countyLabel={countyLabel} />
        </div>
      </section>

      <Footer />
    </div>
  )
}
