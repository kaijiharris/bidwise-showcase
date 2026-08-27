import WatchlistClient from './WatchlistClient'
import { getCurrentUserAccess } from '@/lib/access'

export const metadata = {
  title: 'Watchlists | BidWise',
}

export default async function WatchlistsPage() {
  const { effectivePlan } = await getCurrentUserAccess()
  return <WatchlistClient effectivePlan={effectivePlan} />
}
