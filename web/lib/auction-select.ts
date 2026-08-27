// Pure auction-selection helper shared by the server (lib/county-data) and the
// client dashboard. No server-only deps (no fs/path), so it is safe in both the
// Node and browser bundles.

/**
 * Pick the auction the dashboard defaults to, in a 4-tier preference where a
 * 0-property entry NEVER beats a populated one:
 *
 *   (a) SOONEST UPCOMING with deals — the biddable default.
 *   (b) MOST-RECENT POPULATED PAST — real content beats an empty upcoming
 *       placeholder (the Cobb `no_current_sale_list` bug: a self-declared
 *       total=0 entry used to shadow a populated recent list and render blank).
 *   (c) NEAREST UPCOMING EMPTY — a genuine "list drops soon" countdown when no
 *       populated content exists anywhere.
 *   (d) NEWEST OVERALL — last-resort fallback (all past, all empty).
 *
 * Selection uses explicit date sorts (never index order), so it does not depend
 * on the index being newest-first. `today` (YYYY-MM-DD) is injectable for tests.
 * Throws on an empty index rather than returning `undefined` as `T`.
 */
export function pickDefaultEntry<T extends { auction_date: string; total_properties: number }>(
  index: T[],
  today: string = new Date().toISOString().slice(0, 10),
): T {
  if (index.length === 0) throw new Error('pickDefaultEntry: empty index')

  const byDateAsc = (a: T, b: T) => a.auction_date.localeCompare(b.auction_date)
  const isPopulated = (e: T) => (e.total_properties ?? 0) > 0
  const upcoming = index.filter(e => e.auction_date >= today)

  // (a) soonest UPCOMING with deals — the biddable default.
  const upcomingPopulated = upcoming.filter(isPopulated).sort(byDateAsc)
  if (upcomingPopulated.length) return upcomingPopulated[0]

  // (b) most-recent POPULATED PAST — prefer real content over an empty upcoming
  // placeholder. Explicit date sort (not index.find) so array order is irrelevant.
  const pastPopulated = index
    .filter(e => e.auction_date < today && isPopulated(e))
    .sort(byDateAsc)
  if (pastPopulated.length) return pastPopulated[pastPopulated.length - 1]

  // (c) nearest UPCOMING EMPTY — genuine "list drops soon" countdown.
  if (upcoming.length) return [...upcoming].sort(byDateAsc)[0]

  // (d) NEWEST OVERALL — all past, all empty.
  const byDate = [...index].sort(byDateAsc)
  return byDate[byDate.length - 1]
}
