import { Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated'
import { Building2, Home, Leaf, Lock, MapPin, Zap } from 'lucide-react-native'
import { ScoreBadge } from './ScoreBadge'
import { formatCompactCurrency, formatPercent } from '@/lib/format'
import { isScoreUnknown } from '@/lib/normalize'
import type { NormalizedProperty, PropType } from '@/lib/types'
import { brandGradient, colors, withAlpha } from '@/theme/colors'

interface DealCardProps {
  property: NormalizedProperty
  county: string
  locked?: boolean
  /**
   * Auction dataset this card was rendered from (e.g.
   * "/data/dekalb_2026-06-02.json"). MUST be forwarded to the detail screen:
   * without it the detail route falls back to `/data/<county>.json`, which is
   * the wrong dataset whenever the user has picked a non-default auction date —
   * and is absent from Cobb's index entirely, so every Cobb tap 404s.
   */
  file?: string
  /**
   * Pipeline-stamped Top-Deal verdict (lib/normalize.ts isTopDeal). Pass true
   * only in the Dashboard section — in the Top Deals tab every card qualifies,
   * so the flag would be noise.
   */
  topDeal?: boolean
}

const TYPE_TINT: Record<PropType, { fg: string; bg: string; icon: typeof Home }> = {
  SFR: { fg: '#74C8FF', bg: withAlpha(colors.status.warning, 0.15), icon: Home },
  'Vacant Land': { fg: '#2DE2FF', bg: withAlpha(colors.brand.cyan, 0.15), icon: Leaf },
  Commercial: { fg: '#386BFF', bg: withAlpha(colors.status.danger, 0.18), icon: Building2 },
  'Multi-Family': { fg: '#10A7FF', bg: withAlpha(colors.brand.primary, 0.15), icon: Building2 },
  Unknown: { fg: '#94A3B8', bg: withAlpha(colors.muted, 0.15), icon: Home },
}

export function DealCard({ property, county, locked = false, file, topDeal = false }: DealCardProps) {
  const router = useRouter()
  const tint = TYPE_TINT[property.propType]
  const TypeIcon = tint.icon

  // Spring scale press state (iOS App Store "Today" cards / Robinhood rows):
  // the card compresses ~2% under the finger. Transform-only, so it stays on
  // the compositor — same rationale as the skeleton pulse. Per-card
  // sharedValues are fine; only visible cells are mounted.
  const pressScale = useSharedValue(1)
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }))

  const onPress = () => {
    if (locked) {
      Haptics.selectionAsync()
      router.push('/paywall')
      return
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const parcelKey = property.taxId || `${property.county}-${property.id}`
    const query = new URLSearchParams({ county, id: String(property.id) })
    // Pin the detail screen to the SAME dataset this card came from. `id` is a
    // positional index within that dataset, so it is meaningless against any
    // other file — see the taxId-first resolution in property/[parcelId].tsx.
    if (file) query.set('file', file)
    router.push(`/(app)/property/${encodeURIComponent(parcelKey)}?${query.toString()}` as never)
  }

  const subtitle = [property.city, property.zip ? `GA ${property.zip}` : null]
    .filter(Boolean)
    .join(', ')

  const showScore = !isScoreUnknown(property)

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={() => {
        pressScale.value = withSpring(0.98, { damping: 20, stiffness: 300 })
      }}
      onPressOut={() => {
        pressScale.value = withSpring(1, { damping: 20, stiffness: 300 })
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      <Animated.View
        className="rounded-card overflow-hidden"
        style={[
          {
            backgroundColor: colors.navy,
            borderWidth: 1,
            borderColor: topDeal ? withAlpha(colors.brand.primary, 0.35) : withAlpha(colors.slate, 0.2),
          },
          pressStyle,
        ]}
      >
        {topDeal ? (
          // Redfin "Hot Home" lesson: badge the winners. This surfaces the
          // pipeline's existing verdict — it promises nothing new.
          <LinearGradient
            colors={brandGradient.colors}
            start={brandGradient.start}
            end={brandGradient.end}
            style={{ height: 2 }}
          />
        ) : null}
        {/* Header */}
        <View
          className="flex-row items-start justify-between gap-3"
          style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}
        >
          <View style={{ flex: 1, gap: 6 }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: 'SpaceGrotesk_600SemiBold',
                fontSize: 16,
                color: colors.soft,
                letterSpacing: -0.3,
              }}
            >
              {property.addr || '—'}
            </Text>
            <View className="flex-row items-center gap-1">
              <MapPin size={11} color={colors.muted} strokeWidth={1.75} />
              <Text
                numberOfLines={1}
                style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.muted }}
              >
                {subtitle || '—'}
                {property.county ? ` · ${property.county} County` : ''}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            {showScore ? <ScoreBadge value={property.score} /> : null}
            {topDeal ? (
              <View
                className="flex-row items-center gap-1 rounded-pill"
                style={{
                  backgroundColor: withAlpha(colors.brand.primary, 0.18),
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                }}
              >
                <Zap size={9} color={colors.brand.cyan} strokeWidth={2.5} />
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    fontSize: 9,
                    color: colors.brand.cyan,
                    letterSpacing: 0.8,
                  }}
                >
                  TOP DEAL
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Type + specs row */}
        <View
          className="flex-row items-center gap-2 flex-wrap"
          style={{ paddingHorizontal: 16, paddingBottom: 12 }}
        >
          <View
            className="flex-row items-center gap-1 rounded-pill"
            style={{
              backgroundColor: tint.bg,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <TypeIcon size={10} color={tint.fg} strokeWidth={2} />
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 10,
                color: tint.fg,
                letterSpacing: 0.6,
              }}
            >
              {property.propType.toUpperCase()}
            </Text>
          </View>
          {property.beds != null && property.baths != null ? (
            <SpecChip text={`${property.beds}bd / ${property.baths}ba`} />
          ) : null}
          {property.sqft ? <SpecChip text={`${property.sqft.toLocaleString()} sqft`} /> : null}
          {property.yearBuilt ? <SpecChip text={`built ${property.yearBuilt}`} /> : null}
          {property.lotAcres && property.propType === 'Vacant Land' ? (
            <SpecChip text={`${property.lotAcres.toFixed(2)} ac`} />
          ) : null}
        </View>

        {/* Financial row */}
        <View style={{ position: 'relative' }}>
          <View
            className="flex-row"
            style={{
              borderTopWidth: 1,
              borderTopColor: withAlpha(colors.slate, 0.15),
            }}
          >
            {/* Zillow/Redfin lesson: lead with the number the buyer acts on —
                the cost of entry. minBid falls back to taxDue, which is
                non-nullable, so this cell always renders a real figure. */}
            <Metric
              label="MIN BID"
              value={formatCompactCurrency(property.minBid ?? property.taxDue)}
            />
            <Divider />
            <Metric label="ROI" value={formatPercent(property.roi)} accent />
            <Divider />
            <Metric label="ARV" value={formatCompactCurrency(property.arv)} />
            <Divider />
            <Metric label="Net Profit" value={formatCompactCurrency(property.profit)} />
          </View>

          {locked ? (
            <BlurView
              intensity={28}
              tint="dark"
              style={{
                position: 'absolute',
                inset: 0,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <View
                className="flex-row items-center gap-2 rounded-pill"
                style={{
                  backgroundColor: withAlpha(colors.brand.primary, 0.22),
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                }}
              >
                <Lock size={11} color={colors.brand.primary} strokeWidth={2.5} />
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    fontSize: 11,
                    color: colors.brand.primary,
                    letterSpacing: 0.8,
                  }}
                >
                  UPGRADE TO UNLOCK
                </Text>
              </View>
            </BlurView>
          ) : null}
        </View>
      </Animated.View>
    </Pressable>
  )
}

function SpecChip({ text }: { text: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.graphite,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
      }}
    >
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          fontSize: 10,
          color: colors.muted,
          letterSpacing: 0.3,
        }}
      >
        {text}
      </Text>
    </View>
  )
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <View className="items-center" style={{ flex: 1, paddingVertical: 12 }}>
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          fontSize: 9,
          color: colors.muted,
          letterSpacing: 1.4,
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 16,
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

function Divider() {
  return (
    <View
      style={{
        width: 1,
        backgroundColor: withAlpha(colors.slate, 0.15),
        marginVertical: 12,
      }}
    />
  )
}
