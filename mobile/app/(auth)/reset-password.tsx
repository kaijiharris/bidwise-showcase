import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { BrandMark } from '@/components/ui/BrandMark'
import { GradientButton } from '@/components/ui/GradientButton'
import { Screen } from '@/components/ui/Screen'
import { TextField } from '@/components/ui/TextField'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { colors } from '@/theme/colors'

export default function ResetPasswordScreen() {
  const router = useRouter()
  const { session, loading } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const onSubmit = async () => {
    setError(null)
    if (!session) {
      setError('Open the latest reset link from your email before choosing a new password.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update password.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingVertical: 24, gap: 24 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/(auth)/login')}
          className="flex-row items-center gap-1"
          hitSlop={12}
        >
          <ChevronLeft size={20} color={colors.muted} />
          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.muted }}>
            Sign in
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
            New password.
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.muted }}>
            Choose a secure password for your BidWise account.
          </Text>
        </View>

        {done ? (
          <View className="rounded-card border border-brand-500/40 p-5 gap-3" style={{ backgroundColor: colors.navy }}>
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_600SemiBold',
                fontSize: 16,
                color: colors.brand.cyan,
              }}
            >
              Password updated
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.muted }}>
              You can continue into BidWise with your new password.
            </Text>
            <GradientButton label="Continue" onPress={() => router.replace('/')} />
          </View>
        ) : (
          <View className="gap-4">
            {!loading && !session ? (
              <View className="rounded-card border border-amber-400/30 bg-amber-500/10 p-4">
                <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: '#FBBF24' }}>
                  This reset link is expired or has already been used. Request a new reset link.
                </Text>
              </View>
            ) : null}

            <TextField
              label="New password"
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <TextField
              label="Confirm password"
              placeholder="Re-enter password"
              autoComplete="new-password"
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
              error={error}
            />
            <GradientButton
              label="Update password"
              loading={submitting || loading}
              disabled={!session}
              onPress={onSubmit}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}
