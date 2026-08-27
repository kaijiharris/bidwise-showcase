const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  return ADMIN_EMAILS.includes(email.toLowerCase())
}

// Effective plan for entitlement decisions. Returns null when the caller has
// NO active subscription (and is not an admin) — i.e. deny by default. Callers
// must treat null as "no access", NOT as a free 'starter' tier. Previously this
// silently returned 'starter', handing unsubscribed users 10 free auction
// unlocks worth of paid data.
export function getEffectivePlan(
  email: string | null | undefined,
  subscriptionPlan: string | null | undefined
): string | null {
  if (isAdmin(email)) return 'expert'
  return subscriptionPlan || null
}
