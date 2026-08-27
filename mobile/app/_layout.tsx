import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import Constants from 'expo-constants'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import {
  useFonts as useSpaceGrotesk,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter'
import { AuthProvider } from '@/lib/auth-context'
import { queryClient } from '@/lib/query-client'
import { mmkvStorage, REACT_QUERY_CACHE_KEY } from '@/lib/storage'
import { initSentry, Sentry } from '@/lib/sentry'
import { initAnalytics, track } from '@/lib/analytics'
import { useAuthDeepLinks } from '@/lib/deep-links'
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider'
import { colors } from '@/theme/colors'
import '../global.css'

// Initialize observability as early as possible. Both fail safe when their
// keys (EXPO_PUBLIC_SENTRY_DSN / EXPO_PUBLIC_POSTHOG_KEY) are absent.
initSentry()
initAnalytics()

// Persists the React Query cache to MMKV. On cold start, the cache hydrates
// synchronously before the first render — leads/watchlists/pipeline screens
// paint immediately from disk, then revalidate in the background.
//
// Buster keyed to app version means bumping the version in app.json
// invalidates persisted cache for everyone, which is what we want when
// query shapes change.
const persister = createSyncStoragePersister({
  storage: mmkvStorage,
  key: REACT_QUERY_CACHE_KEY,
})

const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0'

SplashScreen.preventAutoHideAsync().catch(() => {})

// Fallback UI rendered by Sentry's ErrorBoundary when a render throws. Keeps
// the user in a branded screen instead of a white crash.
function ErrorFallback() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.midnight,
        padding: 24,
        gap: 8,
      }}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, color: colors.soft }}>
        Something went wrong.
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 14,
          color: colors.muted,
          textAlign: 'center',
        }}
      >
        Please close and reopen the app. If this keeps happening, contact
        support@bidwiseinvest.com.
      </Text>
    </View>
  )
}

function RootLayout() {
  const [fontsLoaded, fontError] = useSpaceGrotesk({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {})
    }
  }, [fontsLoaded, fontError])

  // Fire once per cold start. No-ops when analytics is disabled.
  useEffect(() => {
    track('app_open')
  }, [])

  if (!fontsLoaded && !fontError) {
    return null
  }

  return (
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <ThemeProvider>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.midnight }}>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              persister,
              maxAge: 24 * 60 * 60 * 1000,
              buster: APP_VERSION,
            }}
          >
            <AuthProvider>
              <ThemedShell />
            </AuthProvider>
          </PersistQueryClientProvider>
        </GestureHandlerRootView>
      </ThemeProvider>
    </Sentry.ErrorBoundary>
  )
}

// Wrap with Sentry so navigation + performance instrumentation attaches. When
// the DSN is absent Sentry.wrap is an identity-ish HOC and the app runs normally.
export default Sentry.wrap(RootLayout)

function ThemedShell() {
  const { scheme } = useTheme()
  // Handle Supabase auth deep links (password reset / email verification).
  useAuthDeepLinks()
  return (
    <>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.midnight },
          animation: 'fade',
        }}
      />
    </>
  )
}
