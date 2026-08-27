import { Text, View } from 'react-native'
import { colors } from '@/theme/colors'

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg'
}

// Two-tone wordmark: "Bid" in soft white, "Wise" in BidWise Blue.
// A gradient-masked variant can be swapped in later via @react-native-masked-view.
export function BrandMark({ size = 'md' }: BrandMarkProps) {
  const fontSize = size === 'lg' ? 48 : size === 'md' ? 32 : 22

  return (
    <View className="flex-row items-baseline">
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize,
          color: colors.soft,
          letterSpacing: -1,
        }}
      >
        Bid
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize,
          color: colors.brand.primary,
          letterSpacing: -1,
        }}
      >
        Wise
      </Text>
    </View>
  )
}
