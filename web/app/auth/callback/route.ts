import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sanitizeNext } from '@/lib/sanitize-next'
import {
  AFFILIATE_COOKIE_NAME,
  getServiceClient,
  lookupActiveAffiliate,
  normalizeAffiliateCode,
  readCookieValue,
  recordAffiliateEvent,
} from '@/lib/affiliates'

// Affiliate attribution stamp. This is the ONE server-side spot that can read
// the httpOnly bw_aff cookie after the user proves their email, so the code is
// promoted from cookie to profile here (durable across devices/cookie expiry).
// FIRST write wins per user; a later scan of another code never re-attributes.
// Any failure is logged and swallowed — attribution must never break auth.
async function stampAffiliateAttribution(
  request: Request,
  user: { id: string } | null | undefined,
): Promise<void> {
  try {
    if (!user) return
    const code = normalizeAffiliateCode(
      readCookieValue(request.headers.get('cookie'), AFFILIATE_COOKIE_NAME),
    )
    if (!code) return

    const supabase = getServiceClient()
    // Re-validate at consumption: cookies outlive pauses/terminations.
    const affiliate = await lookupActiveAffiliate(supabase, code)
    if (!affiliate) return

    const { data: stamped, error } = await supabase
      .from('user_profiles')
      .update({ referred_by_code: code, referred_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('referred_by_code', null) // first-write-wins guard
      .select('id')
    if (error) throw new Error(`referred_by_code stamp failed: ${error.message}`)
    if (!stamped || stamped.length === 0) return // already attributed

    await recordAffiliateEvent(supabase, {
      affiliate_id: affiliate.id,
      event_type: 'signup',
      user_id: user.id,
    })
  } catch (err) {
    console.error('[auth-callback] affiliate attribution failed (auth continues):', err)
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const plan = searchParams.get('plan') || 'starter'
  const cycle = searchParams.get('cycle') || 'monthly'
  const authError = searchParams.get('error_description') || searchParams.get('error')

  if (authError) {
    const url = new URL('/forgot-password', origin)
    url.searchParams.set('error', authError)
    return NextResponse.redirect(url)
  }

  const safeNext = sanitizeNext(next)

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      await stampAffiliateAttribution(request, data?.user ?? data?.session?.user)

      // If a specific next path is given (e.g. password reset), go there directly
      if (safeNext) {
        return NextResponse.redirect(new URL(safeNext, origin))
      }
      // Default: redirect to Stripe checkout after email confirmation
      return NextResponse.redirect(
        `${origin}/api/stripe/checkout?plan=${plan}&cycle=${cycle}`
      )
    }
  }

  const url = new URL('/login', origin)
  url.searchParams.set('error', 'auth_callback_failed')
  return NextResponse.redirect(url)
}
