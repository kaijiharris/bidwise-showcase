import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { BrandMark } from '@/components/ui/BrandMark'
import { GradientButton } from '@/components/ui/GradientButton'
import { TextField } from '@/components/ui/TextField'
import { Screen } from '@/components/ui/Screen'
import { useAuth } from '@/lib/auth-context'
import { colors } from '@/theme/colors'

export default function ForgotPasswordScreen() {
  const router = useRouter()
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const onSubmit = async () => {
    setError(null)
    if (!email.trim()) {
      setError('Enter your email.')
      return
    }
    setSubmitting(true)
    try {
      await resetPassword(email.trim())
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send reset email.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingVertical: 24, gap: 24 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="flex-row items-center gap-1"
          hitSlop={12}
        >
          <ChevronLeft size={20} color={colors.muted} />
          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.muted }}>
            Back
          </Text>
        </Pressable>

        <BrandMark size="sm" />

        <View className="gap-2">
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 32,
              color: colors.soft,
              letterSpacing: -1,
            }}
          >
            Reset password.
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.muted }}>
            We&rsquo;ll email you a reset link.
          </Text>
        </View>

        {sent ? (
          <View className="rounded-card border border-brand-500/40 p-5 gap-2" style={{ backgroundColor: colors.navy }}>
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_600SemiBold',
                fontSize: 16,
                color: colors.brand.cyan,
              }}
            >
              Check your email
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.muted }}>
              We sent a reset link to {email.trim()}. Open it on this device.
            </Text>
          </View>
        ) : (
          <View className="gap-4">
            <TextField
              label="Email"
              placeholder="you@email.com"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              error={error}
            />
            <GradientButton label="Send reset link" loading={submitting} onPress={onSubmit} />
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}
