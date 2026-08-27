import DealDeskClient from './DealDeskClient'
import { getCurrentUserAccess } from '@/lib/access'

export const metadata = {
  title: 'Deal Desk | BidWise',
}

export default async function DealDeskPage() {
  const { effectivePlan } = await getCurrentUserAccess()
  return <DealDeskClient effectivePlan={effectivePlan} />
}
