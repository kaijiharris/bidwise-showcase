import { useMemo, useState } from 'react'
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ArrowRight, Briefcase, Sparkles, Trash2 } from 'lucide-react-native'
import { Screen } from '@/components/ui/Screen'
import { ScoreBadge } from '@/components/ScoreBadge'
import { SkeletonList } from '@/components/ui/SkeletonCard'
import { useAuth } from '@/lib/auth-context'
import {
  fetchLeadPipelineWithLead,
  removeLeadPipelineEntry,
  updateLeadPipelineStage,
} from '@/lib/leads-api'
import {
  fetchPipeline,
  removeFromPipeline,
  updatePipelineStatus,
} from '@/lib/pipeline-api'
import { formatCompactCurrency, formatPercent } from '@/lib/format'
import {
  EQUITY_TIER_LABELS,
  LEAD_DESK_STAGES,
  LEAD_STAGE_LABELS,
  PIPELINE_STATUSES,
  type LeadPipelineRecord,
  type LeadStage,
  type PipelineDeal,
  type PipelineStatus,
} from '@/lib/types'
import { colors, withAlpha } from '@/theme/colors'

type Track = 'auction' | 'leads'

const STATUS_LABEL: Record<PipelineStatus, string> = {
  watchlist: 'Watchlist',
  diligence: 'Diligence',
  bidding: 'Bidding',
  pass: 'Pass',
}

const STATUS_TINT: Record<PipelineStatus, string> = {
  watchlist: '#10A7FF',
  diligence: '#2DE2FF',
  bidding: '#74C8FF',
  pass: '#6B778A',
}

const STAGE_TINT: Record<LeadStage, string> = {
  new: '#74C8FF',
  qualified: '#10A7FF',
  outreach: '#2DE2FF',
  negotiating: '#74C8FF',
  under_contract: '#2DE2FF',
  closed: '#6B778A',
  dead: '#6B778A',
}

export default function PipelineScreen() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const queryClient = useQueryClient()
  const [track, setTrack] = useState<Track>('auction')

  return (
    <Screen edges={['top']}>
      <View style={{ paddingTop: 16, gap: 4 }}>
        <Text
          style={{
            fontFamily: 'Inter_500Medium',
            fontSize: 11,
            color: colors.muted,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          Pipeline
        </Text>
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 30,
            color: colors.soft,
            letterSpacing: -1,
          }}
        >
          Your deals.
        </Text>
      </View>

      <View
        className="flex-row"
        style={{
          gap: 6,
          paddingVertical: 14,
        }}
      >
        <TrackTab
          label="Auction"
          icon={<Briefcase size={12} color={track === 'auction' ? colors.brand.primary : colors.muted} strokeWidth={2} />}
          active={track === 'auction'}
          onPress={() => setTrack('auction')}
        />
        <TrackTab
          label="Off-Market"
          icon={<Sparkles size={12} color={track === 'leads' ? colors.brand.cyan : colors.muted} strokeWidth={2} />}
          active={track === 'leads'}
          activeColor={colors.brand.cyan}
          onPress={() => setTrack('leads')}
        />
      </View>

      {track === 'auction' ? (
        <AuctionPipelineView userId={userId} queryClient={queryClient} />
      ) : (
        <LeadDeskView userId={userId} queryClient={queryClient} />
      )}
    </Screen>
  )
}

function TrackTab({
  label,
  icon,
  active,
  activeColor = colors.brand.primary,
  onPress,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  activeColor?: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: active ? colors.navy : 'transparent',
        borderWidth: 1,
        borderColor: active ? activeColor : withAlpha(colors.slate, 0.25),
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon}
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          fontSize: 11,
          color: active ? activeColor : colors.muted,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

// ─── AUCTION TRACK ──────────────────────────────────────────────────────────

function AuctionPipelineView({
  userId,
  queryClient,
}: {
  userId: string | null
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const [active, setActive] = useState<PipelineStatus>('watchlist')

  const query = useQuery({
    queryKey: ['pipeline', userId],
    queryFn: () => (userId ? fetchPipeline(userId) : Promise.resolve([])),
    enabled: !!userId,
  })

  const byStatus = useMemo(() => {
    const out: Record<PipelineStatus, PipelineDeal[]> = {
      watchlist: [],
      diligence: [],
      bidding: [],
      pass: [],
    }
    for (const d of query.data ?? []) out[d.status]?.push(d)
    return out
  }, [query.data])

  const moveMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PipelineStatus }) =>
      updatePipelineStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline', userId] }),
    onError: (err) => {
      Alert.alert(
        "Couldn't move deal",
        err instanceof Error ? err.message : String(err)
      )
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => removeFromPipeline(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline', userId] }),
    onError: (err) => {
      Alert.alert(
        "Couldn't remove deal",
        err instanceof Error ? err.message : String(err)
      )
    },
  })

  const onMove = (deal: PipelineDeal) => {
    const others = PIPELINE_STATUSES.filter((s) => s !== deal.status)
    Alert.alert('Move deal', `${deal.address}`, [
      ...others.map((s) => ({
        text: STATUS_LABEL[s],
        onPress: () => moveMut.mutate({ id: deal.id, status: s }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  const onRemove = (deal: PipelineDeal) => {
    Alert.alert('Remove from pipeline?', deal.address, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeMut.mutate(deal.id),
      },
    ])
  }

  const rows = byStatus[active]

  return (
    <>
      <View className="flex-row" style={{ gap: 8, paddingBottom: 14 }}>
        {PIPELINE_STATUSES.map((s) => {
          const count = byStatus[s].length
          const isActive = s === active
          return (
            <Pressable
              key={s}
              accessibilityRole="button"
              onPress={() => setActive(s)}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 8,
                borderRadius: 12,
                backgroundColor: isActive ? colors.navy : 'transparent',
                borderWidth: 1,
                borderColor: isActive ? STATUS_TINT[s] : withAlpha(colors.slate, 0.25),
                alignItems: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 10,
                  color: isActive ? STATUS_TINT[s] : colors.muted,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                }}
              >
                {STATUS_LABEL[s]}
              </Text>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 18,
                  color: isActive ? colors.soft : colors.slate,
                  marginTop: 2,
                }}
              >
                {count}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => query.refetch()}
            tintColor={colors.brand.primary}
          />
        }
        ListEmptyComponent={
          query.isLoading ? (
            <SkeletonList count={4} />
          ) : query.isError ? (
            <PipelineError
              title="Couldn't load your pipeline."
              error={query.error}
              hint={'If this mentions "relation auction_pipeline does not exist," apply supabase/migrations/003_auction_pipeline.sql.'}
            />
          ) : (
            <View style={{ paddingVertical: 48, alignItems: 'center', gap: 6 }}>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 18,
                  color: colors.soft,
                }}
              >
                Nothing in {STATUS_LABEL[active]} yet.
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  fontSize: 13,
                  color: colors.muted,
                  textAlign: 'center',
                  paddingHorizontal: 24,
                }}
              >
                Tap &ldquo;Add to pipeline&rdquo; on any deal from the Deals tab.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: colors.navy,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: withAlpha(colors.slate, 0.2),
              padding: 14,
              gap: 10,
            }}
          >
            <View className="flex-row items-start justify-between gap-3">
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: 'SpaceGrotesk_600SemiBold',
                    fontSize: 15,
                    color: colors.soft,
                  }}
                >
                  {item.address}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Inter_400Regular',
                    fontSize: 11,
                    color: colors.muted,
                  }}
                >
                  {[item.city, item.zip, `${item.county} County`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <ScoreBadge value={item.deal_score} />
            </View>

            <View className="flex-row items-center justify-between">
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 16,
                  color: colors.brand.cyan,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {formatPercent(item.roi)}
                <Text
                  style={{
                    fontFamily: 'Inter_500Medium',
                    fontSize: 10,
                    color: colors.muted,
                    letterSpacing: 1,
                  }}
                >
                  {'  '}ROI
                </Text>
              </Text>
              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => onMove(item)}
                  accessibilityRole="button"
                  hitSlop={6}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: colors.graphite,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <ArrowRight size={12} color={colors.soft} strokeWidth={2} />
                  <Text
                    style={{
                      fontFamily: 'Inter_500Medium',
                      fontSize: 11,
                      color: colors.soft,
                    }}
                  >
                    Move
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onRemove(item)}
                  accessibilityRole="button"
                  hitSlop={6}
                  style={({ pressed }) => ({
                    padding: 6,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Trash2 size={14} color={colors.muted} strokeWidth={1.75} />
                </Pressable>
              </View>
            </View>
          </View>
        )}
      />
    </>
  )
}

// ─── OFF-MARKET LEAD DESK ───────────────────────────────────────────────────

function LeadDeskView({
  userId,
  queryClient,
}: {
  userId: string | null
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const router = useRouter()
  const [active, setActive] = useState<LeadStage>('qualified')

  const query = useQuery({
    queryKey: ['lead-pipeline-joined', userId],
    queryFn: () => (userId ? fetchLeadPipelineWithLead(userId) : Promise.resolve([])),
    enabled: !!userId,
  })

  const byStage = useMemo(() => {
    const out: Record<LeadStage, LeadPipelineRecord[]> = {
      new: [],
      qualified: [],
      outreach: [],
      negotiating: [],
      under_contract: [],
      closed: [],
      dead: [],
    }
    for (const r of query.data ?? []) {
      // Remap 'new' to 'qualified' so initial adds show up on the board
      // (mirrors web Deal Desk behavior, DealDeskClient.tsx:46).
      const stage = r.stage === 'new' ? 'qualified' : r.stage
      out[stage]?.push(r)
    }
    return out
  }, [query.data])

  const moveMut = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: LeadStage }) =>
      updateLeadPipelineStage(id, stage),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline-joined', userId] }),
    onError: (err) => {
      Alert.alert(
        "Couldn't move lead",
        err instanceof Error ? err.message : String(err)
      )
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => removeLeadPipelineEntry(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline-joined', userId] }),
    onError: (err) => {
      Alert.alert(
        "Couldn't remove lead",
        err instanceof Error ? err.message : String(err)
      )
    },
  })

  const onMove = (record: LeadPipelineRecord) => {
    const others = LEAD_DESK_STAGES.filter((s) => s !== record.stage)
    Alert.alert('Move lead', record.lead?.address ?? '', [
      ...others.map((s) => ({
        text: LEAD_STAGE_LABELS[s],
        onPress: () => moveMut.mutate({ id: record.id, stage: s }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  const onRemove = (record: LeadPipelineRecord) => {
    Alert.alert('Remove from pipeline?', record.lead?.address ?? '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeMut.mutate(record.id),
      },
    ])
  }

  const rows = byStage[active]

  return (
    <>
      <View className="flex-row" style={{ gap: 8, paddingBottom: 14 }}>
        {LEAD_DESK_STAGES.map((s) => {
          const count = byStage[s].length
          const isActive = s === active
          return (
            <Pressable
              key={s}
              accessibilityRole="button"
              onPress={() => setActive(s)}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 8,
                borderRadius: 12,
                backgroundColor: isActive ? colors.navy : 'transparent',
                borderWidth: 1,
                borderColor: isActive ? STAGE_TINT[s] : withAlpha(colors.slate, 0.25),
                alignItems: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 9,
                  color: isActive ? STAGE_TINT[s] : colors.muted,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                }}
              >
                {LEAD_STAGE_LABELS[s]}
              </Text>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 18,
                  color: isActive ? colors.soft : colors.slate,
                  marginTop: 2,
                }}
              >
                {count}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => query.refetch()}
            tintColor={colors.brand.cyan}
          />
        }
        ListEmptyComponent={
          query.isLoading ? (
            <SkeletonList count={4} />
          ) : query.isError ? (
            <PipelineError
              title="Couldn't load your lead desk."
              error={query.error}
              hint={'If this mentions "relation lead_pipeline does not exist," apply web/supabase/migrations/001_off_market_leads.sql.'}
            />
          ) : (
            <View style={{ paddingVertical: 48, alignItems: 'center', gap: 6 }}>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 18,
                  color: colors.soft,
                }}
              >
                Nothing in {LEAD_STAGE_LABELS[active]} yet.
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  fontSize: 13,
                  color: colors.muted,
                  textAlign: 'center',
                  paddingHorizontal: 24,
                }}
              >
                Tap &ldquo;Pipeline&rdquo; on any lead from the Leads tab.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const lead = item.lead
          if (!lead) return null
          const subtitle = [lead.city, lead.zip_code, lead.county ? `${lead.county} County` : null]
            .filter(Boolean)
            .join(' · ')
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push(`/(app)/intel/${encodeURIComponent(lead.id)}` as never)
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <View
                style={{
                  backgroundColor: colors.navy,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: withAlpha(colors.slate, 0.2),
                  padding: 14,
                  gap: 10,
                }}
              >
                <View className="flex-row items-start justify-between gap-3">
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: 'SpaceGrotesk_600SemiBold',
                        fontSize: 15,
                        color: colors.soft,
                      }}
                    >
                      {lead.address}
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Inter_400Regular',
                        fontSize: 11,
                        color: colors.muted,
                      }}
                    >
                      {subtitle}
                    </Text>
                  </View>
                  <ScoreBadge value={lead.deal_score} />
                </View>

                <View className="flex-row items-center justify-between">
                  <View>
                    <Text
                      style={{
                        fontFamily: 'SpaceGrotesk_700Bold',
                        fontSize: 16,
                        color: colors.brand.cyan,
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {formatCompactCurrency(lead.estimated_equity)}
                      <Text
                        style={{
                          fontFamily: 'Inter_500Medium',
                          fontSize: 10,
                          color: colors.muted,
                          letterSpacing: 1,
                        }}
                      >
                        {'  '}EQUITY
                      </Text>
                    </Text>
                    {lead.equity_tier ? (
                      <Text
                        style={{
                          fontFamily: 'Inter_500Medium',
                          fontSize: 10,
                          color: colors.muted,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase',
                          marginTop: 2,
                        }}
                      >
                        {EQUITY_TIER_LABELS[lead.equity_tier]}
                      </Text>
                    ) : null}
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation()
                        onMove(item)
                      }}
                      accessibilityRole="button"
                      hitSlop={6}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        backgroundColor: colors.graphite,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 999,
                        opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <ArrowRight size={12} color={colors.soft} strokeWidth={2} />
                      <Text
                        style={{
                          fontFamily: 'Inter_500Medium',
                          fontSize: 11,
                          color: colors.soft,
                        }}
                      >
                        Move
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation()
                        onRemove(item)
                      }}
                      accessibilityRole="button"
                      hitSlop={6}
                      style={({ pressed }) => ({
                        padding: 6,
                        opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <Trash2 size={14} color={colors.muted} strokeWidth={1.75} />
                    </Pressable>
                  </View>
                </View>
              </View>
            </Pressable>
          )
        }}
      />
    </>
  )
}

function PipelineError({
  title,
  error,
  hint,
}: {
  title: string
  error: unknown
  hint: string
}) {
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center', gap: 8 }}>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 18,
          color: colors.soft,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 12,
          color: colors.muted,
          textAlign: 'center',
          paddingHorizontal: 24,
          lineHeight: 16,
        }}
      >
        {/* Raw DB errors + migration paths are developer breadcrumbs, not user
            copy. Production gets a retry line; detail stays in dev builds. */}
        {__DEV__
          ? error instanceof Error
            ? error.message
            : String(error)
          : 'Something went wrong on our end. Pull down to try again.'}
      </Text>
      {__DEV__ ? (
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 11,
            color: colors.muted,
            textAlign: 'center',
            paddingHorizontal: 32,
            paddingTop: 4,
            lineHeight: 16,
          }}
        >
          {`DEV: ${hint}`}
        </Text>
      ) : null}
    </View>
  )
}
