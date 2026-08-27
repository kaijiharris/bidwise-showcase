import { ActivityIndicator, Pressable, Text, View, type PressableProps } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { brandGradient, colors } from '@/theme/colors'

interface GradientButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
}

export function GradientButton({
  label,
  loading,
  disabled,
  variant = 'primary',
  ...rest
}: GradientButtonProps) {
  const isDisabled = disabled || loading

  if (variant === 'secondary') {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        className={`h-14 items-center justify-center rounded-card border ${
          isDisabled ? 'opacity-50' : ''
        }`}
        style={{ backgroundColor: colors.navy, borderColor: `${colors.slate}66` }}
        {...rest}
      >
        <Text className="font-display-semibold text-base" style={{ color: colors.soft }}>{label}</Text>
      </Pressable>
    )
  }

  if (variant === 'ghost') {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        className={`h-14 items-center justify-center ${isDisabled ? 'opacity-50' : ''}`}
        {...rest}
      >
        <Text className="font-sans-medium text-base" style={{ color: colors.muted }}>{label}</Text>
      </Pressable>
    )
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      className={isDisabled ? 'opacity-50' : ''}
      {...rest}
    >
      <LinearGradient
        colors={brandGradient.colors}
        start={brandGradient.start}
        end={brandGradient.end}
        style={{
          height: 56,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View className="flex-row items-center gap-3">
          {loading ? <ActivityIndicator color="#08111F" /> : null}
          <Text className="font-display-semibold text-base" style={{ color: '#08111F' }}>{label}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  )
}
