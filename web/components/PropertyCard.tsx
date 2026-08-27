'use client'

import Link from 'next/link'
import { Lock, MapPin, Calendar, Ban } from 'lucide-react'
import ConfidenceBadge, { isNoBidState, noBidLabel } from './ConfidenceBadge'

// Shape matches the `visible_properties_safe` view in migration 002 (+020).
// Financial fields are NULL when locked — frontend renders straight from this.
export type PropertyCardData = {
  id: string
  parcel_id: string
  address: string
  city: string | null
  state: string | null
  zip: string | null
  county: string
  property_type: string | null
  beds: number | null
  baths: number | null
  sqft: number | null
  auction_date: string | null
  deal_score: number | null
  locked: boolean
  user_plan?: 'starter' | 'pro' | 'expert' | 'none'
  // Revealed only when unlocked
  arv?: number | null
  roi_pct?: number | null
  net_profit?: number | null
  max_bid?: number | null
  // Wave 3 deal-engine fields — all OPTIONAL and null-safe. Absent on
  // pre-Wave-1/2 data, in which case the card renders exactly as before.
  arv_confidence?: string | null
  score_tier?: string | null
  is_no_bid?: boolean | null
  no_bid_reason?: string | null
  // Land-model flag (migration 022): valuation is a rough heuristic and the
  // parcel never ranks — always visible, even on locked rows.
  estimate_only?: boolean | null
  roi_if_redeemed_year1_pct?: number | null
  roi_if_deed_matures?: number | null
}

const formatCurrency = (n: number | null | undefined) => {
  if (n == null) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}

const scoreColor = (score: number | null) => {
  if (score == null) return 'bg-slate-700/50 text-slate-300'
  if (score >= 75) return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
  if (score >= 50) return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
  return 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
}

const upgradeTarget = (plan?: PropertyCardData['user_plan']) =>
  plan === 'starter' ? 'Pro' : plan === 'pro' ? 'Expert' : 'Pro'

export default function PropertyCard({ property }: { property: PropertyCardData }) {
  const { locked, user_plan, deal_score, address, city, county, zip, auction_date,
          property_type, beds, baths, sqft, parcel_id } = property

  const cardClass = locked
    ? 'border-white/8 bg-white/[0.02] hover:border-white/12'
    : 'border-emerald-500/20 bg-white/[0.04] hover:border-emerald-500/40 hover:bg-white/[0.06]'

  const Wrapper = locked ? 'div' : Link
  const wrapperProps = locked
    ? {}
    : { href: `/dashboard/property/${parcel_id}` }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- props differ between the Link and div branches of this polymorphic wrapper
  const wrapperSpread = wrapperProps as any

  return (
    <Wrapper
      {...wrapperSpread}
      className={`block relative rounded-xl border p-5 transition-all ${cardClass} ${!locked ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-white truncate">{address}</h3>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
            <MapPin size={11} />
            {city}, {property.state || 'GA'} {zip || ''} · {county} County
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ConfidenceBadge
            arvConfidence={property.arv_confidence}
            scoreTier={property.score_tier}
          />
          <span className={`text-xs font-bold px-2.5 py-1 rounded-md whitespace-nowrap ${scoreColor(deal_score)}`}>
            {deal_score != null ? Math.round(deal_score) : '—'}
          </span>
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400 mb-4">
        {property_type && <span>{property_type}</span>}
        {beds != null && <span>{beds} bd</span>}
        {baths != null && <span>{baths} ba</span>}
        {sqft != null && <span>{sqft.toLocaleString()} sqft</span>}
        {auction_date && (
          <span className="flex items-center gap-1 ml-auto text-slate-500">
            <Calendar size={11} />
            {new Date(auction_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      {locked ? (
        <LockedFinancials userPlan={user_plan} />
      ) : (
        <UnlockedFinancials property={property} />
      )}
    </Wrapper>
  )
}

function UnlockedFinancials({ property }: { property: PropertyCardData }) {
  // NO-BID / ESTIMATE-ONLY: never surface a (misleading) ROI or profit figure.
  // Show the clear disqualified state and the reason instead.
  if (isNoBidState(property.is_no_bid, property.arv_confidence, property.estimate_only)) {
    return <NoBidFinancials property={property} />
  }

  // Redemption dual-ROI: a tax-deed parcel can either be redeemed (owner pays
  // you back with the statutory penalty in year 1) or mature to a deed. When
  // the engine provides both, show both labeled — never a single blended number.
  if (property.roi_if_redeemed_year1_pct != null) {
    return (
      <div className="pt-3 border-t border-white/5">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Stat
            label="Redeemed (yr 1)"
            value={`${Math.round(property.roi_if_redeemed_year1_pct)}%`}
            accent
          />
          <Stat
            label="If deed matures"
            value={property.roi_if_deed_matures != null ? `${Math.round(property.roi_if_deed_matures)}%` : '—'}
            accent
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="ARV" value={formatCurrency(property.arv)} />
          <Stat label="Profit" value={formatCurrency(property.net_profit)} />
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/5">
      <Stat label="ROI" value={property.roi_pct != null ? `${Math.round(property.roi_pct)}%` : '—'} accent />
      <Stat label="ARV" value={formatCurrency(property.arv)} />
      <Stat label="Profit" value={formatCurrency(property.net_profit)} />
    </div>
  )
}

function NoBidFinancials({ property }: { property: PropertyCardData }) {
  const label = noBidLabel(property.is_no_bid, property.arv_confidence, property.estimate_only)

  return (
    <div className="pt-3 border-t border-white/5">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-md bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30 whitespace-nowrap">
          <Ban size={11} /> {label}
        </span>
      </div>
      {property.no_bid_reason && (
        <p className="text-[11px] text-slate-400 mt-2 leading-snug">{property.no_bid_reason}</p>
      )}
    </div>
  )
}

function LockedFinancials({ userPlan }: { userPlan?: PropertyCardData['user_plan'] }) {
  return (
    <div className="relative pt-3 border-t border-white/5">
      <div className="grid grid-cols-3 gap-3 select-none filter blur-[3px] pointer-events-none">
        <Stat label="ROI" value="••%" />
        <Stat label="ARV" value="$•••K" />
        <Stat label="Profit" value="$•••K" />
      </div>
      <div className="absolute inset-0 pt-3 flex items-center justify-center bg-gradient-to-t from-slate-900/95 via-slate-900/85 to-transparent rounded-b-xl">
        <Link
          href="/pricing"
          className="flex items-center gap-2 px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-500/20 transition-all"
        >
          <Lock size={12} />
          Unlock — Upgrade to {upgradeTarget(userPlan)}
        </Link>
      </div>
    </div>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</p>
      <p className={`text-sm font-bold mt-0.5 ${accent ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}
