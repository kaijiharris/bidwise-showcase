import LeadsFeedClient from './LeadsFeedClient'
import { getCurrentUserAccess } from '@/lib/access'

export const metadata = {
  title: 'BidWise Leads | Off-Market Deal Engine',
}

export default async function LeadsPage() {
  const { effectivePlan, isAdmin } = await getCurrentUserAccess()
  return <LeadsFeedClient effectivePlan={effectivePlan} isAdminUser={isAdmin} />
}
