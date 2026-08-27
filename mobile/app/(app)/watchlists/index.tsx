import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Mail, Plus, Trash2, X } from 'lucide-react-native'
import { Screen } from '@/components/ui/Screen'
import { SkeletonList } from '@/components/ui/SkeletonCard'
import { useAuth } from '@/lib/auth-context'
import {
  createWatchlist,
  deleteWatchlist,
  fetchLeads,
  fetchWatchlists,
  leadMatchesWatchlist,
  setWatchlistActive,
} from '@/lib/leads-api'
import {
  DEAL_TYPE_LABELS,
  type DealType,
  type EquityTier,
  type Watchlist,
  type WatchlistCriteria,
} from '@/lib/types'
import { colors, withAlpha } from '@/theme/colors'

const DEAL_TYPE_OPTIONS: { value: DealType | 'all'; label: string }[] = [
  { value: 'all', label: 'Any Strategy' },
  { value: 'wholesale', label: DEAL_TYPE_LABELS.wholesale },
  { value: 'flip', label: DEAL_TYPE_LABELS.flip },
  { value: 'rental', label: DEAL_TYPE_LABELS.rental },
  { value: 'distressed', label: DEAL_TYPE_LABELS.distressed },
]

// Preset equity buckets — picker, not free text. Keeps users from typing
// "fifty thousand" or "50,000.00" and breaking the criteria match.
const EQUITY_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: 10000, label: '$10k+' },
  { value: 30000, label: '$30k+' },
  { value: 50000, label: '$50k+' },
  { value: 100000, label: '$100k+' },
  { value: 200000, label: '$200k+' },
]

const SCORE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: 40, label: '40+' },
  { value: 60, label: '60+' },
  { value: 75, label: '75+' },
  { value: 85, label: '85+' },
]

// Search params accepted from the Leads tab "Save as Watchlist" affordance.
interface PrefillParams {
  prefillCounty?: string
  prefillCity?: string
  prefillEquity?: EquityTier
  openModal?: string
}

export default function WatchlistsScreen() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const queryClient = useQueryClient()
  const router = useRouter()
  const params = useLocalSearchParams() as unknown as PrefillParams
  const [showModal, setShowModal] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [county, setCounty] = useState<string | null>(null)
  const [minEquity, setMinEquity] = useState<number | null>(null)
  const [minScore, setMinScore] = useState<number | null>(60)
  const [dealType, setDealType] = useState<DealType | 'all'>('all')
  const [alertEmail, setAlertEmail] = useState(true)

  // Auto-open create modal with prefill from Leads tab.
  useEffect(() => {
    if (params.openModal === '1') {
      if (params.prefillCounty) setCounty(params.prefillCounty)
      if (params.prefillEquity === 'HIGH_EQUITY') setMinEquity(100000)
      else if (params.prefillEquity === 'MED_EQUITY') setMinEquity(30000)
      else if (params.prefillEquity === 'LOW_EQUITY') setMinEquity(null)
      setShowModal(true)
      router.setParams({ openModal: undefined })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.openModal])

  const watchlistsQuery = useQuery({
    queryKey: ['watchlists', userId],
    queryFn: () => (userId ? fetchWatchlists(userId) : Promise.resolve([])),
    enabled: !!userId,
  })

  // Pull leads once for client-side match counting. Cached + shared with the
  // Leads tab so this doesn't trigger an extra round-trip on tab switch.
  const leadsQuery = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
  })

  const matchCount = useMemo(() => {
    const out: Record<string, number> = {}
    const leads = leadsQuery.data ?? []
    for (const w of watchlistsQuery.data ?? []) {
      let n = 0
      for (const l of leads) if (leadMatchesWatchlist(l, w.criteria)) n++
      out[w.id] = n
    }
    return out
  }, [watchlistsQuery.data, leadsQuery.data])

  const createMut = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in')
      const criteria: WatchlistCriteria = {}
      if (county) criteria.counties = [county.toLowerCase()]
      if (minEquity != null) criteria.equity_min = minEquity
      if (minScore != null) criteria.min_deal_score = minScore
      if (dealType !== 'all') criteria.deal_types = [dealType]
      await createWatchlist(userId, {
        name: name.trim(),
        criteria,
        alert_email: alertEmail,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlists', userId] })
      setShowModal(false)
      setName('')
      setCounty(null)
      setMinEquity(null)
      setMinScore(60)
      setDealType('all')
      setAlertEmail(true)
    },
    onError: (err) => {
      Alert.alert(
        "Couldn't create watchlist",
        err instanceof Error ? err.message : String(err)
      )
    },
  })

  // Distinct counties from the lead dataset — the watchlist can only meaningfully
  // match counties that actually have leads. Same extraction pattern as leads.tsx.
  const availableCounties = useMemo(() => {
    const seen = new Map<string, string>()
    for (const lead of leadsQuery.data ?? []) {
      const c = (lead.county ?? '').trim()
      if (c) seen.set(c.toLowerCase(), c)
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }, [leadsQuery.data])

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setWatchlistActive(id, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlists', userId] }),
    onError: (err) => {
      Alert.alert(
        "Couldn't update watchlist",
        err instanceof Error ? err.message : String(err)
      )
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWatchlist(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlists', userId] }),
    onError: (err) => {
      Alert.alert(
        "Couldn't delete watchlist",
        err instanceof Error ? err.message : String(err)
      )
    },
  })

  const watchlists = watchlistsQuery.data ?? []

  return (
    <Screen edges={['top']}>
      <View className="flex-row items-end justify-between" style={{ paddingTop: 16 }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 11,
              color: colors.muted,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            Auto-Alerts
          </Text>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 30,
              color: colors.soft,
              letterSpacing: -1,
            }}
          >
            Watchlists.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowModal(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 14,
            paddingVertical: 9,
            borderRadius: 999,
            backgroundColor: colors.soft,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Plus size={13} color={colors.midnight} strokeWidth={2.5} />
          <Text
            style={{
              fontFamily: 'Inter_700Bold',
              fontSize: 11,
              color: colors.midnight,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
          >
            New
          </Text>
        </Pressable>
      </View>

      {watchlistsQuery.isLoading ? (
        <View style={{ paddingTop: 16 }}>
          <SkeletonList count={3} />
        </View>
      ) : watchlistsQuery.isError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color: colors.soft }}>
            Couldn&rsquo;t load watchlists.
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 12,
              color: colors.status.danger,
              textAlign: 'center',
            }}
          >
            {watchlistsQuery.error instanceof Error
              ? watchlistsQuery.error.message
              : String(watchlistsQuery.error)}
          </Text>
        </View>
      ) : watchlists.length === 0 ? (
        <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: withAlpha(colors.brand.cyan, 0.16),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Eye size={30} color={colors.brand.cyan} strokeWidth={1.75} />
          </View>
          <Text
            style={{
              marginTop: 18,
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 22,
              color: colors.soft,
              textAlign: 'center',
              letterSpacing: -0.5,
            }}
          >
            No watchlists yet.
          </Text>
          <Text
            style={{
              marginTop: 10,
              fontFamily: 'Inter_400Regular',
              fontSize: 14,
              color: colors.muted,
              textAlign: 'center',
              paddingHorizontal: 16,
              lineHeight: 20,
            }}
          >
            Save criteria once. Get alerted when a new off-market lead matches your exact shape.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={() => setShowModal(true)}
            style={{
              marginTop: 28,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 28,
              paddingVertical: 16,
              borderRadius: 999,
              backgroundColor: colors.brand.cyan,
            }}
          >
            <Plus size={18} color={colors.midnight} strokeWidth={3} />
            <Text
              style={{
                marginLeft: 10,
                fontFamily: 'Inter_700Bold',
                fontSize: 14,
                color: colors.midnight,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
              }}
            >
              Create Your First Watchlist
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={watchlists}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={watchlistsQuery.isRefetching}
              onRefresh={() => {
                watchlistsQuery.refetch()
                leadsQuery.refetch()
              }}
              tintColor={colors.brand.cyan}
            />
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(280)}>
              <WatchlistCard
                watchlist={item}
                matchCount={matchCount[item.id] ?? 0}
                onView={() =>
                  router.push(`/(app)/watchlists/${encodeURIComponent(item.id)}` as never)
                }
                onToggle={() =>
                  toggleMut.mutate({ id: item.id, isActive: !item.is_active })
                }
                onDelete={() =>
                  Alert.alert('Delete watchlist?', item.name, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => deleteMut.mutate(item.id),
                    },
                  ])
                }
                mutating={toggleMut.isPending || deleteMut.isPending}
              />
            </Animated.View>
          )}
      />
      )}

      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <Pressable
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: withAlpha(colors.midnight, 0.7),
            }}
            onPress={() => setShowModal(false)}
          />
          <View
            style={{
              backgroundColor: colors.midnight,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTopWidth: 1,
              borderColor: withAlpha(colors.brand.cyan, 0.2),
              maxHeight: '90%',
            }}
          >
            <View
              className="flex-row items-center justify-between"
              style={{
                paddingHorizontal: 20,
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderBottomColor: withAlpha(colors.slate, 0.15),
              }}
            >
              <View className="flex-row items-center gap-2">
                <Eye size={16} color={colors.brand.cyan} strokeWidth={2} />
                <Text
                  style={{
                    fontFamily: 'SpaceGrotesk_700Bold',
                    fontSize: 16,
                    color: colors.soft,
                    letterSpacing: -0.3,
                  }}
                >
                  Create Watchlist
                </Text>
              </View>
              <Pressable
                onPress={() => setShowModal(false)}
                hitSlop={8}
                accessibilityRole="button"
              >
                <X size={20} color={colors.muted} strokeWidth={2} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 18, gap: 18 }}
              keyboardShouldPersistTaps="handled"
            >
              <Field label="Watchlist Name">
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. High Equity DeKalb"
                  placeholderTextColor={colors.dim}
                  style={fieldStyle}
                />
              </Field>

              <Field label="Target County">
                {availableCounties.length === 0 ? (
                  <Text
                    style={{
                      fontFamily: 'Inter_400Regular',
                      fontSize: 11,
                      color: colors.muted,
                      paddingVertical: 8,
                    }}
                  >
                    No counties available yet. Upload leads from the web dashboard first.
                  </Text>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6, paddingRight: 16 }}
                    keyboardShouldPersistTaps="handled"
                  >
                    <PickerChip
                      label="Any"
                      active={county === null}
                      onPress={() => setCounty(null)}
                    />
                    {availableCounties.map((c) => (
                      <PickerChip
                        key={c}
                        label={c}
                        active={county?.toLowerCase() === c.toLowerCase()}
                        onPress={() => setCounty(c)}
                      />
                    ))}
                  </ScrollView>
                )}
              </Field>

              <Field label="Min. Equity">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, paddingRight: 16 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {EQUITY_OPTIONS.map((opt) => (
                    <PickerChip
                      key={opt.label}
                      label={opt.label}
                      active={minEquity === opt.value}
                      onPress={() => setMinEquity(opt.value)}
                    />
                  ))}
                </ScrollView>
              </Field>

              <Field label="Min. Deal Score">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, paddingRight: 16 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {SCORE_OPTIONS.map((opt) => (
                    <PickerChip
                      key={opt.label}
                      label={opt.label}
                      active={minScore === opt.value}
                      onPress={() => setMinScore(opt.value)}
                    />
                  ))}
                </ScrollView>
              </Field>

              <Field label="Deal Strategy">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, paddingRight: 16 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {DEAL_TYPE_OPTIONS.map((opt) => (
                    <PickerChip
                      key={opt.value}
                      label={opt.label}
                      active={dealType === opt.value}
                      onPress={() => setDealType(opt.value)}
                    />
                  ))}
                </ScrollView>
              </Field>

              <View
                className="flex-row items-center justify-between"
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  backgroundColor: colors.navy,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: withAlpha(colors.slate, 0.2),
                }}
              >
                <View className="flex-row items-center gap-2" style={{ flex: 1 }}>
                  <Mail size={14} color={colors.brand.cyan} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: 'Inter_600SemiBold',
                        fontSize: 13,
                        color: colors.soft,
                      }}
                    >
                      Email alerts on match
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Inter_400Regular',
                        fontSize: 10,
                        color: colors.muted,
                        marginTop: 2,
                      }}
                    >
                      Get an email when new leads match
                    </Text>
                  </View>
                </View>
                <Switch
                  value={alertEmail}
                  onValueChange={setAlertEmail}
                  trackColor={{ false: colors.graphite, true: colors.brand.primary }}
                  thumbColor={alertEmail ? colors.brand.cyan : colors.soft}
                />
              </View>
            </ScrollView>

            <View
              className="flex-row"
              style={{
                paddingHorizontal: 20,
                paddingVertical: 14,
                gap: 10,
                borderTopWidth: 1,
                borderTopColor: withAlpha(colors.slate, 0.15),
                paddingBottom: Platform.OS === 'ios' ? 32 : 14,
              }}
            >
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.85}
                onPress={() => setShowModal(false)}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.graphite,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    fontSize: 12,
                    color: colors.soft,
                    letterSpacing: 0.4,
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.85}
                onPress={() => createMut.mutate()}
                disabled={!name.trim() || createMut.isPending}
                style={{
                  flex: 2,
                  paddingVertical: 14,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.brand.cyan,
                  opacity: !name.trim() || createMut.isPending ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_700Bold',
                    fontSize: 12,
                    color: colors.midnight,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                  }}
                >
                  {createMut.isPending ? 'Creating…' : 'Create Watchlist'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  )
}

function WatchlistCard({
  watchlist,
  matchCount,
  onView,
  onToggle,
  onDelete,
  mutating,
}: {
  watchlist: Watchlist
  matchCount: number
  onView: () => void
  onToggle: () => void
  onDelete: () => void
  mutating: boolean
}) {
  const c = watchlist.criteria
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onView}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <View
        style={{
          backgroundColor: colors.navy,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: withAlpha(colors.slate, 0.2),
          padding: 14,
          gap: 12,
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

        <View className="flex-row items-start justify-between" style={{ paddingLeft: 6 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 16,
                color: colors.soft,
                letterSpacing: -0.3,
              }}
            >
              {watchlist.name}
            </Text>
            <View className="flex-row items-center gap-2">
              <View className="flex-row items-center gap-1">
                <Mail size={10} color={colors.muted} strokeWidth={2} />
                <Text
                  style={{
                    fontFamily: 'Inter_500Medium',
                    fontSize: 10,
                    color: colors.muted,
                  }}
                >
                  {watchlist.alert_email ? 'Email on' : 'Silent'}
                </Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 999,
                  backgroundColor: watchlist.is_active
                    ? withAlpha(colors.brand.cyan, 0.16)
                    : withAlpha(colors.slate, 0.18),
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_700Bold',
                    fontSize: 9,
                    color: watchlist.is_active ? colors.brand.cyan : colors.muted,
                    letterSpacing: 0.8,
                  }}
                >
                  {watchlist.is_active ? 'ACTIVE' : 'PAUSED'}
                </Text>
              </View>
            </View>
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
              {matchCount}
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

        <View style={{ paddingLeft: 6, gap: 4 }}>
          <CriteriaRow label="Target County" value={c.counties?.[0] ?? 'Any'} />
          <CriteriaRow
            label="Min. Equity"
            value={c.equity_min != null ? `$${c.equity_min.toLocaleString()}` : 'Any'}
          />
          <CriteriaRow label="Min. Deal Score" value={c.min_deal_score?.toString() ?? 'Any'} />
          <CriteriaRow
            label="Deal Strategy"
            value={c.deal_types?.[0] ? DEAL_TYPE_LABELS[c.deal_types[0] as DealType] : 'Any'}
          />
        </View>

        <View
          className="flex-row"
          style={{
            gap: 8,
            paddingLeft: 6,
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: withAlpha(colors.slate, 0.15),
          }}
        >
          <Pressable
            accessibilityRole="button"
            disabled={mutating}
            onPress={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 8,
              borderRadius: 10,
              alignItems: 'center',
              backgroundColor: colors.graphite,
              opacity: pressed || mutating ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 11,
                color: colors.soft,
                letterSpacing: 0.4,
              }}
            >
              {watchlist.is_active ? 'Pause Alerts' : 'Resume Alerts'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={mutating}
            onPress={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            hitSlop={6}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: withAlpha(colors.status.danger, 0.18),
              borderWidth: 1,
              borderColor: withAlpha(colors.status.danger, 0.4),
              opacity: pressed || mutating ? 0.7 : 1,
            })}
          >
            <Trash2 size={14} color={colors.status.danger} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  )
}

function CriteriaRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between" style={{ paddingVertical: 3 }}>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.muted }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_600SemiBold',
          fontSize: 12,
          color: colors.soft,
          textTransform: 'capitalize',
          maxWidth: '60%',
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

function PickerChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.8}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? colors.brand.cyan : withAlpha(colors.slate, 0.3),
        backgroundColor: active ? withAlpha(colors.brand.cyan, 0.16) : colors.navy,
      }}
    >
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
          color: active ? colors.brand.cyan : colors.soft,
          textTransform: 'capitalize',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={{
          fontFamily: 'Inter_700Bold',
          fontSize: 9,
          color: colors.muted,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  )
}

const fieldStyle = {
  backgroundColor: colors.navy,
  borderWidth: 1,
  borderColor: withAlpha(colors.slate, 0.3),
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: colors.soft,
  fontFamily: 'Inter_500Medium',
  fontSize: 13,
} as const
