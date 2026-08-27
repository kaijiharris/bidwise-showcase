// mobile/lib/push.ts
//
// Expo push notification registration.
//
// Two call sites:
//   1. AuthProvider on sign-in — calls silently. Registers a token only if the
//      user has *already* granted notification permission. Never prompts.
//   2. A user-initiated CTA (e.g. "Enable push alerts" in Profile) — calls with
//      { requestIfNeeded: true } to trigger the iOS permission dialog at a
//      moment the user understands.
//
// Avoiding the auto-prompt on sign-in is an App Store best practice: prompting
// before the user sees value usually gets denied, and once denied iOS won't
// re-prompt without sending them to Settings.
//
// Push tokens are device-physical only — simulators and Expo Go return null.
// This module no-ops gracefully in those cases so dev iteration isn't blocked.

import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from './supabase'

// Show notifications even when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

interface RegisterOptions {
  // When true, show the iOS permission dialog if permission hasn't been asked
  // yet. When false (default), skip silently if permission isn't already
  // granted. Use true only from user-initiated UI affordances.
  requestIfNeeded?: boolean
}

interface RegisterResult {
  token: string | null
  reason?:
    | 'simulator'
    | 'expo-go'
    | 'permission-not-granted'
    | 'permission-denied'
    | 'no-project-id'
    | 'error'
  error?: string
}

export async function registerPushToken(
  userId: string,
  options: RegisterOptions = {}
): Promise<RegisterResult> {
  if (!Device.isDevice) {
    return { token: null, reason: 'simulator' }
  }

  // Expo Go on SDK 53+ cannot receive push notifications — only dev builds.
  if (Constants.appOwnership === 'expo') {
    return { token: null, reason: 'expo-go' }
  }

  // Android needs an explicit channel before tokens can be requested.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Watchlist Alerts',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    })
  }

  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing
  if (existing !== 'granted') {
    if (!options.requestIfNeeded) {
      // Silent path — don't prompt the OS dialog at sign-in time.
      return { token: null, reason: 'permission-not-granted' }
    }
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') {
    return { token: null, reason: 'permission-denied' }
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!projectId) {
    return { token: null, reason: 'no-project-id' }
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })

    // Upsert by (user_id, token) — see migration 005.
    const { error } = await supabase
      .from('device_tokens')
      .upsert(
        {
          user_id: userId,
          token,
          platform:
            Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' }
      )
    if (error) {
      return { token: null, reason: 'error', error: error.message }
    }

    return { token }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { token: null, reason: 'error', error: msg }
  }
}

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported'

// Current OS notification permission, for UI state (the Profile push-alerts
// card). 'unsupported' covers simulators and Expo Go, where push tokens can't
// exist — callers should hide push UI entirely rather than show a dead button.
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (!Device.isDevice) return 'unsupported'
  if (Constants.appOwnership === 'expo') return 'unsupported'
  const { status } = await Notifications.getPermissionsAsync()
  if (status === 'granted') return 'granted'
  if (status === 'denied') return 'denied'
  return 'undetermined'
}
