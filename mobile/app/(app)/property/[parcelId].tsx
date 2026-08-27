import { useEffect, useMemo } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  ChevronLeft,
  ExternalLink,
  FileSearch,
  Gavel,
  Home,
  Leaf,
  MapPin,
} from 'lucide-react-native'
import { ScoreBadge } from '@/components/ScoreBadge'
import { Screen } from '@/components/ui/Screen'
import { GradientButton } from '@/components/ui/GradientButton'
import { useAuth } from '@/lib/auth-context'
import { track } from '@/lib/analytics'
import { fetchAuctionProperties } from '@/lib/auction-api'
import { addToPipeline, fetchPipeline } from '@/lib/pipeline-api'
import * as Haptics from 'expo-haptics'
import { daysUntil, formatCurrency, formatDate, formatPercent } from '@/lib/format'
import { isScoreUnknown } from '@/lib/normalize'
import { FinancialDisclaimer } from '@/components/ui/FinancialDisclaimer'
import { DataFreshness } from '@/components/ui/DataFreshness'
import type { County, NormalizedProperty, PropType } from '@/lib/types'
import { colors, withAlpha } from '@/theme/colors'

// ─── External URL builders (ported from web/app/dashboard/PropertyDetailPanel.tsx) ──

function buildZillowUrl(p: NormalizedProperty): string {
  if (p.zillowUrl) return p.zillowUrl
  const base = p.assessorAddress || p.addr
  if (/\b[A-Z]{2}\b/.test(base) && base.length > p.addr.length) {
    return `https://www.zillow.com/homes/${encodeURIComponent(base)}_rb/`
  }
  const parts: string[] = [p.addr]
  if (p.city) parts.push(p.city)
  parts.push('GA')
  if (p.zip) parts.push(p.zip)
  return `https://www.zillow.com/homes/${encodeURIComponent(parts.join(', '))}_rb/`
}

function buildStreetViewUrl(p: NormalizedProperty): string {
  const query = encodeURIComponent(
    p.assessorAddress ||
      [p.addr, p.city, 'GA', p.zip].filter(Boolean).join(', ')
  )
  return `https://www.google.com/maps/search/?api=1&query=${query}`
}

function buildParcelSearchUrl(p: NormalizedProperty): string {
  const id = encodeURIComponent(p.taxId || p.addr)
  const county = (p.county || '').toLowerCase()
  if (county.includes('gwinnett'))
    return `https://qpublic.net/ga/gwinnett/search.html?keywords=${id}`
  if (county.includes('dekalb'))
    return `https://qpublic.schneidercorp.com/Application.aspx?AppID=994&LayerID=20990&PageTypeID=4&PageID=9022&KeyValue=${id}`
  if (county.includes('cobb'))
    return `https://qpublic.net/ga/cobb/search.html?keywords=${id}`
  return `https://www.google.com/search?q=${encodeURIComponent(
    `${p.taxId} ${p.county} County GA parcel`
  )}`
}

function hasHouseNumber(addr: string): boolean {
  return /^\d/.test(addr.trim())
}

const TYPE_TINT: Record<PropType, { fg: string; bg: string; Icon: typeof Home }> = {
  SFR: { fg: '#74C8FF', bg: withAlpha(colors.status.warning, 0.15), Icon: Home },
  'Vacant Land': { fg: '#2DE2FF', bg: withAlpha(colors.brand.cyan, 0.15), Icon: Leaf },
  Commercial: { fg: '#386BFF', bg: withAlpha(colors.status.danger, 0.18), Icon: Building2 },
  'Multi-Family': { fg: '#10A7FF', bg: withAlpha(colors.brand.primary, 0.15), Icon: Building2 },
  Unknown: { fg: '#94A3B8', bg: withAlpha(colors.muted, 0.15), Icon: Home },
}

export default function PropertyDetailScreen() {
  const params = useLocalSearchParams<{
    parcelId: string
    county: string
    id?: string
    file?: string
  }>()
  const router = useRouter()
  const { user, hasActiveAccess } = useAuth()
  const userId = user?.id ?? null
  const queryClient = useQueryClient()

  const countySlug = (params.county || 'dekalb') as County['slug']
  const file = params.file || `/data/${countySlug}.json`
  const idHint = params.id ? Number(params.id) : null

  const dataQuery = useQuery({
    queryKey: ['auction', countySlug, file],
    queryFn: () => fetchAuctionProperties({ file, county: countySlug }),
  })

  const pipelineQuery = useQuery({
    queryKey: ['pipeline', userId],
    queryFn: () => (userId ? fetchPipeline(userId) : Promise.resolve([])),
    enabled: !!userId,
  })

  const property = useMemo<NormalizedProperty | null>(() => {
    if (!dataQuery.data) return null
    const all = dataQuery.data.props

    // taxId FIRST. `id` is only a positional index within whichever file was
    // loaded (normalize.ts assigns `i + 1`), so matching on it before the stable
    // parcel identity silently returns a DIFFERENT property whenever the loaded
    // dataset isn't the one the card came from — wrong address, wrong ARV, wrong
    // max bid, and "Add to pipeline" persisting the wrong parcel.
    const byTaxId = all.find((p) => p.taxId && p.taxId === params.parcelId)
    if (byTaxId) return byTaxId

    // Positional fallback, only for datasets whose rows carry no taxId. Callers
    // now pin `file` (see DealCard), so this resolves within the intended file.
    if (idHint != null) {
      const byId = all.find((p) => p.id === idHint)
      if (byId) return byId
    }
    return null
  }, [dataQuery.data, idHint, params.parcelId])

  const alreadyInPipeline = useMemo(() => {
    if (!property || !pipelineQuery.data) return false
    const pid = property.taxId || `${property.county}-${property.id}`
    return pipelineQuery.data.some((d) => d.parcel_id === pid)
  }, [pipelineQuery.data, property])

  // Fire once per opened deal. No-ops when analytics is disabled.
  useEffect(() => {
    if (property) {
      track('deal_viewed', { county: countySlug, parcelId: property.taxId || null })
    }
  }, [property, countySlug])

  const addMut = useMutation({
    mutationFn: () => {
      if (!userId || !property) throw new Error('Not ready')
      return addToPipeline(userId, property)
    },
    onSuccess: () => {
      // The add-to-pipeline moment is the app's core "I decided" action — give
      // it a success haptic payoff. No-ops on hardware without an engine.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      queryClient.invalidateQueries({ queryKey: ['pipeline', userId] })
    },
    onError: (err) => {
      Alert.alert(
        "Couldn't add to pipeline",
        err instanceof Error ? err.message : String(err),
        [{ text: 'OK' }]
      )
    },
  })

  if (dataQuery.isLoading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      </Screen>
    )
  }

  if (dataQuery.isError || !property) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, color: colors.soft }}>
            Couldn&rsquo;t load deal.
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text
              style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.brand.primary }}
            >
              Go back
            </Text>
          </Pressable>
        </View>
      </Screen>
    )
  }

  const p = property
  const tint = TYPE_TINT[p.propType]
  const TypeIcon = tint.Icon
  const subtitle = [p.city, p.zip ? `GA ${p.zip}` : null, p.county ? `${p.county} County` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <Screen edges={['top']}>
      {/* Top bar */}
      <View
        className="flex-row items-center justify-between"
        style={{ paddingVertical: 12 }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          className="flex-row items-center gap-1"
        >
          <ChevronLeft size={22} color={colors.muted} strokeWidth={1.75} />
          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.muted }}>
            Back
          </Text>
        </Pressable>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Address header */}
        <View style={{ gap: 8 }}>
          <View
            className="flex-row items-center gap-1 rounded-pill"
            style={{
              alignSelf: 'flex-start',
              backgroundColor: tint.bg,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <TypeIcon size={11} color={tint.fg} strokeWidth={2} />
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 10,
                color: tint.fg,
                letterSpacing: 0.8,
              }}
            >
              {p.propType.toUpperCase()}
            </Text>
          </View>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 26,
              color: colors.soft,
              letterSpacing: -0.8,
              lineHeight: 30,
            }}
          >
            {p.addr}
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.muted }}>
            {subtitle}
          </Text>
          {p.auctionDate ? (
            <View className="flex-row items-center gap-2 mt-1">
              <Gavel size={13} color={colors.brand.primary} strokeWidth={1.75} />
              <Text
                style={{
                  fontFamily: 'Inter_500Medium',
                  fontSize: 12,
                  color: colors.brand.primary,
                }}
              >
                Auction · {formatDate(p.auctionDate)}
                {(() => {
                  // Future only; past/today render nothing (never "in -3 days",
                  // never implying an ended sale is live). Warning tint inside
                  // a week — bid-prep time is nearly gone.
                  const d = daysUntil(p.auctionDate)
                  return d != null && d > 0 ? (
                    <Text
                      style={{
                        fontFamily: 'Inter_600SemiBold',
                        color: d <= 7 ? colors.status.warning : colors.brand.cyan,
                      }}
                    >
                      {` · in ${d} day${d === 1 ? '' : 's'}`}
                    </Text>
                  ) : null
                })()}
              </Text>
            </View>
          ) : null}
          <DataFreshness generated={dataQuery.data?.meta.generated} />
        </View>

        {/* Score + specs grid */}
        <View className="flex-row gap-3">
          <View
            style={{
              flex: 1,
              backgroundColor: colors.navy,
              borderRadius: 16,
              padding: 14,
              borderWidth: 1,
              borderColor: withAlpha(colors.slate, 0.2),
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_500Medium',
                fontSize: 10,
                color: colors.muted,
                letterSpacing: 1.5,
              }}
            >
              DEAL SCORE
            </Text>
            {isScoreUnknown(p) ? (
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 22,
                  color: colors.muted,
                }}
              >
                N/A
              </Text>
            ) : (
              <ScoreBadge value={p.score} size="lg" />
            )}
          </View>
          <View
            style={{
              flex: 1.4,
              backgroundColor: colors.navy,
              borderRadius: 16,
              padding: 14,
              borderWidth: 1,
              borderColor: withAlpha(colors.slate, 0.2),
              gap: 8,
            }}
          >
            <SpecRow label="Beds" value={p.beds?.toString() ?? '—'} />
            <SpecRow label="Baths" value={p.baths?.toString() ?? '—'} />
            <SpecRow label="Sq Ft" value={p.sqft ? p.sqft.toLocaleString() : '—'} />
            <SpecRow label="Built" value={p.yearBuilt?.toString() ?? '—'} />
            {p.lotAcres ? (
              <SpecRow label="Lot" value={`${p.lotAcres.toFixed(2)} ac`} />
            ) : null}
          </View>
        </View>

        {/* Action buttons — Street View / Zillow / Parcel Search */}
        <View className="flex-row gap-2">
          {hasHouseNumber(p.addr) ? (
            <>
              <ActionButton
                icon={MapPin}
                label="Street View"
                onPress={() => Linking.openURL(buildStreetViewUrl(p)).catch(() => {})}
              />
              <ActionButton
                icon={ExternalLink}
                label="Zillow"
                onPress={() => Linking.openURL(buildZillowUrl(p)).catch(() => {})}
              />
            </>
          ) : (
            <ActionButton
              icon={FileSearch}
              label="Parcel Search"
              onPress={() => Linking.openURL(buildParcelSearchUrl(p)).catch(() => {})}
            />
          )}
        </View>

        {/* Financials */}
        <Section title="Financials">
          <Row label="Tax Due (Min Bid)" value={formatCurrency(p.taxDue)} />
          <Row label="Est. Rehab Cost" value={formatCurrency(p.rehab)} />
          <Row label="Legal & Closing Costs" value={formatCurrency(p.legalClosing)} />
          <Row label="All-In Cost" value={formatCurrency(p.allIn)} />
          <Row label="ARV (After Repair)" value={formatCurrency(p.arv)} tone="positive" />
          {p.countyAppraisedValue != null ? (
            // Zillow's anchor trick, honestly sourced: the county's own number
            // beside ours gives the ARV an external reference point for free.
            <Row label="County Appraised" value={formatCurrency(p.countyAppraisedValue)} />
          ) : null}
          <Row
            label="Est. Net Profit"
            value={formatCurrency(p.profit)}
            tone={(p.profit ?? 0) >= 0 ? 'positive' : 'negative'}
          />

          {p.recommendedMaxBid != null ? (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: withAlpha(colors.slate, 0.2),
                paddingTop: 10,
                marginTop: 4,
                gap: 4,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Inter_500Medium',
                  fontSize: 10,
                  color: colors.muted,
                  letterSpacing: 1.5,
                }}
              >
                RECOMMENDED MAX BID
              </Text>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 28,
                  color: colors.brand.cyan,
                  letterSpacing: -0.8,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {formatCurrency(p.recommendedMaxBid)}
              </Text>
            </View>
          ) : null}

          <View className="flex-row gap-2" style={{ paddingTop: 6 }}>
            <Pill label="ROI" value={formatPercent(p.roi)} />
            <Pill label="Comps" value={`${p.comps || 0}`} />
            <Pill label="Conf." value={p.arvConf || '—'} />
          </View>
        </Section>

        {/* As-is alternative (residential only when present) */}
        {p.asisRoi != null || p.asisSalePrice != null ? (
          <Section title="As-Is Alternative (sell without repairs)">
            <Row label="As-Is Sale Price" value={formatCurrency(p.asisSalePrice)} />
            <Row label="As-Is All-In" value={formatCurrency(p.asisAllIn)} />
            <Row
              label="As-Is Net Profit"
              value={formatCurrency(p.asisProfit)}
              tone={(p.asisProfit ?? 0) >= 0 ? 'positive' : 'negative'}
            />
            <Row label="As-Is ROI" value={formatPercent(p.asisRoi)} tone="positive" />
          </Section>
        ) : null}

        {/* Data quality — Overall Risk and Investment Viability were removed:
            they were never populated by the live pipeline and always rendered "—".
            Data Confidence is produced by enrichment, so it stays. */}
        {p.dataConf ? (
          <Section title="Data Quality">
            <Row label="Data Confidence" value={p.dataConf} />
          </Section>
        ) : null}

        {/* Comparables */}
        {p.comparables.length > 0 ? (
          <Section title={`Comparable sales (${p.comparables.length})`}>
            {p.comparables.slice(0, 8).map((c, i) => (
              <View
                key={`${c.a}-${i}`}
                style={{
                  paddingVertical: 8,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: withAlpha(colors.slate, 0.15),
                  gap: 4,
                }}
              >
                <View className="flex-row items-center justify-between gap-3">
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontFamily: 'SpaceGrotesk_600SemiBold',
                      fontSize: 13,
                      color: colors.soft,
                    }}
                  >
                    {c.a || '—'}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'SpaceGrotesk_700Bold',
                      fontSize: 14,
                      color: colors.brand.cyan,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {formatCurrency(c.p)}
                  </Text>
                </View>
                {c.d || c.psf ? (
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: 'Inter_400Regular',
                      fontSize: 11,
                      color: colors.muted,
                    }}
                  >
                    {c.d || ''}
                    {c.psf ? `${c.d ? ' · ' : ''}$${Math.round(c.psf)}/sqft` : ''}
                  </Text>
                ) : null}
              </View>
            ))}
          </Section>
        ) : null}

        {/* Calculation breakdowns */}
        {p.arvCalc || p.rehabCalc || p.profitCalc ? (
          <Section title="Calculation notes">
            {p.arvCalc ? <Note label="ARV method" body={p.arvCalc} /> : null}
            {p.rehabCalc ? <Note label="Rehab" body={p.rehabCalc} /> : null}
            {p.allInCalc ? <Note label="All-in" body={p.allInCalc} /> : null}
            {p.profitCalc ? <Note label="Profit" body={p.profitCalc} /> : null}
            {p.roiCalc ? <Note label="ROI" body={p.roiCalc} /> : null}
          </Section>
        ) : null}

        {/* Add to pipeline */}
        <View style={{ paddingTop: 8 }}>
          {hasActiveAccess ? (
            <GradientButton
              label={alreadyInPipeline ? '✓ In your pipeline' : 'Add to pipeline'}
              loading={addMut.isPending}
              variant={alreadyInPipeline ? 'secondary' : 'primary'}
              disabled={alreadyInPipeline}
              onPress={() => addMut.mutate()}
            />
          ) : (
            <GradientButton
              label="Upgrade to track deals"
              onPress={() => router.push('/paywall')}
            />
          )}
        </View>

        <FinancialDisclaimer extra="Verify all figures and do your own diligence before bidding." />
      </ScrollView>
    </Screen>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
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
        {title}
      </Text>
      {children}
    </View>
  )
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.muted }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_600SemiBold',
          fontSize: 13,
          color: colors.soft,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
    </View>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
}) {
  const color =
    tone === 'positive'
      ? colors.brand.cyan
      : tone === 'negative'
        ? colors.status.danger
        : colors.soft
  return (
    <View className="flex-row items-center justify-between" style={{ paddingVertical: 2 }}>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.muted }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_600SemiBold',
          fontSize: 15,
          color,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
    </View>
  )
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.graphite,
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 10,
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          fontSize: 9,
          color: colors.muted,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 14,
          color: colors.soft,
          letterSpacing: -0.4,
        }}
      >
        {value}
      </Text>
    </View>
  )
}

interface ActionButtonProps {
  icon: typeof MapPin
  label: string
  onPress: () => void
}

function ActionButton({ icon: Icon, label, onPress }: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        borderRadius: 14,
        backgroundColor: colors.navy,
        borderWidth: 1,
        borderColor: withAlpha(colors.brand.primary, 0.35),
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon size={14} color={colors.brand.primary} strokeWidth={2} />
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          fontSize: 12,
          color: colors.brand.primary,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function Note({ label, body }: { label: string; body: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          fontSize: 10,
          color: colors.brand.primary,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 12,
          color: colors.muted,
          lineHeight: 17,
        }}
      >
        {body}
      </Text>
    </View>
  )
}
