import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { BlurView } from 'expo-blur'
import * as Haptics from 'expo-haptics'
import { Check, ChevronDown, Lock, SlidersHorizontal } from 'lucide-react-native'
import { DealCard } from '@/components/DealCard'
import { SkeletonList } from '@/components/ui/SkeletonCard'
import { FilterSheet } from '@/components/FilterSheet'
import { Screen } from '@/components/ui/Screen'
import { FinancialDisclaimer } from '@/components/ui/FinancialDisclaimer'
import { DataFreshness } from '@/components/ui/DataFreshness'
import { useAuth } from '@/lib/auth-context'
import { fetchAuctionIndex, fetchAuctionProperties, DealsFetchError } from '@/lib/auction-api'
import {
  COUNTIES,
  DEFAULT_FILTER,
  type County,
  type FeedFilter,
  type NormalizedProperty,
  type SortField,
} from '@/lib/types'
import { isScoreUnknown, isTopDeal } from '@/lib/normalize'
import { daysUntil, formatCompactCurrency, formatPercent } from '@/lib/format'
import { colors, withAlpha } from '@/theme/colors'

type Section = 'dashboard' | 'top-deals' | 'analytics'

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'top-deals', label: 'Top Deals' },
  { key: 'analytics', label: 'Analytics' },
]

export default function FeedScreen() {
  const router = useRouter()
  const { hasActiveAccess } = useAuth()
  const [countySlug, setCountySlug] = useState<County['slug']>('dekalb')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('dashboard')
  const [filter, setFilter] = useState<FeedFilter>(DEFAULT_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  const [countyPickerOpen, setCountyPickerOpen] = useState(false)

  const county = useMemo(
    () => COUNTIES.find((c) => c.slug === countySlug) ?? COUNTIES[0],
    [countySlug]
  )

  // Reset selectedFile when county changes so we re-pick the most recent auction.
  useEffect(() => {
    setSelectedFile(null)
  }, [countySlug])

  const indexQuery = useQuery({
    queryKey: ['auction-index', countySlug],
    queryFn: () => fetchAuctionIndex(countySlug),
  })

  // Auto-select most recent auction once the index lands.
  useEffect(() => {
    if (!selectedFile && indexQuery.data && indexQuery.data.length > 0) {
      setSelectedFile(indexQuery.data[0].file)
    }
  }, [indexQuery.data, selectedFile])

  const fileToLoad = selectedFile ?? county.dataFile

  const dataQuery = useQuery({
    queryKey: ['auction', countySlug, fileToLoad],
    queryFn: () => fetchAuctionProperties({ file: fileToLoad, county: countySlug }),
    enabled: !!fileToLoad,
  })

  const allProps = useMemo(() => dataQuery.data?.props ?? [], [dataQuery.data?.props])

  const cities = useMemo(() => {
    const set = new Set<string>()
    for (const p of allProps) if (p.city) set.add(p.city)
    return Array.from(set).sort()
  }, [allProps])

  const filtered = useMemo(() => {
    let arr = allProps
    if (filter.propType !== 'all') {
      arr = arr.filter((p) => p.propType === filter.propType)
    }
    if (filter.city) {
      arr = arr.filter((p) => p.city === filter.city)
    }
    if (filter.search.trim()) {
      const q = filter.search.trim().toLowerCase()
      arr = arr.filter((p) => p.addr.toLowerCase().includes(q))
    }
    if (section === 'top-deals') {
      // Pipeline-stamped verdict (ROI >= 100 + confidence gate — see
      // execution/utils/top_deals.py). The fallback approximates the gate on
      // unstamped archive data with the fields the client receives.
      arr = arr.filter(isTopDeal)
    }
    return [...arr].sort((a, b) => {
      const av = sortValue(a, filter.sortField)
      const bv = sortValue(b, filter.sortField)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return (av - bv) * filter.sortDir
    })
  }, [allProps, filter, section])

  const activeFilterCount =
    (filter.propType !== 'all' ? 1 : 0) +
    (filter.city ? 1 : 0) +
    (filter.search.trim() ? 1 : 0) +
    (filter.sortField !== 'roi' || filter.sortDir !== -1 ? 1 : 0)

  return (
    <Screen edges={['top']}>
      {/* County picker + filter */}
      <View
        className="flex-row items-center justify-between"
        style={{ paddingTop: 12, paddingBottom: 8 }}
      >
        <Pressable
          onPress={() => setCountyPickerOpen(true)}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 4,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View style={{ gap: 2 }}>
            <Text
              style={{
                fontFamily: 'Inter_500Medium',
                fontSize: 10,
                color: colors.muted,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              County
            </Text>
            <View className="flex-row items-center gap-1">
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 22,
                  color: colors.soft,
                  letterSpacing: -0.5,
                }}
              >
                {county.name}
              </Text>
              <ChevronDown size={18} color={colors.muted} strokeWidth={2} />
            </View>
          </View>
        </Pressable>

        <Pressable
          onPress={() => setFilterOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: activeFilterCount > 0 ? withAlpha(colors.brand.primary, 0.18) : colors.graphite,
            borderWidth: 1,
            borderColor: activeFilterCount > 0 ? colors.brand.primary : withAlpha(colors.slate, 0.3),
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <SlidersHorizontal
            size={14}
            color={activeFilterCount > 0 ? colors.brand.primary : colors.soft}
            strokeWidth={2}
          />
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 12,
              color: activeFilterCount > 0 ? colors.brand.primary : colors.soft,
            }}
          >
            Filter{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </Text>
        </Pressable>
      </View>

      {/* Auction date chips */}
      {(indexQuery.data?.length ?? 0) > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
        >
          {indexQuery.data!.map((a) => {
            const isActive = a.file === fileToLoad
            return (
              <Pressable
                key={a.file}
                accessibilityRole="button"
                onPress={() => {
                  Haptics.selectionAsync()
                  setSelectedFile(a.file)
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: isActive ? withAlpha(colors.brand.primary, 0.18) : colors.graphite,
                  borderWidth: 1,
                  borderColor: isActive ? colors.brand.primary : withAlpha(colors.slate, 0.3),
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_500Medium',
                    fontSize: 12,
                    color: isActive ? colors.brand.primary : colors.soft,
                  }}
                >
                  {a.label}
                  {(() => {
                    // Future dates only. Past/today render nothing — a countdown
                    // on an ended sale (Cobb) would imply it is still live.
                    const d = daysUntil(a.auction_date)
                    return d != null && d > 0 ? (
                      <Text
                        style={{
                          fontFamily: 'Inter_600SemiBold',
                          fontSize: 10,
                          color: colors.brand.cyan,
                        }}
                      >
                        {`  · IN ${d}D`}
                      </Text>
                    ) : null
                  })()}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Inter_400Regular',
                    fontSize: 10,
                    color: colors.muted,
                  }}
                >
                  {a.total_properties} deals
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}

      {/* Section segments */}
      <View className="flex-row" style={{ gap: 6, paddingVertical: 10 }}>
        {SECTIONS.map((s) => {
          const active = s.key === section
          return (
            <Pressable
              key={s.key}
              accessibilityRole="button"
              onPress={() => {
                Haptics.selectionAsync()
                setSection(s.key)
              }}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 8,
                borderRadius: 12,
                backgroundColor: active ? colors.navy : 'transparent',
                borderWidth: 1,
                borderColor: active ? colors.brand.primary : withAlpha(colors.slate, 0.25),
                alignItems: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 11,
                  color: active ? colors.brand.primary : colors.muted,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                }}
              >
                {s.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {section === 'analytics' ? (
        <ScrollView
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 32, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={dataQuery.isRefetching}
              onRefresh={() => dataQuery.refetch()}
              tintColor={colors.brand.primary}
            />
          }
        >
          {dataQuery.isError ? (
            <EmptyState title="Couldn’t load analytics." body={errorBody(dataQuery.error)} />
          ) : dataQuery.isLoading ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator color={colors.brand.primary} />
            </View>
          ) : !hasActiveAccess ? (
            // Locked users used to see the REAL Analytics component fed masked
            // rows: Avg ROI "—", "$0" total profit, an all-zero histogram. That
            // is an anti-sell that reads as broken — and it is the screen a
            // review account hits. Mirror the locked-card idiom instead.
            <View style={{ borderRadius: 16, overflow: 'hidden', minHeight: 320 }}>
              <Analytics props={allProps} />
              <BlurView
                intensity={28}
                tint="dark"
                style={{
                  position: 'absolute',
                  inset: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    Haptics.selectionAsync()
                    router.push('/paywall')
                  }}
                  className="flex-row items-center gap-2 rounded-pill"
                  style={{
                    backgroundColor: withAlpha(colors.brand.primary, 0.22),
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                  }}
                >
                  <Lock size={12} color={colors.brand.primary} strokeWidth={2.5} />
                  <Text
                    style={{
                      fontFamily: 'Inter_600SemiBold',
                      fontSize: 12,
                      color: colors.brand.primary,
                      letterSpacing: 0.8,
                    }}
                  >
                    UPGRADE TO UNLOCK
                  </Text>
                </Pressable>
                <Text
                  style={{
                    fontFamily: 'Inter_400Regular',
                    fontSize: 12,
                    color: colors.soft,
                    textAlign: 'center',
                    paddingHorizontal: 40,
                    lineHeight: 17,
                  }}
                >
                  County-level ROI, profit totals, and score distribution for every analyzed
                  parcel.
                </Text>
              </BlurView>
            </View>
          ) : (
            <Analytics props={allProps} />
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => `${item.county}-${item.id}-${item.taxId || ''}`}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={dataQuery.isRefetching}
              onRefresh={() => dataQuery.refetch()}
              tintColor={colors.brand.primary}
            />
          }
          ListHeaderComponent={
            <View style={{ marginBottom: 12, gap: 4 }}>
              <Text
                style={{
                  fontFamily: 'Inter_500Medium',
                  fontSize: 11,
                  color: colors.muted,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                }}
              >
                {filtered.length} of {allProps.length} {section === 'top-deals' ? '(ROI ≥ 100%)' : 'deals'}
              </Text>
              <DataFreshness generated={dataQuery.data?.meta.generated} />
            </View>
          }
          ListFooterComponent={
            filtered.length > 0 ? (
              <View style={{ paddingTop: 16 }}>
                <FinancialDisclaimer />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <DealCard
              property={item}
              county={countySlug}
              locked={!hasActiveAccess}
              file={fileToLoad}
              // Dashboard only: in the Top Deals tab every card qualifies, so
              // the badge would be noise there.
              topDeal={section === 'dashboard' && isTopDeal(item)}
            />
          )}
          ListEmptyComponent={
            dataQuery.isLoading ? (
              // Skeletons over a bare spinner: same component the pipeline,
              // leads, and watchlist screens already ship, and it kills the
              // layout jump when the cards land.
              <SkeletonList count={5} />
            ) : dataQuery.isError ? (
              <EmptyState title="Couldn’t load deals." body={errorBody(dataQuery.error)} />
            ) : (
              <EmptyState
                title="No deals match."
                body="Loosen your filters or pick a different auction."
              />
            )
          }
        />
      )}

      {/* County picker modal */}
      <Modal
        visible={countyPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCountyPickerOpen(false)}
        statusBarTranslucent
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'flex-end',
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setCountyPickerOpen(false)} />
          <View
            style={{
              backgroundColor: colors.navy,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 24,
              paddingBottom: 36,
              gap: 12,
              borderTopWidth: 1,
              borderColor: withAlpha(colors.slate, 0.25),
            }}
          >
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                alignSelf: 'center',
                backgroundColor: colors.slate,
                opacity: 0.5,
                marginBottom: 6,
              }}
            />
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 22,
                color: colors.soft,
                letterSpacing: -0.5,
              }}
            >
              Pick a county.
            </Text>
            {COUNTIES.map((c) => {
              const isActive = c.slug === countySlug
              return (
                <Pressable
                  key={c.slug}
                  accessibilityRole="button"
                  onPress={() => {
                    Haptics.selectionAsync()
                    setCountySlug(c.slug)
                    setCountyPickerOpen(false)
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: isActive ? withAlpha(colors.brand.primary, 0.12) : colors.graphite,
                    borderRadius: 14,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: isActive ? colors.brand.primary : withAlpha(colors.slate, 0.25),
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View style={{ gap: 2 }}>
                    <Text
                      style={{
                        fontFamily: 'SpaceGrotesk_600SemiBold',
                        fontSize: 16,
                        color: colors.soft,
                      }}
                    >
                      {c.name}
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Inter_400Regular',
                        fontSize: 11,
                        color: colors.muted,
                      }}
                    >
                      {c.auctionType} · {c.state}
                    </Text>
                  </View>
                  {isActive ? (
                    <Check size={18} color={colors.brand.primary} strokeWidth={2.5} />
                  ) : null}
                </Pressable>
              )
            })}
          </View>
        </View>
      </Modal>

      <FilterSheet
        visible={filterOpen}
        initial={filter}
        cities={cities}
        onApply={(f) => {
          setFilter(f)
          setFilterOpen(false)
        }}
        onClose={() => setFilterOpen(false)}
      />
    </Screen>
  )
}

function sortValue(p: NormalizedProperty, field: SortField): number | null {
  switch (field) {
    case 'roi':
      return p.roi
    case 'score':
      return isScoreUnknown(p) ? null : p.score
    case 'profit':
      return p.profit
    case 'taxDue':
      return p.taxDue
  }
}

function Analytics({ props }: { props: NormalizedProperty[] }) {
  const total = props.length
  const scoreable = props.filter((p) => !isScoreUnknown(p))
  const avgScore =
    scoreable.length > 0
      ? scoreable.reduce((s, p) => s + (p.score ?? 0), 0) / scoreable.length
      : null
  const withRoi = props.filter((p) => p.roi != null)
  const avgRoi =
    withRoi.length > 0 ? withRoi.reduce((s, p) => s + (p.roi ?? 0), 0) / withRoi.length : null
  const totalProfit = props.reduce((s, p) => s + (p.profit ?? 0), 0)

  const roiBuckets = [
    { label: '< 50%', range: [-Infinity, 50], color: colors.status.danger },
    { label: '50–100%', range: [50, 100], color: colors.status.warning },
    { label: '100–200%', range: [100, 200], color: colors.brand.primary },
    { label: '200–300%', range: [200, 300], color: colors.brand.cyan },
    { label: '300%+', range: [300, Infinity], color: colors.brand.cyan },
  ]
  const buckets = roiBuckets.map((b) => ({
    ...b,
    count: props.filter(
      (p) => p.roi != null && p.roi >= b.range[0] && p.roi < b.range[1]
    ).length,
  }))
  const max = Math.max(1, ...buckets.map((b) => b.count))

  const typeCounts: Record<string, number> = {}
  for (const p of props) typeCounts[p.propType] = (typeCounts[p.propType] ?? 0) + 1

  return (
    <View style={{ gap: 12 }}>
      <View className="flex-row gap-2">
        <StatCard label="Total deals" value={total.toString()} />
        <StatCard
          label="Avg ROI"
          value={avgRoi != null ? formatPercent(avgRoi) : '—'}
          accent
        />
        <StatCard
          label="Avg score"
          value={avgScore != null ? Math.round(avgScore).toString() : '—'}
        />
      </View>
      <View
        style={{
          backgroundColor: colors.navy,
          borderRadius: 16,
          padding: 14,
          borderWidth: 1,
          borderColor: withAlpha(colors.slate, 0.2),
          gap: 10,
        }}
      >
        <View className="flex-row items-center justify-between">
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              fontSize: 10,
              color: colors.muted,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            Total est. profit
          </Text>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 20,
              color: colors.brand.cyan,
              fontVariant: ['tabular-nums'],
              letterSpacing: -0.5,
            }}
          >
            {formatCompactCurrency(totalProfit)}
          </Text>
        </View>
      </View>

      <View
        style={{
          backgroundColor: colors.navy,
          borderRadius: 16,
          padding: 14,
          borderWidth: 1,
          borderColor: withAlpha(colors.slate, 0.2),
          gap: 12,
        }}
      >
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            fontSize: 10,
            color: colors.muted,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          ROI distribution
        </Text>
        {buckets.map((b) => (
          <View key={b.label} style={{ gap: 4 }}>
            <View className="flex-row items-center justify-between">
              <Text
                style={{ fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.soft }}
              >
                {b.label}
              </Text>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_600SemiBold',
                  fontSize: 12,
                  color: colors.muted,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {b.count}
              </Text>
            </View>
            <View
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: withAlpha(colors.slate, 0.15),
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${(b.count / max) * 100}%`,
                  height: '100%',
                  backgroundColor: b.color,
                }}
              />
            </View>
          </View>
        ))}
      </View>

      <View
        style={{
          backgroundColor: colors.navy,
          borderRadius: 16,
          padding: 14,
          borderWidth: 1,
          borderColor: withAlpha(colors.slate, 0.2),
          gap: 8,
        }}
      >
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            fontSize: 10,
            color: colors.muted,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          By property type
        </Text>
        {Object.entries(typeCounts).map(([type, count]) => (
          <View key={type} className="flex-row items-center justify-between">
            <Text
              style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.soft }}
            >
              {type}
            </Text>
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_600SemiBold',
                fontSize: 13,
                color: colors.muted,
                fontVariant: ['tabular-nums'],
              }}
            >
              {count}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.navy,
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: withAlpha(colors.slate, 0.2),
        gap: 4,
      }}
    >
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          fontSize: 9,
          color: colors.muted,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 18,
          color: accent ? colors.brand.cyan : colors.soft,
          letterSpacing: -0.5,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
    </View>
  )
}

// Turn a query error into a short, user-safe sentence. DealsFetchError already
// carries a friendly `message` (technical context lives in `.detail`, for logs
// only); anything else falls back to a generic retry hint so a raw parser or
// network string never reaches the UI.
const FALLBACK_ERROR_BODY = 'Check your connection and pull down to retry.'
function errorBody(error: unknown): string {
  if (error instanceof DealsFetchError) return error.message
  return FALLBACK_ERROR_BODY
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ paddingVertical: 64, alignItems: 'center', gap: 8 }}>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 18,
          color: colors.soft,
          letterSpacing: -0.3,
        }}
      >
        {title}
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
        {body}
      </Text>
    </View>
  )
}
