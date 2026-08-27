import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { mmkv } from '@/lib/storage'
import { applyPalette } from './colors'
import { darkPalette, lightPalette } from './palette'

export type Scheme = 'light' | 'dark'
export type ThemePreference = Scheme | 'system'

interface ThemeState {
  scheme: Scheme
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
}

const STORAGE_KEY = 'bidwise.theme.preference'
const ThemeContext = createContext<ThemeState | null>(null)

function readStoredPreference(): ThemePreference {
  const v = mmkv.getString(STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function resolveScheme(pref: ThemePreference, systemScheme: Scheme): Scheme {
  return pref === 'system' ? systemScheme : pref
}

// Apply once at module load so the very first render of any component reads
// the correct palette. The provider keeps it in sync afterwards.
applyPalette(readStoredPreference() === 'light' ? lightPalette : darkPalette)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme: Scheme = useColorScheme() === 'light' ? 'light' : 'dark'
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference())
  const scheme = resolveScheme(preference, systemScheme)

  // Mutate the singleton synchronously during render so children see the right
  // colors on this render — no flash-of-wrong-theme on toggle.
  applyPalette(scheme === 'light' ? lightPalette : darkPalette)

  const setPreference = useCallback((next: ThemePreference) => {
    mmkv.set(STORAGE_KEY, next)
    setPreferenceState(next)
  }, [])

  const value = useMemo<ThemeState>(
    () => ({ scheme, preference, setPreference }),
    [scheme, preference, setPreference],
  )

  // `key={scheme}` forces a subtree remount when the resolved scheme flips so
  // inline `colors.xxx` reads pick up the singleton's new values without a
  // per-file refactor.
  return (
    <ThemeContext.Provider value={value}>
      <ThemeFragment key={scheme}>{children}</ThemeFragment>
    </ThemeContext.Provider>
  )
}

function ThemeFragment({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
