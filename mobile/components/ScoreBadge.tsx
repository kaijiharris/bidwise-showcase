import { Text, View } from 'react-native'
import { colors, withAlpha } from '@/theme/colors'

interface ScoreBadgeProps {
  value: number | null
  size?: 'sm' | 'lg'
}

// Bands read from the `band` palette role, whose colors are tuned per theme for
// contrast against their own 16% tint. Dark keeps the original blues; light uses
// three distinct hues because its blues measured 2.16 (strong) and 2.58 (ok) on a
// near-white card — under even the 3:1 large-text floor.
function bandFor(score: number) {
  if (score >= 75) {
    return { fg: colors.band.strong, bg: withAlpha(colors.band.strong, 0.16), label: 'STRONG' }
  }
  if (score >= 50) {
    return { fg: colors.band.ok, bg: withAlpha(colors.band.ok, 0.16), label: 'OK' }
  }
  return { fg: colors.band.weak, bg: withAlpha(colors.band.weak, 0.16), label: 'WEAK' }
}

export function ScoreBadge({ value, size = 'sm' }: ScoreBadgeProps) {
  if (value == null) {
    return (
      <View
        className="rounded-pill px-2 py-1"
        style={{ backgroundColor: withAlpha(colors.slate, 0.2) }}
      >
        <Text
          style={{ fontFamily: 'Inter_600SemiBold', fontSize: 10, color: colors.muted }}
        >
          NO SCORE
        </Text>
      </View>
    )
  }

  const { fg, bg, label } = bandFor(value)
  const isLarge = size === 'lg'

  return (
    <View
      className="items-center justify-center rounded-pill"
      style={{
        backgroundColor: bg,
        paddingHorizontal: isLarge ? 14 : 10,
        paddingVertical: isLarge ? 8 : 4,
        minWidth: isLarge ? 88 : 56,
      }}
    >
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: isLarge ? 22 : 14,
          color: fg,
          letterSpacing: -0.5,
          lineHeight: isLarge ? 26 : 16,
        }}
      >
        {Math.round(value)}
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          // This label is what keeps the band readable without relying on hue,
          // so it has to survive on its own: 8/9px sat under the ~11pt iOS floor,
          // and the 0.9 opacity was shaving contrast off the one channel that
          // works for a colorblind user.
          fontSize: isLarge ? 11 : 10,
          color: fg,
          letterSpacing: 1.2,
          marginTop: isLarge ? 2 : 0,
        }}
      >
        {label}
      </Text>
    </View>
  )
}
