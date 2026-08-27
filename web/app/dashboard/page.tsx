import { redirect } from 'next/navigation'
import { getCurrentUserAccess } from '@/lib/access'
import { getFeatureFlags } from '@/lib/feature-flags'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const [{ user, effectivePlan, isAdmin, hasAccess }, featureFlags] = await Promise.all([
    getCurrentUserAccess(),
    getFeatureFlags(),
  ])

  // Deny by default: an authenticated user with no active subscription gets no
  // dashboard access. Middleware already redirects unsubscribed users; this is
  // the fail-closed backstop at the page level.
  if (!user) redirect('/login?next=/dashboard')
  if (!hasAccess) redirect('/pricing?reason=subscription_required')

  return (
    <DashboardClient
      user={user}
      effectivePlan={effectivePlan}
      isAdminUser={isAdmin}
      featureFlags={featureFlags}
    />
  )
}
