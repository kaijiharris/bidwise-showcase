// GET /v/[code] — vendor QR redirect.
//
// Thinner sibling of /a/[code]: vendor QR codes are string constants held in
// the app_config singleton's vendor_qr_codes JSONB allowlist (migration 016) —
// v1 has 1-3 vendor QRs, a dedicated table would be overkill. No per-scan DB
// event either: vendor scan volume IS the application count, and the ?src code
// lands on the application row.
//
// A vendor is NEVER dead-ended: malformed/unknown codes and DB failures all
// still land on the public application form, just without src attribution.

import { NextResponse } from 'next/server'
import { getServiceClient, normalizeAffiliateCode, withDeadline } from '@/lib/affiliates'
import {
  VENDOR_SRC_COOKIE_MAX_AGE_DAYS,
  VENDOR_SRC_COOKIE_NAME,
} from '@/lib/vendor-application'

export const dynamic = 'force-dynamic'

// Vendor lands on the form regardless; a slow/dead DB just costs the src tag.
const VENDOR_LOOKUP_DEADLINE_MS = 1500

async function isAllowlistedVendorCode(code: string): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from('app_config')
    .select('vendor_qr_codes')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`app_config lookup failed: ${error.message}`)
  const list = data?.vendor_qr_codes
  return Array.isArray(list) && list.includes(code)
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code: rawCode } = await ctx.params
  const code = normalizeAffiliateCode(rawCode) // same <XX>-<6 base32> format
  const dest = new URL('/vendors/apply', request.url)

  let allowed = false
  if (code) {
    try {
      allowed = await withDeadline(
        isAllowlistedVendorCode(code),
        VENDOR_LOOKUP_DEADLINE_MS,
      )
    } catch (err) {
      // Treat as unknown (slow, unreachable, or failed DB): the form still
      // loads, only the src tag is lost.
      console.error('[vendor-redirect] allowlist lookup failed:', err)
    }
  }

  if (!code || !allowed) return NextResponse.redirect(dest)

  dest.searchParams.set('src', code)
  const res = NextResponse.redirect(dest)
  // Non-httpOnly fallback so the code survives navigation away and back —
  // the form reads ?src first, this cookie second. No PII, low stakes.
  res.cookies.set(VENDOR_SRC_COOKIE_NAME, code, {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * VENDOR_SRC_COOKIE_MAX_AGE_DAYS,
  })
  return res
}
