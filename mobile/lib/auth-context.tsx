import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { registerPushToken } from './push'
import { queryClient } from './query-client'
import { clearPersistedQueryCache } from './storage'
import { supabase } from './supabase'
import {
  configurePurchases,
  logOutPurchases,
  getCustomerInfo,
  hasEntitlement,
  isPurchasesConfigured,
} from './purchases'
import { identifyUser, resetAnalytics } from './analytics'
import type { Subscription, UserProfile } from './types'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  profile: UserProfile | null
  subscription: Subscription | null
  hasActiveAccess: boolean
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  deleteAccount: () => Promise<void>
  /** Re-check the RevenueCat entitlement (call after a purchase/restore). */
  refreshAccess: () => Promise<void>
}

const ADMIN_EMAILS = new Set(
  (process.env.EXPO_PUBLIC_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)
)

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Tracks whether the RevenueCat access entitlement is active for this user.
  const [entitlementActive, setEntitlementActive] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id ?? null

  // Register the Expo push token once per signed-in user. The ref dedupes
  // across re-renders so we don't spam Supabase with repeat upserts.
  // No-ops cleanly on simulators and in Expo Go (see lib/push.ts).
  const registeredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!userId) {
      registeredFor.current = null
      return
    }
    if (registeredFor.current === userId) return
    registeredFor.current = userId
    void registerPushToken(userId)
  }, [userId])

  // Configure RevenueCat with the Supabase user id and refresh the entitlement
  // whenever the signed-in user changes. No-ops when keys are absent.
  useEffect(() => {
    if (!userId) {
      setEntitlementActive(false)
      return
    }
    identifyUser(userId)
    let active = true
    // Sequential, not parallel: getCustomerInfo() must run AFTER the RevenueCat
    // identity switch resolves, or it answers from the previous account's cached
    // CustomerInfo and this user inherits their entitlement.
    void (async () => {
      const ok = await configurePurchases(userId)
      if (!ok || !active) return
      const info = await getCustomerInfo()
      if (active) setEntitlementActive(hasEntitlement(info))
    })()
    return () => {
      active = false
    }
  }, [userId])

  const profileQuery = useQuery<UserProfile | null>({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return null
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, role, full_name, county_preference')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return data as UserProfile | null
    },
  })

  const subscriptionQuery = useQuery<Subscription | null>({
    queryKey: ['subscription', userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return null
      const { data, error } = await supabase
        .from('subscriptions')
        .select(
          'id, user_id, plan, status, billing_cycle, trial_end, current_period_end, stripe_subscription_id'
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error && error.code !== 'PGRST116') throw error
      return data as Subscription | null
    },
  })

  const profile = profileQuery.data ?? null
  const subscription = subscriptionQuery.data ?? null
  const email = (profile?.email ?? session?.user?.email ?? '').toLowerCase()
  const isAdmin = profile?.role === 'admin' || ADMIN_EMAILS.has(email)
  // Access is granted by: admin allowlist, a server-side subscription row
  // (web/Stripe), OR an active RevenueCat entitlement (in-app purchase).
  const hasActiveAccess =
    isAdmin ||
    entitlementActive ||
    subscription?.status === 'active' ||
    subscription?.status === 'trialing'

  const refreshAccess = async () => {
    if (!isPurchasesConfigured()) return
    const info = await getCustomerInfo()
    setEntitlementActive(hasEntitlement(info))
  }

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    loading: loading || profileQuery.isLoading || subscriptionQuery.isLoading,
    profile,
    subscription,
    hasActiveAccess,
    isAdmin,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signUp: async (email, password) => {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      resetAnalytics()
      // Drop the RevenueCat identity too. Without this the SDK keeps this
      // user's app_user_id, so the next person to sign in on this device
      // inherits their CustomerInfo — and any purchase that person makes is
      // billed to them but attributed to the account that just signed out.
      await logOutPurchases()
      setEntitlementActive(false)
      // Purge the previous user's leads / watchlists / subscription cache so the
      // next sign-in doesn't briefly render stale data. clear() empties the
      // in-memory cache; clearPersistedQueryCache() removes the MMKV snapshot so
      // it can't rehydrate for a different user on the next cold boot.
      queryClient.clear()
      clearPersistedQueryCache()
    },
    resetPassword: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'bidwise://reset-password',
      })
      if (error) throw error
    },
    deleteAccount: async () => {
      // Server-side deletion (auth user + owned rows) runs in the
      // `delete-account` edge function with the service-role key. The function
      // authenticates the caller from the bearer token the SDK attaches.
      const { error } = await supabase.functions.invoke('delete-account')
      if (error) throw error
      // Best-effort local sign-out + cache purge. Ignore sign-out errors since
      // the account is already gone server-side.
      await supabase.auth.signOut().catch(() => {})
      resetAnalytics()
      await logOutPurchases()
      setEntitlementActive(false)
      queryClient.clear()
      clearPersistedQueryCache()
    },
    refreshAccess,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
