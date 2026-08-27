import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/trial/status
 * Called by: mobile/lib/auth-context.tsx (trial eligibility check on app load)
 * Data: Calls Supabase RPC `get_user_trial_status(p_user_id)` which reads
 *       from `user_trials` and returns JSONB with trial_ends_at, unlocks_used, etc.
 * User instruction: "Sure, if it's not too much to implement the trial
 * iOS trial unlocks expire after seven days without a subscription."
 */

export async function GET() {
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

  const { data, error } = await supabase.rpc('get_user_trial_status', {
    p_user_id: user.id,
  })

  if (error) {
    console.error('[trial/status] RPC error:', error)
    return NextResponse.json(
      { error: 'Unable to check trial status' },
      { status: 500 },
    )
  }

  const result = data as {
    is_active: boolean
    trial_ends_at: string | null
    unlocks_used: number
    unlocks_limit: number
    remaining: number
    is_expired: boolean | null
    message?: string
  }

  return NextResponse.json(result)
}
