// Client-safe plan helpers. No server-only imports (next/headers, supabase
// server client) so this module can be pulled into client components without
// leaking server code into the browser bundle.

export type PlanKey = 'starter' | 'pro' | 'expert'

export function normalizePlan(plan: string | null | undefined): PlanKey {
  return plan === 'pro' || plan === 'expert' ? plan : 'starter'
}
