import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import { secureStorage } from './secure-storage'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — copy mobile/.env.example to .env.local and fill them in.'
  )
}

// A release build must never point at a developer's machine. `.env.local` holds
// a LAN host for local work, and if it ever reaches the build archive the app
// would boot "successfully" and then fail every request against an unreachable,
// ATS-blocked private address — the silent version of the JSON-parse deals bug.
// Failing loudly here turns a shipped-broken binary into a failed build.
function isNonProductionHost(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return true // unparseable is never a valid production endpoint
  }
  if (parsed.protocol !== 'https:') return true
  const host = parsed.hostname
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

if (!__DEV__ && isNonProductionHost(url)) {
  throw new Error(
    `EXPO_PUBLIC_SUPABASE_URL is not a production endpoint (got "${url}"). ` +
      'Release builds require an https Supabase host. Set it as an EAS environment ' +
      'variable for this build profile (`eas env:list --environment production`) — ' +
      'a LAN/localhost value almost always means a stray .env.local reached the build archive.'
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Persist the session in the device keychain/keystore (expo-secure-store)
    // instead of plaintext AsyncStorage. The adapter chunks large values to
    // stay under SecureStore's per-item size limit.
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
