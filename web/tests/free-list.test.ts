import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// ── What this covers ─────────────────────────────────────────────────────────
// The public /free-list/[county] teaser must NEVER leak the paid product:
// exact addresses, parcel ids, ARVs, deal scores, or owner PII. Masking lives
// in lib/free-list (pure functions) and the page renders ONLY the masked rows
// via TeaserTable. We test both layers:
//   1. the pure masking/banding helpers,
//   2. buildTeaserRows against the REAL shipped datasets (DeKalb 7/7 +
//      Gwinnett 8/4) — the exact data the auction-day page serves,
//   3. TeaserTable rendered to static markup — the literal HTML a visitor
//      receives — asserting none of the raw values appear in it.

import {
  FREE_LIST_COUNTIES,
  STRONG_DEAL_SCORE,
  TEASER_ROW_LIMIT,
  buildTeaserRows,
  formatAsOf,
  isFreeListCounty,
  maskAddress,
  maskParcel,
  teaserStats,
  valueBand,
  type TeaserRow,
} from '@/lib/free-list'
import TeaserTable from '@/app/free-list/[county]/TeaserTable'

type RawProperty = Record<string, unknown>

function loadProperties(fileName: string): RawProperty[] {
  const raw = readFileSync(path.resolve(__dirname, '..', 'data', fileName), 'utf8')
  const parsed = JSON.parse(raw) as { properties: RawProperty[] }
  return parsed.properties
}

// The default files the page serves for the target auctions (the county
// auction index points its upcoming entry at these).
const dekalb = loadProperties('dekalb.json')     // DeKalb 2026-07-07
const gwinnett = loadProperties('gwinnett.json') // Gwinnett 2026-08-04

const TEASER_ROW_KEYS = [
  'addressMasked',
  'city',
  'parcelMasked',
  'propertyType',
  'state',
  'taxDue',
  'valueBand',
].sort()

describe('lib/free-list — county allowlist', () => {
  it('accepts exactly the live free-list counties', () => {
    // Clayton joined 2026-07-14 with its Aug-4 list (24 parcels) published.
    expect(FREE_LIST_COUNTIES).toEqual(['dekalb', 'gwinnett', 'clayton'])
    expect(isFreeListCounty('dekalb')).toBe(true)
    expect(isFreeListCounty('gwinnett')).toBe(true)
    expect(isFreeListCounty('clayton')).toBe(true)
    expect(isFreeListCounty('cobb')).toBe(false)
    expect(isFreeListCounty('fulton')).toBe(false)
    expect(isFreeListCounty('')).toBe(false)
  })
})

describe('lib/free-list — maskAddress', () => {
  it('redacts the street number but keeps the street name', () => {
    const masked = maskAddress('4036 SMITHFIELD TRL')
    expect(masked).not.toContain('4036')
    expect(masked).toContain('SMITHFIELD TRL')
    expect(masked).toMatch(/^•••/)
  })

  it('redacts unit numbers too, with a fixed-width mask (digit count hidden)', () => {
    const masked = maskAddress('241 MAYNARD TER 25')
    expect(masked).not.toMatch(/\d/)
    expect(masked).toBe('••• MAYNARD TER •••')
  })

  it('strips an owner name embedded in the address field', () => {
    const masked = maskAddress(
      'SHACKELFORD PROPERTIES LLC GA HWY 124',
      'SHACKELFORD PROPERTIES LLC',
    )
    expect(masked).not.toContain('SHACKELFORD')
    expect(masked).toContain('GA HWY')
    expect(masked).not.toContain('124')
  })

  it('strips an entity-name prefix even when the owner field is empty', () => {
    // Real shapes from the Gwinnett 8/4 dataset (owner field is undefined there).
    expect(maskAddress('SHACKELFORD PROPERTIES LLC GA HWY 124')).toBe('GA HWY •••')
    expect(maskAddress('SPRING SWALLOW LODGE LLC JIMMY CARTER BLVD')).toBe('JIMMY CARTER BLVD')
    expect(maskAddress('FOX BROTHERS PROPERTY LLC 2925 HORIZON PARK DR STE C')).toBe('••• HORIZON PARK DR STE C')
    // Plain street with no number and no entity prefix passes through untouched.
    expect(maskAddress('WHITEHEAD RD')).toBe('WHITEHEAD RD')
  })

  it('strips PERSON owner-name prefixes (no entity token to key on)', () => {
    // Real Gwinnett 8/4 shapes: "<owner name> <house number> <street>".
    expect(maskAddress('SPENCER VIVIAN 2191 ROCKBRIDGE RD 1304')).toBe('••• ROCKBRIDGE RD •••')
    expect(maskAddress('PETERKIN KENNETH G & BERNICE M 3215 GROVE MEADOWS CV')).toBe('••• GROVE MEADOWS CV')
    expect(maskAddress('PHAM YEN-LINH THI 674 WOODHAVEN DOWNS')).toBe('••• WOODHAVEN DOWNS')
    expect(maskAddress('KUN WOO RHEE LIVING TRUST 840 RIVERDANCE DR 4')).toBe('••• RIVERDANCE DR •••')
  })

  it('returns a placeholder when the address is missing or owner-only', () => {
    expect(maskAddress(null)).toBe('—')
    expect(maskAddress('')).toBe('—')
    expect(maskAddress(undefined)).toBe('—')
    expect(maskAddress('ACME HOLDINGS LLC', 'ACME HOLDINGS LLC')).toBe('—')
    expect(maskAddress('ACME VENTURES LLC')).toBe('—')
  })
})

describe('lib/free-list — maskParcel', () => {
  it('keeps only a 2-char prefix of the first segment', () => {
    expect(maskParcel('15 021 08 023')).toBe('15 ••• ••• •••')
    expect(maskParcel('R4321 320')).toBe('R4••• •••')
  })

  it('handles missing parcel ids', () => {
    expect(maskParcel(null)).toBe('—')
    expect(maskParcel('')).toBe('—')
  })
})

describe('lib/free-list — valueBand', () => {
  it('collapses exact values into $50K bands', () => {
    expect(valueBand(314_068.27)).toBe('$300K–$350K')
    expect(valueBand(390_485.21)).toBe('$350K–$400K')
    expect(valueBand(50_000)).toBe('$50K–$100K')
  })

  it('handles the low and high tails', () => {
    expect(valueBand(600)).toBe('Under $25K')
    expect(valueBand(30_000)).toBe('$25K–$50K')
    expect(valueBand(1_200_000)).toBe('Over $1M')
  })

  it('returns null when there is no usable estimate', () => {
    expect(valueBand(null)).toBeNull()
    expect(valueBand(undefined)).toBeNull()
    expect(valueBand(0)).toBeNull()
    expect(valueBand(-5)).toBeNull()
    expect(valueBand(NaN)).toBeNull()
  })
})

describe('lib/free-list — formatAsOf (PR #17 freshness-stamp parity)', () => {
  it('formats ISO timestamps like the dashboard stamp', () => {
    expect(formatAsOf('2026-07-04T01:28:59.284801')).toBe('Jul 4, 2026')
  })
  it('handles compact YYYYMMDD input', () => {
    // Date-only strings parse as UTC midnight and format in the local zone
    // (same behavior as the dashboard stamp this mirrors), so the rendered
    // day can be the 21st or 22nd depending on the machine's timezone.
    expect(formatAsOf('20260322')).toMatch(/^Mar 2[12], 2026$/)
  })
  it('returns null on missing/garbage input', () => {
    expect(formatAsOf(null)).toBeNull()
    expect(formatAsOf(undefined)).toBeNull()
    expect(formatAsOf('not-a-date')).toBeNull()
  })
})

describe('buildTeaserRows — against the real shipped datasets', () => {
  const cases: Array<[string, RawProperty[]]> = [
    ['dekalb 7/7', dekalb],
    ['gwinnett 8/4', gwinnett],
  ]

  it.each(cases)('%s: caps the sample at TEASER_ROW_LIMIT', (_name, props) => {
    const rows = buildTeaserRows(props)
    expect(rows.length).toBeLessThanOrEqual(TEASER_ROW_LIMIT)
    expect(rows.length).toBe(Math.min(props.length, TEASER_ROW_LIMIT))
  })

  it.each(cases)('%s: rows carry ONLY the allowlisted teaser fields', (_name, props) => {
    for (const row of buildTeaserRows(props)) {
      expect(Object.keys(row).sort()).toEqual(TEASER_ROW_KEYS)
    }
  })

  it.each(cases)('%s: no raw address, parcel, or owner survives masking', (_name, props) => {
    const rows = buildTeaserRows(props)
    const serialized = JSON.stringify(rows)
    for (const p of props) {
      const address = typeof p.full_address === 'string' ? p.full_address.trim() : ''
      // A numbered address must never survive intact (a digit-less street name
      // like "WHITEHEAD RD" has no number to protect and passes through).
      if (address && /\d/.test(address)) {
        expect(serialized).not.toContain(JSON.stringify(address).slice(1, -1))
      }
      const parcel = typeof p.tax_id === 'string' ? p.tax_id.trim() : ''
      if (parcel) expect(serialized).not.toContain(`"${parcel}"`)
    }
    for (const row of rows) {
      expect(row.addressMasked).not.toMatch(/\d/) // every digit is redacted
    }
    // No owner-name prefix (entity OR person) survives: for every source
    // address of the form "<words> <number> <street>", the words before the
    // house number must be gone from the masked output.
    for (const p of props) {
      const address = typeof p.full_address === 'string' ? p.full_address.trim() : ''
      const m = address.match(/^([A-Za-z][A-Za-z .&'-]+?)\s+\d+\s+\S/)
      if (m) {
        const prefix = m[1].toUpperCase()
        for (const row of rows) {
          expect(row.addressMasked.toUpperCase()).not.toContain(prefix)
        }
      }
    }
    // Per-row: a property's own owner name never appears in its masked address.
    const sorted = [...props].sort((a, b) =>
      String(a.tax_id ?? '').localeCompare(String(b.tax_id ?? '')),
    )
    rows.forEach((row, i) => {
      const owner = typeof sorted[i].owner === 'string' ? (sorted[i].owner as string).trim() : ''
      if (owner.length >= 4) {
        expect(row.addressMasked.toUpperCase()).not.toContain(owner.toUpperCase())
      }
    })
  })

  it.each(cases)('%s: exact ARVs and deal scores never leak (bands only)', (_name, props) => {
    const serialized = JSON.stringify(buildTeaserRows(props))
    for (const p of props) {
      if (typeof p.arv === 'number' && p.arv > 0) {
        expect(serialized).not.toContain(String(p.arv))
      }
      if (typeof p.net_profit === 'number' && p.net_profit !== 0) {
        expect(serialized).not.toContain(String(p.net_profit))
      }
    }
    // No paid-product keys survive into the teaser shape.
    for (const forbiddenKey of ['"deal_score"', '"roi_percent"', '"max_bid"', '"recommended_max_bid"', '"arv"', '"net_profit"', '"owner"', '"ranked_comps"']) {
      expect(serialized).not.toContain(forbiddenKey)
    }
  })

  it('sorts by parcel id (neutral county order), not the ranked pipeline order', () => {
    const synthetic: RawProperty[] = [
      { tax_id: 'C 3', full_address: '9 THIRD ST', city: 'Ccity', deal_score: 100 },
      { tax_id: 'A 1', full_address: '7 FIRST ST', city: 'Acity', deal_score: 10 },
      { tax_id: 'B 2', full_address: '8 SECOND ST', city: 'Bcity', deal_score: 55 },
    ]
    const rows = buildTeaserRows(synthetic)
    expect(rows.map(r => r.city)).toEqual(['Acity', 'Bcity', 'Ccity'])
  })

  it('respects a custom limit', () => {
    expect(buildTeaserRows(gwinnett, 10)).toHaveLength(10)
    expect(buildTeaserRows(gwinnett, 0)).toHaveLength(0)
  })
})

describe('teaserStats', () => {
  it('counts totals and strong deals from the real datasets', () => {
    const dk = teaserStats(dekalb)
    expect(dk.totalProperties).toBe(dekalb.length)
    expect(dk.strongDeals).toBe(
      dekalb.filter(p => typeof p.deal_score === 'number' && p.deal_score >= STRONG_DEAL_SCORE).length,
    )
    const gw = teaserStats(gwinnett)
    expect(gw.totalProperties).toBe(gwinnett.length)
    expect(gw.strongDeals).toBeGreaterThan(0)
  })
})

describe('TeaserTable — the rendered HTML a visitor actually receives', () => {
  function renderRows(rows: TeaserRow[]): string {
    return renderToStaticMarkup(React.createElement(TeaserTable, { rows }))
  }

  it('renders every masked row and the Locked placeholders', () => {
    const rows = buildTeaserRows(dekalb)
    const html = renderRows(rows)
    for (const row of rows) {
      expect(html).toContain(row.addressMasked)
    }
    expect(html).toContain('Locked')
    expect(html).toContain('Deal score')
    expect(html).toContain('Max bid')
  })

  it('contains none of the raw addresses, parcels, or exact ARVs', () => {
    for (const props of [dekalb, gwinnett]) {
      const html = renderRows(buildTeaserRows(props))
      for (const p of props) {
        const address = typeof p.full_address === 'string' ? p.full_address.trim() : ''
        if (address && /\d/.test(address)) expect(html).not.toContain(address)
        const parcel = typeof p.tax_id === 'string' ? p.tax_id.trim() : ''
        if (parcel) expect(html).not.toContain(parcel)
        if (typeof p.arv === 'number' && p.arv > 0) {
          expect(html).not.toContain(String(p.arv))
        }
      }
    }
  })
})
