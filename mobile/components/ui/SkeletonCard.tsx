import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { colors, withAlpha } from '@/theme/colors'

interface SkeletonBlockProps {
  width?: number | `${number}%`
  height?: number
  radius?: number
  style?: object
}

// Animated opacity pulse — opacity-only is compositor-friendly and never
// triggers layout, which keeps the loading state at 60fps even on the older
// iPhones we test on.
export function SkeletonBlock({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: SkeletonBlockProps) {
  const progress = useSharedValue(0)

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    )
    return () => cancelAnimation(progress)
  }, [progress])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + progress.value * 0.4,
  }))

  return (
    <Animated.View
      style={[
        {
          width: width as number,
          height,
          borderRadius: radius,
          backgroundColor: colors.graphite,
        },
        animatedStyle,
        style,
      ]}
    />
  )
}

// Sized to roughly match LeadCard / DealCard so the loading state doesn't
// cause a layout shift when the real data arrives.
export function SkeletonCard() {
  return (
    <View
      style={{
        backgroundColor: colors.navy,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: withAlpha(colors.slate, 0.2),
        padding: 16,
        gap: 12,
        overflow: 'hidden',
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonBlock height={16} width="70%" />
          <SkeletonBlock height={11} width="45%" />
        </View>
        <SkeletonBlock height={44} width={64} radius={12} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SkeletonBlock height={20} width={68} radius={999} />
        <SkeletonBlock height={20} width={84} radius={999} />
      </View>
      <View style={{ gap: 6, paddingTop: 4 }}>
        <SkeletonBlock height={10} width="90%" />
        <SkeletonBlock height={10} width="60%" />
      </View>
    </View>
  )
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: 10, paddingTop: 4 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  )
}
