import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { sanitizeNext } from '@/lib/sanitize-next'

// Default-deny: every route requires auth unless it appears in PUBLIC_ROUTES
// (exact match) or PUBLIC_PREFIXES (startsWith). New routes are protected by
// default — the previous PROTECTED_ROUTES blocklist let /api/debug and
// /onboarding through unauthenticated.
const PUBLIC_ROUTES = new Set<string>([
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/pricing',
  '/faq',
  '/how-it-works',
  '/privacy',
  '/terms',
  '/support',                // App Store Connect's required Support URL. An Apple
                             // reviewer is never signed in, so a 307 to /login here
                             // fails the listing form (and looks like a broken app).
  '/resources',
  '/vendors/apply',          // public vendor application form (QR-driven)
  '/tax-sale',               // Georgia tax-sale hub (index) — the '/tax-sale/' PREFIX below
                             // does not match the bare path, so the hub needs an exact entry
  '/api/health',             // uptime-monitor probe — no auth, no session, proves the runtime
  '/robots.txt',             // crawler directives — app/robots.ts. Must be public or the
                             // default-deny wall 307s Googlebot to /login (site goes unindexed).
  '/sitemap.xml',            // sitemap — app/sitemap.ts. Same reason: crawlers must reach it.
  '/free-list',              // no index page — public so it 404s instead of auth-redirecting
  // Next.js metadata image routes are extensionless dynamic routes, so the
  // matcher below (which only excludes *.png/*.svg/... by extension) does NOT
  // skip them — without these entries the default-deny wall 307s social
  // crawlers and the browser tab-icon request to /login, and the favicon/OG
  // image never render. They serve only generated public brand art.
  '/icon',
  '/opengraph-image',
  '/twitter-image',
])

const PUBLIC_PREFIXES = [
  '/auth/',                  // Supabase OAuth/email callback
  '/api/stripe/webhook',     // authenticated by Stripe signature, not session
  '/api/trial/',             // trial APIs require auth check inside the route
  '/api/data/',              // self-authenticates (Bearer JWT OR cookie) + tier-masks
                             // inside the route, returning 401 JSON — NOT a session
                             // redirect. Must be middleware-public so bearer-only
                             // clients (the mobile app) reach the route instead of
                             // getting a 307 to /login. The route, not middleware,
                             // is the security boundary here.
  '/resources/',             // public guide/blog articles (/resources/<slug>)
  '/a/',                     // affiliate QR redirects — public by design; scan
                             // logging + attribution cookie happen inside the route
  '/v/',                     // vendor QR redirects — public by design
  '/api/vendor-applications', // POST self-validates (honeypot + rate limit +
                             // service-role writes); the public form posts here
  '/tax-sale/',              // public programmatic county pages (/tax-sale/<county>-county-ga)
                             // — the SEO surface for "<county> tax sale list" queries; masked
                             // marketing content only, no paid data
  '/tools/',                 // free public tools (/tools/redemption-calculator) — lead magnets,
                             // pure client-side math, no paid data
  '/free-list/',             // public lead-magnet teaser (/free-list/<county>) — serves
                             // MASKED sample rows only (lib/free-list); full values still
                             // require the authenticated, tier-gated /api/data route
  '/api/lead-capture',       // public email-capture endpoint for the free-list pages —
                             // visitors are by definition logged out; the route itself
                             // validates (email/county allowlist) + rate-limits per IP
  // NOTE: '/data/' is intentionally NOT public. The financial dataset + owner
  // PII used to be web-served from public/data/*.json and was downloadable by
  // anyone. The files now live in the server-only web/data/ dir and are served
  // exclusively through the authenticated, tier-gated /api/data/[county] route.
]

const AUTH_ROUTES = ['/login', '/signup']
const DASHBOARD_PATHS = ['/dashboard', '/dashboard/']
// Cap for the middleware auth round-trip (see the client's global.fetch).
const MIDDLEWARE_FETCH_TIMEOUT_MS = 2000

async function hasActiveSubscriptionOrTrial(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<boolean> {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .maybeSingle()
  if (sub) return true

  const { data: trial } = await supabase
    .from('user_trials')
    .select('id')
    .eq('user_id', userId)
    .gt('trial_ends_at', new Date().toISOString())
    .maybeSingle()

  return !!trial
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
          )
        },
      },
      // Cap the auth round-trip. The default fetch hangs ~15s on a dropped
      // connection (OS TCP connect timeout), stalling every request that
      // reaches getUser(); 2s keeps a degraded network from freezing the app.
      global: {
        fetch: (url: RequestInfo | URL, init?: RequestInit) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(MIDDLEWARE_FETCH_TIMEOUT_MS) }),
      },
    }
  )

  const path = request.nextUrl.pathname
  const isPublic =
    PUBLIC_ROUTES.has(path) || PUBLIC_PREFIXES.some(p => path.startsWith(p))
  const requiresAuth = !isPublic
  const isAuthRoute = AUTH_ROUTES.some(r => path === r || path.startsWith(`${r}/`))
  const isDashboard = DASHBOARD_PATHS.some(p => path === p || path.startsWith(`${p}`))

  // The auth check is a NETWORK call — only make it when a middleware redirect
  // depends on identity: protected routes, auth routes (bounce logged-in users
  // away from /login,/signup), and the dashboard paywall. Public content + QR
  // redirect routes must never block on it, or a dropped connection stalls the
  // auction-critical scan (~15s → skipped entirely for those routes here).
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null
  if (requiresAuth || isAuthRoute || isDashboard) {
    const result = await supabase.auth.getUser()
    user = result.data.user
  }

  if (requiresAuth && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Only round-trip an allowlisted same-origin path back through `?next=`.
    // Unvalidated paths would let a crafted link drive an open redirect once
    // login completes; reject those and let the login page use its default.
    const safeNext = sanitizeNext(path)
    if (safeNext) {
      url.searchParams.set('next', safeNext)
    } else {
      url.searchParams.delete('next')
    }
    return NextResponse.redirect(url)
  }

  // Web paywall: unsubscribed users hit pricing immediately (no cardless web trial)
  if (isDashboard && user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    const isAdmin = profile?.role === 'admin'
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
    if (!isAdmin && !adminEmails.includes((user.email ?? '').toLowerCase())) {
      const hasAccess = await hasActiveSubscriptionOrTrial(supabase, user.id)
      if (!hasAccess) {
        const url = request.nextUrl.clone()
        url.pathname = '/pricing'
        url.searchParams.set('reason', 'subscription_required')
        return NextResponse.redirect(url)
      }
    }
  }

  if (path === '/signup' && user) {
    const plan = request.nextUrl.searchParams.get('plan')
    if (plan) {
      // Never send an already-entitled user back into checkout to pay a second
      // time — e.g. an access grant written by execution/invite_user.py, or an
      // existing subscriber following a stale /signup?plan= link. Route them to
      // the app instead. (Complements the /dashboard paywall above, which covers
      // users who reach the dashboard directly.)
      const hasAccess = await hasActiveSubscriptionOrTrial(supabase, user.id)
      if (hasAccess) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        url.search = ''
        return NextResponse.redirect(url)
      }
      const url = request.nextUrl.clone()
      url.pathname = '/api/stripe/checkout'
      url.searchParams.set('plan', plan)
      url.searchParams.set('cycle', request.nextUrl.searchParams.get('cycle') || 'annual')
      return NextResponse.redirect(url)
    }
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm)$).*)',
  ],
}
