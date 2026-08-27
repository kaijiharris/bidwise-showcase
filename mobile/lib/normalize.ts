// Faithfully ported from web/app/dashboard/DashboardClient.tsx so mobile and web
// agree on every field alias and classification rule. If you change either side,
// change both — this is the contract between the two surfaces.

import type { CompItem, NormalizedProperty, PropType, AuctionMeta } from './types'

export function classifyType(
  type: string | undefined,
  propertyClass?: string,
  sqft?: number | null,
  beds?: number | null,
  _appraisedValue?: number | null,
  _structureConfirmed?: boolean
): PropType {
  if (propertyClass) {
    const pc = propertyClass.trim().toUpperCase()
    if (/^RM[-\s]?\d/.test(pc) || pc === 'RAD' || pc === 'TR') return 'Multi-Family'
    if (pc === 'C4') return 'Multi-Family'
    if (/^[CI]\d/.test(pc)) return 'Commercial'
    if (pc === 'COMMERCIAL' || pc === 'INDUSTRIAL') return 'Commercial'
    if (
      pc === 'MULTI-FAMILY' ||
      pc === 'MULTI_FAMILY' ||
      pc === 'MULTIFAMILY' ||
      pc === 'MULTI FAMILY' ||
      pc === 'APARTMENT' ||
      pc === 'APARTMENTS'
    ) {
      return 'Multi-Family'
    }
  }

  if (type) {
    const t = type.toLowerCase()
    if (t.includes('vacant') || t.includes('land') || t.includes('lot')) return 'Vacant Land'
    if (
      t.includes('multi') ||
      t.includes('apartment') ||
      t.includes('duplex') ||
      t.includes('triplex') ||
      t.includes('quadplex') ||
      t.includes('fourplex')
    ) {
      return 'Multi-Family'
    }
    if (
      t.includes('commercial') ||
      t.includes('industrial') ||
      t.includes('office') ||
      t.includes('retail')
    ) {
      return 'Commercial'
    }
    if (t.includes('single') || t.includes('sfr') || t.includes('residential')) return 'SFR'
  }

  if (propertyClass) {
    const pc = propertyClass.trim().toUpperCase()
    if (/^R\d/.test(pc)) {
      const hasStructure = (sqft != null && sqft > 0) || (beds != null && beds > 0)
      return hasStructure ? 'SFR' : 'Vacant Land'
    }
  }

  const hasStructure = (sqft != null && sqft > 0) || (beds != null && beds > 0)
  return hasStructure ? 'SFR' : 'Vacant Land'
}

interface RawComp {
  address?: string | { streetAddress?: string; city?: string; state?: string }
  used_for_address?: string
  sale_price?: number
  sale_date?: number | string
  sqft?: number | null
  bedrooms?: number | null
  bathrooms?: number | null
  beds?: number | null
  baths?: number | null
  year_built?: number | null
  psf?: number | null
  top5?: boolean
}

function buildComps(rawComps: RawComp[], addr: string, rankedComps?: RawComp[]): CompItem[] {
  if (Array.isArray(rankedComps) && rankedComps.length > 0) {
    return rankedComps.map((c) => ({
      a:
        typeof c.address === 'object' && c.address !== null
          ? [c.address.streetAddress, c.address.city, c.address.state].filter(Boolean).join(', ')
          : (c.address as string) || '',
      d: '',
      p: c.sale_price || 0,
      sqft: c.sqft ?? null,
      beds: c.beds ?? null,
      baths: c.baths ?? null,
      psf: c.psf ?? null,
      top5: c.top5 ?? false,
      saleDate: typeof c.sale_date === 'string' ? c.sale_date : '',
    }))
  }

  if (!Array.isArray(rawComps)) return []

  return rawComps
    .filter((c) => c.used_for_address === addr)
    .map((c) => {
      const ms = typeof c.sale_date === 'number' ? c.sale_date : Number(c.sale_date)
      const soldDate = ms
        ? new Date(ms > 9_999_999_999 ? ms : ms * 1000).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          })
        : ''
      const detail = [
        c.bedrooms && c.bathrooms ? `${c.bedrooms}bd/${c.bathrooms}ba` : null,
        c.sqft ? `${Number(c.sqft).toLocaleString()} sqft` : null,
        c.year_built ? `built ${c.year_built}` : null,
        soldDate ? `sold ${soldDate}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      return {
        a: typeof c.address === 'string' ? c.address : '',
        d: detail,
        p: c.sale_price || 0,
      }
    })
}

interface RawAuctionPayload {
  properties?: unknown[]
  comparables?: RawComp[]
  total_properties?: number
  analysis_date?: string
  auction_date?: string
}

export function normalizeData(
  data: RawAuctionPayload | unknown[],
  slug: string
): { props: NormalizedProperty[]; meta: AuctionMeta } {
  const rawProps = (Array.isArray(data) ? data : data.properties || []) as Record<
    string,
    unknown
  >[]
  const rawComps = (Array.isArray(data) ? [] : data.comparables || []) as RawComp[]
  const metaAuctionDate =
    !Array.isArray(data) && typeof data.auction_date === 'string' ? data.auction_date : null

  const props: NormalizedProperty[] = rawProps.map((p, i) => {
    const addr = (p.full_address as string) || (p.address as string) || ''
    // Mirror web's legalClosing: prefer the pre-summed legal_closing_costs, else
    // aggregate the individual acquisition costs. Plain closing_costs alone is a
    // placeholder and understates the true cash needed at close.
    const legalClosing =
      (p.legal_closing_costs as number) ??
      (((p.closing_costs as number) || 0) +
        ((p.title_insurance as number) || 0) +
        ((p.transfer_tax as number) || 0) +
        ((p.recording_fees as number) || 0) +
        ((p.quiet_title_cost as number) || 0))
    return {
      id: i + 1,
      county: (p.county as string) || slug,
      addr,
      city: (p.city as string) || '',
      zip: (p.zip_code as string) || '',
      propType: classifyType(
        p.property_type as string,
        p.property_class as string,
        p.sqft as number | null,
        (p.beds ?? p.bedrooms) as number | null,
        p.appraised_value as number | null,
        p.structure_confirmed as boolean | undefined
      ),
      auctionDate: (p.auction_date as string) || metaAuctionDate || null,
      beds: ((p.beds ?? p.bedrooms) as number | null) ?? null,
      baths: ((p.baths ?? p.bathrooms) as number | null) ?? null,
      sqft: (p.sqft as number | null) ?? null,
      yearBuilt: (p.year_built as number | null) ?? null,
      lotAcres: (p.lot_acres as number | null) ?? null,
      taxDue: (p.tax_due as number) || 0,
      rehab:
        (p.estimated_rehab_cost as number) ||
        (p.estimated_rehab as number) ||
        (p.rehab_cost as number) ||
        0,
      arv: (p.arv as number | null) ?? null,
      countyAppraisedValue: (p.county_appraised_value as number | null) ?? null,
      landValue: (p.land_value as number | null) ?? null,
      landValueSource: (p.land_value_source as string) || '',
      landAcreageFlag: (p.land_acreage_flag as string) || '',
      asisProfit: (p.asis_net_profit as number | null) ?? null,
      asisRoi: (p.asis_roi_percent as number | null) ?? null,
      asisAllIn: (p.asis_all_in_cost as number | null) ?? null,
      asisSalePrice: (p.asis_sale_price as number | null) ?? null,
      profit: ((p.net_profit ?? p.gross_profit) as number | null) ?? null,
      roi: ((p.roi_percent ?? p.roi_pct) as number | null) ?? null,
      score: (p.deal_score as number | null) ?? null,
      risk: (p.risk_score as number | null) ?? null,
      allIn: (p.all_in_cost as number) || 0,
      closing: (p.closing_costs as number) || 0,
      legalClosing,
      comps: ((p.comps_used_for_arv ?? p.comp_count ?? p.arv_comp_count) as number) || 0,
      compPoolSize: ((p.comp_count ?? p.arv_comp_count) as number) || 0,
      compQual: (p.comp_quality_rating as string) || '',
      arvConf: (p.arv_confidence as string) || '',
      dataConf: (p.data_confidence as string) || '',
      topDeal: (p.top_deal as boolean | null) ?? null,
      structureConfirmed: (p.structure_confirmed as boolean) ?? false,
      dealRating: (p.deal_rating as string) || '',
      arvCalc: ((p.arv_calculation ?? p.arv_method) as string) || '',
      rehabCalc: (p.rehab_calculation as string) || '',
      rehabNotes: (p.rehab_notes as string) || '',
      closeCalc: (p.closing_calculation as string) || '',
      allInCalc: ((p.all_in_breakdown ?? p.all_in_calculation) as string) || '',
      profitCalc: (p.profit_calculation as string) || '',
      roiCalc: (p.roi_calculation as string) || '',
      investViability: (p.investment_viability as string) || '',
      taxId: (p.tax_id as string) || '',
      recommendedMaxBid: (p.recommended_max_bid as number | null) ?? null,
      assessorAddress: (p.assessor_address as string) || addr,
      appraisedValue: (p.appraised_value as number | null) ?? null,
      minBid: (p.min_bid as number | null) ?? null,
      comparables: buildComps(rawComps, addr, p.ranked_comps as RawComp[] | undefined),
      scoreType: (p.score_type as NormalizedProperty['scoreType']) ?? null,
      zillowUrl: (p.zillow_url as string | null) ?? null,
    }
  })

  return {
    props,
    meta: {
      count: (!Array.isArray(data) && data.total_properties) || props.length,
      generated: (!Array.isArray(data) && data.analysis_date) || null,
      county: slug,
      auctionDate: metaAuctionDate,
    },
  }
}

// Auction properties that "scored to 0" because they couldn't be analyzed —
// matches isScoreUnknown() on web. Used to suppress "Weak" badges on those.
/**
 * The pipeline-stamped Top-Deal verdict (execution/utils/top_deals.py), with the
 * client-side approximation as fallback for unstamped archive data. Extracted
 * from the feed's top-deals filter so the DealCard badge and the tab filter can
 * never disagree about what qualifies.
 */
export function isTopDeal(p: NormalizedProperty): boolean {
  return (
    p.topDeal ??
    ((p.roi ?? -Infinity) >= 100 &&
      (p.roi as number) <= 200 &&
      p.comps >= 3 &&
      p.arvConf.trim().toUpperCase() !== 'LOW')
  )
}

export function isScoreUnknown(p: NormalizedProperty): boolean {
  if (p.score == null) return true
  if (p.scoreType === 'none' || p.scoreType === 'N/A') return true
  if (
    !p.scoreType &&
    p.score === 0 &&
    (p.propType === 'Commercial' || p.propType === 'Multi-Family' || p.propType === 'Vacant Land')
  ) {
    return true
  }
  return false
}
