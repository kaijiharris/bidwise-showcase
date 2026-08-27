import { Redirect } from 'expo-router'
import { View, ActivityIndicator } from 'react-native'
import { useAuth } from '@/lib/auth-context'
import { colors } from '@/theme/colors'

export default function Index() {
  const { session, loading, hasActiveAccess, isAdmin } = useAuth()

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.midnight,
        }}
      >
        <ActivityIndicator color={colors.brand.primary} />
      </View>
    )
  }

  if (!session) return <Redirect href="/(auth)/login" />
  if (!hasActiveAccess && !isAdmin) return <Redirect href="/paywall" />
  return <Redirect href="/(app)/feed" />
}
