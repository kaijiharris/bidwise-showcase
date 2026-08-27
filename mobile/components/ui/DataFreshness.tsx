import { Text, View } from 'react-native'
import { Clock } from 'lucide-react-native'
import { analysisFreshness } from '@/lib/format'
import { colors } from '@/theme/colors'

interface DataFreshnessProps {
  /**
   * ISO date the analysis was generated (AuctionMeta.generated).
   *
   * `undefined` — the query hasn't resolved yet (callers pass
   * `dataQuery.data?.meta.generated`): render nothing, a loading screen must
   * not assert anything about freshness.
   * `null` — the dataset loaded WITHOUT an analysis date: say "Freshness
   * unknown" rather than hiding, so missing provenance is visible instead of
   * silently reading as current.
   */
  generated: string | null | undefined
  align?: 'left' | 'center'
}

// "Analyzed <date>" / "As of <date>" / "Freshness unknown" indicator so users
// know how fresh the figures are. Stale analysis (older than
// STALE_ANALYSIS_DAYS, mirroring web) escalates to the theme's warning tone —
// the county keeps revising its list until sale day, so an aged snapshot must
// not read as current.
export function DataFreshness({ generated, align = 'left' }: DataFreshnessProps) {
  if (generated === undefined) return null
  const { kind, label } = analysisFreshness(generated)
  // Live palette read at render time (never captured module-level) so the tint
  // tracks theme changes.
  const tone = kind === 'stale' ? colors.status.warning : colors.muted

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        justifyContent: align === 'center' ? 'center' : 'flex-start',
      }}
    >
      <Clock size={10} color={tone} strokeWidth={2} />
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          fontSize: 10,
          color: tone,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </View>
  )
}
