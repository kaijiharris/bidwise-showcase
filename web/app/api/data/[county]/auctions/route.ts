import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { serviceClient, getUserFromBearer } from '@/lib/data-access'
import { isKnownCounty, readAuctionIndex } from '@/lib/county-data'

export const dynamic = 'force-dynamic'

// GET /api/data/[county]/auctions
// Returns the auction index (dates + per-auction counts) for the county's
// dataset selector. No financials or PII live here, but the files moved out of
// public/ so this requires an authenticated session like the rest of /api/data.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ county: string }> },
): Promise<NextResponse> {
  const { county } = await context.params

  if (!isKnownCounty(county)) {
    return NextResponse.json({ error: 'Unknown county' }, { status: 404 })
  }

  const svc = serviceClient()
  let user = await getUserFromBearer(request.headers.get('authorization'), svc)
  if (!user) {
    const supabase = await createServerClient()
    const { data } = await supabase.auth.getUser()
    user = data.user
  }
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const index = await readAuctionIndex(county)
  return NextResponse.json(index, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
