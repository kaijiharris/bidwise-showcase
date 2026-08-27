// mobile/lib/secure-storage.ts
//
// A `Storage`-shaped adapter backed by expo-secure-store, used to persist the
// Supabase auth session in the device keychain/keystore instead of plaintext
// AsyncStorage.
//
// SecureStore rejects values larger than ~2KB on iOS with a warning and can
// fail on Android. Supabase sessions (JWT + refresh token + user) routinely
// exceed that, so this adapter transparently chunks large values across
// multiple keys and reassembles them on read.
//
// On web (where SecureStore isn't available) it falls back to localStorage so
// the same client config works for `expo start --web` without crashing.

import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

// Keep a comfortable margin under the SecureStore size warning threshold.
const CHUNK_SIZE = 1800
const CHUNK_COUNT_SUFFIX = '__chunks'

function isWeb(): boolean {
  return Platform.OS === 'web'
}

// SecureStore keys must be alphanumeric, ".", "-", and "_". Supabase keys
// (e.g. "sb-<ref>-auth-token") already satisfy this, but sanitize defensively.
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_')
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb()) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  const base = safeKey(key)
  const countRaw = await SecureStore.getItemAsync(base + CHUNK_COUNT_SUFFIX).catch(() => null)

  // Non-chunked value (small) — stored directly under the base key.
  if (!countRaw) {
    return SecureStore.getItemAsync(base).catch(() => null)
  }

  const count = Number(countRaw)
  if (!Number.isFinite(count) || count <= 0) return null

  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${base}.${i}`).catch(() => null)
    if (part == null) return null // corrupt/partial — treat as missing
    parts.push(part)
  }
  return parts.join('')
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb()) {
    try {
      globalThis.localStorage?.setItem(key, value)
    } catch {
      // ignore
    }
    return
  }

  const base = safeKey(key)
  // Clear any previous representation before writing the new one.
  await clearChunks(base)

  if (value.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(base, value).catch(() => {})
    return
  }

  const count = Math.ceil(value.length / CHUNK_SIZE)
  for (let i = 0; i < count; i++) {
    const part = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    await SecureStore.setItemAsync(`${base}.${i}`, part).catch(() => {})
  }
  await SecureStore.setItemAsync(base + CHUNK_COUNT_SUFFIX, String(count)).catch(() => {})
}

async function removeItem(key: string): Promise<void> {
  if (isWeb()) {
    try {
      globalThis.localStorage?.removeItem(key)
    } catch {
      // ignore
    }
    return
  }
  await clearChunks(safeKey(key))
}

// Remove the base key, the chunk-count marker, and any chunk keys.
async function clearChunks(base: string): Promise<void> {
  await SecureStore.deleteItemAsync(base).catch(() => {})
  const countRaw = await SecureStore.getItemAsync(base + CHUNK_COUNT_SUFFIX).catch(() => null)
  if (countRaw) {
    const count = Number(countRaw)
    if (Number.isFinite(count)) {
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${base}.${i}`).catch(() => {})
      }
    }
  }
  await SecureStore.deleteItemAsync(base + CHUNK_COUNT_SUFFIX).catch(() => {})
}

// Matches the async Storage interface Supabase expects for `auth.storage`.
export const secureStorage = {
  getItem,
  setItem,
  removeItem,
}
