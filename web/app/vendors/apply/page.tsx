// /vendors/apply — public vendor application (QR-driven via /v/[code]).
//
// Server component: county options come from the server-only county dataset
// (lib/county-data.ts uses node:fs and must never be imported client-side),
// and the ?src attribution code is read from searchParams here. The
// interactive form itself is the VendorApplyForm client component.

import type { Metadata } from 'next'
import { KNOWN_COUNTIES } from '@/lib/county-data'
import VendorApplyForm, { type CountyOption } from './VendorApplyForm'

export const metadata: Metadata = {
  title: 'Vendor Application — BidWise',
  description:
    'Apply to join the BidWise vendor network serving auction-property investors in metro Atlanta.',
}

const COUNTY_LABELS: Record<string, string> = {
  dekalb: 'DeKalb County, GA',
  gwinnett: 'Gwinnett County, GA',
  cobb: 'Cobb County, GA',
  clayton: 'Clayton County, GA',
}

export default async function VendorApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>
}) {
  const { src } = await searchParams
  const counties: CountyOption[] = [
    ...KNOWN_COUNTIES.map(slug => ({
      value: slug as string,
      label: COUNTY_LABELS[slug] ?? slug,
    })),
    { value: 'other', label: 'Other' },
  ]

  return <VendorApplyForm counties={counties} initialSrc={src ?? null} />
}
