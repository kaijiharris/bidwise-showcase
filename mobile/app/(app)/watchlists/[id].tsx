import { useMemo } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Eye, Mail } from 'lucide-react-native'
import { LeadCard } from '@/components/LeadCard'
import { Screen } from '@/components/ui/Screen'
import { useAuth } from '@/lib/auth-context'
import {
  addLeadToPipeline,
  fetchLeadPipelineEntries,
  fetchLeads,
  fetchWatchlists,
  leadMatchesWatchlist,
  removeLeadFromPipeline,
} from '@/lib/leads-api'
import {
  DEAL_TYPE_LABELS,
  type DealType,
  type OffMarketLeadSummary,
} from '@/lib/types'
import { colors, withAlpha } from '@/theme/colors'

export default function WatchlistDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const queryClient = useQueryClient()

  const watchlistsQuery = useQuery({
    queryKey: ['watchlists', userId],
    queryFn: () => (userId ? fetchWatchlists(userId) : Promise.resolve([])),
    enabled: !!userId,
  })

  const leadsQuery = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
  })

  const pipelineQuery = useQuery({
    queryKey: ['lead-pipeline', userId],
    queryFn: () => (userId ? fetchLeadPipelineEntries(userId) : Promise.resolve([])),
    enabled: !!userId,
  })

  const pipelineLeadIds = useMemo(
    () => new Set((pipelineQuery.data ?? []).map((r) => r.lead_id)),
    [pipelineQuery.data]
  )

  const watchlist = useMemo(
    () => (watchlistsQuery.data ?? []).find((w) => w.id === id) ?? null,
    [watchlistsQuery.data, id]
  )

  const matches = useMemo(() => {
    if (!watchlist) return []
    return (leadsQuery.data ?? []).filter((l) =>
      leadMatchesWatchlist(l, watchlist.criteria)
    )
  }, [watchlist, leadsQuery.data])

  const toggleMut = useMutation({
    mutationFn: async (lead: OffMarketLeadSummary) => {
      if (!userId) throw new Error('Not signed in')
      if (pipelineLeadIds.has(lead.id)) {
        await removeLeadFromPipeline(userId, lead.id)
      } else {
        await addLeadToPipeline(userId, lead.id, 'qualified')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline', userId] })
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline-joined', userId] })
    },
    onError: (err) => {
      Alert.alert(
        "Couldn't update pipeline",
        err instanceof Error ? err.message : String(err)
      )
    },
  })

  if (watchlistsQuery.isLoading) {
    return (
      <Screen edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand.cyan} />
        </View>
      </Screen>
    )
  }

  if (!watchlist) {
    return (
      <Screen edges={['top']}>
        <View style={{ paddingTop: 16 }}>
          <BackButton onPress={() => router.replace('/(app)/watchlists' as never)} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color: colors.soft }}>
            Watchlist not found.
          </Text>
        </View>
      </Screen>
    )
  }

  const c = watchlist.criteria
  const summaryChips: string[] = []
  if (c.counties?.[0]) summaryChips.push(c.counties[0])
  if (c.equity_min != null) summaryChips.push(`≥ $${c.equity_min.toLocaleString()}`)
  if (c.min_deal_score != null) summaryChips.push(`Score ≥ ${c.min_deal_score}`)
  if (c.deal_types?.[0]) summaryChips.push(DEAL_TYPE_LABELS[c.deal_types[0] as DealType])

  return (
    <Screen edges={['top']}>
      <View style={{ paddingTop: 12, gap: 12 }}>
        <BackButton onPress={() => router.replace('/(app)/watchlists' as never)} />
        <View
          style={{
            backgroundColor: colors.navy,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: withAlpha(colors.slate, 0.2),
            padding: 16,
            gap: 10,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: 3,
              backgroundColor: watchlist.is_active ? colors.brand.cyan : colors.slate,
            }}
          />
          <View className="flex-row items-center justify-between" style={{ paddingLeft: 6 }}>
            <View className="flex-row items-center gap-2" style={{ flex: 1 }}>
              <Eye size={14} color={colors.brand.cyan} strokeWidth={2} />
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 18,
                  color: colors.soft,
                  letterSpacing: -0.4,
                }}
                numberOfLines={1}
              >
                {watchlist.name}
              </Text>
            </View>
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 12,
                backgroundColor: withAlpha(colors.brand.primary, 0.16),
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 18,
                  color: colors.brand.primary,
                  letterSpacing: -0.5,
                }}
              >
                {matches.length}
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_500Medium',
                  fontSize: 8,
                  color: colors.brand.primary,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                }}
              >
                matches
              </Text>
            </View>
          </View>
          {summaryChips.length > 0 ? (
            <View className="flex-row flex-wrap" style={{ paddingLeft: 6, gap: 6 }}>
              {summaryChips.map((s, i) => (
                <View
                  key={i}
                  style={{
                    paddingHorizontal: 9,
                    paddingVertical: 4,
                    borderRadius: 999,
                    backgroundColor: colors.graphite,
                    borderWidth: 1,
                    borderColor: withAlpha(colors.slate, 0.3),
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Inter_500Medium',
                      fontSize: 10,
                      color: colors.soft,
                      textTransform: 'capitalize',
                    }}
                  >
                    {s}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <View
            className="flex-row items-center gap-1.5"
            style={{
              paddingLeft: 6,
              paddingTop: 6,
              borderTopWidth: 1,
              borderTopColor: withAlpha(colors.slate, 0.12),
            }}
          >
            <Mail size={10} color={colors.muted} strokeWidth={2} />
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.muted }}>
              {watchlist.alert_email
                ? 'Email alerts on · notified when new leads match'
                : 'Silent · no email alerts'}
            </Text>
          </View>
        </View>
      </View>

      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={leadsQuery.isRefetching}
            onRefresh={() => leadsQuery.refetch()}
            tintColor={colors.brand.cyan}
          />
        }
        ListEmptyComponent={
          <View style={{ paddingVertical: 48, alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 17, color: colors.soft }}>
              No matches yet.
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 12,
                color: colors.muted,
                textAlign: 'center',
                paddingHorizontal: 32,
                lineHeight: 17,
              }}
            >
              When a new lead matches this criteria, it&rsquo;ll appear here automatically.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <LeadCard
            lead={item}
            inPipeline={pipelineLeadIds.has(item.id)}
            pipelineLoading={toggleMut.isPending}
            onTogglePipeline={() => toggleMut.mutate(item)}
          />
        )}
      />
    </Screen>
  )
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <ArrowLeft size={14} color={colors.muted} strokeWidth={2} />
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          fontSize: 11,
          color: colors.muted,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        }}
      >
        Back to Watchlists
      </Text>
    </Pressable>
  )
}
