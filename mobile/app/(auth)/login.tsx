import { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { Link, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { BrandMark } from '@/components/ui/BrandMark'
import { GradientButton } from '@/components/ui/GradientButton'
import { TextField } from '@/components/ui/TextField'
import { Screen } from '@/components/ui/Screen'
import { useAuth } from '@/lib/auth-context'
import { track } from '@/lib/analytics'
import { colors } from '@/theme/colors'

const TERMS_URL = 'https://bidwiseinvest.com/terms'
const PRIVACY_URL = 'https://bidwiseinvest.com/privacy'

export default function LoginScreen() {
  const router = useRouter()
  const { signIn, signUp } = useAuth()
  // Signup is available on all platforms — users subscribe in-app via the
  // RevenueCat paywall after creating an account.
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async () => {
    setError(null)
    if (!email || !password) {
      setError('Email and password are required.')
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
        router.replace('/')
      } else {
        await signUp(email.trim(), password)
        track('sign_up')
        Alert.alert(
          'Check your email',
          'We sent a confirmation link. Verify your email, then sign in.'
        )
        setMode('signin')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong. Try again.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            paddingVertical: 32,
            gap: 24,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-2">
            <BrandMark size="md" />
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                color: colors.muted,
                marginTop: 8,
              }}
            >
              Smart property investing.{'\n'}Bid with confidence.
            </Text>
          </View>

          <View className="gap-6">
            <View className="gap-1">
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 36,
                  color: colors.soft,
                  letterSpacing: -1,
                }}
              >
                {mode === 'signin' ? 'Welcome back.' : 'Create account.'}
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.muted }}>
                {mode === 'signin'
                  ? 'Sign in to see today’s deals.'
                  : 'Create an account, then subscribe in-app to unlock deals.'}
              </Text>
            </View>

            <View className="gap-4">
              <TextField
                label="Email"
                placeholder="you@email.com"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
              <TextField
                label="Password"
                placeholder="••••••••"
                secureTextEntry
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChangeText={setPassword}
                error={error}
              />
              {mode === 'signin' ? (
                <Link href="/(auth)/forgot-password" asChild>
                  <Pressable hitSlop={8}>
                    <Text
                      style={{
                        fontFamily: 'Inter_500Medium',
                        fontSize: 13,
                        color: colors.brand.primary,
                      }}
                    >
                      Forgot password?
                    </Text>
                  </Pressable>
                </Link>
              ) : null}
            </View>

            <View className="gap-3">
              <GradientButton
                label={mode === 'signin' ? 'Sign in' : 'Create account'}
                loading={submitting}
                onPress={onSubmit}
              />
              <GradientButton
                label={mode === 'signin' ? 'New here? Create account' : 'Have an account? Sign in'}
                variant="ghost"
                onPress={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin')
                  setError(null)
                }}
              />
            </View>
          </View>

          <View className="flex-row flex-wrap items-center justify-center" style={{ gap: 4 }}>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.dim }}>
              By continuing you agree to our
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => WebBrowser.openBrowserAsync(TERMS_URL).catch(() => {})}
              hitSlop={6}
            >
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.brand.primary }}>
                Terms
              </Text>
            </Pressable>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.dim }}>and</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL).catch(() => {})}
              hitSlop={6}
            >
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.brand.primary }}>
                Privacy Policy
              </Text>
            </Pressable>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.dim }}>.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
