'use client'

import { useState } from 'react'
import { X, Leaf, Home, Search, Ruler, AlertTriangle, MapPin, ExternalLink, Bookmark, PlusCircle, CheckCircle2, FileSearch, Ban, Clock } from 'lucide-react'
import NetProceedsCalculator from './NetProceedsCalculator'
import ComparativeValueScale from './ComparativeValueScale'
import CompsMap from './CompsMap'
import ConfidenceBadge, { isNoBidState, noBidLabel } from '@/components/ConfidenceBadge'

// ─── TYPES (shared with DashboardClient) ────────────────────────────────────

export interface CompItem {
  a: string
  d: string
  p: number
  sqft?: number | null
  beds?: number | null
  baths?: number | null
  psf?: number | null
  top5?: boolean
  saleDate?: string
  // Pin coordinates for the comps map (absent on pre-2026-07-05 datasets)
  lat?: number | null
  lng?: number | null
}

export interface NormalizedProperty {
  id: number
  serverId?: string
  county: string
  addr: string
  city: string
  zip: string
  propType: 'SFR' | 'Vacant Land' | 'Commercial' | 'Multi-Family' | 'Unknown'
  auctionDate: string | null
  beds: number | null
  baths: number | null
  sqft: number | null
  yearBuilt: number | null
  lotAcres: number | null
  taxDue: number
  rehab: number
  arv: number | null
  countyAppraisedValue: number | null
  // Land-specific valuation (Vacant Land only)
  landValue: number | null
  landValueSource: string
  landAcreageFlag: string
  // As-is view (residential only) — sell distressed without repairs
  asisProfit: number | null
  asisRoi: number | null
  asisAllIn: number | null
  asisSalePrice: number | null
  profit: number | null
  roi: number | null
  score: number | null
  risk: number | null
  allIn: number
  closing: number
  legalClosing: number
  comps: number
  compPoolSize: number
  compQual: string
  arvConf: string
  dataConf: string
  // Wave 3 deal-engine fields — all OPTIONAL and null-safe. Absent on
  // pre-Wave-1/2 data. Plumbed through both normalizers so the presentation
  // layer (ConfidenceBadge, NO-BID / redemption dual-ROI) can read them.
  scoreTier?: string | null
  isNoBid?: boolean | null
  noBidReason?: string | null
  // Land-model flag: valuation is a rough heuristic; the parcel never ranks.
  estimateOnly?: boolean | null
  // Pipeline-stamped public Top-Deal verdict (execution/utils/top_deals.py).
  // Clients render this flag — the full gate reads server-only fields.
  topDeal?: boolean | null
  roiIfRedeemedYear1Pct?: number | null
  roiIfDeedMatures?: number | null
  structureConfirmed: boolean
  dealRating: string
  arvCalc: string
  rehabCalc: string
  rehabNotes: string
  // Pipe-separated stipulations from the pipeline (ARV guard, secondary
  // assessment records, floodplain, condotel units, rehab basis...).
  analysisNotes: string
  closeCalc: string
  allInCalc: string
  profitCalc: string
  roiCalc: string
  investViability: string
  taxId: string
  recommendedMaxBid: number | null
  assessorAddress: string
  appraisedValue: number | null
  minBid: number | null
  comparables: CompItem[]
  // Subject pin for the comps map (from county GIS parcel centroid; null when unavailable)
  latitude: number | null
  longitude: number | null
  scoreType: 'roi' | 'equity' | 'lot_value' | 'none' | 'N/A' | null
  zillowUrl: string | null
  // Pre-auction removal protection: 'cancelled_before_auction' means the parcel
  // was pulled from the auction before sale and any monthly-quota unlock spent
  // on it was credited back. removedAt is the ISO timestamp of removal.
  auctionStatus: 'active' | 'cancelled_before_auction'
  removedAt: string | null
  // Server-authoritative lock state from /api/data. When the dashboard loads
  // data through the authenticated route, locked rows arrive with null
  // financials and a masked address — there is nothing real to reveal client
  // side. `serverUnlocked === false` means the server withheld this row's
  // financials; `serverUnlockKey` is the stable identity used when unlocking.
  serverUnlocked: boolean | null
  serverUnlockKey: string | null
}

// ─── FORMATTERS ──────────────────────────────────────────────────────────────

const fmt$full = (v: number) =>
  '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtPct = (v: number | null) =>
  v == null ? '—' : v >= 999 ? '>999%' : v.toFixed(1) + '%'

function roiColor(roi: number | null) {
  if (roi == null) return '#94a3b8'
  if (roi >= 300) return '#10b981'
  if (roi >= 200) return '#10b981'
  if (roi >= 100) return '#f59e0b'
  if (roi >= 50) return '#f97316'
  return '#ef4444'
}

function scoreColor(s: number) {
  if (s >= 90) return '#10b981'
  if (s >= 75) return '#f59e0b'
  if (s >= 50) return '#f97316'
  return '#ef4444'
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function PropertyDetailPanel({
  prop,
  plan = 'starter',
  isAdmin = false,
  dataAsOf = null,
  onClose,
  onAddToPipeline,
}: {
  prop: NormalizedProperty
  plan?: 'starter' | 'pro' | 'expert'
  isAdmin?: boolean
  /** Pre-formatted "Data as of" date (e.g. "May 23, 2026") — freshness stamp
      parity with the mobile property screen's DataFreshness component. */
  dataAsOf?: string | null
  onClose: () => void
  onAddToPipeline?: (prop: NormalizedProperty) => void
}) {
  const [added, setAdded] = useState(false)
  const isStarterPlan = !isAdmin && plan === 'starter'
  const isLand       = prop.propType === 'Vacant Land'
  const isCommercial = prop.propType === 'Commercial' || prop.propType === 'Multi-Family'
  const isBelowThreshold = !isCommercial && prop.roi != null && prop.roi < 50
  // Guardrail screen-out / estimate-only: the parcel's ROI/profit/max-bid are
  // not trustworthy, so the panel suppresses those numbers and shows a NO-BID
  // state instead. Null-safe — absent fields → false → unchanged panel.
  const noBid = isNoBidState(prop.isNoBid, prop.arvConf, prop.estimateOnly)

  // No house number = land parcel with only a street/road name (e.g. "INWOOD TRL").
  // These have no valid Zillow listing or geocodable address.
  const hasHouseNumber = /^\d/.test(prop.addr.trim())

  // Score display helpers
  const scoreIsUnknown = prop.score == null
                      || prop.scoreType === 'none'
                      || prop.scoreType === 'N/A'
                      || (!prop.scoreType && prop.score === 0 && (isCommercial || isLand))
  const scoreLabel = prop.scoreType === 'equity'    ? 'Equity Score'
                   : prop.scoreType === 'lot_value' ? 'Lot Value Score'
                   : 'Deal Score'
  const scoreDisplay = scoreIsUnknown ? '—' : `${prop.score}/100`
  const scoreHex     = scoreIsUnknown ? '#94a3b8' : scoreColor(prop.score ?? 0)

  // Build Zillow URL with full city+state+zip to prevent cross-state address matches.
  // Prefer a stored validated URL from enrichment; fall back to address construction.
  function buildZillowUrl(): string {
    if (prop.zillowUrl) return prop.zillowUrl
    const base = prop.assessorAddress || prop.addr
    // If base already carries a state abbreviation, use as-is
    if (/\b[A-Z]{2}\b/.test(base) && base.length > prop.addr.length) return `https://www.zillow.com/homes/${encodeURIComponent(base)}_rb/`
    const parts: string[] = [prop.addr]
    if (prop.city) parts.push(prop.city)
    parts.push('GA')
    if (prop.zip) parts.push(prop.zip)
    return `https://www.zillow.com/homes/${encodeURIComponent(parts.join(', '))}_rb/`
  }

  // County parcel search — used as Zillow/Maps replacement for no-house-number parcels.
  function buildParcelSearchUrl(): string {
    const id = encodeURIComponent(prop.taxId || prop.addr)
    const county = (prop.county || '').toLowerCase()
    if (county.includes('gwinnett')) return `https://qpublic.net/ga/gwinnett/search.html?keywords=${id}`
    if (county.includes('dekalb'))   return `https://qpublic.schneidercorp.com/Application.aspx?AppID=994&LayerID=20990&PageTypeID=4&PageID=9022&KeyValue=${id}`
    if (county.includes('cobb'))     return `https://qpublic.net/ga/cobb/search.html?keywords=${id}`
    return `https://www.google.com/search?q=${encodeURIComponent(`${prop.taxId} ${prop.county} County GA parcel`)}`
  }

  const taxPct  = prop.allIn > 0 ? Math.max(1, Math.round((prop.taxDue / prop.allIn) * 100)) : 3
  const rehPct  = prop.allIn > 0 ? Math.max(1, Math.round((prop.rehab  / prop.allIn) * 100)) : 82
  const clsPct  = Math.max(1, 100 - taxPct - rehPct)

  const rc = roiColor(prop.roi)

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[380px] z-50 flex flex-col shadow-2xl shadow-slate-900/10 transition-transform transform translate-x-0">
      {/* Backdrop click-away */}
      <div
        className="fixed inset-0 -z-10 bg-slate-900/30 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="flex flex-col h-full bg-white dark:bg-navy-800 border-l border-slate-200 dark:border-white/10 overflow-y-auto w-full md:w-[380px] absolute right-0 shadow-[-10px_0_30px_rgba(0,0,0,0.05)]">

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/10 sticky top-0 bg-white/95 dark:bg-navy-800/95 backdrop-blur-sm z-10">
          <span className="text-sm font-bold text-slate-800 dark:text-white">Property Detail</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 px-5 py-4 space-y-5">

          {/* ── NO-BID / ESTIMATE-ONLY BANNER ──────────────────────────── */}
          {noBid && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 shadow-sm">
              <Ban size={14} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-red-600 dark:text-red-400">
                  {noBidLabel(prop.isNoBid, prop.arvConf, prop.estimateOnly)} — Screened Out
                </div>
                <div className="text-xs text-red-500 dark:text-red-400 mt-0.5 leading-relaxed font-medium">
                  {prop.noBidReason
                    ? prop.noBidReason
                    : 'This parcel failed the deal guardrails or lacks a reliable valuation. Its ROI and profit figures are not shown because they would be misleading.'}
                </div>
              </div>
            </div>
          )}

          {/* ── REMOVED-BEFORE-AUCTION BANNER ──────────────────────────── */}
          {prop.auctionStatus === 'cancelled_before_auction' && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-300 dark:border-white/20 shadow-sm">
              <Ban size={14} className="text-slate-500 dark:text-slate-300 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Removed Before Auction</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  This parcel was withdrawn from the auction before sale — typically the owner
                  redeemed or paid the taxes. It is no longer biddable. If you had unlocked it,
                  the unlock has been credited back to your monthly allowance automatically
                  {prop.removedAt
                    ? <> (removed {new Date(prop.removedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})</>
                    : null}.
                </div>
              </div>
            </div>
          )}

          {/* ── ANALYSIS STIPULATIONS ──────────────────────────────────── */}
          {prop.analysisNotes && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 shadow-sm">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-amber-700 dark:text-amber-400">Analysis Stipulations</div>
                <ul className="text-xs text-amber-700/90 dark:text-amber-400/90 mt-1 space-y-1 leading-relaxed list-disc pl-4">
                  {prop.analysisNotes.split(' | ').map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* ── NO-HOUSE-NUMBER BANNER ─────────────────────────────────── */}
          {!hasHouseNumber && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/15 shadow-sm">
              <FileSearch size={14} className="text-slate-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-slate-600 dark:text-slate-300">Land Parcel — No Street Address</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  This record has no house number. It is likely a vacant lot or unimproved parcel
                  identified only by a road name. Zillow and Google Maps cannot locate it. Use the
                  Parcel Search button below with Tax ID <strong>{prop.taxId}</strong> to look up
                  county records.
                </div>
              </div>
            </div>
          )}

          {/* ── COMMERCIAL VALUATION WARNING ───────────────────────────── */}
          {isCommercial && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 shadow-sm">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-amber-700 dark:text-amber-400">Specialist Valuation Required</div>
                <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 leading-relaxed font-medium">
                  {prop.propType} properties cannot be valued using residential comps.
                  ARV and ROI figures are unreliable. Use the county appraised value as a
                  reference only and obtain a commercial appraisal before bidding.
                  Rehab costs require a commercial contractor estimate.
                </div>
              </div>
            </div>
          )}

          {/* ── BELOW-THRESHOLD BANNER ─────────────────────────────────── */}
          {!isStarterPlan && isBelowThreshold && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 shadow-sm">
              <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-red-600 dark:text-red-400">Below Investment Threshold</div>
                <div className="text-xs text-red-500 dark:text-red-400 mt-0.5 leading-relaxed font-medium">
                  Post-rehab ROI {fmtPct(prop.roi)} does not meet minimum 50% threshold. Do not bid at current tax due.
                </div>
              </div>
            </div>
          )}

          {/* ── LOW CONFIDENCE BANNER ───────────────────────────────────── */}
          {!isStarterPlan && prop.dataConf === 'LOW' && prop.propType !== 'Vacant Land' && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 shadow-sm">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-amber-600 dark:text-amber-400">Estimated Analysis — Verify Before Bidding</div>
                <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 leading-relaxed">
                  No sqft found in any database. ARV and ROI are based on the county assessor&apos;s appraised value — treat as a floor estimate. Confirm property specs before submitting a bid.
                </div>
              </div>
            </div>
          )}

          {/* ── PROPERTY HEADER ────────────────────────────────────────── */}
          <div>
            <div className="text-lg font-black text-slate-800 dark:text-white tracking-tight mb-2">{prop.addr}</div>
            <div className="flex flex-wrap gap-1.5">
              {prop.city && (
                <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700/50 text-xs font-semibold shadow-sm">
                  {prop.city}, GA {prop.zip}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border flex items-center gap-1 shadow-sm ${
                isLand
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/50'
                  : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700/50'
              }`}>
                {isLand ? <Leaf size={10} /> : <Home size={10} />}
                {prop.propType}
              </span>
              {prop.dealRating && (
                <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700/50 text-xs font-semibold shadow-sm">
                  {prop.dealRating}
                </span>
              )}
              <ConfidenceBadge arvConfidence={prop.arvConf} scoreTier={prop.scoreTier} />
              {!isStarterPlan && prop.compQual && (
                <span className="px-2 py-0.5 rounded-md bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10 text-xs font-semibold shadow-sm">
                  {prop.compQual} comps
                </span>
              )}
            </div>
            {!isStarterPlan && prop.arvConf && (
              <div className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                {prop.arvConf} ARV confidence
              </div>
            )}
            {dataAsOf && (
              <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                <Clock size={10} />
                Data as of <strong className="text-slate-500 dark:text-slate-400 font-semibold">{dataAsOf}</strong>
              </div>
            )}
          </div>

          {/* ── RECOMMENDED MAX BID ────────────────────────────────────── */}
          {/* Suppressed on NO-BID / ESTIMATE-ONLY: never recommend a bid on a
              parcel the guardrails screened out. */}
          {!isStarterPlan && !noBid && prop.recommendedMaxBid != null && (
            <div className="rounded-xl border-2 border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 flex items-center justify-between shadow-sm">
              <div>
                <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Recommended Max Bid</div>
                <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-0.5">
                  {'$' + Math.round(prop.recommendedMaxBid).toLocaleString()}
                </div>
                {prop.minBid != null && (
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                    Opening bid: {'$' + Math.round(prop.minBid).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="text-emerald-300 dark:text-emerald-600">
                <Bookmark size={28} strokeWidth={1.5} />
              </div>
            </div>
          )}

          {/* ── ACTION BUTTONS ──────────────────────────────────────────── */}
          <div className="flex gap-2">
            {hasHouseNumber ? (
              <>
                <button
                  onClick={() => {
                    const q = encodeURIComponent(prop.assessorAddress || [prop.addr, prop.city, 'GA', prop.zip].filter(Boolean).join(', '))
                    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank', 'noopener')
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-blue-200 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                >
                  <MapPin size={13} /> Street View
                </button>
                <button
                  onClick={() => window.open(buildZillowUrl(), '_blank', 'noopener')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-navy-700 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
                >
                  <ExternalLink size={13} /> Zillow
                </button>
              </>
            ) : (
              <button
                onClick={() => window.open(buildParcelSearchUrl(), '_blank', 'noopener')}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-navy-700 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
              >
                <FileSearch size={13} /> Parcel Search
              </button>
            )}
            <button
              onClick={() => {
                if (!added && onAddToPipeline) {
                  onAddToPipeline(prop)
                  setAdded(true)
                  setTimeout(() => setAdded(false), 2500)
                }
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-bold transition-all ${
                added
                  ? 'border-emerald-300 dark:border-emerald-700/50 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                  : 'border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40'
              }`}
            >
              {added ? <CheckCircle2 size={13} /> : <PlusCircle size={13} />}
              {added ? 'Added!' : 'Pipeline'}
            </button>
          </div>

          {/* ── PROPERTY SPECS ──────────────────────────────────────────── */}
          {(isCommercial ? prop.appraisedValue != null : (prop.beds != null || prop.baths != null || prop.sqft != null || prop.yearBuilt != null || prop.appraisedValue != null)) && (
            <div className="grid grid-cols-2 gap-2">
              {[
                !isCommercial && prop.beds      != null ? { label: 'Beds',       val: String(prop.beds) }                                       : null,
                !isCommercial && prop.baths     != null ? { label: 'Baths',      val: String(prop.baths) }                                      : null,
                !isCommercial && prop.sqft      != null ? { label: 'Sq Ft',      val: Number(prop.sqft).toLocaleString() }                      : null,
                !isCommercial && prop.yearBuilt != null ? { label: 'Year Built', val: String(prop.yearBuilt) }                                  : null,
                prop.appraisedValue != null             ? { label: 'Appraised',  val: '$' + Math.round(prop.appraisedValue).toLocaleString() }  : null,
              ].filter(Boolean).map(m => (
                <div key={m!.label} className="flex justify-between px-3 py-2 bg-white dark:bg-navy-700 border border-slate-200 dark:border-white/10 rounded-lg shadow-sm">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{m!.label}</span>
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{m!.val}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── KEY METRICS ────────────────────────────────────────────── */}
          {/* ROI tile: NO-BID suppresses the number entirely; otherwise, when the
              engine provides a redemption year-1 ROI, the tile switches to the
              "Redeemed yr1" figure and a second tile shows the "If deed matures"
              ROI (never a single blended number). */}
          {(() => {
            const roiTile = noBid
              ? { label: isLand ? 'Land Value ROI' : 'ROI', val: 'NO BID', color: '#ef4444' }
              : prop.roiIfRedeemedYear1Pct != null
                ? { label: 'Redeemed yr1', val: fmtPct(prop.roiIfRedeemedYear1Pct), color: rc }
                : {
                    label: isLand ? 'Land Value ROI' : isCommercial ? 'ROI' : 'Post-Rehab ROI',
                    val:   isCommercial ? '—' : fmtPct(prop.roi),
                    color: isCommercial ? '#94a3b8' : rc,
                  }
            const showDeedTile = !noBid && prop.roiIfRedeemedYear1Pct != null
            const tiles = [
              roiTile,
              ...(showDeedTile
                ? [{ label: 'If deed matures', val: fmtPct(prop.roiIfDeedMatures ?? null), color: rc }]
                : []),
              { label: scoreLabel, val: scoreDisplay, color: scoreHex },
              ...(!isStarterPlan && !showDeedTile
                ? [{ label: 'Comps Used', val: prop.comps > 0 ? prop.comps.toString() : '—', color: '#f59e0b' }]
                : []),
            ]
            const cols = tiles.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'
            return (
              <div className={`grid ${cols} gap-3`}>
                {tiles.map(m => (
                  <div key={m.label} className="bg-white dark:bg-navy-700 border border-slate-200 dark:border-white/10 shadow-sm rounded-xl p-3 text-center">
                    <div className="text-[19px] font-black" style={{ color: m.color }}>{m.val}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mt-1 tracking-wide">{m.label}</div>
                  </div>
                ))}
              </div>
            )
          })()}

          {isStarterPlan && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
              Starter shows the unlocked listing, score, and ROI. Upgrade to Pro for comps, max bid, profit, ARV, and rehab details.
            </div>
          )}

          {/* ── VALUATION SECTION — three branches ─────────────────────── */}
          {!isStarterPlan && (isCommercial ? (
            /* Commercial: acquisition cost only */
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-navy-800 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                <Ruler size={13} className="text-amber-500" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Acquisition Cost (Reference Only)</span>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                {[
                  { label: 'Opening Bid (Tax Due)',  val: fmt$full(prop.taxDue) },
                  { label: 'Legal & Closing Costs',  val: fmt$full(prop.legalClosing) },
                ].map(row => (
                  <div key={row.label} className="flex justify-between gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{row.label}</span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{row.val}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-white/10">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Total Acquisition Cost</span>
                  <span className="text-xs font-black text-slate-800 dark:text-white">{fmt$full(prop.allIn)}</span>
                </div>
                {prop.appraisedValue != null && (
                  <div className="flex justify-between gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">County Appraised Value (reference)</span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">${Math.round(prop.appraisedValue).toLocaleString()}</span>
                  </div>
                )}
                <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium pt-1 leading-relaxed">
                  ARV and ROI do not apply to {prop.propType} properties. Engage a commercial broker or appraiser before bidding.
                </div>
              </div>
            </div>
          ) : isLand ? (
            /* Vacant Land: 20% land value rule */
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-navy-800 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                <Leaf size={13} className="text-emerald-500" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Land Valuation</span>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                {prop.landAcreageFlag === 'ACREAGE_UNKNOWN' && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 mb-1">
                    <AlertTriangle size={11} className="text-amber-500 shrink-0 mt-0.5" />
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium leading-relaxed">
                      Acreage not confirmed. Estimate not adjusted for lot size — verify before bidding.
                    </span>
                  </div>
                )}
                {prop.landAcreageFlag === 'NO_COMPS' && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 mb-1">
                    <AlertTriangle size={11} className="text-red-500 shrink-0 mt-0.5" />
                    <span className="text-[10px] text-red-600 dark:text-red-400 font-medium leading-relaxed">
                      No comparable sales available — land value cannot be estimated.
                    </span>
                  </div>
                )}
                {[
                  { label: 'Opening Bid (Tax Due)', val: fmt$full(prop.taxDue) },
                  { label: 'Legal & Closing Costs', val: fmt$full(prop.legalClosing) },
                ].map(row => (
                  <div key={row.label} className="flex justify-between gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{row.label}</span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{row.val}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-white/10">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">All-In Cost</span>
                  <span className="text-xs font-black text-slate-800 dark:text-white">{fmt$full(prop.allIn)}</span>
                </div>
                {prop.landValue != null && (
                  <>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs text-slate-600 dark:text-slate-300 font-bold">Estimated Land Value</span>
                      <span className="text-xs font-black text-emerald-700 dark:text-emerald-300">{fmt$full(prop.landValue)}</span>
                    </div>
                    {prop.landValueSource && (
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 italic">{prop.landValueSource}</div>
                    )}
                    {prop.lotAcres != null && (
                      <div className="text-[10px] text-slate-400 dark:text-slate-500">Lot size: {prop.lotAcres} acres</div>
                    )}
                    <div className="flex justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-white/10">
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Net Profit = Land Value − All-In</span>
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        {noBid ? <span className="text-red-500 dark:text-red-400">NO BID</span> : prop.profit != null ? fmt$full(prop.profit) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Land Value ROI</span>
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{noBid ? <span className="text-red-500 dark:text-red-400">NO BID</span> : fmtPct(prop.roi)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Residential: post-rehab + as-is views */
            <div className="space-y-3">
              {/* Post-rehab */}
              <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-navy-800 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                  <Ruler size={13} className="text-emerald-500" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Post-Rehab Flip</span>
                </div>
                <div className="px-4 py-3 space-y-2.5">
                  {[
                    { label: 'Opening Bid (Tax Due)', val: fmt$full(prop.taxDue) },
                    { label: 'Est. Rehab Cost',        val: fmt$full(prop.rehab) },
                    { label: 'Legal & Closing Costs',  val: fmt$full(prop.legalClosing) },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{row.label}</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{row.val}</span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-white/10">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">All-In Cost</span>
                    <span className="text-xs font-black text-slate-800 dark:text-white">{fmt$full(prop.allIn)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">After-Repair Value (ARV)</span>
                    <span className="text-xs font-black text-slate-800 dark:text-white">{prop.arv != null ? fmt$full(prop.arv) : '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-white/10">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Net Profit</span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {noBid ? <span className="text-red-500 dark:text-red-400">NO BID</span> : prop.profit != null ? fmt$full(prop.profit) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Post-Rehab ROI</span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{noBid ? <span className="text-red-500 dark:text-red-400">NO BID</span> : fmtPct(prop.roi)}</span>
                  </div>
                </div>
              </div>
              {/* What-if net-proceeds calculator — seeded from pipeline numbers.
                  Guards: plan tier (outer !isStarterPlan), server unlock, and
                  non-null financials (locked rows arrive with these nulled). */}
              {prop.serverUnlocked !== false && prop.arv != null && prop.allIn > 0 && (
                <NetProceedsCalculator
                  seedPrice={prop.arv}
                  seedRehab={prop.rehab}
                  taxDue={prop.taxDue}
                  fixedCosts={Math.max(0, prop.allIn - prop.taxDue - prop.rehab)}
                  rehabBasis={prop.rehabCalc || undefined}
                />
              )}
              {/* As-is flip */}
              {prop.asisProfit != null && (
                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-navy-800 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                    <Ruler size={13} className="text-blue-400" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">As-Is Wholesale Flip</span>
                    <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700/50 font-bold">No Repairs</span>
                  </div>
                  <div className="px-4 py-3 space-y-2.5">
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                      Sell to an investor at distressed price (ARV − rehab). No repair cost to you.
                    </div>
                    {[
                      { label: 'Opening Bid (Tax Due)',       val: fmt$full(prop.taxDue) },
                      { label: 'Legal & Closing Costs',       val: fmt$full(prop.legalClosing) },
                    ].map(row => (
                      <div key={row.label} className="flex justify-between gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{row.label}</span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{row.val}</span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-white/10">
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">As-Is All-In (no rehab)</span>
                      <span className="text-xs font-black text-slate-800 dark:text-white">{prop.asisAllIn != null ? fmt$full(prop.asisAllIn) : '—'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">As-Is Sale Price (ARV − rehab)</span>
                      <span className="text-xs font-black text-slate-800 dark:text-white">{prop.asisSalePrice != null ? fmt$full(prop.asisSalePrice) : '—'}</span>
                    </div>
                    <div className="flex justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-white/10">
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">As-Is Net Profit</span>
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{fmt$full(prop.asisProfit)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">As-Is ROI</span>
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{fmtPct(prop.asisRoi)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* ── COMPARABLE SALES ────────────────────────────────────────── */}
          {!isStarterPlan && prop.comparables.length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                {isLand
                  ? `Area Home Sales · ${prop.comparables.length} nearby`
                  : `Comparable Sales · ${prop.comparables.length} used in ARV`}
              </div>
              <div className="flex items-center gap-2 py-2 px-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg mb-2 shadow-sm">
                <Search size={12} className="text-slate-400 dark:text-slate-500" />
                <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                  {isLand
                    ? 'Recent home sales near this lot — area value context (not land sales)'
                    : 'Recent verified home sales · Top 5 carry 2× weight'}
                </span>
              </div>
              {/* Zillow-style comps map — subject pin + numbered comp pins.
                  Renders only when coordinates + the browser Maps key exist. */}
              {prop.serverUnlocked !== false && (
                <CompsMap
                  subject={
                    prop.latitude != null && prop.longitude != null
                      ? { lat: prop.latitude, lng: prop.longitude, address: prop.addr }
                      : null
                  }
                  comps={prop.comparables}
                />
              )}
              {/* Zillow-style comparative value strip — dots numbered to match
                  the comp cards below. Locked rows ship null arv/landValue. */}
              {prop.serverUnlocked !== false && (isLand ? prop.landValue : prop.arv) != null && (
                <ComparativeValueScale
                  comps={prop.comparables}
                  subjectValue={(isLand ? prop.landValue : prop.arv) as number}
                  subjectLabel={isLand ? 'Land Value' : 'ARV'}
                />
              )}
              <div className="space-y-1.5">
                {prop.comparables.map((c, i) => {
                  const isRich = c.sqft != null || c.beds != null || c.psf != null
                  const specs = isRich
                    ? [
                        c.beds != null && c.baths != null ? `${c.beds}bd/${c.baths}ba` : c.beds != null ? `${c.beds}bd` : null,
                        c.sqft != null ? `${Number(c.sqft).toLocaleString()} sqft` : null,
                        c.psf != null ? `$${Math.round(c.psf)}/sqft` : null,
                      ].filter(Boolean).join(' · ')
                    : c.d
                  return (
                    <div key={i} className={`px-3 py-2.5 rounded-xl border shadow-sm ${
                      c.top5
                        ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-700/40'
                        : 'bg-white dark:bg-navy-700 border-slate-200 dark:border-white/10'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`w-[16px] h-[16px] rounded-full flex items-center justify-center text-[8px] font-black text-white shrink-0 ${
                              c.top5 ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-slate-400 dark:bg-slate-500'
                            }`}>
                              {i + 1}
                            </span>
                            {c.top5 && (
                              <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/50 font-black uppercase tracking-wider shrink-0">
                                Top 5
                              </span>
                            )}
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-700/50 font-bold shrink-0">
                              {/* Comps are house sales even for land subjects — never badge them "LAND" */}
                              {isLand ? 'AREA HOME' : 'SFR'}
                            </span>
                          </div>
                          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{c.a}</div>
                          {specs && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">{specs}</div>
                          )}
                          {(c.saleDate || (!isRich && c.d)) && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {c.saleDate ? `Sold ${c.saleDate}` : c.d}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[13px] font-black text-slate-800 dark:text-white">
                            {c.p >= 1000 ? '$' + Math.round(c.p / 1000) + 'K' : '$' + c.p.toLocaleString()}
                          </div>
                          {c.top5 && (
                            <div className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold">2× weight</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── COST STACK ──────────────────────────────────────────────── */}
          {!isStarterPlan && (
          <div>
            <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Cost Stack</div>
            <div className="flex h-3.5 rounded-md overflow-hidden gap-0.5 shadow-inner">
              <div className="h-full rounded-l-md" style={{ width: `${taxPct}%`, background: '#3b82f6' }} />
              {prop.rehab > 0 && (
                <div className="h-full" style={{ width: `${rehPct}%`, background: '#f59e0b' }} />
              )}
              <div className="h-full rounded-r-md" style={{ width: `${clsPct}%`, background: '#8b5cf6' }} />
            </div>
            <div className="flex gap-4 mt-2">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                <div className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
                Tax Bid {taxPct}%
              </div>
              {prop.rehab > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  <div className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                  Rehab {rehPct}%
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                <div className="w-2.5 h-2.5 rounded-sm bg-purple-500" />
                Costs {clsPct}%
              </div>
            </div>
          </div>
          )}

          {/* ── CALCULATION DETAIL ──────────────────────────────────────── */}
          {!isStarterPlan && (prop.arvCalc || prop.rehabCalc || prop.profitCalc || prop.taxId) && (
            <div>
              <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Calculation Detail</div>
              <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-navy-800 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                  <Ruler size={11} className="text-slate-400 dark:text-slate-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-400 font-semibold">From Pipeline Output</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-white/10">
                  {[
                    { label: 'ARV',             val: prop.arvCalc,    color: '#64748b' },
                    { label: 'Rehab',           val: prop.rehabCalc,  color: '#64748b' },
                    { label: 'Notes',           val: prop.rehabNotes, color: '#475569' },
                    { label: 'Legal/Closing',   val: prop.closeCalc,  color: '#64748b' },
                    { label: 'All-In',          val: prop.allInCalc,  color: '#64748b' },
                    { label: 'Profit',          val: prop.profitCalc, color: '#059669' },
                    { label: 'ROI',             val: prop.roiCalc,    color: '#059669' },
                    { label: 'Comp Quality',    val: prop.compQual,   color: '#d97706' },
                    { label: 'ARV Confidence',  val: prop.arvConf,    color: '#d97706' },
                    { label: 'Tax ID',          val: prop.taxId,      color: '#475569' },
                  ].filter(r => r.val).map(row => (
                    <div key={row.label} className="flex justify-between gap-4 px-4 py-2.5">
                      <span className="text-[11.5px] text-slate-500 dark:text-slate-400 font-medium shrink-0">{row.label}</span>
                      <span className="text-[11.5px] font-semibold text-right leading-relaxed" style={{ color: row.color }}>
                        {row.val}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Investment Viability removed: only legacy land-deal scripts ever
              populated it, so it was absent for nearly every listing. */}

          {/* Bottom padding */}
          <div className="h-6" />

        </div>
      </div>
    </div>
  )
}
