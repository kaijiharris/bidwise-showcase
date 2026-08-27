import { redirect } from 'next/navigation'
import { getCurrentUserAccess } from '@/lib/access'
import LeadsLayoutClient from './LeadsLayoutClient'

export default async function LeadsLayout({ children }: { children: React.ReactNode }) {
  const { user, effectivePlan, isAdmin } = await getCurrentUserAccess()

  if (!user) redirect('/login?next=/dashboard/leads')

  return (
    <LeadsLayoutClient user={user} effectivePlan={effectivePlan} isAdmin={isAdmin}>
      {children}
    </LeadsLayoutClient>
  )
}
