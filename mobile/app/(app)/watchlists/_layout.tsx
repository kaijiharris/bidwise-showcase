import { Stack } from 'expo-router'

// Wrap the watchlists directory in its own Stack so the parent (app) Tabs
// layout treats the whole tree as a single "watchlists" entry and respects
// the declaration order in (app)/_layout.tsx. Without this, Expo Router
// alphabetizes the tab bar when a tab segment is a directory with multiple
// routes — which is why Watch swapped with Profile after the restructure.
export default function WatchlistsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
