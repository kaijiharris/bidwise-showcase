import { getEffectivePlan, isAdmin as isConfiguredAdmin } from '@/lib/admin'
import { createClient } from '@/lib/supabase/server'
import { normalizePlan, type PlanKey } from '@/lib/plan'

// Re-exported so existing server-side imports from '@/lib/access' keep working.
// Client components should import these directly from '@/lib/plan' to avoid
// pulling this server-coupled module into the browser bundle.
export { normalizePlan, type PlanKey }

export async function getCurrentUserAccess() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, effectivePlan: 'starter' as PlanKey, isAdmin: false, hasAccess: false }
  }

  const [{ data: profile }, { data: subscription }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('subscriptions')
      .select('plan, status, current_period_end')
      .eq('user_id', user.id)
      .in('status', ['active', 'trialing'])
      .order('current_period_end', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ])

  const isAdmin = profile?.role === 'admin' || isConfiguredAdmin(user.email)

  // Deny by default: getEffectivePlan returns null for a non-admin with no
  // active subscription. `hasAccess` is the real gate (see middleware + the
  // /api/data route). `effectivePlan` is still normalized to a concrete
  // PlanKey ('starter' = most-locked) so the existing tier gates that compare
  // `=== 'starter'` keep failing closed rather than accidentally opening.
  const rawPlan = isAdmin ? 'expert' : getEffectivePlan(user.email, subscription?.plan)
  const hasAccess = isAdmin || rawPlan !== null
  const effectivePlan = normalizePlan(rawPlan)

  return { user, effectivePlan, isAdmin, hasAccess }
}
