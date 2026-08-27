import { describe, it, expect } from 'vitest'
import { teaserRowsToCsv } from '@/lib/free-list-email'
import type { TeaserRow } from '@/lib/free-list'

// Pure CSV builder for the lead-magnet fulfillment attachment. The masking
// itself is buildTeaserRows' job (covered by free-list tests); here we pin the
// CSV contract: header, quoting, null handling, CRLF line endings.

function row(overrides: Partial<TeaserRow> = {}): TeaserRow {
  return {
    parcelMasked: '15 ••• ••• •••',
    addressMasked: '••• SMITHFIELD TRL',
    city: 'Decatur',
    state: 'GA',
    propertyType: 'Residential',
    taxDue: 4321.5,
    valueBand: '$250K–$300K',
    ...overrides,
  }
}

describe('teaserRowsToCsv', () => {
  it('emits the header plus one CRLF-terminated line per row, all fields quoted', () => {
    const csv = teaserRowsToCsv([row()])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      '"Parcel (masked)","Address (masked)","City","State","Property Type","Taxes Due (USD)","Est. Value Band"',
    )
    expect(lines[1]).toBe(
      '"15 ••• ••• •••","••• SMITHFIELD TRL","Decatur","GA","Residential","4321.5","$250K–$300K"',
    )
    // Trailing CRLF -> final split element is empty.
    expect(lines[2]).toBe('')
  })

  it('renders null fields as empty quoted cells', () => {
    const csv = teaserRowsToCsv([
      row({ city: null, state: null, propertyType: null, taxDue: null, valueBand: null }),
    ])
    expect(csv.split('\r\n')[1]).toBe('"15 ••• ••• •••","••• SMITHFIELD TRL","","","","",""')
  })

  it('escapes embedded quotes by doubling them (RFC 4180)', () => {
    const csv = teaserRowsToCsv([row({ addressMasked: '••• "OLD MILL" RD' })])
    expect(csv).toContain('"••• ""OLD MILL"" RD"')
  })

  it('handles an empty row set (header only)', () => {
    const csv = teaserRowsToCsv([])
    expect(csv.split('\r\n')).toHaveLength(2) // header + trailing empty
  })
})
