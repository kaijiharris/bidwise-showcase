import { NextResponse } from 'next/server'

// GET /api/health — the uptime-monitor endpoint (launch-audit gap: "no uptime
// monitoring, no health-check endpoint"). Deliberately dependency-free: it
// proves the Next.js runtime is serving, nothing more. Probing Supabase/Stripe
// here would page the operator for VENDOR incidents and give attackers a
// dependency map — external monitors should watch vendor status pages instead.
//
// Public by design (middleware allowlists it): no auth, no cookies, no body
// parsing, cache disabled so every probe hits the runtime.

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: true,
      service: 'bidwise-web',
      // Vercel injects the deployed commit — lets an alert say WHICH deploy broke.
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      ts: new Date().toISOString(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
