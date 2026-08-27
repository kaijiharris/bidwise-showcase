import { SafeAreaView } from 'react-native-safe-area-context'
import { View, type ViewProps } from 'react-native'
import { colors } from '@/theme/colors'

interface ScreenProps extends ViewProps {
  edges?: ('top' | 'bottom' | 'left' | 'right')[]
}

export function Screen({ children, edges = ['top', 'bottom'], className, ...rest }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.midnight }}>
      <View className={`flex-1 px-6 ${className ?? ''}`} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  )
}
