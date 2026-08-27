import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/trial/claim
 * Called by: mobile/app/paywall.tsx (ReaderAppPaywall trial CTA button)
 * Data: Calls Supabase RPC `claim_trial_for_user(p_user_id, p_platform)` which
 *       inserts into `user_trials` (fields: user_id, trial_started_at,
 *       trial_ends_at, unlocks_used, unlocks_limit, platform) and returns JSONB.
 * User instruction: "Sure, if it's not too much to implement the trial
 * iOS trial unlocks expire after seven days without a subscription."
 */

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    )
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    // empty body uses default platform
  }

  const platform =
    typeof body.platform === 'string' ? body.platform : 'ios'

  const { data, error } = await supabase.rpc('claim_trial_for_user', {
    p_user_id: user.id,
    p_platform: platform,
  })

  if (error) {
    console.error('[trial/claim] RPC error:', error)
    return NextResponse.json(
      { error: 'Unable to claim trial' },
      { status: 500 },
    )
  }

  const result = data as {
    status:
      | 'created'
      | 'already_claimed'
      | 'already_subscribed'
      | 'unauthorized'
    trial?: Record<string, unknown>
    message?: string
  }

  switch (result.status) {
    case 'created':
      return NextResponse.json({
        success: true,
        trial: result.trial,
        message: 'Trial started successfully.',
      })
    case 'already_subscribed':
      return NextResponse.json(
        {
          success: false,
          alreadySubscribed: true,
          message: 'You already have an active subscription.',
        },
        { status: 409 },
      )
    case 'already_claimed':
      return NextResponse.json(
        {
          success: false,
          alreadyClaimed: true,
          trial: result.trial,
          message: 'You have already claimed your free trial.',
        },
        { status: 409 },
      )
    case 'unauthorized':
      return NextResponse.json(
        {
          success: false,
          message: result.message || 'Unauthorized.',
        },
        { status: 403 },
      )
    default:
      return NextResponse.json(
        { success: false, message: 'Unknown error.' },
        { status: 500 },
      )
  }
}
