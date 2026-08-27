import { createMMKV } from 'react-native-mmkv'

// Single MMKV instance for the whole app. MMKV is synchronous and ~10-30x
// faster than AsyncStorage — fast enough that the React Query persister can
// hydrate the cache off it on app boot before the first frame paints.
//
// Storage location is per-app, sandboxed on iOS/Android. Nothing in here is
// secret — RLS on Supabase governs what can be fetched in the first place,
// and the auth session token lives in expo-secure-store (the device keychain/
// keystore), kept separate so the Supabase client owns its own persistence.
//
// v4 of react-native-mmkv is a Nitro module — the old `new MMKV(...)` API
// became `createMMKV(...)` and `MMKV` is now a type-only export.
export const mmkv = createMMKV({ id: 'bidwise-cache' })

// Key under which the React Query persister stores the cache snapshot.
// Single-sourced here so the persister setup (app/_layout.tsx) and the
// sign-out cache purge (lib/auth-context.tsx) can't drift apart.
export const REACT_QUERY_CACHE_KEY = 'bidwise-react-query-cache'

// Adapter that satisfies the `Storage` shape expected by
// @tanstack/query-sync-storage-persister. The persister calls getItem on
// boot to hydrate, setItem on every cache mutation, and removeItem when
// the buster changes (app version bump).
export const mmkvStorage = {
  getItem: (key: string): string | null => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string): void => mmkv.set(key, value),
  removeItem: (key: string): void => {
    mmkv.remove(key)
  },
}

// Removes the persisted React Query cache from disk. Safe to call when the
// key is absent — MMKV.remove() no-ops on missing keys. Called on sign-out /
// account deletion so a previous user's cached data can't survive to the next
// cold boot for a different account.
export function clearPersistedQueryCache(): void {
  mmkvStorage.removeItem(REACT_QUERY_CACHE_KEY)
}
