import { redirect } from 'next/navigation'

export default function IntelRootPage() {
  // The Intel section requires a specific lead ID.
  // If the user clicks "BidWise Intel" in the sidebar, send them back to the leads feed.
  redirect('/dashboard/leads')
}
