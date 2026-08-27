// mobile/lib/purchases.ts
//
// Thin wrapper around react-native-purchases (RevenueCat). Centralizes
// configuration, entitlement checks, and the offerings/purchase/restore flow
// so screens never touch the SDK directly.
//
// Keys come from env (EXPO_PUBLIC_REVENUECAT_IOS_KEY /
// EXPO_PUBLIC_REVENUECAT_ANDROID_KEY) — NEVER hardcoded. If the platform key
// is absent the module stays in a safe "not configured" state: configure()
// no-ops and isConfigured() returns false, so the paywall can render a
// graceful fallback instead of crashing.

import { Platform } from 'react-native'
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases'

// The entitlement identifier configured in the RevenueCat dashboard. Map every
// subscription product to this single entitlement so "entitlement active ⇒
// hasActiveAccess" holds regardless of which tier the user bought.
export const ENTITLEMENT_ID = 'pro'

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY

function platformKey(): string | undefined {
  return Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY
}

let configured = false

export function isPurchasesConfigured(): boolean {
  return configured
}

/**
 * Configure the RevenueCat SDK exactly once. Safe to call repeatedly. No-ops
 * (and returns false) when the platform API key is missing so the app never
 * crashes in environments where IAP isn't provisioned yet.
 *
 * @param appUserId Optional stable user id (the Supabase user id) so RevenueCat
 *   ties purchases to the account rather than an anonymous device id.
 */
export async function configurePurchases(appUserId?: string | null): Promise<boolean> {
  if (configured) {
    // Re-identify on an account switch. This MUST be awaited and its failure
    // MUST be surfaced. Callers read getCustomerInfo() immediately after; with a
    // fire-and-forget logIn that read resolves against the PREVIOUS account's
    // cached CustomerInfo, so user B inherits user A's unlocked session on a
    // shared device. Worse, if logIn fails silently the SDK keeps A's
    // app_user_id, so a purchase B makes is attributed to A — the webhook then
    // writes the subscription row onto A's Supabase user. B pays, A gets access.
    if (appUserId) {
      try {
        await Purchases.logIn(appUserId)
      } catch {
        return false
      }
    }
    return true
  }
  const key = platformKey()
  if (!key) return false

  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN)
    Purchases.configure({ apiKey: key, appUserID: appUserId ?? undefined })
    configured = true
    return true
  } catch {
    return false
  }
}

/**
 * Drop the RevenueCat identity on sign-out.
 *
 * Without this the SDK keeps the previous account's `app_user_id` for the life
 * of the process, so the next person to sign in on this device inherits their
 * CustomerInfo — and any purchase that person makes is attributed to whoever
 * signed out. Resets the SDK to a fresh anonymous id.
 *
 * Safe to call when unconfigured or already anonymous; both are no-ops.
 */
export async function logOutPurchases(): Promise<void> {
  if (!configured) return
  try {
    await Purchases.logOut()
  } catch {
    // The SDK throws when the current user is already anonymous — which is
    // precisely the state we are trying to reach, so this is not an error.
  }
}

/** True when the customer holds the access entitlement. */
export function hasEntitlement(info: CustomerInfo | null): boolean {
  if (!info) return false
  return info.entitlements.active[ENTITLEMENT_ID] != null
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!configured) return null
  try {
    return await Purchases.getCustomerInfo()
  } catch {
    return null
  }
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null
  const offerings = await Purchases.getOfferings()
  return offerings.current ?? null
}

export interface PurchaseResult {
  customerInfo: CustomerInfo
  /** True if the access entitlement is now active. */
  hasAccess: boolean
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseResult> {
  const { customerInfo } = await Purchases.purchasePackage(pkg)
  return { customerInfo, hasAccess: hasEntitlement(customerInfo) }
}

export async function restorePurchases(): Promise<PurchaseResult> {
  const customerInfo = await Purchases.restorePurchases()
  return { customerInfo, hasAccess: hasEntitlement(customerInfo) }
}

/**
 * RevenueCat surfaces user-cancelled purchases as an error with
 * `userCancelled === true`. Callers should treat that as a benign no-op rather
 * than an error toast.
 */
export function isUserCancelled(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err != null &&
    'userCancelled' in err &&
    (err as { userCancelled?: boolean }).userCancelled === true
  )
}
