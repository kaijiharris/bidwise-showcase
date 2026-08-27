import { Redirect, Tabs } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Briefcase, Eye, Home, Sparkles, User } from 'lucide-react-native'
import { useAuth } from '@/lib/auth-context'
import { colors, withAlpha } from '@/theme/colors'

export default function AppLayout() {
  const { session, loading } = useAuth()

  if (loading) return null
  if (!session) return <Redirect href="/(auth)/login" />
  // No paywall gate here: card-level locking on the feed handles non-subscribers.
  // First-time routing to paywall lives in /index.tsx.

  return (
    <Tabs
      screenListeners={{
        // Selection tick on tab switches — Robinhood's cheapest "alive" trick.
        // Fires only on press, not programmatic navigation; no-ops on hardware
        // without a haptic engine.
        tabPress: () => {
          Haptics.selectionAsync()
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.navy,
          borderTopColor: withAlpha(colors.slate, 0.2),
          borderTopWidth: 0.5,
          height: 88,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 9.5,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        },
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.slate,
        sceneStyle: { backgroundColor: colors.midnight },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Deals',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: 'Leads',
          tabBarIcon: ({ color, size }) => (
            <Sparkles size={size} color={color} strokeWidth={1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="pipeline"
        options={{
          title: 'Pipeline',
          tabBarIcon: ({ color, size }) => (
            <Briefcase size={size} color={color} strokeWidth={1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="watchlists"
        options={{
          title: 'Watch',
          tabBarIcon: ({ color, size }) => <Eye size={size} color={color} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User size={size} color={color} strokeWidth={1.75} />,
        }}
      />
      {/* Hide dynamic detail routes from the tab bar.
          watchlists/[id] is handled by watchlists/_layout.tsx (Stack), so
          the parent Tabs only sees the watchlists segment as a single entry. */}
      <Tabs.Screen name="property/[parcelId]" options={{ href: null }} />
      <Tabs.Screen name="intel/[id]" options={{ href: null }} />
    </Tabs>
  )
}
