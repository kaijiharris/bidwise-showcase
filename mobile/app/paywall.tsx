import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import * as WebBrowser from 'expo-web-browser'
import { Check, X } from 'lucide-react-native'
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases'
import { BrandMark } from '@/components/ui/BrandMark'
import { GradientButton } from '@/components/ui/GradientButton'
import { Screen } from '@/components/ui/Screen'
import { useAuth } from '@/lib/auth-context'
import { track } from '@/lib/analytics'
import {
  getCurrentOffering,
  isPurchasesConfigured,
  isUserCancelled,
  purchasePackage,
  restorePurchases,
} from '@/lib/purchases'
import { colors, withAlpha } from '@/theme/colors'

// `?app=ios` suppresses the site chrome on these pages. Both open INSIDE the app
// via WebBrowser, two taps from the purchase button, and the site Navbar carries
// a "Start Free Trial" button into Stripe checkout — steering an iOS buyer to an
// external purchase (Guideline 3.1.1). The pages render the same legal text
// either way; only the nav/footer CTAs are hidden.
const TERMS_URL = 'https://bidwiseinvest.com/terms?app=ios'
const PRIVACY_URL = 'https://bidwiseinvest.com/privacy?app=ios'

// Features highlighted on the paywall. RevenueCat owns price + title; this is
// just the value proposition copy shown above the package list.
// TRUTHFULNESS GATE: this screen is the IAP review screenshot Apple keeps on
// file, and it is one tap from the purchase button. Every line must be true of
// the SHIPPED BINARY, not the roadmap. Removed 2026-07-26: "All Georgia
// tax-deed counties" (types.ts COUNTIES has four of Georgia's 159), "auction
// alerts" (TAX_SALE_SUBSCRIBER_DRY_RUN defaults true — nothing sends), and
// "Off-market lead intel & AI briefs" (off_market_leads is RLS-scoped to a
// single seeding account, so it is empty for ordinary users).
const VALUE_PROPS = [
  'Four Georgia counties: DeKalb, Gwinnett, Cobb, Clayton',
  'Full deal detail: comps, ARV, rehab, risk',
  'Unlimited property unlocks — no monthly cap',
  'Save parcels and track them to auction day',
]

export default function PaywallScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { signOut, session, refreshAccess } = useAuth()

  const [offering, setOffering] = useState<PurchasesOffering | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyPackage, setBusyPackage] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const configured = isPurchasesConfigured()

  useEffect(() => {
    track('paywall_viewed')
  }, [])

  useEffect(() => {
    let active = true
    if (!configured) {
      setLoading(false)
      return
    }
    ;(async () => {
      try {
        const current = await getCurrentOffering()
        if (!active) return
        setOffering(current)
        if (!current || current.availablePackages.length === 0) {
          setLoadError('No subscription options are available right now.')
        }
      } catch (e) {
        if (!active) return
        setLoadError(e instanceof Error ? e.message : 'Could not load subscription options.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [configured])

  const onSignOut = async () => {
    if (session) await signOut()
    router.replace('/(auth)/login')
  }

  const onContinueBrowsing = () => {
    router.replace('/(app)/feed')
  }

  const goToAccess = async () => {
    await refreshAccess()
    // Entitlement just changed, so every cached server response is stale BY
    // DEFINITION: the feed and property payloads now in cache were fetched while
    // locked, and each one has null financials and "Unlock to view address" in
    // place of the data the user just paid for. Without this invalidation the
    // buyer lands on the feed and still sees a wall of dashes — and because the
    // query cache is persisted to MMKV, even relaunching the app does not clear
    // it. This is the screen an App Review sandbox purchase ends on.
    await queryClient.invalidateQueries()
    router.replace('/(app)/feed')
  }

  const onPurchase = async (pkg: PurchasesPackage) => {
    setNotice(null)
    setBusyPackage(pkg.identifier)
    try {
      const { hasAccess } = await purchasePackage(pkg)
      if (hasAccess) {
        track('purchase_completed', { package: pkg.identifier })
        await goToAccess()
      } else {
        // StoreKit receipt propagation can lag the purchase call by a few
        // seconds. Do NOT tell the user to "pull to refresh" — this screen is a
        // plain ScrollView with no RefreshControl, so that instruction pointed
        // at a gesture that does not exist. Restore Purchases is right below and
        // actually re-checks the entitlement.
        setNotice(
          'Purchase complete — access is still syncing. Tap Restore Purchases below in a moment if it has not unlocked.'
        )
        await refreshAccess()
        await queryClient.invalidateQueries()
      }
    } catch (e) {
      if (!isUserCancelled(e)) {
        setNotice(e instanceof Error ? e.message : 'Purchase failed. Please try again.')
      }
    } finally {
      setBusyPackage(null)
    }
  }

  const onRestore = async () => {
    setNotice(null)
    setRestoring(true)
    try {
      const { hasAccess } = await restorePurchases()
      if (hasAccess) {
        await goToAccess()
      } else {
        setNotice('No active subscription found to restore on this Apple ID.')
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Restore failed. Please try again.')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: 24, paddingBottom: 32, gap: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between">
          <BrandMark size="sm" />
          <Pressable onPress={onSignOut} hitSlop={12} accessibilityRole="button">
            <X size={22} color={colors.muted} strokeWidth={1.75} />
          </Pressable>
        </View>

        <View className="gap-2">
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 34,
              color: colors.soft,
              letterSpacing: -1,
            }}
          >
            Unlock every deal.
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.muted, lineHeight: 22 }}>
            Subscribe to see full financials and comps for every published parcel in the four
            counties we cover.
          </Text>
        </View>

        <View className="gap-2">
          {VALUE_PROPS.map((f) => (
            <View key={f} className="flex-row items-center gap-2">
              <Check size={15} color={colors.brand.cyan} strokeWidth={2.5} />
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.soft }}>
                {f}
              </Text>
            </View>
          ))}
        </View>

        {loading ? (
          <View style={{ paddingVertical: 32, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brand.primary} />
          </View>
        ) : !configured ? (
          <NotConfiguredNotice />
        ) : loadError ? (
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 13,
              color: colors.status.danger,
              textAlign: 'center',
              paddingVertical: 8,
            }}
          >
            {loadError}
          </Text>
        ) : (
          <View className="gap-3">
            {(() => {
              const packages = offering?.availablePackages ?? []
              // Annual-savings anchor, derived 100% from StoreKit prices so it
              // can never contradict what Apple charges. Renders only when both
              // periods exist AND annual is actually cheaper — a missing
              // package shows exactly the previous UI.
              const monthly = packages.find((p) => p.packageType === 'MONTHLY')
              const annual = packages.find((p) => p.packageType === 'ANNUAL')
              let savings: SavingsAnchor | null = null
              if (monthly && annual) {
                const m = monthly.product.price
                const a = annual.product.price
                if (m > 0 && a > 0 && a < m * 12) {
                  const fmt = new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: annual.product.currencyCode || 'USD',
                    maximumFractionDigits: 0,
                  })
                  savings = {
                    pct: Math.round((1 - a / (m * 12)) * 100),
                    perMonth: `≈ ${fmt.format(a / 12)}/mo billed annually`,
                  }
                }
              }
              return packages.map((pkg) => (
                <PackageCard
                  key={pkg.identifier}
                  pkg={pkg}
                  busy={busyPackage === pkg.identifier}
                  disabled={busyPackage != null || restoring}
                  onPress={() => onPurchase(pkg)}
                  savings={pkg.packageType === 'ANNUAL' ? savings : null}
                />
              ))
            })()}
          </View>
        )}

        {notice ? (
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 12,
              color: colors.status.warning,
              textAlign: 'center',
            }}
          >
            {notice}
          </Text>
        ) : null}

        {configured ? (
          <Pressable
            onPress={onRestore}
            disabled={restoring || busyPackage != null}
            hitSlop={8}
            accessibilityRole="button"
            style={{ alignItems: 'center', paddingVertical: 4, opacity: restoring ? 0.6 : 1 }}
          >
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.brand.primary }}>
              {restoring ? 'Restoring…' : 'Restore Purchases'}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={onContinueBrowsing}
          hitSlop={8}
          accessibilityRole="button"
          style={{ alignItems: 'center', paddingVertical: 4 }}
        >
          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.muted }}>
            Continue browsing (limited access)
          </Text>
        </Pressable>

        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 11,
            color: colors.dim,
            textAlign: 'center',
            lineHeight: 17,
            paddingHorizontal: 8,
          }}
        >
          Subscriptions auto-renew at the price shown until cancelled. Manage or cancel anytime in
          your device&rsquo;s App Store account settings, at least 24 hours before the period ends.
          Payment is charged to your Apple ID at confirmation of purchase.
        </Text>

        <View className="flex-row items-center justify-center gap-4">
          <Pressable
            accessibilityRole="link"
            onPress={() => WebBrowser.openBrowserAsync(TERMS_URL).catch(() => {})}
            hitSlop={8}
          >
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.brand.primary }}>
              Terms of Use
            </Text>
          </Pressable>
          <Text style={{ color: colors.dim }}>·</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL).catch(() => {})}
            hitSlop={8}
          >
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.brand.primary }}>
              Privacy Policy
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  )
}

interface SavingsAnchor {
  pct: number
  perMonth: string
}

interface PackageCardProps {
  pkg: PurchasesPackage
  busy: boolean
  disabled: boolean
  onPress: () => void
  /** Annual card only: StoreKit-derived savings vs paying monthly. */
  savings?: SavingsAnchor | null
}

function PackageCard({ pkg, busy, disabled, onPress, savings }: PackageCardProps) {
  const product = pkg.product
  // RevenueCat localizes priceString and surfaces the subscription period.
  const period = product.subscriptionPeriod
  const periodLabel = formatPeriod(period)

  return (
    <View
      className="rounded-card p-5 gap-4"
      style={{
        backgroundColor: colors.navy,
        borderWidth: 1,
        borderColor: withAlpha(colors.brand.primary, 0.4),
      }}
    >
      <View className="flex-row items-start justify-between">
        <View style={{ flex: 1, paddingRight: 12 }}>
          <View className="flex-row items-center gap-2 flex-wrap">
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 20,
                color: colors.soft,
                letterSpacing: -0.5,
              }}
            >
              {product.title}
            </Text>
            {savings ? (
              <View
                className="rounded-pill"
                style={{
                  backgroundColor: withAlpha(colors.brand.cyan, 0.16),
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    fontSize: 10,
                    color: colors.brand.cyan,
                    letterSpacing: 0.6,
                  }}
                >
                  {`SAVE ${savings.pct}%`}
                </Text>
              </View>
            ) : null}
          </View>
          {product.description ? (
            <Text
              style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.muted, marginTop: 4 }}
            >
              {product.description}
            </Text>
          ) : null}
        </View>
        <View className="items-end">
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 24,
              color: colors.brand.cyan,
              letterSpacing: -0.8,
            }}
          >
            {product.priceString}
          </Text>
          {periodLabel ? (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.muted }}>
              {periodLabel}
            </Text>
          ) : null}
          {savings ? (
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.brand.cyan }}>
              {savings.perMonth}
            </Text>
          ) : null}
        </View>
      </View>

      <GradientButton
        label={busy ? 'Processing…' : 'Subscribe'}
        loading={busy}
        disabled={disabled}
        onPress={onPress}
      />
    </View>
  )
}

// ISO-8601 subscription period (e.g. "P1M", "P1Y") → human label.
function formatPeriod(period: string | null): string | null {
  if (!period) return null
  const map: Record<string, string> = {
    P1W: 'per week',
    P1M: 'per month',
    P2M: 'every 2 months',
    P3M: 'per quarter',
    P6M: 'every 6 months',
    P1Y: 'per year',
  }
  return map[period] ?? 'per period'
}

function NotConfiguredNotice() {
  return (
    <View
      style={{
        backgroundColor: colors.navy,
        borderRadius: 16,
        padding: 18,
        gap: 8,
        borderWidth: 1,
        borderColor: withAlpha(colors.slate, 0.25),
      }}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 15, color: colors.soft }}>
        In-app purchases unavailable
      </Text>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.muted, lineHeight: 19 }}>
        Subscriptions can&rsquo;t load on this build. If you already subscribed, sign in with that
        account or contact support@bidwiseinvest.com.
      </Text>
    </View>
  )
}
