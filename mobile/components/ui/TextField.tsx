import { useState } from 'react'
import { Text, TextInput, View, type TextInputProps } from 'react-native'
import { colors, withAlpha } from '@/theme/colors'

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string
  error?: string | null
}

export function TextField({ label, error, onFocus, onBlur, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false)

  const borderColor = error
    ? '#386BFF'
    : focused
      ? colors.brand.primary
      : withAlpha(colors.slate, 0.4)

  return (
    <View className="gap-2">
      <Text
        className="font-sans-medium text-xs uppercase"
        style={{ letterSpacing: 1.2, color: colors.muted }}
      >
        {label}
      </Text>
      <TextInput
        placeholderTextColor={colors.dim}
        autoCapitalize="none"
        autoCorrect={false}
        className="h-14 rounded-card px-4 text-base"
        style={{
          borderWidth: 1.5,
          borderColor,
          fontFamily: 'Inter_400Regular',
          backgroundColor: colors.graphite,
          color: colors.soft,
        }}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        {...rest}
      />
      {error ? (
        <Text className="text-xs" style={{ fontFamily: 'Inter_500Medium', color: '#386BFF' }}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}
