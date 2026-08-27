import { useEffect, useState } from 'react'
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Bell, BellOff, Mail, Moon, Smartphone, Sun, Trash2 } from 'lucide-react-native'
import { GradientButton } from '@/components/ui/GradientButton'
import { Screen } from '@/components/ui/Screen'
import { useAuth } from '@/lib/auth-context'
import { getPushPermissionStatus, registerPushToken, type PushPermissionStatus } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { colors, withAlpha } from '@/theme/colors'
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider'

const TERMS_URL = 'https://bidwiseinvest.com/terms'
const PRIVACY_URL = 'https://bidwiseinvest.com/privacy'

interface PerWatchlistResult {
  id: string
  name: string
  new_matches: number
}

interface NotifyResult {
  watchlists_scanned: number
  emails_sent: number
  pushes_sent: number
  matches_recorded: number
  errors: string[]
  dry_run?: boolean
  per_watchlist?: PerWatchlistResult[]
}

export default function ProfileScreen() {
  const router = useRouter()
  const { user, profile, subscription, signOut, isAdmin, deleteAccount, hasActiveAccess } =
    useAuth()
  const { preference, setPreference } = useTheme()
  const [testing, setTesting] = useState(false)
  const [lastResult, setLastResult] = useState<NotifyResult | null>(null)
  const [deleting, setDeleting] = useState(false)

  const onSignOut = async () => {
    await signOut()
    router.replace('/(auth)/login')
  }

  const performDelete = async () => {
    setDeleting(true)
    try {
      await deleteAccount()
      router.replace('/(auth)/login')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert('Could not delete account', `${msg}\n\nContact support@bidwiseinvest.com if this continues.`, [
        { text: 'OK' },
      ])
    } finally {
      setDeleting(false)
    }
  }

  const onDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your BidWise account and all associated data (watchlists, pipeline, leads). This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => void performDelete() },
      ]
    )
  }

  const runFunction = async (dryRun: boolean) => {
    setTesting(true)
    setLastResult(null)
    try {
      const { data, error } = await supabase.functions.invoke<NotifyResult>(
        'notify-watchlist-matches',
        { body: { dryRun } }
      )
      if (error) throw error
      if (!data) throw new Error('No response body')
      setLastResult(data)

      if (dryRun) {
        const totalPending = (data.per_watchlist ?? []).reduce(
          (sum, w) => sum + w.new_matches,
          0
        )
        const breakdown = (data.per_watchlist ?? [])
          .filter((w) => w.new_matches > 0)
          .map((w) => `• ${w.name}: ${w.new_matches}`)
          .join('\n')
        Alert.alert(
          totalPending > 0 ? `${totalPending} pending alert${totalPending === 1 ? '' : 's'}` : 'No pending alerts',
          totalPending > 0
            ? `If you send now:\n\n${breakdown}\n\nNothing was sent or recorded.`
            : 'Every current match is already notified. Nothing would be sent.',
          [{ text: 'OK' }]
        )
      } else {
        const sent = data.emails_sent ?? 0
        const recorded = data.matches_recorded ?? 0
        Alert.alert(
          sent > 0 ? 'Email sent' : 'Function ran — no new matches',
          sent > 0
            ? `Sent ${sent} email${sent === 1 ? '' : 's'}, recorded ${recorded} new match${recorded === 1 ? '' : 'es'}.`
            : 'All current watchlist matches are already notified. Create a new watchlist or wait for fresh leads to trigger another email.',
          [{ text: 'OK' }]
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert(dryRun ? 'Preview failed' : 'Test failed', msg, [{ text: 'OK' }])
    } finally {
      setTesting(false)
    }
  }

  return (
    <Screen>
      {/* ScrollView, not a fixed View: the card stack grows past one screen —
          especially for admin accounts, whose extra panels pushed Sign Out and
          Delete Account below the fold with no way to reach them. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 32, paddingBottom: 48, gap: 24 }}
      >
        <View className="gap-1">
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 12,
              color: colors.muted,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            Account
          </Text>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 32,
              color: colors.soft,
              letterSpacing: -1,
            }}
          >
            {profile?.full_name ?? 'Investor'}
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.muted }}>
            {user?.email}
          </Text>
          {isAdmin ? (
            <View
              className="self-start mt-2 px-2 py-1 rounded-pill"
              style={{ backgroundColor: withAlpha(colors.brand.primary, 0.15) }}
            >
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 10,
                  color: colors.brand.primary,
                  letterSpacing: 1.5,
                }}
              >
                ADMIN
              </Text>
            </View>
          ) : null}
        </View>

        <View className="rounded-card border p-5 gap-3" style={{ backgroundColor: colors.navy, borderColor: `${colors.slate}33` }}>
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 11,
              color: colors.muted,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            Subscription
          </Text>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_600SemiBold',
              fontSize: 18,
              color: isAdmin ? colors.brand.cyan : colors.soft,
              textTransform: 'capitalize',
            }}
          >
            {isAdmin
              ? 'Expert · Admin access'
              : subscription
                ? `${subscription.plan} · ${subscription.status}`
                : hasActiveAccess
                  ? 'Pro · active (App Store)'
                  : 'No active plan'}
          </Text>
          {!isAdmin && !subscription && hasActiveAccess ? (
            // An App Store buyer holds a live RevenueCat entitlement before the
            // reconciliation webhook writes their `subscriptions` row — and
            // permanently if that webhook ever silently skips the event. Reading
            // the DB row alone told a paying customer "No active plan" while the
            // rest of the app was unlocked for them.
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 11,
                color: colors.muted,
                lineHeight: 16,
              }}
            >
              Purchased through the App Store. Manage or cancel it in your Apple Account
              subscription settings.
            </Text>
          ) : null}
          {isAdmin ? (
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 11,
                color: colors.muted,
                lineHeight: 16,
              }}
            >
              Full access to every tier — no billing. Comp&apos;d as part of the BidWise admin
              allowlist.
            </Text>
          ) : null}
        </View>

        <AppearancePicker preference={preference} onChange={setPreference} />

        <PushAlertsCard />

        {isAdmin ? (
          <View
            style={{
              backgroundColor: colors.navy,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: withAlpha(colors.brand.cyan, 0.25),
              padding: 18,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mail size={14} color={colors.brand.cyan} strokeWidth={2} />
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 11,
                  color: colors.brand.cyan,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                }}
              >
                Admin · Email Alerts
              </Text>
            </View>
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 12,
                color: colors.muted,
                lineHeight: 18,
              }}
            >
              Manually invoke the watchlist-alert function instead of waiting for the cron. Useful
              for verifying Resend delivery after schema or template changes.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                disabled={testing}
                onPress={() => runFunction(true)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.brand.cyan,
                  backgroundColor: 'transparent',
                  opacity: testing ? 0.6 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_700Bold',
                    fontSize: 11,
                    color: colors.brand.cyan,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                  }}
                >
                  Preview
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={testing}
                onPress={() => runFunction(false)}
                style={{
                  flex: 2,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: colors.brand.cyan,
                  opacity: testing ? 0.6 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_700Bold',
                    fontSize: 12,
                    color: colors.midnight,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                  }}
                >
                  {testing ? 'Working…' : 'Send Test Alert'}
                </Text>
              </Pressable>
            </View>
            {lastResult ? (
              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  fontSize: 11,
                  color: colors.muted,
                  textAlign: 'center',
                }}
              >
                Last run · scanned {lastResult.watchlists_scanned} · emails {lastResult.emails_sent}
                {' · '}pushes {lastResult.pushes_sent ?? 0} · recorded {lastResult.matches_recorded}
                {lastResult.errors.length > 0 ? ` · ${lastResult.errors.length} error(s)` : ''}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={{ flex: 1 }} />

        <View className="flex-row items-center justify-center" style={{ gap: 16, paddingBottom: 4 }}>
          <Pressable
            accessibilityRole="link"
            onPress={() => WebBrowser.openBrowserAsync(TERMS_URL).catch(() => {})}
            hitSlop={8}
          >
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.muted }}>
              Terms of Use
            </Text>
          </Pressable>
          <Text style={{ color: colors.dim }}>·</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL).catch(() => {})}
            hitSlop={8}
          >
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.muted }}>
              Privacy Policy
            </Text>
          </Pressable>
        </View>

        <GradientButton label="Sign out" variant="secondary" onPress={onSignOut} />

        <Pressable
          accessibilityRole="button"
          disabled={deleting}
          onPress={onDeleteAccount}
          hitSlop={8}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 12,
            opacity: deleting ? 0.6 : 1,
          }}
        >
          <Trash2 size={14} color={colors.status.danger} strokeWidth={2} />
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              fontSize: 13,
              color: colors.status.danger,
              letterSpacing: 0.3,
            }}
          >
            {deleting ? 'Deleting account…' : 'Delete account'}
          </Text>
        </Pressable>
      </ScrollView>
    </Screen>
  )
}

interface AppearancePickerProps {
  preference: ThemePreference
  onChange: (next: ThemePreference) => void
}

function AppearancePicker({ preference, onChange }: AppearancePickerProps) {
  const options: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'dark', label: 'Dark', Icon: Moon },
    { value: 'system', label: 'System', Icon: Smartphone },
  ]

  return (
    <View
      className="rounded-card border p-5 gap-3"
      style={{ backgroundColor: colors.navy, borderColor: `${colors.slate}33` }}
    >
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
          color: colors.muted,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        Appearance
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {options.map(({ value, label, Icon }) => {
          const active = preference === value
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(value)}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 10,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: active ? colors.brand.primary : `${colors.slate}55`,
                backgroundColor: active ? `${colors.brand.primary}22` : 'transparent',
              }}
            >
              <Icon
                size={14}
                color={active ? colors.brand.primary : colors.muted}
                strokeWidth={2}
              />
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 12,
                  color: active ? colors.brand.primary : colors.muted,
                  letterSpacing: 0.4,
                }}
              >
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

// The only place in the app that can trigger the OS notification-permission
// dialog (registerPushToken with requestIfNeeded). The sign-in path in
// auth-context registers silently and never prompts, so without this card no
// user is ever asked and device_tokens stays empty — pushes_sent would be 0
// forever even though notify-watchlist-matches already delivers pushes.
function PushAlertsCard() {
  const { user } = useAuth()
  const [status, setStatus] = useState<PushPermissionStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void getPushPermissionStatus().then((s) => {
      if (active) setStatus(s)
    })
    return () => {
      active = false
    }
  }, [])

  // Self-heal: permission can be granted in system settings AFTER the sign-in
  // silent pass ran, leaving no token row. Re-registering is a cheap upsert.
  useEffect(() => {
    if (status === 'granted' && user) void registerPushToken(user.id)
  }, [status, user])

  if (!user || status === null || status === 'unsupported') return null

  const onEnable = async () => {
    setBusy(true)
    try {
      const result = await registerPushToken(user.id, { requestIfNeeded: true })
      if (result.token) {
        setStatus('granted')
      } else if (result.reason === 'permission-denied') {
        setStatus('denied')
      } else {
        Alert.alert(
          'Could not enable push alerts',
          result.error ?? `Registration failed (${result.reason ?? 'unknown'}). Try again later.`,
          [{ text: 'OK' }]
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <View
      className="rounded-card border p-5 gap-3"
      style={{ backgroundColor: colors.navy, borderColor: `${colors.slate}33` }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {status === 'denied' ? (
          <BellOff size={14} color={colors.muted} strokeWidth={2} />
        ) : (
          <Bell size={14} color={colors.brand.primary} strokeWidth={2} />
        )}
        <Text
          style={{
            fontFamily: 'Inter_500Medium',
            fontSize: 11,
            color: colors.muted,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}
        >
          Push Alerts
        </Text>
      </View>
      {status === 'granted' ? (
        <Text
          style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.muted, lineHeight: 18 }}
        >
          Enabled — new watchlist matches arrive as push notifications on this device.
        </Text>
      ) : status === 'denied' ? (
        <>
          <Text
            style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.muted, lineHeight: 18 }}
          >
            Notifications are turned off for BidWise in system settings. Turn them on to get
            watchlist matches as push alerts.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openSettings()}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.brand.primary,
              backgroundColor: 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                fontSize: 11,
                color: colors.brand.primary,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              Open Settings
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text
            style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.muted, lineHeight: 18 }}
          >
            Get a push notification the moment a new auction property matches one of your
            watchlists.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void onEnable()}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: colors.brand.primary,
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                fontSize: 12,
                color: colors.midnight,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              {busy ? 'Enabling…' : 'Enable Push Alerts'}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  )
}
