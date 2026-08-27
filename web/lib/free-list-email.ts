// Free-list lead-magnet FULFILLMENT — the email the capture form promises
// ("one email with the full analyzed list").
//
// What it delivers: the COMPLETE list of analyzed properties for the county
// (every parcel, not just the 50-row page teaser) as a CSV attachment — using
// the exact same server-side masking as the public teaser (lib/free-list
// buildTeaserRows). Deal scores, max bids, ARVs, comps, owner PII and full
// parcels/addresses stay locked: the paid product is never given away here.
//
// Contract mirrors lib/email.ts: sendFreeListEmail NEVER throws. The lead is
// already stored by the caller — fulfillment failing must not break capture.

import { readCountyDataset, resolveDataFile } from './county-data'
import {
  buildTeaserRows,
  teaserStats,
  COUNTY_LABELS,
  formatAsOf,
  type FreeListCounty,
  type TeaserRow,
} from './free-list'
import { sendEmail } from './email'
import { TRIAL_DAYS } from './trial'

const SITE_URL = 'https://www.bidwiseinvest.com'

// RFC-4180-ish escaping: wrap every field in quotes, double any quotes inside.
function csvField(v: string | number | null): string {
  if (v === null || v === undefined) return '""'
  return `"${String(v).replaceAll('"', '""')}"`
}

/** Pure + unit-testable: teaser rows -> CSV text (header + one line per row). */
export function teaserRowsToCsv(rows: readonly TeaserRow[]): string {
  const header = [
    'Parcel (masked)',
    'Address (masked)',
    'City',
    'State',
    'Property Type',
    'Taxes Due (USD)',
    'Est. Value Band',
  ].map(csvField).join(',')

  const lines = rows.map(r =>
    [
      csvField(r.parcelMasked),
      csvField(r.addressMasked),
      csvField(r.city),
      csvField(r.state),
      csvField(r.propertyType),
      csvField(r.taxDue),
      csvField(r.valueBand),
    ].join(','),
  )
  return [header, ...lines].join('\r\n') + '\r\n'
}

export interface FreeListEmailInput {
  to: string
  county: FreeListCounty
}

/**
 * Load the county's current published dataset, build the masked full-list CSV,
 * and email it. Returns { ok:false } (never throws) on any failure — including
 * "no dataset published yet", where a link-only email is sent instead so the
 * lead still hears from us.
 */
export async function sendFreeListEmail(input: FreeListEmailInput): Promise<{ ok: boolean }> {
  const countyLabel = COUNTY_LABELS[input.county] ?? input.county
  const pageUrl = `${SITE_URL}/free-list/${input.county}`

  try {
    let rows: TeaserRow[] = []
    let totalProperties = 0
    let strongDeals = 0
    let auctionDateLabel: string | null = null

    const resolved = await resolveDataFile(input.county)
    if (resolved) {
      const dataset = await readCountyDataset(input.county, resolved.fileName)
      rows = buildTeaserRows(dataset.properties, dataset.properties.length)
      const stats = teaserStats(dataset.properties)
      totalProperties = stats.totalProperties
      strongDeals = stats.strongDeals
      auctionDateLabel = formatAsOf(dataset.auction_date)
    }

    const hasData = rows.length > 0
    const auctionLine = auctionDateLabel
      ? `<p style="font-size:14px;line-height:1.6;margin:0 0 14px;">Auction date: <strong>${auctionDateLabel}</strong>.</p>`
      : ''

    const bodyTop = hasData
      ? `<p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
           Attached is the complete analyzed ${countyLabel} tax-sale list —
           <strong>${totalProperties} properties</strong>, ${strongDeals} flagged as strong deals
           by our scoring engine. Street names, property types, taxes due, and
           estimated-value bands are included.
         </p>
         ${auctionLine}
         <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
           Deal scores, recommended max bids, ARVs, and comps stay locked to
           members — start the ${TRIAL_DAYS}-day free trial and the full numbers open up
           for every parcel on this list.
         </p>`
      : `<p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
           ${countyLabel}'s next tax-sale list hasn't been published by the county
           yet. You're on the list — the moment it drops and our analysis runs,
           you'll get the full breakdown here.
         </p>
         <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
           In the meantime, the live teaser stays current:
         </p>`

    const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#10151e;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <p style="font-size:13px;letter-spacing:0.14em;font-weight:bold;color:#2563eb;margin:0 0 20px;">BIDWISE</p>
      <div style="background:#ffffff;border:1px solid #e3e7ec;border-radius:8px;padding:28px;">
        <h1 style="font-size:20px;margin:0 0 16px;">Your ${countyLabel} tax-sale list</h1>
        ${bodyTop}
        <p style="margin:22px 0 0;">
          <a href="${pageUrl}"
             style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 22px;border-radius:6px;">
            View the list online
          </a>
        </p>
      </div>
      <p style="font-size:12px;color:#697180;margin:20px 4px 0;">
        You asked for this one email on bidwiseinvest.com. No follow-up sequence, no spam.
      </p>
    </div>
  </body>
</html>`

    return await sendEmail({
      to: input.to,
      subject: hasData
        ? `Your ${countyLabel} tax-sale list — ${totalProperties} properties analyzed`
        : `Your ${countyLabel} tax-sale list — next auction pending`,
      html,
      ...(hasData
        ? {
            attachments: [
              {
                filename: `bidwise-${input.county}-tax-sale-list.csv`,
                content: Buffer.from(teaserRowsToCsv(rows), 'utf8'),
              },
            ],
          }
        : {}),
    })
  } catch (err) {
    console.error(`[free-list-email] fulfillment failed for ${input.county}:`, err)
    return { ok: false }
  }
}
