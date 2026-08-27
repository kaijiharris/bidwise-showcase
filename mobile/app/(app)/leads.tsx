import { useMemo, useState } from 'react'
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { BookmarkPlus, Sparkles } from 'lucide-react-native'
import { LeadCard } from '@/components/LeadCard'
import { Screen } from '@/components/ui/Screen'
import { SkeletonList } from '@/components/ui/SkeletonCard'
import { useAuth } from '@/lib/auth-context'
import {
  addLeadToPipeline,
  fetchLeadPipelineEntries,
  fetchLeads,
  removeLeadFromPipeline,
} from '@/lib/leads-api'
import {
  EQUITY_TIER_LABELS,
  type EquityTier,
  type OffMarketLeadSummary,
} from '@/lib/types'
import { colors, withAlpha } from '@/theme/colors'

type EquityFilter = 'all' | EquityTier

const FILTER_OPTIONS: { value: EquityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'HIGH_EQUITY', label: EQUITY_TIER_LABELS.HIGH_EQUITY },
  { value: 'MED_EQUITY', label: EQUITY_TIER_LABELS.MED_EQUITY },
  { value: 'LOW_EQUITY', label: EQUITY_TIER_LABELS.LOW_EQUITY },
]

export default function LeadsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<EquityFilter>('all')
  const [county, setCounty] = useState<string | null>(null)
  const [city, setCity] = useState<string | null>(null)

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

  const rows = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data])

  // Distinct counties from the dataset (case-insensitive, sorted).
  const counties = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) {
      const c = (r.county ?? '').trim()
      if (c) seen.set(c.toLowerCase(), c)
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }, [rows])

  // Cities are scoped to the selected county when one is active.
  const cities = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) {
      if (county && (r.county ?? '').toLowerCase() !== county.toLowerCase()) continue
      const c = (r.city ?? '').trim()
      if (c) seen.set(c.toLowerCase(), c)
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }, [rows, county])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== 'all' && (r.equity_tier ?? 'UNKNOWN') !== filter) return false
      if (county && (r.county ?? '').toLowerCase() !== county.toLowerCase()) return false
      if (city && (r.city ?? '').toLowerCase() !== city.toLowerCase()) return false
      return true
    })
  }, [rows, filter, county, city])

  const activeFilterCount =
    (filter !== 'all' ? 1 : 0) + (county ? 1 : 0) + (city ? 1 : 0)

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
          Off-Market
        </Text>
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 30,
            color: colors.soft,
            letterSpacing: -1,
          }}
        >
          BidWise Leads.
        </Text>
      </View>

      <View style={{ paddingTop: 14, paddingBottom: 6, gap: 8 }}>
        <FilterRow label="Equity">
          {FILTER_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              active={opt.value === filter}
              onPress={() => setFilter(opt.value)}
            />
          ))}
        </FilterRow>
        {counties.length > 0 ? (
          <FilterRow label="County">
            <Chip
              label="All"
              active={county === null}
              onPress={() => {
                setCounty(null)
                setCity(null)
              }}
            />
            {counties.map((c) => (
              <Chip
                key={c}
                label={c}
                active={county?.toLowerCase() === c.toLowerCase()}
                onPress={() => {
                  setCounty(c)
                  setCity(null)
                }}
              />
            ))}
          </FilterRow>
        ) : null}
        {cities.length > 0 ? (
          <FilterRow label="City">
            <Chip label="All" active={city === null} onPress={() => setCity(null)} />
            {cities.map((c) => (
              <Chip
                key={c}
                label={c}
                active={city?.toLowerCase() === c.toLowerCase()}
                onPress={() => setCity(c)}
              />
            ))}
          </FilterRow>
        ) : null}
        {activeFilterCount > 0 ? (
          <View className="flex-row items-center justify-between" style={{ paddingTop: 2 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFilter('all')
                setCounty(null)
                setCity(null)
              }}
              hitSlop={6}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 10,
                  color: colors.brand.primary,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                }}
              >
                Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const search: Record<string, string> = { openModal: '1' }
                if (county) search.prefillCounty = county
                if (city) search.prefillCity = city
                if (filter !== 'all') search.prefillEquity = filter
                router.push({ pathname: '/(app)/watchlists', params: search } as never)
              }}
              hitSlop={6}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                backgroundColor: withAlpha(colors.brand.cyan, 0.16),
                borderWidth: 1,
                borderColor: colors.brand.cyan,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <BookmarkPlus size={11} color={colors.brand.cyan} strokeWidth={2} />
              <Text
                style={{
                  fontFamily: 'Inter_700Bold',
                  fontSize: 10,
                  color: colors.brand.cyan,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                }}
              >
                Save as Watchlist
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={leadsQuery.isRefetching}
            onRefresh={() => {
              leadsQuery.refetch()
              pipelineQuery.refetch()
            }}
            tintColor={colors.brand.primary}
          />
        }
        ListHeaderComponent={
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 11,
              color: colors.muted,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            {filtered.length} of {leadsQuery.data?.length ?? 0} leads
          </Text>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(280)}>
            <LeadCard
              lead={item}
              inPipeline={pipelineLeadIds.has(item.id)}
              pipelineLoading={toggleMut.isPending}
              onTogglePipeline={() => toggleMut.mutate(item)}
            />
          </Animated.View>
        )}
        ListEmptyComponent={
          leadsQuery.isLoading ? (
            <SkeletonList count={5} />
          ) : leadsQuery.isError ? (
            <View style={{ paddingVertical: 48, alignItems: 'center', gap: 8 }}>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 18,
                  color: colors.soft,
                }}
              >
                Couldn&rsquo;t load leads.
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
                {/* Raw DB errors and migration file paths are developer
                    breadcrumbs, not user copy — and this empty-by-default tab is
                    a screen App Review is likely to see. Detail stays in dev. */}
                {__DEV__
                  ? leadsQuery.error instanceof Error
                    ? leadsQuery.error.message
                    : String(leadsQuery.error)
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
                    paddingTop: 8,
                    lineHeight: 16,
                  }}
                >
                  DEV: if this mentions &ldquo;relation off_market_leads does not exist,&rdquo;
                  apply web/supabase/migrations/001_off_market_leads.sql in Supabase Studio.
                </Text>
              ) : null}
            </View>
          ) : (
            <View
              style={{ paddingVertical: 48, alignItems: 'center', gap: 10 }}
            >
              <Sparkles size={28} color={colors.muted} strokeWidth={1.5} />
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 17,
                  color: colors.soft,
                }}
              >
                No leads match this filter.
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  fontSize: 12,
                  color: colors.muted,
                  textAlign: 'center',
                  paddingHorizontal: 24,
                }}
              >
                Try a different equity tier, or upload a CSV from the web dashboard to bring in
                new leads.
              </Text>
            </View>
          )
        }
      />
    </Screen>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center" style={{ gap: 8 }}>
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          fontSize: 9,
          color: colors.muted,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          width: 50,
        }}
      >
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingRight: 16 }}
      >
        {children}
      </ScrollView>
    </View>
  )
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: active ? withAlpha(colors.brand.primary, 0.18) : colors.graphite,
        borderWidth: 1,
        borderColor: active ? colors.brand.primary : withAlpha(colors.slate, 0.3),
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
          color: active ? colors.brand.primary : colors.soft,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}
