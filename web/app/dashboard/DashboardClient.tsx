'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { csvRow } from '@/lib/csv'
import { pickDefaultEntry } from '@/lib/auction-select'
import {
  BarChart3, Settings, LogOut, ChevronDown,
  FileText, Zap, TrendingUp, Home,
  Leaf, Building2, Download, Layers,
  MapPin, Tag, RefreshCw,
  Gem, Landmark, CheckCircle, X, Menu,
  Sparkles, Eye, Briefcase, Lock,
  CreditCard, Ban, AlertTriangle,
  Calculator, Clock, Hammer, Search
} from 'lucide-react'
import PropertyDetailPanel, { NormalizedProperty, CompItem } from './PropertyDetailPanel'
import { ThemeToggle } from '@/components/ThemeToggle'
import ConfidenceBadge, { isNoBidState, noBidLabel } from '@/components/ConfidenceBadge'
import { isTopDeal } from '@/lib/topDeals'
import type { FeatureFlags } from '@/lib/feature-flags'
import { normalizePlan, type PlanKey } from '@/lib/plan'
import { trackEvent } from '@/lib/observability'
import {
  type PipelineDeal,
  type PipelineStatus,
  fetchPipeline,
  addToPipelineServer,
  updatePipelineStatusServer,
  removeFromPipelineServer,
  clearPipelineServer,
  syncLegacyDeals,
  isServerDealId,
  parcelIdFor,
} from '@/lib/pipeline-api'

// ─── TYPES ───────────────────────────────────────────────────────────────────

type User = { email?: string | null; user_metadata?: { plan?: string } } | null

interface County {
  slug: string
  name: string
  state: string
  auctionType: string
  nextAuction: string | null
  dataFile: string | null
}

interface AuctionEntry {
  auction_date: string
  label: string
  file: string
  total_properties: number
  residential: number
  multi_family: number
  commercial: number
  land: number
  top_deals: number
  generated: string
}

// PipelineDeal / PipelineStatus now live in lib/pipeline-api.ts — the deal
// pipeline is server-backed (auction_pipeline, shared with mobile) with
// localStorage kept as a paint-fast cache + offline fallback.

const AUCTION_UNLOCK_LIMITS: Record<PlanKey, number | null> = {
  starter: 10,
  pro: 25,
  expert: null,
}

function currentMonthKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function propertyUnlockKey(p: NormalizedProperty) {
  return [
    p.county || 'unknown',
    p.auctionDate || 'no-date',
    p.taxId || p.addr || p.id,
  ].join(':')
}

// ─── COUNTY REGISTRY ─────────────────────────────────────────────────────────

const COUNTIES: County[] = [
  { slug: 'dekalb',   name: 'DeKalb County',   state: 'GA', auctionType: 'Tax Deed Sale', nextAuction: 'September 1, 2026', dataFile: '/data/dekalb.json'   },
  { slug: 'gwinnett', name: 'Gwinnett County', state: 'GA', auctionType: 'Tax Deed Sale', nextAuction: 'August 4, 2026',   dataFile: '/data/gwinnett.json' },
  { slug: 'cobb',     name: 'Cobb County',     state: 'GA', auctionType: 'Tax Deed Sale', nextAuction: 'November 3, 2026', dataFile: '/data/cobb.json'     },
  { slug: 'clayton',  name: 'Clayton County',  state: 'GA', auctionType: 'Tax Deed Sale', nextAuction: 'August 4, 2026',   dataFile: '/data/clayton.json'  },
]

// ─── DATA NORMALIZATION ───────────────────────────────────────────────────────

function classifyType(
  type: string,
  propertyClass?: string,
  sqft?: number | null,
  beds?: number | null,
  appraisedValue?: number | null,
  structureConfirmed?: boolean,
): NormalizedProperty['propType'] {
  // Step 1: Definitive ArcGIS codes and full-string Gwinnett class names win.
  if (propertyClass) {
    const pc = propertyClass.trim().toUpperCase()
    // DeKalb short codes
    if (/^RM[-\s]?\d/.test(pc) || ['RAD', 'TR'].includes(pc)) return 'Multi-Family'
    if (pc === 'C4') return 'Multi-Family'  // DeKalb C4 = Condominium
    if (/^[CI]\d/.test(pc)) return 'Commercial'
    // Gwinnett full-string codes (ArcGIS returns descriptions, not short codes)
    if (['COMMERCIAL', 'INDUSTRIAL'].includes(pc)) return 'Commercial'
    if (['MULTI-FAMILY', 'MULTI_FAMILY', 'MULTIFAMILY', 'MULTI FAMILY', 'APARTMENT', 'APARTMENTS'].includes(pc)) return 'Multi-Family'
  }

  // Step 2: Trust the pipeline's explicit property_type string — it already ran
  // classification logic with full enrichment context.
  if (type) {
    const t = type.toLowerCase()
    if (t.includes('vacant') || t.includes('land') || t.includes('lot')) return 'Vacant Land'
    if (
      t.includes('multi') || t.includes('apartment') ||
      t.includes('duplex') || t.includes('triplex') ||
      t.includes('quadplex') || t.includes('fourplex')
    ) return 'Multi-Family'
    if (t.includes('commercial') || t.includes('industrial') || t.includes('office') || t.includes('retail')) return 'Commercial'
    if (t.includes('single') || t.includes('sfr') || t.includes('residential')) return 'SFR'
  }

  // Step 3: R-prefix heuristic — only reached when type string is empty/unrecognized.
  // R-prefix means residential zone, not necessarily a structure. Use sqft/beds presence
  // as a proxy for whether a building exists.
  if (propertyClass) {
    const pc = propertyClass.trim().toUpperCase()
    if (/^R\d/.test(pc)) {
      const hasStructure = (sqft != null && sqft > 0) || (beds != null && beds > 0)
      if (!hasStructure) return 'Vacant Land'
      return 'SFR'
    }
  }

  // Step 4: Final fallback — no type, no class, check for structure signals.
  const hasStructure = (sqft != null && sqft > 0) || (beds != null && beds > 0)
  return hasStructure ? 'SFR' : 'Vacant Land'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw comps come from untyped per-county dataset JSON
function buildComps(rawComps: any[], addr: string, rankedComps?: any[]): CompItem[] {
  // Prefer ranked_comps from the property's own analysis (richer, already filtered+ranked)
  if (Array.isArray(rankedComps) && rankedComps.length > 0) {
    return rankedComps.map(c => ({
      a: typeof c.address === 'object' && c.address !== null
        ? [c.address.streetAddress, c.address.city, c.address.state].filter(Boolean).join(', ')
        : (c.address || ''),
      d: '',
      p: c.sale_price || 0,
      sqft: c.sqft ?? null,
      beds: c.beds ?? null,
      baths: c.baths ?? null,
      psf: c.psf ?? null,
      top5: c.top5 ?? false,
      saleDate: c.sale_date || '',
      lat: c.lat ?? null,
      lng: c.lng ?? null,
    }))
  }
  // Fall back to global comps pool (legacy data without ranked_comps)
  if (!Array.isArray(rawComps)) return []
  return rawComps
    .filter(c => c.used_for_address === addr)
    .map(c => {
      const ms = typeof c.sale_date === 'number' ? c.sale_date : Number(c.sale_date)
      const soldDate = ms
        ? new Date(ms > 9_999_999_999 ? ms : ms * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        : ''
      const detail = [
        c.bedrooms && c.bathrooms ? `${c.bedrooms}bd/${c.bathrooms}ba` : null,
        c.sqft ? `${Number(c.sqft).toLocaleString()} sqft` : null,
        c.year_built ? `built ${c.year_built}` : null,
        soldDate ? `sold ${soldDate}` : null,
      ].filter(Boolean).join(' · ')
      return {
        a: c.address || '', d: detail, p: c.sale_price || 0,
        lat: c.latitude ?? null, lng: c.longitude ?? null,
      }
    })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- normalizes untyped per-county dataset JSON into typed rows
function normalizeData(data: any, slug: string): { props: NormalizedProperty[]; meta: any } {
  // All counties now output {properties, comparables} — same schema as DeKalb
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped per-county dataset JSON
  const rawProps: any[] = Array.isArray(data) ? data : (data.properties || [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped per-county dataset JSON
  const rawComps: any[] = data.comparables || []
  const metaAuctionDate: string | null = (!Array.isArray(data) && data.auction_date) ? data.auction_date : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- per-property record from untyped county JSON
  const props: NormalizedProperty[] = rawProps.map((p: any, i: number) => {
    const addr = p.full_address || p.address || ''
    const legalClosing =
      p.legal_closing_costs ??
      ((p.closing_costs || 0) +
        (p.title_insurance || 0) +
        (p.transfer_tax || 0) +
        (p.recording_fees || 0) +
        (p.quiet_title_cost || 0))
    return {
      id: i + 1,
      county: p.county || slug,
      addr,
      city:       p.city        || '',
      zip:        p.zip_code    || '',
      propType:   classifyType(p.property_type, p.property_class, p.sqft, p.beds ?? p.bedrooms, p.appraised_value, p.structure_confirmed),
      auctionDate: p.auction_date || metaAuctionDate || null,
      beds:       p.beds   ?? p.bedrooms  ?? null,
      baths:      p.baths  ?? p.bathrooms ?? null,
      sqft:       p.sqft       ?? null,
      yearBuilt:  p.year_built  ?? null,
      lotAcres:   p.lot_acres   ?? null,
      taxDue:     p.tax_due     || 0,
      rehab:               p.estimated_rehab_cost || p.estimated_rehab || p.rehab_cost || 0,
      arv:                 p.arv         ?? null,
      countyAppraisedValue: p.county_appraised_value ?? null,
      landValue:       p.land_value        ?? null,
      landValueSource: p.land_value_source || '',
      landAcreageFlag: p.land_acreage_flag || '',
      asisProfit:    p.asis_net_profit    ?? null,
      asisRoi:       p.asis_roi_percent   ?? null,
      asisAllIn:     p.asis_all_in_cost   ?? null,
      asisSalePrice: p.asis_sale_price    ?? null,
      profit:     p.net_profit  ?? p.gross_profit ?? null,
      roi:        p.roi_percent ?? p.roi_pct       ?? null,
      score:      p.deal_score  ?? null,
      risk:       p.risk_score  ?? null,
      allIn:      p.all_in_cost || 0,
      closing:    p.closing_costs || 0,
      legalClosing,
      comps:        p.comps_used_for_arv ?? p.comp_count ?? p.arv_comp_count ?? 0,
      compPoolSize: p.comp_count         ?? p.arv_comp_count ?? 0,
      compQual:   p.comp_quality_rating || '',
      arvConf:    p.arv_confidence      || '',
      // Wave 3 deal-engine fields — null-safe passthrough.
      scoreTier:             p.score_tier                ?? null,
      isNoBid:               p.is_no_bid                 ?? null,
      noBidReason:           p.no_bid_reason             ?? null,
      estimateOnly:          p.estimate_only             ?? null,
      topDeal:               p.top_deal                  ?? null,
      roiIfRedeemedYear1Pct: p.roi_if_redeemed_year1_pct ?? null,
      roiIfDeedMatures:      p.roi_if_deed_matures       ?? null,
      dataConf:            p.data_confidence    || '',
      structureConfirmed:  p.structure_confirmed ?? false,
      dealRating:          p.deal_rating         || '',
      arvCalc:    p.arv_calculation || p.arv_method || '',
      rehabCalc:  p.rehab_calculation   || '',
      rehabNotes: p.rehab_notes         || '',
      analysisNotes: p.analysis_notes   || '',
      closeCalc:  p.closing_calculation || '',
      allInCalc:  p.all_in_breakdown || p.all_in_calculation || '',
      profitCalc: p.profit_calculation  || '',
      roiCalc:    p.roi_calculation      || '',
      investViability: p.investment_viability || '',
      taxId:      p.tax_id || '',
      recommendedMaxBid: p.recommended_max_bid ?? null,
      assessorAddress:   p.assessor_address   || addr,
      appraisedValue:    p.appraised_value     ?? null,
      minBid:            p.min_bid             ?? null,
      comparables: buildComps(rawComps, addr, p.ranked_comps),
      latitude:   p.latitude  ?? null,
      longitude:  p.longitude ?? null,
      scoreType:  p.score_type ?? null,
      zillowUrl:  p.zillow_url ?? null,
      auctionStatus: p.auction_status === 'cancelled_before_auction' ? 'cancelled_before_auction' : 'active',
      removedAt:  p.removed_at ?? null,
      // Server-authoritative lock flags from /api/data. Undefined when the
      // payload predates the authenticated route (then we fall back to the
      // local unlock set in isAuctionLocked).
      serverUnlocked:   typeof p._unlocked === 'boolean' ? p._unlocked : null,
      // The server no longer ships an internal `_unlockKey` (it leaked the
      // county:date:parcel join key). Unlocking keys off `serverId` (the
      // property UUID) instead, so this is intentionally null here.
      serverUnlockKey:  null,
    }
  })

  return {
    props,
    meta: {
      count:       data.total_properties || props.length,
      generated:   data.analysis_date    || null,
      county:      slug,
      auctionDate: metaAuctionDate,
    },
  }
}

// Converts a row from public.visible_properties_safe (Supabase) into the
// dashboard's NormalizedProperty shape. The typed columns come from the row;
// the rich "rest of the JSON" lives in `details` JSONB. For Starter the view
// already masks details/ranked_comps to empty, so all branches still work.
function rowToNormalizedProperty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase row carries arbitrary JSONB details
  row: any,
  i: number,
  slug: string,
): NormalizedProperty {
  const d = row.details || {}
  const addr = row.address || d.full_address || d.address || ''
  const legalClosing =
    d.legal_closing_costs ??
    ((d.closing_costs || 0) +
      (d.title_insurance || 0) +
      (d.transfer_tax || 0) +
      (d.recording_fees || 0) +
      (d.quiet_title_cost || 0))

  return {
    id:                   i + 1,
    serverId:             row.id,
    county:               row.county || slug,
    addr,
    city:                 row.city || d.city || '',
    zip:                  row.zip || d.zip_code || '',
    propType:             classifyType(
                            row.property_type || d.property_type,
                            d.property_class,
                            row.sqft,
                            row.beds ?? d.bedrooms,
                            d.appraised_value,
                            d.structure_confirmed,
                          ),
    auctionDate:          row.auction_date || null,
    beds:                 row.beds ?? d.bedrooms ?? null,
    baths:                row.baths ?? d.bathrooms ?? null,
    sqft:                 row.sqft ?? null,
    yearBuilt:            row.year_built ?? null,
    lotAcres:             d.lot_acres ?? row.lot_size ?? null,
    taxDue:               row.tax_due ?? 0,
    rehab:                d.estimated_rehab_cost ?? d.estimated_rehab ?? row.rehab_cost ?? 0,
    arv:                  row.arv ?? null,
    countyAppraisedValue: d.county_appraised_value ?? null,
    landValue:            d.land_value ?? null,
    landValueSource:      d.land_value_source || '',
    landAcreageFlag:      d.land_acreage_flag || '',
    asisProfit:           d.asis_net_profit ?? null,
    asisRoi:              d.asis_roi_percent ?? null,
    asisAllIn:            d.asis_all_in_cost ?? null,
    asisSalePrice:        d.asis_sale_price ?? null,
    profit:               row.net_profit ?? d.gross_profit ?? null,
    roi:                  row.roi_pct ?? d.roi_percent ?? null,
    score:                row.deal_score ?? null,
    risk:                 row.risk_score ?? null,
    allIn:                row.all_in_cost ?? 0,
    closing:              d.closing_costs ?? 0,
    legalClosing,
    comps:                d.comps_used_for_arv ?? row.comp_count ?? 0,
    compPoolSize:         row.comp_count ?? 0,
    compQual:             d.comp_quality_rating || '',
    arvConf:              row.arv_confidence || '',
    // Wave 3 deal-engine fields — read the typed view columns first, fall back
    // to details JSONB for older rows. Null-safe.
    scoreTier:             row.score_tier ?? d.score_tier ?? null,
    isNoBid:               row.is_no_bid ?? d.is_no_bid ?? null,
    noBidReason:           row.no_bid_reason ?? d.no_bid_reason ?? null,
    estimateOnly:          row.estimate_only ?? d.estimate_only ?? null,
    topDeal:               row.top_deal ?? d.top_deal ?? null,
    roiIfRedeemedYear1Pct: row.roi_if_redeemed_year1_pct ?? d.roi_if_redeemed_year1_pct ?? null,
    roiIfDeedMatures:      row.roi_if_deed_matures ?? d.roi_if_deed_matures ?? null,
    dataConf:             d.data_confidence || '',
    structureConfirmed:   d.structure_confirmed ?? false,
    dealRating:           d.deal_rating || '',
    arvCalc:              d.arv_calculation || d.arv_method || '',
    rehabCalc:            d.rehab_calculation || '',
    rehabNotes:           d.rehab_notes || '',
    analysisNotes:        row.analysis_notes || d.analysis_notes || '',
    closeCalc:            d.closing_calculation || '',
    allInCalc:            d.all_in_breakdown || d.all_in_calculation || '',
    profitCalc:           d.profit_calculation || '',
    roiCalc:              d.roi_calculation || '',
    investViability:      d.investment_viability || '',
    taxId:                row.parcel_id || '',
    recommendedMaxBid:    row.max_bid ?? null,
    assessorAddress:      d.assessor_address || addr,
    appraisedValue:       d.appraised_value ?? null,
    minBid:               row.min_bid ?? null,
    comparables:          buildComps([], addr, row.ranked_comps),
    latitude:             d.latitude ?? null,
    longitude:            d.longitude ?? null,
    scoreType:            d.score_type ?? null,
    zillowUrl:            d.zillow_url ?? null,
    auctionStatus:        row.auction_status === 'cancelled_before_auction' ? 'cancelled_before_auction' : 'active',
    removedAt:            row.removed_at ?? null,
    // visible_properties_safe carries a `locked` flag; the view already masks
    // financial details for locked rows server-side.
    serverUnlocked:       typeof row.locked === 'boolean' ? !row.locked : null,
    serverUnlockKey:      row.id ?? null,
  }
}

// ─── FORMATTERS ───────────────────────────────────────────────────────────────

const fmt$ = (v: number | null) => {
  if (v == null) return '—'
  if (v >= 1_000_000) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1_000)     return '$' + Math.round(v / 1_000) + 'K'
  return '$' + v.toLocaleString()
}

const fmtPct = (v: number | null) =>
  v == null ? '—' : v >= 999 ? '>999%' : v.toFixed(1) + '%'

// Absolute "data as of" date for the header freshness stamp. Mirrors the mobile
// DataFreshness component's formatDate output ("May 23, 2026"). Returns null on
// missing/unparseable input so the caller can skip rendering the stamp.
function formatAsOf(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  // Handle compact YYYYMMDD format (e.g. "20260322").
  const normalized = /^\d{8}$/.test(dateStr)
    ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
    : dateStr
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function roiBadgeCls(roi: number | null) {
  if (roi == null) return 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-white/10 dark:text-slate-400 dark:border-white/15'
  if (roi >= 300)  return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700/50'
  if (roi >= 200)  return 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700/30'
  if (roi >= 100)  return 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700/30'
  if (roi >= 50)   return 'bg-orange-50 text-orange-600 border-orange-100 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-700/30'
  return 'bg-red-50 text-red-600 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-700/30'
}

function scoreColorCls(s: number) {
  if (s >= 90) return 'text-emerald-600'
  if (s >= 75) return 'text-amber-500'
  if (s >= 50) return 'text-orange-500'
  return 'text-red-500'
}

function riskColorCls(r: number | null) {
  if (r == null) return 'text-slate-400'
  if (r <= 25) return 'text-emerald-600'
  if (r <= 40) return 'text-amber-500'
  return 'text-red-500'
}

// Returns true when the score number is meaningless for display purposes.
// Commercial and land properties that couldn't be ROI-scored default to 0,
// which reads as "terrible deal" to users — but 0 really means "not analyzed".
function isScoreUnknown(p: NormalizedProperty): boolean {
  if (p.score == null)       return true
  if (p.scoreType === 'none' || p.scoreType === 'N/A') return true
  if (!p.scoreType && p.score === 0 && (p.propType === 'Commercial' || p.propType === 'Multi-Family' || p.propType === 'Vacant Land')) return true
  return false
}

// A parcel pulled from the auction before sale. Its monthly-quota unlock (if
// any) was auto-credited back — see refund_unlocks_for_parcel. We keep it
// visible so a user who unlocked it understands why it's gone, rather than it
// silently vanishing from the list.
function isRemoved(p: NormalizedProperty): boolean {
  return p.auctionStatus === 'cancelled_before_auction'
}

function RemovedBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-white/20 text-[10px] font-semibold whitespace-nowrap">
      <Ban size={9} /> Removed — unlock refunded
    </span>
  )
}

function TypeBadge({ type }: { type: NormalizedProperty['propType'] }) {
  if (type === 'Vacant Land')
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/50 text-[10px] font-semibold">
        <Leaf size={9} /> Vacant Land
      </span>
    )
  if (type === 'Commercial')
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-700/50 text-[10px] font-semibold">
        <Building2 size={9} /> Commercial
      </span>
    )
  if (type === 'Multi-Family')
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-700/50 text-[10px] font-semibold">
        <Building2 size={9} /> Multi-Family
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700/50 text-[10px] font-semibold">
      <Home size={9} /> SFR
    </span>
  )
}

function LockedCell({ label = 'Unlock' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400 text-[10px] font-bold">
      <Lock size={10} /> {label}
    </span>
  )
}

// NO-BID / ESTIMATE-ONLY pill — shown in place of a misleading ROI/profit value
// when the deal guardrails screened the parcel out (is_no_bid) or the valuation
// is a bare estimate. Rendered wherever a property row would otherwise display
// its ROI number.
function NoBidPill({ p }: { p: NormalizedProperty }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 text-[10px] font-bold whitespace-nowrap">
      <Ban size={10} /> {noBidLabel(p.isNoBid, p.arvConf, p.estimateOnly)}
    </span>
  )
}

function UpgradeCell({ label = 'Upgrade' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-slate-500 text-[10px] font-bold">
      <Lock size={10} /> {label}
    </span>
  )
}

// ─── ROI DISTRIBUTION CHART ──────────────────────────────────────────────────

function ROIChart({ props }: { props: NormalizedProperty[] }) {
  const buckets = [0, 0, 0, 0, 0]
  props.forEach(p => {
    if (p.roi == null) return
    if      (p.roi < 50)  buckets[0]++
    else if (p.roi < 100) buckets[1]++
    else if (p.roi < 200) buckets[2]++
    else if (p.roi < 300) buckets[3]++
    else                  buckets[4]++
  })
  const labels = ['Bad\n(<50%)', 'Marginal\n(50-100%)', 'Good\n(100-200%)', 'Strong\n(200-300%)', 'Except.\n(300%+)']
  const colors = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#34d399']
  const maxB   = Math.max(...buckets, 1)
  const H = 120, W = 260, bW = 30, gap = (W - bW * 5) / 6

  return (
    <svg width="100%" viewBox={`0 0 ${W + 48} ${H + 46}`} className="overflow-visible">
      <text x="10" y={H / 2 + 5} fontSize="9" fill="#64748b" textAnchor="middle"
        transform={`rotate(-90,10,${H / 2 + 5})`}>
        # Properties
      </text>
      {buckets.map((count, i) => {
        const barH = count === 0 ? 2 : Math.max(6, (count / maxB) * H)
        const x    = 28 + gap + i * (bW + gap)
        const y    = H - barH + 5
        return (
          <g key={i}>
            <rect x={x} y={y} width={bW} height={barH} rx={3} fill={colors[i]} opacity={0.8} />
            {count > 0 && (
              <text x={x + bW / 2} y={y - 4} fontSize="11" fill={colors[i]} textAnchor="middle" fontWeight="700">
                {count}
              </text>
            )}
            {labels[i].split('\n').map((line, j) => (
              <text key={j} x={x + bW / 2} y={H + 16 + j * 11} fontSize="8" fill="#64748b" textAnchor="middle">
                {line}
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

// ─── SCATTER CHART ────────────────────────────────────────────────────────────

function ScatterChart({ props }: { props: NormalizedProperty[] }) {
  const pts  = props.filter(p => p.propType !== 'Vacant Land' && p.profit != null)
  const maxP = Math.max(...pts.map(p => p.profit || 0), 1)
  const W = 260, H = 130
  const LEFT = 48  // left margin — enough room for rotated label + tick labels

  return (
    <svg width="100%" viewBox={`0 0 ${W + LEFT + 16} ${H + 46}`} className="overflow-visible">
      {/* Y-axis title — rotated, pushed further left so it doesn't overlap tick labels */}
      <text x="11" y={H / 2 + 5} fontSize="8.5" fill="#64748b" textAnchor="middle"
        transform={`rotate(-90,11,${H / 2 + 5})`}>
        Net Profit
      </text>
      {/* Y-axis grid lines + tick labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
        const y   = 5 + (1 - pct) * H
        const val = Math.round(maxP * pct / 1000)
        return (
          <g key={i}>
            <line x1={LEFT} y1={y} x2={LEFT + W} y2={y} stroke="rgba(0,0,0,0.05)" strokeWidth={1} />
            <text x={LEFT - 4} y={y + 3.5} fontSize="7.5" fill="#64748b" textAnchor="end">${val}K</text>
          </g>
        )
      })}
      {/* X-axis grid lines */}
      {[0, 25, 50, 75, 100].map(v => {
        const x = LEFT + (v / 100) * W
        return <line key={v} x1={x} y1={5} x2={x} y2={H + 5} stroke="rgba(0,0,0,0.05)" strokeWidth={1} />
      })}
      {/* Data points */}
      {pts.map((p, i) => {
        const x     = LEFT + ((p.score ?? 0) / 100) * W
        const y     = 5 + (1 - Math.max(0, Math.min(1, (p.profit || 0) / maxP))) * H
        const color = (p.score ?? 0) >= 90 ? '#10b981' : (p.score ?? 0) >= 70 ? '#f59e0b' : '#ef4444'
        return (
          <circle key={i} cx={x} cy={y} r={5} fill={color} opacity={0.8} stroke={color} strokeWidth={1.5}>
            <title>{p.addr} · Score {p.score} · Profit {fmt$(p.profit)} · ROI {fmtPct(p.roi)}</title>
          </circle>
        )
      })}
      {/* X-axis baseline */}
      <line x1={LEFT} y1={H + 5} x2={LEFT + W} y2={H + 5} stroke="rgba(0,0,0,0.1)" strokeWidth={1} />
      {/* X-axis tick labels */}
      {[0, 25, 50, 75, 100].map(v => (
        <text key={v} x={LEFT + (v / 100) * W} y={H + 18} fontSize="7.5" fill="#64748b" textAnchor="middle">{v}</text>
      ))}
      {/* X-axis title */}
      <text x={LEFT + W / 2} y={H + 32} fontSize="8.5" fill="#64748b" textAnchor="middle">Deal Score (higher = better)</text>
    </svg>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function DashboardClient({
  user,
  effectivePlan,
  isAdminUser = false,
  featureFlags,
}: {
  user: User
  effectivePlan?: string
  isAdminUser?: boolean
  featureFlags?: FeatureFlags
}) {
  const router = useRouter()

  const [activeCounty,    setActiveCounty]    = useState('dekalb')
  const [auctionIndex,    setAuctionIndex]    = useState<Record<string, AuctionEntry[]>>({})
  const [selectedAuction, setSelectedAuction] = useState<Record<string, string>>({})
  const [props,           setProps]           = useState<NormalizedProperty[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped metadata blob
  const [meta,            setMeta]            = useState<any>(null)
  const [loading,         setLoading]         = useState(true)
  const [loadError,       setLoadError]       = useState<string | null>(null)
  const [refetchTick,     setRefetchTick]     = useState(0)
  const [selectedProp, setSelectedProp]  = useState<NormalizedProperty | null>(null)
  const [filterType,   setFilterType]    = useState('')
  const [filterCity,   setFilterCity]    = useState('')
  const [sortField,    setSortField]     = useState<'roi' | 'score' | 'profit' | 'taxDue'>('roi')
  const [sortDir,      setSortDir]       = useState<1 | -1>(-1)
  const [search,       setSearch]        = useState('')
  const [activeNav,    setActiveNav]     = useState('dashboard')
  const [sidebarOpen,       setSidebarOpen]        = useState(false)
  const [comingSoon,        setComingSoon]          = useState<string | null>(null)
  const [countyDropdownOpen, setCountyDropdownOpen] = useState(false)
  const [activePanel,       setActivePanel]         = useState<'settings' | 'directives' | null>(null)
  const [pipelineDeals,     setPipelineDeals]       = useState<PipelineDeal[]>([])
  const [pipelineLoaded,    setPipelineLoaded]       = useState(false)
  const [unlockedPropertyKeys, setUnlockedPropertyKeys] = useState<Set<string>>(new Set())
  // Server-side usage when feature flag is on. null = no active subscription
  // row in current_plan_usage (treat as unauthenticated / starter defaults).
  const [serverUnlocks, setServerUnlocks] = useState<{
    used: number
    limit: number | null
    remaining: number | null
  } | null>(null)

  const useFlag = !!featureFlags?.useSupabaseProperties

  const plan    = normalizePlan(effectivePlan || user?.user_metadata?.plan || 'starter')
  const email   = user?.email?.toLowerCase() || ''
  // Admin status is determined server-side (role + ADMIN_EMAILS env) and passed
  // in as `isAdminUser`. Never hardcode an admin allowlist in client code — it
  // ships to every browser and drifts from the server source of truth.
  const isAdmin = isAdminUser
  const county  = COUNTIES.find(c => c.slug === activeCounty)!
  const hasCountyChoices = COUNTIES.length > 1
  const auctionUnlockLimit = isAdmin ? null : AUCTION_UNLOCK_LIMITS[plan]
  const canExport = isAdmin || plan === 'expert'
  const showAdvancedAuctionMetrics = isAdmin || plan === 'pro' || plan === 'expert'
  const usagePeriod = currentMonthKey()
  const unlockStorageKey = `bidwise:auction-unlocks:${email || 'anonymous'}:${usagePeriod}`

  // Attach the Supabase access token so the authenticated /api/data routes can
  // verify the caller via `Authorization: Bearer <jwt>` (the cookie session
  // works too, but the explicit header keeps parity with the mobile client).
  async function authHeaders(): Promise<Record<string, string>> {
    try {
      const supabase = createClient()
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      return token ? { Authorization: `Bearer ${token}` } : {}
    } catch {
      return {}
    }
  }

  // Display helpers: when flag is on, the counter reads from server truth
  // (current_plan_usage view); when off, it mirrors the localStorage Set.
  const unlockUsedCount = useFlag ? (serverUnlocks?.used ?? 0) : unlockedPropertyKeys.size
  const unlockDisplayLimit = useFlag
    ? (serverUnlocks ? serverUnlocks.limit : auctionUnlockLimit)
    : auctionUnlockLimit

  // Load auction index for active county (authenticated route; the static
  // /data/*.json files are no longer web-served).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const headers = await authHeaders()
        const r = await fetch(`/api/data/${activeCounty}/auctions`, { cache: 'no-store', headers })
        const entries: AuctionEntry[] = r.ok ? await r.json() : []
        if (cancelled || !Array.isArray(entries) || entries.length === 0) return
        setAuctionIndex(prev => ({ ...prev, [activeCounty]: entries }))
        // Default to the SOONEST UPCOMING auction with deals (a list you can
        // still bid on) rather than the newest-overall, which is usually already
        // past. If none is populated yet, the nearest future auction (so the UI
        // shows a countdown) beats the newest past one. Shared with the server
        // default (lib/county-data.pickDefaultEntry) so both agree.
        const def = pickDefaultEntry(entries)
        setSelectedAuction(prev => prev[activeCounty] ? prev : { ...prev, [activeCounty]: def.auction_date })
      } catch {
        // index unavailable — county view shows the empty/"no data" state
      }
    })()
    return () => { cancelled = true }
  }, [activeCounty])

  // Resolve which data file to load: selected auction > legacy default
  const countyAuctions = auctionIndex[activeCounty] || []
  const activeAuctionDate = selectedAuction[activeCounty]
  const activeAuctionEntry = countyAuctions.find(e => e.auction_date === activeAuctionDate)
  const dataFileToLoad = activeAuctionEntry ? activeAuctionEntry.file : county.dataFile

  // "Data as of" freshness stamp (web parity of mobile's DataFreshness). Prefer
  // the loaded dataset's analysis date; fall back to the auction index entry's
  // `generated` so the stamp still shows on the Supabase path, where meta.generated
  // is null. Both are ISO timestamps from the same pipeline run.
  const dataAsOf = formatAsOf(meta?.generated ?? activeAuctionEntry?.generated)

  // Load county data — branches on feature flag.
  useEffect(() => {
    setSearch(''); setFilterType(''); setFilterCity('')
    setSelectedProp(null)
    setLoadError(null)

    if (useFlag) {
      const auctionDate = activeAuctionDate
      if (!auctionDate) {
        setProps([]); setMeta(null); setLoading(false); return
      }
      setLoading(true)
      const supabase = createClient()
      Promise.all([
        supabase
          .from('visible_properties_safe')
          .select('*')
          .eq('county', county.name.split(' ')[0])
          .eq('auction_date', auctionDate),
        supabase
          .from('current_plan_usage')
          .select('auction_unlocks_used, auction_unlocks_per_month, auction_unlocks_remaining')
          .maybeSingle(),
      ])
        .then(([rowsRes, usageRes]) => {
          if (rowsRes.error) {
            console.error('[supabase] properties fetch:', rowsRes.error)
            setLoadError('We could not load auction data right now. Please try again in a moment.')
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase rows with arbitrary JSONB details
          const rows = (rowsRes.data || []) as any[]
          const mapped = rows.map((r, i) => rowToNormalizedProperty(r, i, activeCounty))
          setProps(mapped)
          setMeta({ count: rows.length, generated: null, county: activeCounty, auctionDate })

          const unlocked = new Set<string>()
          rows.forEach(r => { if (r.locked === false && r.id) unlocked.add(r.id) })
          setUnlockedPropertyKeys(unlocked)

          if (usageRes.data) {
            setServerUnlocks({
              used:      usageRes.data.auction_unlocks_used ?? 0,
              limit:     usageRes.data.auction_unlocks_per_month ?? null,
              remaining: usageRes.data.auction_unlocks_remaining ?? null,
            })
          } else {
            setServerUnlocks(null)
          }
        })
        .catch(err => {
          console.error('[supabase] load failed:', err)
          setLoadError('We could not load auction data right now. Please try again in a moment.')
        })
        .finally(() => setLoading(false))
      return
    }

    // Authenticated JSON path: the dataset is read server-side from web/data
    // and tier-masked by /api/data/[county]. Locked rows arrive with null
    // financials and a masked address — there is no real data to un-blur.
    if (!dataFileToLoad) {
      setProps([]); setMeta(null); setLoading(false); return
    }
    setLoading(true)
    let cancelled = false
    ;(async () => {
      try {
        const headers = await authHeaders()
        const fileParam = (dataFileToLoad.split('/').pop() || '').trim()
        const url = fileParam
          ? `/api/data/${activeCounty}?file=${encodeURIComponent(fileParam)}`
          : `/api/data/${activeCounty}`
        const res = await fetch(url, { cache: 'no-store', headers })
        if (!res.ok) {
          let message = 'We could not load auction data right now. Please try again in a moment.'
          if (res.status === 401) message = 'Your session expired. Please sign in again to view auction data.'
          if (res.status === 403) message = 'Your plan does not include access to this data.'
          if (res.status === 404) message = `No auction data is available for ${county.name} yet.`
          throw new Error(message)
        }
        const data = await res.json()
        if (cancelled) return
        const { props: p, meta: m } = normalizeData(data, activeCounty)
        setProps(p)
        setMeta(m)
        if (data?.access) {
          setServerUnlocks({
            used:      data.access.unlockedThisMonth ?? 0,
            limit:     data.access.unlockLimit ?? null,
            remaining:
              data.access.unlockLimit == null
                ? null
                : Math.max(0, data.access.unlockLimit - (data.access.unlockedThisMonth ?? 0)),
          })
        }
      } catch (err) {
        if (cancelled) return
        console.error('[api/data] load failed:', err)
        setProps([]); setMeta(null)
        setLoadError(err instanceof Error ? err.message : 'Failed to load auction data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [useFlag, activeCounty, dataFileToLoad, activeAuctionDate, county.name, refetchTick])

  // Hydrate the pipeline. Server (auction_pipeline — shared with mobile) is
  // the source of truth; localStorage stays as an instant-paint cache and the
  // offline fallback. Legacy localStorage-era deals (pre-sync ids, or deals
  // added while offline) are pushed up first — idempotent upsert on
  // (user_id, parcel_id) — then the fresh server list wins.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let cached: PipelineDeal[] = []
      try {
        const stored = JSON.parse(localStorage.getItem('bw_pipeline') || '[]')
        if (Array.isArray(stored)) cached = stored
      } catch {}
      if (cached.length > 0 && !cancelled) setPipelineDeals(cached)

      try {
        const unsynced = cached.filter(d => !isServerDealId(String(d.id ?? '')))
        if (unsynced.length > 0) await syncLegacyDeals(unsynced)
        const server = await fetchPipeline()
        if (!cancelled) setPipelineDeals(server)
      } catch (err) {
        // Offline / server hiccup: the cached deals above remain usable; the
        // next successful mount re-runs the sync.
        console.warn('[pipeline] server hydrate failed — using cached deals:', err)
      } finally {
        if (!cancelled) setPipelineLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Analytics: dashboard view + active-subscription signal. The dashboard only
  // renders for subscribed or admin users (page-level + middleware gate), so a
  // paid plan here means an active subscription. Fires once per mount.
  useEffect(() => {
    trackEvent('dashboard_viewed', { plan, isAdmin })
    if (!isAdmin && (plan === 'pro' || plan === 'expert')) {
      trackEvent('subscription_active', { plan })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ads conversion: ?checkout=success&plan=… is Stripe's success_url landing
  // (api/stripe/checkout). Fire the one-time conversion (maps to GA4
  // `purchase`), then strip the params via replaceState so a refresh or
  // bookmarked URL can never double-count. The URL's plan param is used over
  // the plan prop — the webhook may not have updated the subscription row yet
  // at redirect time.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') !== 'success') return
    trackEvent('checkout_completed', { plan: params.get('plan') ?? plan })
    params.delete('checkout')
    params.delete('plan')
    const qs = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Legacy localStorage-only path. The unlock storage key includes YYYY-MM so
  // unlocks reset monthly. On every mount we also pull current-month server
  // content_unlocks and merge them in — that way reverting the feature flag
  // from on→off doesn't lose unlocks the user earned while it was on.
  useEffect(() => {
    if (useFlag) return
    let cancelled = false
    ;(async () => {
      let combined = new Set<string>()
      try {
        const stored = JSON.parse(localStorage.getItem(unlockStorageKey) || '[]')
        if (Array.isArray(stored)) combined = new Set<string>(stored)
      } catch {}

      try {
        const supabase = createClient()
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const { data: unlocks } = await supabase
          .from('content_unlocks')
          .select('content_id')
          .eq('content_type', 'auction_property')
          .gte('unlocked_at', monthStart)

        if (unlocks && unlocks.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase unlock rows (dynamic select)
          const ids = unlocks.map((r: any) => r.content_id).filter(Boolean)
          if (ids.length > 0) {
            const { data: rows } = await supabase
              // visible_properties_safe, not `properties`: migration 025
              // revoked client SELECT on the raw table. These identity
              // columns are always visible on the view, locked or not.
              .from('visible_properties_safe')
              .select('id, county, auction_date, parcel_id')
              .in('id', ids)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase property rows (dynamic select)
            ;(rows || []).forEach((p: any) => {
              const k = [
                p.county || 'unknown',
                p.auction_date || 'no-date',
                p.parcel_id,
              ].join(':')
              combined.add(k)
            })
          }
        }
      } catch (err) {
        // Server unreachable — fall back to whatever localStorage gave us.
        console.warn('[unlock-hydrate] server fetch failed:', err)
      }

      if (cancelled) return
      setUnlockedPropertyKeys(combined)
      try {
        localStorage.setItem(unlockStorageKey, JSON.stringify(Array.from(combined)))
      } catch {}
    })()
    return () => { cancelled = true }
  }, [useFlag, unlockStorageKey])

  // Persist pipeline changes — only after the initial load to avoid wiping stored data
  useEffect(() => {
    if (!pipelineLoaded) return
    localStorage.setItem('bw_pipeline', JSON.stringify(pipelineDeals))
  }, [pipelineDeals, pipelineLoaded])

  function addToPipeline(prop: NormalizedProperty) {
    if (isAuctionLocked(prop)) {
      setComingSoon('Unlock this listing before adding it to your pipeline')
      return
    }

    // Same parcel identity the mobile app writes — required for the shared
    // unique (user_id, parcel_id) key and for /api/export's pipeline lookup.
    const parcelId = parcelIdFor({ taxId: prop.taxId, county: prop.county, id: prop.id })
    if (pipelineDeals.some(d => d.parcelId === parcelId)) return

    // Optimistic local deal; swapped for the server row (uuid id) on sync.
    const tempId = `local-${prop.county}-${prop.id}-${Date.now()}`
    const optimistic: PipelineDeal = {
      id:       tempId,
      parcelId,
      addr:     prop.addr,
      county:   prop.county,
      roi:      prop.roi,
      score:    prop.score,
      status:   'watchlist',
      addedAt:  new Date().toISOString(),
    }
    setPipelineDeals(prev => [optimistic, ...prev])

    void addToPipelineServer({
      parcelId,
      addr: prop.addr,
      county: prop.county,
      city: prop.city || null,
      zip: prop.zip || null,
      auctionDate: prop.auctionDate ?? null,
      roi: prop.roi,
      score: prop.score,
    })
      .then(saved => {
        setPipelineDeals(prev => prev.map(d => (d.id === tempId ? saved : d)))
      })
      .catch(err => {
        // Keep the local deal — the hydrate-time legacy sync retries it on the
        // next visit, so nothing the user saved is lost.
        console.warn('[pipeline] add sync failed — kept locally, retried next visit:', err)
      })
  }

  function isAuctionLocked(prop: NormalizedProperty) {
    if (isAdmin || plan === 'expert') return false
    // Server truth wins: /api/data (and visible_properties_safe) already
    // withhold financials for locked rows, so `serverUnlocked` is the
    // authoritative lock state. The local `unlockedPropertyKeys` set only
    // provides an optimistic flip after a successful unlock POST, before the
    // next data refetch re-derives lock state from the server.
    if (prop.serverUnlocked === true) return false
    const key = useFlag ? prop.serverId : propertyUnlockKey(prop)
    if (key && unlockedPropertyKeys.has(key)) return false
    if (prop.serverUnlocked === false) return true
    // No server signal at all (legacy payloads) — fall back to the local set.
    if (!key) return true
    return !unlockedPropertyKeys.has(key)
  }

  async function refetchServerUsage() {
    const supabase = createClient()
    const { data } = await supabase
      .from('current_plan_usage')
      .select('auction_unlocks_used, auction_unlocks_per_month, auction_unlocks_remaining')
      .maybeSingle()
    if (data) {
      setServerUnlocks({
        used:      data.auction_unlocks_used ?? 0,
        limit:     data.auction_unlocks_per_month ?? null,
        remaining: data.auction_unlocks_remaining ?? null,
      })
    }
  }

  async function unlockProperty(prop: NormalizedProperty) {
    if (!isAuctionLocked(prop)) {
      setSelectedProp(selectedProp?.id === prop.id ? null : prop)
      return
    }

    if (useFlag) {
      if (!prop.serverId) {
        setComingSoon('Property not yet available in the new system')
        return
      }
      try {
        const headers = await authHeaders()
        const res = await fetch('/api/unlocks', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body:    JSON.stringify({ contentType: 'auction_property', contentId: prop.serverId }),
        })
        const result = await res.json()
        if (res.ok && result.unlocked) {
          setUnlockedPropertyKeys(prev => {
            const next = new Set(prev)
            next.add(prop.serverId!)
            return next
          })
          trackEvent('property_unlocked', { county: prop.county, propertyId: prop.serverId })
          await refetchServerUsage()
          // Refetch so the now-unlocked row arrives from the server WITH its
          // financials (locked rows ship null financials; nothing to un-blur).
          setRefetchTick(t => t + 1)
          const remaining = result.remaining
          setComingSoon(
            remaining === null || remaining === undefined
              ? 'Unlocked.'
              : `Unlocked. ${remaining} ${remaining === 1 ? 'unlock' : 'unlocks'} left this month`,
          )
          setSelectedProp(prop)
        } else {
          setComingSoon(result.message || 'Unable to unlock this listing')
        }
      } catch (err) {
        console.error('[unlock] error:', err)
        setComingSoon('Network error — please try again')
      }
      return
    }

    // Legacy localStorage path
    if (auctionUnlockLimit != null && unlockedPropertyKeys.size >= auctionUnlockLimit) {
      setComingSoon(`Monthly auction unlock limit reached. Upgrade for ${plan === 'starter' ? '25' : 'unlimited'} unlocks`)
      return
    }

    const next = new Set(unlockedPropertyKeys)
    next.add(propertyUnlockKey(prop))
    setUnlockedPropertyKeys(next)
    localStorage.setItem(unlockStorageKey, JSON.stringify(Array.from(next)))
    trackEvent('property_unlocked', { county: prop.county, key: propertyUnlockKey(prop) })
    setSelectedProp(prop)
  }

  function removeDeal(id: string) {
    const snapshot = pipelineDeals
    setPipelineDeals(prev => prev.filter(d => d.id !== id))
    if (!isServerDealId(id)) return // local-only deal: nothing on the server yet
    void removeFromPipelineServer(id).catch(err => {
      console.warn('[pipeline] remove sync failed — restoring:', err)
      setPipelineDeals(snapshot)
      setComingSoon("Couldn't remove that deal — check your connection and try again")
    })
  }

  function moveDeal(id: string, status: PipelineStatus) {
    const snapshot = pipelineDeals
    setPipelineDeals(prev => prev.map(d => d.id === id ? { ...d, status } : d))
    if (!isServerDealId(id)) return
    void updatePipelineStatusServer(id, status).catch(err => {
      console.warn('[pipeline] status sync failed — reverting:', err)
      setPipelineDeals(snapshot)
      setComingSoon("Couldn't update that deal — check your connection and try again")
    })
  }

  function clearPipeline() {
    if (!confirm('Clear all pipeline deals?')) return
    const snapshot = pipelineDeals
    setPipelineDeals([])
    void clearPipelineServer().catch(err => {
      console.warn('[pipeline] clear sync failed — restoring:', err)
      setPipelineDeals(snapshot)
      setComingSoon("Couldn't clear your pipeline — check your connection and try again")
    })
  }

  const cities = useMemo(() => Array.from(new Set(props.map(p => p.city).filter(Boolean))).sort(), [props])

  const filteredProps = useMemo(() => {
    const data = props.filter(p => {
      // Removed parcels are no longer biddable — never surface them in Top Deals.
      if (activeNav === 'top-deals' && isRemoved(p)) return false
      // Canonical Top-Deal gate (lib/topDeals.ts — mirrors execution/utils/
      // top_deals.py): no land, no estimate-only land heuristics, no NO-BID
      // guardrail screen-outs, no thin-comp ESTIMATE_ONLY valuations, and
      // ROI >= the dashboard's 100% bar.
      if (activeNav === 'top-deals' && !isTopDeal(p)) return false
      if (filterType && p.propType !== filterType) return false
      if (filterCity && p.city !== filterCity) return false
      if (search) {
        const q = search.toLowerCase()
        if (!p.addr.toLowerCase().includes(q) && !p.city.toLowerCase().includes(q)) return false
      }
      return true
    })
    return [...data].sort((a, b) => {
      // Removed parcels always sink to the bottom, regardless of the active sort.
      const ra = isRemoved(a) ? 1 : 0
      const rb = isRemoved(b) ? 1 : 0
      if (ra !== rb) return ra - rb
      const va = (a[sortField as keyof NormalizedProperty] as number) ?? -Infinity
      const vb = (b[sortField as keyof NormalizedProperty] as number) ?? -Infinity
      return sortDir * (va - vb)
    })
  }, [props, filterType, filterCity, search, sortField, sortDir, activeNav])

  const kpis = useMemo(() => {
    // Removed parcels are no longer biddable, so they don't count toward any
    // metric — including the property total.
    const active     = props.filter(p => !isRemoved(p))
    // "Viable" = the canonical Top-Deal gate (lib/topDeals.ts), so this KPI,
    // the sidebar Top Deals badge, and the Top Deals view always agree.
    const viable     = active.filter(p => isTopDeal(p))
    const withProfit = active.filter(p => p.profit != null && p.profit > 0)
    const avgProfit  = withProfit.length ? withProfit.reduce((s, p) => s + (p.profit || 0), 0) / withProfit.length : 0
    const withRoi    = active.filter(p => p.roi != null)
    const avgRoi     = withRoi.length ? withRoi.reduce((s, p) => s + (p.roi || 0), 0) / withRoi.length : 0
    return {
      total:   active.length,
      viable:  viable.length,
      avgProfit,
      avgRoi,
      sfr:     active.filter(p => p.propType === 'SFR').length,
      mf:      active.filter(p => p.propType === 'Multi-Family').length,
      comm:    active.filter(p => p.propType === 'Commercial').length,
      land:    active.filter(p => p.propType === 'Vacant Land').length,
      flagged: active.filter(p => p.roi != null && p.roi < 50).length,
    }
  }, [props])

  function handleSort(field: typeof sortField) {
    if (sortField === field) setSortDir(d => (d === -1 ? 1 : -1) as 1 | -1)
    else { setSortField(field); setSortDir(-1) }
  }

  function SortIcon({ field }: { field: typeof sortField }) {
    return sortField === field
      ? <span className="text-emerald-500 ml-0.5">{sortDir === -1 ? '↓' : '↑'}</span>
      : <span className="text-slate-400 dark:text-slate-500 ml-0.5">↕</span>
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  function exportToCSV() {
    if (!canExport) {
      router.push('/pricing')
      return
    }
    if (!filteredProps.length) return
    const headers = ['Address', 'City', 'Zip', 'Type', 'Beds', 'Baths', 'Tax Due', 'Est. Rehab', 'ARV', 'Net Profit', 'ROI (%)', 'Score', 'Risk']
    // csvRow handles RFC-4180 quoting (doubling internal quotes, wrapping
    // commas/newlines) and CSV-injection protection for scraped address strings.
    const rows = filteredProps.map(p => csvRow([
      p.addr, p.city, p.zip, p.propType,
      p.beds || '', p.baths || '', p.taxDue, p.rehab, p.arv, p.profit || '',
      p.roi || '', p.score, p.risk || ''
    ]))
    const csvContent = "data:text/csv;charset=utf-8," + [csvRow(headers), ...rows].join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `bidwise_export_${activeCounty}_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="flex h-screen bg-[#F8F9FA] dark:bg-navy-900 text-slate-800 dark:text-slate-200 overflow-hidden relative">

      {/* MOBILE SIDEBAR OVERLAY */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 md:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <aside className={`fixed md:static inset-y-0 left-0 z-50 w-[220px] shrink-0 flex flex-col bg-white dark:bg-navy-800 border-r border-slate-200 dark:border-white/10 transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>

        {/* Logo */}
        <div className="px-4 pt-5 pb-4 border-b border-slate-100 dark:border-white/10 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50 flex items-center justify-center shrink-0">
                <Landmark size={15} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-[15px] font-black text-slate-900 dark:text-white tracking-tight">BidWiseAI</span>
            </div>
            <div className="bp-label !text-[9px] pl-[42px]">
              Deal Intelligence
            </div>
          </div>
          {/* Mobile Close Button */}
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto">

          {/* WORKSPACE */}
          <div className="mb-4">
            <div className="px-2 pb-1.5 bp-label !text-[9px]">Workspace</div>
            {[
              { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={13} />, badge: kpis.total > 0 ? kpis.total : null },
              { id: 'top-deals', label: 'Top Deals',  icon: <Gem size={13} />,     badge: kpis.viable > 0 ? kpis.viable : null },
              { id: 'analytics', label: 'Analytics',  icon: <TrendingUp size={13} /> },
              { id: 'pipeline',  label: 'Pipeline',   icon: <Layers size={13} />, badge: pipelineDeals.length > 0 ? pipelineDeals.length : null },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => { setActiveNav(item.id); setSidebarOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all text-left mb-0.5 ${
                  activeNav === item.id
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/50'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10 border border-transparent'
                }`}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.badge != null && (
                  <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
                    activeNav === item.id
                      ? 'bg-emerald-100 dark:bg-emerald-800/50 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* OFF-MARKET */}
          <div className="mb-4">
            <div className="px-2 pb-1.5 bp-label !text-[9px]">Off-Market</div>
            {[
              { id: 'leads', label: 'BidWise Leads', icon: <Sparkles size={13} />, href: '/dashboard/leads' },
              { id: 'intel', label: 'BidWise Intel', icon: <FileText size={13} />, href: '/dashboard/leads/intel' },
              { id: 'watchlists', label: 'Watchlists', icon: <Eye size={13} />, href: '/dashboard/leads/watchlists' },
              { id: 'deal-desk', label: 'Deal Desk', icon: <Briefcase size={13} />, href: '/dashboard/leads/deal-desk' },
            ].map(item => (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all text-left mb-0.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10 border border-transparent`}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
              </Link>
            ))}
          </div>

          {/* COUNTIES */}
          <div className="mb-4">
            <div className="px-2 pb-1.5 bp-label !text-[9px]">Counties</div>
            {COUNTIES.map(c => (
              <button
                key={c.slug}
                onClick={() => {
                  if (c.dataFile) {
                    setActiveCounty(c.slug);
                    if (activeNav === 'pipeline' || activeNav === 'analytics') {
                      setActiveNav('dashboard');
                    }
                    setSidebarOpen(false);
                  }
                }}
                disabled={!c.dataFile}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all text-left mb-0.5 ${
                  activeCounty === c.slug
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/50'
                    : c.dataFile
                    ? 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10 border border-transparent'
                    : 'text-slate-400 dark:text-slate-600 cursor-not-allowed border border-transparent opacity-50'
                }`}
              >
                <MapPin size={12} />
                <span className="flex-1">{c.name.replace(' County', '')}, {c.state}</span>
                {!c.dataFile && <span className="text-[9px] text-slate-400 dark:text-slate-600">Soon</span>}
              </button>
            ))}
          </div>

          {/* SYSTEM */}
          <div>
            <div className="px-2 pb-1.5 bp-label !text-[9px]">System</div>
            {[
              { label: 'Settings',   icon: <Settings size={12} />, panel: 'settings'   as const },
              { label: 'Directives', icon: <FileText size={12} />, panel: 'directives' as const },
            ].map(item => (
              <button
                key={item.label}
                onClick={() => { setActivePanel(item.panel); setSidebarOpen(false) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10 transition-all text-left mb-0.5"
              >
                {item.icon}{item.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-white/10 space-y-1.5">
          <div className="flex items-center gap-2 px-2.5 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/50 rounded-lg">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">System Online</span>
          </div>
          <div className="px-2 text-[10px] text-slate-500 dark:text-slate-400 truncate">{user?.email}</div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11.5px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>

      {/* ── MAIN AREA ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden w-full">

        {/* TOP BAR */}
        <div className="h-[56px] shrink-0 flex items-center justify-between px-3 md:px-5 bg-white dark:bg-navy-800 border-b border-slate-200 dark:border-white/10 shadow-sm z-10">
          <div className="flex items-center gap-3">
            {/* Mobile Hamburger */}
            <button onClick={() => setSidebarOpen(true)} className="md:hidden text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white p-1">
              <Menu size={20} />
            </button>

            {/* County Dropdown */}
            <div className="relative hidden md:block">
              {hasCountyChoices && countyDropdownOpen && (
                <div className="fixed inset-0 z-30" onClick={() => setCountyDropdownOpen(false)} />
              )}
              <div
                onClick={() => hasCountyChoices && setCountyDropdownOpen(o => !o)}
                className={`flex items-center gap-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 transition-all select-none ${
                  hasCountyChoices
                    ? 'cursor-pointer hover:border-slate-300 dark:hover:border-white/20'
                    : 'cursor-default'
                }`}
              >
                <Landmark size={13} className="text-slate-400 dark:text-slate-500" />
                <div>
                  <div className="text-[12px] font-bold text-slate-800 dark:text-slate-200 leading-none">{county.name}, {county.state}</div>
                  <div className="text-[9.5px] text-slate-500 dark:text-slate-400 leading-none mt-0.5">{county.auctionType}</div>
                </div>
                {hasCountyChoices && (
                  <ChevronDown size={11} className={`text-slate-400 dark:text-slate-500 ml-1 transition-transform duration-200 ${countyDropdownOpen ? 'rotate-180' : ''}`} />
                )}
              </div>
              {hasCountyChoices && countyDropdownOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-[210px] bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-40 py-1.5 overflow-hidden">
                  {COUNTIES.map(c => (
                    <button
                      key={c.slug}
                      onClick={() => {
                        if (c.dataFile) {
                          setActiveCounty(c.slug)
                          if (activeNav === 'pipeline' || activeNav === 'analytics') setActiveNav('dashboard')
                          setCountyDropdownOpen(false)
                        }
                      }}
                      disabled={!c.dataFile}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                        activeCounty === c.slug
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                          : c.dataFile
                          ? 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'
                          : 'text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'
                      }`}
                    >
                      <MapPin size={11} className="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] font-semibold leading-none">{c.name}, {c.state}</div>
                        <div className="text-[9.5px] text-slate-500 dark:text-slate-400 mt-0.5">{c.auctionType}</div>
                      </div>
                      {activeCounty === c.slug
                        ? <CheckCircle size={11} className="text-emerald-500 shrink-0" />
                        : !c.dataFile
                        ? <span className="text-[9px] text-slate-400 dark:text-slate-600 shrink-0">Soon</span>
                        : null
                      }
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Auction selector — shows when index has entries */}
            {countyAuctions.length > 0 && (
              <>
                <div className="hidden md:block w-px h-4 bg-slate-200 dark:bg-white/15" />
                <select
                  value={activeAuctionDate || ''}
                  onChange={e => setSelectedAuction(prev => ({ ...prev, [activeCounty]: e.target.value }))}
                  className="hidden md:block bg-white dark:bg-navy-700 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-[11px] font-semibold rounded-lg px-2.5 py-1.5 outline-none cursor-pointer focus:border-emerald-500 shadow-sm"
                >
                  {countyAuctions.map(e => (
                    <option key={e.auction_date} value={e.auction_date}>
                      {e.label} ({e.total_properties} props)
                    </option>
                  ))}
                </select>
              </>
            )}
            {dataAsOf && (
              <>
                <div className="hidden md:block w-px h-4 bg-slate-200 dark:bg-white/15" />
                <span className="hidden md:inline-flex items-center gap-1 text-[11.5px] text-slate-500 dark:text-slate-400">
                  <Clock size={11} className="text-slate-400 dark:text-slate-500" />
                  Data as of <strong className="text-slate-700 dark:text-slate-300 font-semibold">{dataAsOf}</strong>
                </span>
              </>
            )}
            {props.length > 0 && (
              <>
                <div className="hidden md:block w-px h-4 bg-slate-200 dark:bg-white/15" />
                <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  <strong className="text-slate-700 dark:text-slate-300 font-semibold">{filteredProps.length}</strong> loaded
                </span>
              </>
            )}
            {unlockDisplayLimit != null && (
              <>
                <div className="hidden md:block w-px h-4 bg-slate-200 dark:bg-white/15" />
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-2 py-1 rounded-lg">
                  <Lock size={10} /> {unlockUsedCount}/{unlockDisplayLimit} unlocks
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {plan === 'starter' && !isAdmin && (
              <Link href="/pricing" className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-all">
                <Zap size={10} /> Upgrade
              </Link>
            )}
            {!isAdmin && (
              <Link href="/api/stripe/billing-portal" className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-all">
                <CreditCard size={10} /> Manage Subscription
              </Link>
            )}
            <div className="hidden md:block border-l border-slate-200 dark:border-white/10 h-6 mx-1" />
            <ThemeToggle />
            <button
              onClick={exportToCSV}
              className={`flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11.5px] font-semibold rounded-lg transition-all shadow-sm ${
                canExport
                  ? 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white'
                  : 'text-slate-400 dark:text-slate-500 hover:text-amber-600 dark:hover:text-amber-400'
              }`}
            >
              {canExport ? <Download size={12} /> : <Lock size={12} />} <span className="hidden sm:inline">{canExport ? 'Export' : 'CSV Export'}</span>
            </button>
          </div>
        </div>

        {/* SCROLL AREA */}
        <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4">

          {/* Coming Soon toast */}
          {comingSoon && (
            <div className="fixed top-16 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl text-sm font-medium shadow-xl">
              <span className="text-slate-700 dark:text-slate-300">{comingSoon}</span>
              <button onClick={() => setComingSoon(null)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 ml-1">
                <X size={13} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-24 text-slate-500 dark:text-slate-400 text-sm">
              <RefreshCw size={16} className="animate-spin mr-2" />
              Loading {county.name} data…
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center bg-white dark:bg-navy-800 border border-red-200 dark:border-red-800/50 rounded-xl shadow-sm">
              <AlertTriangle size={28} className="text-red-500" />
              <div className="text-slate-700 dark:text-slate-200 text-sm font-bold">Couldn&apos;t load auction data</div>
              <div className="text-slate-500 dark:text-slate-400 text-xs max-w-sm leading-relaxed">{loadError}</div>
              <button
                onClick={() => setRefetchTick(t => t + 1)}
                className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold rounded-lg transition-colors"
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : !county.dataFile ? (
            <div className="flex flex-col items-center justify-center py-24 gap-2 text-center bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm">
              <div className="text-slate-600 dark:text-slate-400 text-sm font-semibold">No data for {county.name} yet</div>
              <div className="text-slate-500 dark:text-slate-500 text-xs">Data for this county is not yet available. Check back soon.</div>
            </div>
          ) : (
            <>
              {/* PIPELINE VIEW */}
              {activeNav === 'pipeline' && (() => {
                const COLUMNS: { status: PipelineStatus; label: string; color: string; dot: string }[] = [
                  { status: 'watchlist', label: 'Watchlist',     color: 'text-blue-600 dark:text-blue-400',   dot: 'bg-blue-500'   },
                  { status: 'diligence', label: 'Due Diligence', color: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500'  },
                  { status: 'bidding',   label: 'Bidding',       color: 'text-purple-600 dark:text-purple-400', dot: 'bg-purple-500' },
                  { status: 'pass',      label: 'Pass',          color: 'text-slate-500 dark:text-slate-400', dot: 'bg-slate-400'  },
                ]
                return (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-[15px] font-bold text-slate-800 dark:text-white">Deal Pipeline</h2>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Track properties through your investment process</p>
                      </div>
                      {pipelineDeals.length > 0 && (
                        <button onClick={clearPipeline}
                          className="text-[11px] text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                          Clear all
                        </button>
                      )}
                    </div>

                    {pipelineDeals.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 gap-3 bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm text-center">
                        <Layers size={28} className="text-slate-300 dark:text-slate-600" />
                        <div className="text-slate-600 dark:text-slate-400 text-sm font-semibold">No deals tracked yet</div>
                        <div className="text-slate-400 dark:text-slate-500 text-xs max-w-[240px] leading-relaxed">
                          Browse the auction listings, open a property, and click <strong>+ Pipeline</strong> to add it here.
                        </div>
                        <button onClick={() => setActiveNav('dashboard')}
                          className="mt-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold rounded-lg transition-colors">
                          Browse Listings
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        {COLUMNS.map(col => {
                          const deals = pipelineDeals.filter(d => d.status === col.status)
                          return (
                            <div key={col.status} className="bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden">
                              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                                <div className={`w-2 h-2 rounded-full ${col.dot}`} />
                                <span className={`text-[11.5px] font-bold ${col.color}`}>{col.label}</span>
                                <span className="ml-auto text-[10px] bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 font-bold px-1.5 py-0.5 rounded-full">{deals.length}</span>
                              </div>
                              <div className="p-2 space-y-2 min-h-[80px]">
                                {deals.length === 0 && (
                                  <div className="py-6 text-center text-[11px] text-slate-400 dark:text-slate-600">Empty</div>
                                )}
                                {deals.map(deal => (
                                  <div key={deal.id} className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-lg">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                      <div className="text-[11.5px] font-bold text-slate-800 dark:text-slate-200 leading-tight">{deal.addr}</div>
                                      <button onClick={() => removeDeal(deal.id)} className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 shrink-0 transition-colors">
                                        <X size={12} />
                                      </button>
                                    </div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mb-2 capitalize">{deal.county}</div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${roiBadgeCls(deal.roi)}`}>
                                        {deal.roi != null ? (deal.roi >= 999 ? '>999%' : deal.roi.toFixed(1) + '%') : '—'} ROI
                                      </span>
                                      <span className={`text-[10px] font-bold ${deal.score != null && deal.score > 0 ? scoreColorCls(deal.score) : 'text-slate-400 dark:text-slate-500'}`}>{deal.score != null && deal.score > 0 ? `${deal.score}/100` : '—'}</span>
                                    </div>
                                    <select
                                      value={deal.status}
                                      onChange={e => moveDeal(deal.id, e.target.value as PipelineStatus)}
                                      className="w-full text-[10.5px] font-semibold bg-white dark:bg-navy-700 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 rounded-md px-2 py-1 outline-none cursor-pointer focus:border-emerald-500"
                                    >
                                      <option value="watchlist">Watchlist</option>
                                      <option value="diligence">Due Diligence</option>
                                      <option value="bidding">Bidding</option>
                                      <option value="pass">Pass</option>
                                    </select>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* DATA QUALITY BANNER */}
              {activeNav !== 'pipeline' && props.length > 0 && kpis.viable === 0 && props.filter(p => p.roi != null).length === 0 && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 shadow-sm">
                  <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-amber-700 dark:text-amber-400">Analysis Incomplete — {county.name}</div>
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-1 leading-relaxed">
                      {props.length} properties loaded but comparable sales data is not yet available. ARV, ROI, and deal scores will appear once the analysis is complete.
                    </div>
                  </div>
                </div>
              )}

              {/* DATA-FRESHNESS GUARD — loud warning if the viewed auction already passed */}
              {activeNav !== 'pipeline' && activeNav !== 'analytics' &&
                !!activeAuctionDate && activeAuctionDate < new Date().toISOString().slice(0, 10) && (
                <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700/50 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700/50 flex items-center justify-center shrink-0">
                    <Clock size={14} className="text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
                      This auction has already passed
                    </div>
                    <div className="text-[9.5px] text-amber-700/90 dark:text-amber-400/80 mt-0.5 leading-relaxed">
                      You&apos;re viewing {activeAuctionEntry?.label || activeAuctionDate}, which is in the past — these
                      listings may no longer be available. Pick a current auction from the selector above.
                    </div>
                  </div>
                </div>
              )}

              {/* LAST-COMPLETED-AUCTION NOTE — picker tier (b) fell back to the most
                  recent POPULATED past auction because no upcoming list is populated
                  yet. Make that fallback explicit so it is never silent; complements
                  the "already passed" banner above. */}
              {activeNav !== 'pipeline' && activeNav !== 'analytics' &&
                !!activeAuctionDate && activeAuctionDate < new Date().toISOString().slice(0, 10) && props.length > 0 && (
                <div className="text-[10px] text-slate-500 dark:text-slate-400 -mt-2 px-1 font-medium">
                  Showing the last completed auction — no upcoming list has dropped yet.
                </div>
              )}

              {/* AUCTION BANNER — shows active auction from index, or upcoming if none loaded */}
              {activeNav !== 'pipeline' && activeNav !== 'analytics' && (
                activeAuctionEntry ? (
                  <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700/40 flex items-center justify-center shrink-0">
                      <Clock size={14} className="text-purple-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                        Viewing: <span className="text-purple-600 dark:text-purple-400">{activeAuctionEntry.label} Auction</span>
                      </div>
                      <div className="text-[9.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {county.name} · {activeAuctionEntry.total_properties} properties · SFR {activeAuctionEntry.residential} · MF {activeAuctionEntry.multi_family} · Comm {activeAuctionEntry.commercial} · Land {activeAuctionEntry.land}
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700/40 rounded-lg shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                      <span className="text-[10.5px] font-bold text-purple-700 dark:text-purple-400">{activeAuctionEntry.top_deals} Top Deals</span>
                    </div>
                  </div>
                ) : county.nextAuction ? (
                  <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 flex items-center justify-center shrink-0">
                      <Clock size={14} className="text-amber-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                        Next Auction — <span className="text-amber-600 dark:text-amber-400">{county.nextAuction}</span>
                      </div>
                      <div className="text-[9.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {county.name} · {county.auctionType} · Run analysis to populate this auction
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-lg shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      <span className="text-[10.5px] font-bold text-amber-700 dark:text-amber-400">No Data Yet</span>
                    </div>
                  </div>
                ) : null
              )}

              {activeNav !== 'pipeline' && activeNav !== 'analytics' && unlockDisplayLimit != null && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 shadow-sm">
                  <Lock size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {plan === 'starter' ? 'Starter includes 10 auction unlocks per month' : 'Pro includes 25 auction unlocks per month'}
                    </div>
                    <div className="text-xs text-amber-700/80 dark:text-amber-400/90 mt-1 leading-relaxed">
                      Locked listings hide their address and analysis until you unlock them. Unlocks reset every month across all counties.
                    </div>
                  </div>
                  <Link href="/pricing" className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-navy-800 border border-amber-200 dark:border-amber-800/50 rounded-lg text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
                    Upgrade
                  </Link>
                </div>
              )}

              {/* ESTIMATES DISCLAIMER — sits with the data so it travels with
                  ROI / max-bid / profit figures (the footer disclaimer is not
                  rendered inside the dashboard layout). */}
              {activeNav !== 'pipeline' && (
                <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                  <AlertTriangle size={13} className="text-slate-400 dark:text-slate-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">Estimates only.</span>{' '}
                    ARV, rehab, ROI, profit, deal scores, and recommended max bids are automated estimates from public records and third-party data — not investment, legal, or tax advice. Verify every figure and do your own due diligence before bidding.
                  </p>
                </div>
              )}

              {activeNav === 'analytics' && !showAdvancedAuctionMetrics && (
                <div className="flex flex-col items-center justify-center py-20 text-center bg-white dark:bg-navy-800 border border-amber-200 dark:border-amber-800/50 rounded-xl shadow-sm">
                  <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 flex items-center justify-center mb-4">
                    <Lock size={24} className="text-amber-500" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Upgrade for Advanced Analytics</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    Pro unlocks profit, risk, confidence, and comp analytics across your auction batches.
                  </p>
                  <Link href="/pricing" className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors">
                    <Lock size={13} /> Compare Plans
                  </Link>
                </div>
              )}

              {/* KPI CARDS */}
              {activeNav !== 'pipeline' && activeNav !== 'analytics' && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    {
                      label: 'Properties Analyzed',
                      value: kpis.total.toString(),
                      sub: `SFR ${kpis.sfr} · MF ${kpis.mf} · Comm ${kpis.comm} · Land ${kpis.land}`,
                      icon: <Home size={15} />,
                      color: 'text-amber-500',
                      bg: 'bg-amber-50 dark:bg-amber-900/20',
                      border: 'border-amber-100 dark:border-amber-800/40',
                      iconColor: 'text-amber-500',
                      barPct: 100,
                      barColor: 'bg-amber-400',
                    },
                    {
                      label: 'Viable Deals',
                      value: kpis.viable.toString(),
                      sub: `ROI ≥ 100% · ${kpis.total > 0 ? Math.round(kpis.viable / kpis.total * 100) : 0}% hit rate`,
                      icon: <Gem size={15} />,
                      color: 'text-cyan-600 dark:text-cyan-400',
                      bg: 'bg-cyan-50 dark:bg-cyan-900/20',
                      border: 'border-cyan-100 dark:border-cyan-800/40',
                      iconColor: 'text-cyan-500',
                      barPct: kpis.total > 0 ? Math.round(kpis.viable / kpis.total * 100) : 0,
                      barColor: 'bg-cyan-400',
                    },
                    showAdvancedAuctionMetrics ? {
                      label: 'Avg Net Profit',
                      value: fmt$(kpis.avgProfit),
                      sub: 'Improved properties · post-rehab',
                      icon: <TrendingUp size={15} />,
                      color: 'text-emerald-600 dark:text-emerald-400',
                      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
                      border: 'border-emerald-100 dark:border-emerald-800/40',
                      iconColor: 'text-emerald-500',
                      barPct: kpis.avgProfit > 0 ? Math.min(100, Math.round(kpis.avgProfit / 1000)) : 0,
                      barColor: 'bg-emerald-400',
                    } : {
                      label: 'Unlocks Used',
                      value: `${unlockUsedCount}/${unlockDisplayLimit ?? '∞'}`,
                      sub: 'Monthly across all counties',
                      icon: <Lock size={15} />,
                      color: 'text-amber-600 dark:text-amber-400',
                      bg: 'bg-amber-50 dark:bg-amber-900/20',
                      border: 'border-amber-100 dark:border-amber-800/40',
                      iconColor: 'text-amber-500',
                      barPct: unlockDisplayLimit ? Math.min(100, Math.round(unlockUsedCount / unlockDisplayLimit * 100)) : 0,
                      barColor: 'bg-amber-400',
                    },
                    {
                      label: 'Avg Post-Rehab ROI',
                      value: fmtPct(kpis.avgRoi),
                      sub: 'Bid + Rehab + Costs vs. ARV',
                      icon: <BarChart3 size={15} />,
                      color: 'text-purple-600 dark:text-purple-400',
                      bg: 'bg-purple-50 dark:bg-purple-900/20',
                      border: 'border-purple-100 dark:border-purple-800/40',
                      iconColor: 'text-purple-500',
                      barPct: kpis.avgRoi != null ? Math.min(100, Math.round(kpis.avgRoi / 3)) : 0,
                      barColor: 'bg-purple-400',
                    },
                  ].map(kpi => (
                    <div key={kpi.label} className="bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm relative overflow-hidden group hover:shadow-md transition-all hover:border-slate-300 dark:hover:border-white/15">
                      {/* Icon */}
                      <div className={`absolute top-3.5 right-3.5 p-1.5 rounded-lg ${kpi.bg} border ${kpi.border} ${kpi.iconColor}`}>{kpi.icon}</div>
                      {/* Label */}
                      <div className="text-[9.5px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2.5 pr-8">{kpi.label}</div>
                      {/* Value */}
                      <div className={`text-[22px] md:text-[26px] font-black tracking-tight leading-none mb-1.5 ${kpi.color}`}>{kpi.value}</div>
                      {/* Sub */}
                      <div className="text-[9.5px] text-slate-500 dark:text-slate-400 truncate mb-3">{kpi.sub}</div>
                      {/* Progress bar */}
                      <div className="h-[3px] rounded-full bg-slate-100 dark:bg-white/8 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${kpi.barColor} opacity-60`}
                          style={{ width: `${kpi.barPct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* CHARTS ROW */}
              {(activeNav === 'dashboard' || (activeNav === 'analytics' && showAdvancedAuctionMetrics)) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm p-4">
                    <div className="text-[12.5px] font-bold text-slate-800 dark:text-white mb-0.5">Post-Rehab ROI Distribution</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                      {props.filter(p => p.propType !== 'Vacant Land').length} improved properties · excludes land parcels
                    </div>
                    <div className="flex gap-3 flex-wrap mb-2">
                      {[['#ef4444','<50%'],['#f59e0b','50-100%'],['#10b981','100-200%'],['#34d399','200%+']].map(([c,l]) => (
                        <div key={l} className="flex items-center gap-1 text-[9.5px] text-slate-600 dark:text-slate-400 font-medium">
                          <div className="w-2 h-2 rounded-full" style={{ background: c }} />{l}
                        </div>
                      ))}
                    </div>
                    <div className="w-full max-w-[320px] mx-auto mt-4">
                      <ROIChart props={props.filter(p => p.propType !== 'Vacant Land')} />
                    </div>
                  </div>
                  <div className="bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm p-4">
                    <div className="text-[12.5px] font-bold text-slate-800 dark:text-white mb-0.5">Risk vs. Net Profit</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">Improved properties only · hover for detail</div>
                    <div className="flex gap-3 flex-wrap mb-2">
                      {[['#10b981','Score ≥ 90'],['#f59e0b','Score 70-89'],['#ef4444','Score < 70']].map(([c,l]) => (
                        <div key={l} className="flex items-center gap-1 text-[9.5px] text-slate-600 dark:text-slate-400 font-medium">
                          <div className="w-2 h-2 rounded-full" style={{ background: c }} />{l}
                        </div>
                      ))}
                    </div>
                    <div className="w-full max-w-[320px] mx-auto mt-4">
                      <ScatterChart props={props} />
                    </div>
                  </div>
                </div>
              )}

              {/* AUCTION LISTINGS */}
              {(activeNav === 'dashboard' || activeNav === 'top-deals') && (
                <div className="bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden mb-6">
                  {/* Table header */}
                  <div className="px-4 md:px-5 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5">
                    {/* Category tabs */}
                    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                      {([
                        { value: '',             label: 'All',         color: 'emerald' },
                        { value: 'SFR',          label: 'SFR',         color: 'blue'    },
                        { value: 'Multi-Family', label: 'Multi-Family',color: 'orange'  },
                        { value: 'Commercial',   label: 'Commercial',  color: 'purple'  },
                        { value: 'Vacant Land',  label: 'Land',        color: 'teal'    },
                      ] as const).map(tab => {
                        const count = tab.value === ''
                          ? props.length
                          : props.filter(p => p.propType === tab.value).length
                        if (count === 0 && tab.value !== '') return null
                        const isActive = filterType === tab.value
                        const colorMap: Record<string, string> = {
                          emerald: isActive ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-navy-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400',
                          blue:    isActive ? 'bg-blue-600 text-white border-blue-600'       : 'bg-white dark:bg-navy-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400',
                          orange:  isActive ? 'bg-orange-500 text-white border-orange-500'   : 'bg-white dark:bg-navy-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-orange-400 hover:text-orange-600 dark:hover:text-orange-400',
                          purple:  isActive ? 'bg-purple-600 text-white border-purple-600'   : 'bg-white dark:bg-navy-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-400',
                          teal:    isActive ? 'bg-teal-600 text-white border-teal-600'       : 'bg-white dark:bg-navy-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400',
                        }
                        return (
                          <button
                            key={tab.value}
                            onClick={() => setFilterType(tab.value)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all shadow-sm ${colorMap[tab.color]}`}
                          >
                            {tab.label}
                            <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400'}`}>
                              {count}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-slate-800 dark:text-white">
                          {activeNav === 'top-deals' ? 'Top Deals (ROI ≥ 100%)' : 'Auction Listings'}
                          {filterType && <span className="ml-1.5 text-slate-500 dark:text-slate-400 font-normal">· {filterType}</span>}
                        </span>
                        <span className="text-[10.5px] text-slate-500 dark:text-slate-400 font-medium bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded-full">{filteredProps.length} properties</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
                          className="bg-white dark:bg-navy-700 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-[11px] font-medium rounded-lg px-2.5 py-1.5 outline-none cursor-pointer focus:border-emerald-500 shadow-sm">
                          <option value="">All Cities</option>
                          {cities.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={sortField} onChange={e => setSortField(e.target.value as typeof sortField)}
                          className="bg-white dark:bg-navy-700 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-[11px] font-medium rounded-lg px-2.5 py-1.5 outline-none cursor-pointer focus:border-emerald-500 shadow-sm">
                          <option value="roi">Sort: ROI</option>
                          <option value="score">Sort: Score</option>
                          <option value="profit">Sort: Net Profit</option>
                          <option value="taxDue">Sort: Tax Due</option>
                        </select>
                        <div className="relative flex-1 md:flex-none">
                          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Search address…"
                            className="bg-white dark:bg-navy-700 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-[11px] font-medium rounded-lg pl-7 pr-3 py-1.5 outline-none focus:border-emerald-500 w-full md:w-[150px] placeholder-slate-400 dark:placeholder-slate-600 shadow-sm" />
                        </div>
                      </div>
                    </div>
                    {/* Rehab legend */}
                    <div className="hidden md:flex items-center gap-3 text-[9.5px] text-slate-500 dark:text-slate-400 flex-wrap">
                      <span className="font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[8.5px]">Rehab Method</span>
                      {[
                        ['#10b981','Light $35/sqft (2006+)'],
                        ['#f59e0b','Moderate $55/sqft (1976-2005)'],
                        ['#ef4444','Heavy $85/sqft (pre-1976)'],
                        ['#8b5cf6','Land: 20% of avg comp'],
                      ].map(([c,l]) => (
                        <div key={l} className="flex items-center gap-1 font-medium">
                          <div className="w-2 h-2 rounded-sm" style={{ background: c }} />{l}
                        </div>
                      ))}
                      <span className="ml-auto text-[8.5px] text-slate-400 dark:text-slate-500">Sight-unseen · +30% variance · conservative</span>
                    </div>
                  </div>

                  {/* DESKTOP Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-white/10 bg-white dark:bg-navy-800">
                          {[
                            { label: 'Property',       field: null as null },
                            { label: 'Bed / Bath',     field: null as null },
                            { label: 'Auction Date',   field: null as null },
                            { label: 'Tax Due',        field: 'taxDue' as const },
                            { label: 'Est. Rehab',     field: null as null },
                            { label: 'ARV',            field: null as null },
                            { label: 'Net Profit',     field: 'profit' as const },
                            { label: 'Post-Rehab ROI', field: 'roi'    as const },
                            { label: 'Score',          field: 'score'  as const },
                            { label: 'Risk',           field: null as null },
                          ].map(col => (
                            <th key={col.label}
                              onClick={() => col.field && handleSort(col.field)}
                              className={`px-4 py-3 text-left text-[9.5px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap ${col.field ? 'cursor-pointer hover:text-slate-800 dark:hover:text-white select-none' : ''}`}>
                              {col.label}{col.field ? <SortIcon field={col.field} /> : null}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProps.map((p, i) => {
                          const isBad      = p.roi != null && p.roi < 50
                          const isSelected = selectedProp?.id === p.id
                          const removed    = isRemoved(p)
                          // A removed parcel's unlock was already refunded — never let a
                          // click spend another unlock on it; just open the read-only panel.
                          const isLocked = !removed && isAuctionLocked(p)
                          // Guardrail screen-out / estimate-only: suppress the ROI number.
                          const noBid    = isNoBidState(p.isNoBid, p.arvConf, p.estimateOnly)
                          return (
                            <tr key={p.id}
                              onClick={() => isLocked ? unlockProperty(p) : setSelectedProp(isSelected ? null : p)}
                              className={`border-b border-slate-100 dark:border-white/10 cursor-pointer transition-colors text-[11.5px] ${
                                removed     ? 'opacity-55 bg-slate-50/60 dark:bg-white/5 hover:opacity-80' :
                                isLocked    ? 'bg-amber-50/40 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20' :
                                isSelected  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-l-2 border-l-emerald-500' :
                                isBad       ? 'bg-red-50/50 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20' :
                                i % 2 === 1 ? 'bg-slate-50/50 dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10' : 'bg-white dark:bg-transparent hover:bg-slate-50 dark:hover:bg-white/5'
                              }`}>
                              <td className="px-4 py-3">
                                <div className={`font-semibold text-slate-800 dark:text-slate-200 ${isLocked ? 'italic text-slate-400 dark:text-slate-500 select-none' : ''} ${removed ? 'line-through decoration-slate-400' : ''}`}>{i + 1}. {p.addr}</div>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{p.city}, GA {p.zip}</span>
                                  <TypeBadge type={p.propType} />
                                  <ConfidenceBadge arvConfidence={p.arvConf} scoreTier={p.scoreTier} />
                                  {removed && <RemovedBadge />}
                                  {isLocked && <LockedCell label="Unlock analysis" />}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                                {isLocked ? <LockedCell /> : p.beds ? `${p.beds}bd / ${p.baths}ba` : <span className="text-slate-400 dark:text-slate-600">—</span>}
                              </td>
                              <td className="px-4 py-3">
                                {p.auctionDate
                                  ? <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700/50 px-2 py-0.5 rounded-md whitespace-nowrap">
                                      {new Date(p.auctionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                  : <span className="text-slate-400 dark:text-slate-600 text-[11px]">—</span>
                                }
                              </td>
                              <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-semibold">{isLocked ? <LockedCell /> : fmt$(p.taxDue)}</td>
                              <td className="px-4 py-3">
                                {isLocked ? (
                                  <LockedCell />
                                ) : plan === 'starter' && !isAdmin ? (
                                  <UpgradeCell label="Pro" />
                                ) : p.propType === 'Vacant Land' ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/50 text-[9.5px] font-semibold">
                                    <Leaf size={8} /> Land
                                  </span>
                                ) : (p.propType === 'Commercial' || p.propType === 'Multi-Family') ? (
                                  <span className="text-amber-600 dark:text-amber-400 text-[10px] font-semibold">Specialist est.</span>
                                ) : (
                                  <span className="text-slate-600 dark:text-slate-300 font-semibold">{fmt$(p.rehab)}</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-semibold">
                                {isLocked ? (
                                  <LockedCell />
                                ) : plan === 'starter' && !isAdmin ? (
                                  <UpgradeCell label="Pro" />
                                ) : (p.propType === 'Commercial' || p.propType === 'Multi-Family') ? (
                                  p.countyAppraisedValue != null
                                    ? <span title="County Appraised Value (no ARV for commercial)">{fmt$(p.countyAppraisedValue)} <span className="text-[9px] text-slate-400 font-normal">County</span></span>
                                    : <span className="text-slate-400 dark:text-slate-600">—</span>
                                ) : (
                                  fmt$(p.arv != null && p.arv > 0 ? p.arv : null)
                                )}
                              </td>
                              <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 font-bold">{isLocked ? <LockedCell /> : plan === 'starter' && !isAdmin ? <UpgradeCell label="Pro" /> : noBid ? <span className="text-slate-400 dark:text-slate-500 font-semibold">—</span> : fmt$(p.profit)}</td>
                              <td className="px-4 py-3">
                                {isLocked ? (
                                  <LockedCell />
                                ) : noBid ? (
                                  <div>
                                    <NoBidPill p={p} />
                                    {p.noBidReason && (
                                      <div className="text-[9px] text-slate-500 dark:text-slate-400 font-medium mt-1 max-w-[140px] leading-snug">{p.noBidReason}</div>
                                    )}
                                  </div>
                                ) : (
                                  <>
                                    <span className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold border ${roiBadgeCls(p.roi)}`}>
                                      {fmtPct(p.roi)}
                                    </span>
                                    {showAdvancedAuctionMetrics && isBad && (
                                      <div className="flex items-center gap-0.5 mt-1">
                                        <AlertTriangle size={9} className="text-red-500" />
                                        <span className="text-[9px] text-red-500 font-medium">Below threshold</span>
                                      </div>
                                    )}
                                    {showAdvancedAuctionMetrics && p.dataConf === 'LOW' && p.propType !== 'Vacant Land' && (
                                      <div className="flex items-center gap-0.5 mt-1">
                                        <AlertTriangle size={9} className="text-amber-500" />
                                        <span className="text-[9px] text-amber-500 font-medium">Est. — no sqft</span>
                                      </div>
                                    )}
                                  </>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {isLocked ? (
                                  <LockedCell />
                                ) : isScoreUnknown(p) ? (
                                  <span className="text-[13px] font-bold text-slate-400 dark:text-slate-500">—</span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[15px] font-black ${scoreColorCls(p.score ?? 0)}`}>{p.score}</span>
                                    <div className="w-12 h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden shadow-inner">
                                      <div
                                        className={`h-full rounded-full ${(p.score ?? 0) >= 90 ? 'bg-emerald-500' : (p.score ?? 0) >= 75 ? 'bg-amber-500' : (p.score ?? 0) >= 50 ? 'bg-orange-500' : 'bg-red-500'}`}
                                        style={{ width: `${p.score ?? 0}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {isLocked ? <LockedCell /> : showAdvancedAuctionMetrics ? <span className={`font-bold ${riskColorCls(p.risk)}`}>{p.risk ?? '—'}</span> : <UpgradeCell label="Pro" />}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* MOBILE Property Cards */}
                  <div className="md:hidden grid grid-cols-1 gap-3 p-3 bg-slate-50/50 dark:bg-transparent">
                    {filteredProps.map((p, i) => {
                      const isBad = p.roi != null && p.roi < 50
                      const isSelected = selectedProp?.id === p.id
                      const removed = isRemoved(p)
                      const isLocked = !removed && isAuctionLocked(p)
                      const noBid = isNoBidState(p.isNoBid, p.arvConf, p.estimateOnly)
                      return (
                        <div key={p.id} onClick={() => isLocked ? unlockProperty(p) : setSelectedProp(isSelected ? null : p)}
                          className={`border rounded-xl p-3.5 shadow-sm cursor-pointer transition-all ${
                            removed ? 'opacity-60 bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10' : isLocked ? 'bg-amber-50/60 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/50' : isSelected ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/50' : isBad ? 'bg-white dark:bg-navy-800 border-red-200 dark:border-red-800/50' : 'bg-white dark:bg-navy-800 border-slate-200 dark:border-white/10'
                          }`}>
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className={`font-bold text-slate-800 dark:text-white text-[13px] ${isLocked ? 'italic text-slate-400 dark:text-slate-500 select-none' : ''} ${removed ? 'line-through decoration-slate-400' : ''}`}>{i + 1}. {p.addr}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">{p.city}, GA {p.zip}</div>
                            </div>
                            {removed ? null : isLocked ? <LockedCell label="Unlock" /> : noBid ? (
                              <NoBidPill p={p} />
                            ) : (
                              <div className={`px-2 py-1 rounded-lg text-[10.5px] font-bold border ${roiBadgeCls(p.roi)}`}>
                                {fmtPct(p.roi)}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <TypeBadge type={p.propType} />
                            <ConfidenceBadge arvConfidence={p.arvConf} scoreTier={p.scoreTier} />
                            {removed && <RemovedBadge />}
                            {!noBid && isBad && (
                              <div className="flex items-center gap-1 text-[10px] text-red-500 font-semibold bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-800/50">
                                <AlertTriangle size={10} /> Below threshold
                              </div>
                            )}
                            {noBid && p.noBidReason && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium w-full">{p.noBidReason}</div>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-[11.5px] border-t border-slate-100 dark:border-white/10 pt-2.5">
                            <div className="overflow-hidden">
                              <span className="text-slate-500 dark:text-slate-400 block mb-0.5 font-medium">Est. Profit</span>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400 text-[13px] block truncate">{isLocked ? 'Unlock' : plan === 'starter' && !isAdmin ? 'Pro' : noBid ? '—' : fmt$(p.profit)}</span>
                            </div>
                            <div>
                              <span className="text-slate-500 dark:text-slate-400 block mb-0.5 font-medium">
                                {p.scoreType === 'equity' ? 'Equity Score' : 'Deal Score'}
                              </span>
                              {isLocked ? (
                                <span className="font-bold text-[13px] text-amber-600 dark:text-amber-400">Unlock</span>
                              ) : isScoreUnknown(p) ? (
                                <span className="font-bold text-[13px] text-slate-400 dark:text-slate-500">—</span>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span className={`font-black text-[13px] ${scoreColorCls(p.score ?? 0)}`}>{p.score}</span>
                                  <div className="w-10 h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${(p.score ?? 0) >= 90 ? 'bg-emerald-500' : (p.score ?? 0) >= 75 ? 'bg-amber-500' : (p.score ?? 0) >= 50 ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${p.score ?? 0}%` }} />
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="overflow-hidden">
                              <span className="text-slate-500 dark:text-slate-400 block mb-0.5 font-medium">Tax Due</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-300 block truncate">{isLocked ? 'Unlock' : fmt$(p.taxDue)}</span>
                            </div>
                            <div className="overflow-hidden">
                              <span className="text-slate-500 dark:text-slate-400 block mb-0.5 font-medium">ARV</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-300 block truncate">{isLocked ? 'Unlock' : plan === 'starter' && !isAdmin ? 'Pro' : fmt$(p.arv != null && p.arv > 0 ? p.arv : null)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* EMPTY STATE — split by the UNFILTERED signal (props.length) so a
                      0-property loaded dataset never renders a silent blank grid or
                      the misleading "no filter matches" message. */}
                  {props.length === 0 ? (() => {
                    const todayStr = new Date().toISOString().slice(0, 10)
                    // Genuinely empty dataset. If the selected auction is UPCOMING,
                    // the scored list simply hasn't dropped yet — show a countdown
                    // state, NOT a filter message.
                    if (activeAuctionDate && activeAuctionDate >= todayStr) {
                      return (
                        <div className="py-12 px-6 text-center">
                          <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                            No active list yet for {activeAuctionEntry?.label || activeAuctionDate}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed max-w-md mx-auto">
                            The scored list hasn&apos;t dropped yet — check back closer to the sale date.
                          </div>
                        </div>
                      )
                    }
                    // Past auction with no rows: the amber "already passed" banner
                    // above already fires; this only surfaces for a genuinely empty
                    // completed record (picker tier b returns a POPULATED past, so a
                    // populated past never reaches here).
                    if (activeAuctionDate && activeAuctionDate < todayStr) {
                      return (
                        <div className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium">
                          No properties in this completed auction.
                        </div>
                      )
                    }
                    return (
                      <div className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium">
                        No data for {county.name} yet.
                      </div>
                    )
                  })() : filteredProps.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium">No properties match your filters.</div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ── PROPERTY DETAIL SLIDE-OUT ───────────────────────────────────── */}
      {selectedProp && (
        <PropertyDetailPanel
          prop={selectedProp}
          plan={plan}
          isAdmin={isAdmin}
          dataAsOf={dataAsOf}
          onClose={() => setSelectedProp(null)}
          onAddToPipeline={addToPipeline}
        />
      )}

      {/* ── PANELS / MODALS ─────────────────────────────────────────────── */}
      {activePanel && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
          style={{ zIndex: 70 }}
          onClick={() => setActivePanel(null)}
        >
          <div
            className="bg-white dark:bg-navy-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-[480px] max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >

            {/* ── SETTINGS ── */}
            {activePanel === 'settings' && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-[15px] font-black text-slate-900 dark:text-white">Settings</h2>
                  <button onClick={() => setActivePanel(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"><X size={16} /></button>
                </div>
                <div className="space-y-5">

                  {/* Appearance */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">Appearance</div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                      <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">Theme</span>
                      <ThemeToggle />
                    </div>
                  </div>

                  {/* Account */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">Account</div>
                    <div className="space-y-2">
                      <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mb-0.5">Email</div>
                        <div className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">{user?.email}</div>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mb-0.5">Plan</div>
                          <div className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 capitalize">{isAdmin ? 'Expert (Admin)' : plan}</div>
                        </div>
                        {!isAdmin && (
                          <Link href="/pricing" onClick={() => setActivePanel(null)}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-600 dark:text-amber-400 text-[11px] font-bold rounded-lg hover:bg-amber-100 transition-colors">
                            <Zap size={10} /> Upgrade
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Security */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">Security</div>
                    <div className="space-y-2">
                      <button
                        onClick={async () => {
                          const supabase = createClient()
                          const newPw = prompt('Enter new password (min 8 characters):')
                          if (!newPw || newPw.length < 8) return
                          const { error } = await supabase.auth.updateUser({ password: newPw })
                          if (error) alert('Error: ' + error.message)
                          else { alert('Password updated successfully.'); setActivePanel(null) }
                        }}
                        className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 transition-colors group"
                      >
                        <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Change Password</span>
                        <span className="text-[11px] text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">→</span>
                      </button>
                      <button
                        onClick={() => { setActivePanel(null); handleSignOut() }}
                        className="w-full flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-800/50 hover:border-red-300 dark:hover:border-red-700/50 transition-colors"
                      >
                        <span className="text-[12.5px] font-medium text-red-600 dark:text-red-400">Sign Out</span>
                        <LogOut size={13} className="text-red-400 dark:text-red-500" />
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* ── DIRECTIVES ── */}
            {activePanel === 'directives' && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-[15px] font-black text-slate-900 dark:text-white">Analysis Directives</h2>
                  <button onClick={() => setActivePanel(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"><X size={16} /></button>
                </div>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mb-5">The SOPs that drive how properties are sourced, scored, and ranked. Lives in <code className="font-mono bg-slate-100 dark:bg-white/10 px-1 rounded text-slate-700 dark:text-slate-300">/directives/</code></p>
                <div className="space-y-3">
                  {[
                    { icon: <FileText size={14} />, name: 'PDF Parse', detail: 'Extracts all tax-delinquent properties from the county\'s official PDF. Captures address, tax ID, amount owed, and property details.', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { icon: <Tag size={14} />, name: 'Classify', detail: 'Categorizes each property as SFR, Vacant Land, or Commercial based on property type descriptions.', color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                    { icon: <BarChart3 size={14} />, name: 'Comps', detail: 'Analyzes recent verified sales for each market, matched by property type and proximity. Calculates ARV from the comp median.', color: 'text-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                    { icon: <Hammer size={14} />, name: 'Rehab Est.', detail: 'Estimates renovation cost by year built: $35/sqft (light, 2006+), $55/sqft (moderate, 1976–2005), $85/sqft (heavy, pre-1976). Land uses 20% of avg comp.', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
                    { icon: <Calculator size={14} />, name: 'Score & ROI', detail: '65% rule: (ARV × 0.65) − Rehab − legal/title-clearing reserve − carrying costs. Scores 0–100 based on ROI and comp quality. Realistic target: 30–60% ROI.', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                  ].map((step, i) => (
                    <div key={i} className="flex gap-3 p-3.5 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                      <div className={`w-8 h-8 rounded-lg ${step.bg} ${step.color} flex items-center justify-center shrink-0`}>{step.icon}</div>
                      <div>
                        <div className="text-[12px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">{step.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{step.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  )
}
