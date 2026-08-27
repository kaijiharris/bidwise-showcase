import { Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  AlertTriangle,
  Briefcase,
  Calendar,
  Check,
  FileText,
  Home,
  Link2,
  MapPin,
  Scale,
  Tag,
  Wallet,
} from 'lucide-react-native'
import { formatCompactCurrency } from '@/lib/format'
import {
  DEAL_TYPE_LABELS,
  DISTRESS_SIGNAL_LABELS,
  EQUITY_TIER_LABELS,
  type DistressSignal,
  type EquityTier,
  type OffMarketLeadSummary,
} from '@/lib/types'
import { colors, withAlpha } from '@/theme/colors'

interface LeadCardProps {
  lead: OffMarketLeadSummary
  inPipeline: boolean
  onTogglePipeline: () => void
  pipelineLoading?: boolean
}

const EQUITY_TINT: Record<EquityTier, { fg: string; bg: string }> = {
  HIGH_EQUITY: { fg: colors.brand.cyan, bg: withAlpha(colors.brand.cyan, 0.16) },
  MED_EQUITY: { fg: colors.brand.primary, bg: withAlpha(colors.brand.primary, 0.16) },
  LOW_EQUITY: { fg: colors.status.warning, bg: withAlpha(colors.status.warning, 0.16) },
  UNDERWATER: { fg: colors.status.danger, bg: withAlpha(colors.status.danger, 0.18) },
  UNKNOWN: { fg: colors.muted, bg: withAlpha(colors.muted, 0.14) },
}

const SIGNAL_ICON: Record<DistressSignal, typeof Home> = {
  absentee_owner: Home,
  foreclosure: Scale,
  lis_pendens: FileText,
  open_liens: Link2,
  long_held: Calendar,
  vacant: AlertTriangle,
  listed: Tag,
  tax_delinquent: Wallet,
}

function scoreBand(s: number | null) {
  if (s == null) return { fg: colors.muted, label: '—' }
  if (s >= 75) return { fg: colors.brand.cyan, label: `${Math.round(s)}` }
  if (s >= 50) return { fg: colors.status.warning, label: `${Math.round(s)}` }
  return { fg: colors.status.danger, label: `${Math.round(s)}` }
}

export function LeadCard({
  lead,
  inPipeline,
  onTogglePipeline,
  pipelineLoading,
}: LeadCardProps) {
  const router = useRouter()
  const equity = lead.equity_tier ?? 'UNKNOWN'
  const equityTint = EQUITY_TINT[equity]
  const score = scoreBand(lead.deal_score)

  const subtitle = [
    lead.city,
    lead.state ? `${lead.state} ${lead.zip_code ?? ''}`.trim() : null,
  ]
    .filter(Boolean)
    .join(', ')

  const signals = (lead.distress_signals ?? []).slice(0, 5)

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push(`/(app)/intel/${encodeURIComponent(lead.id)}` as never)
      }
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <View
        className="rounded-card overflow-hidden"
        style={{
          backgroundColor: colors.navy,
          borderWidth: 1,
          borderColor: withAlpha(colors.slate, 0.2),
        }}
      >
        <View
          className="flex-row items-center justify-between"
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: withAlpha(colors.slate, 0.15),
            backgroundColor: 'rgba(0,0,0,0.15)',
          }}
        >
          <View className="flex-row items-center gap-2">
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 18,
                color: score.fg,
                letterSpacing: -0.5,
              }}
            >
              {score.label}
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 9,
                color: colors.muted,
                letterSpacing: 1.4,
              }}
            >
              DEAL SCORE
            </Text>
          </View>
          <View
            className="rounded-pill"
            style={{
              backgroundColor: equityTint.bg,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 10,
                color: equityTint.fg,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              {EQUITY_TIER_LABELS[equity]}
            </Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 4 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'SpaceGrotesk_600SemiBold',
              fontSize: 16,
              color: colors.soft,
              letterSpacing: -0.3,
            }}
          >
            {lead.address}
          </Text>
          {subtitle ? (
            <View className="flex-row items-center gap-1">
              <MapPin size={11} color={colors.muted} strokeWidth={1.75} />
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'Inter_400Regular',
                  fontSize: 12,
                  color: colors.muted,
                }}
              >
                {subtitle}
                {lead.county ? ` · ${lead.county} County` : ''}
              </Text>
            </View>
          ) : null}
          {lead.deal_type ? (
            <Text
              style={{
                fontFamily: 'Inter_500Medium',
                fontSize: 10,
                color: colors.brand.primary,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginTop: 2,
              }}
            >
              {DEAL_TYPE_LABELS[lead.deal_type]}
            </Text>
          ) : null}
        </View>

        {signals.length > 0 ? (
          <View
            className="flex-row flex-wrap"
            style={{ paddingHorizontal: 14, paddingTop: 10, gap: 6 }}
          >
            {signals.map((sig) => {
              const Icon = SIGNAL_ICON[sig] ?? AlertTriangle
              return (
                <View
                  key={sig}
                  className="flex-row items-center gap-1 rounded-pill"
                  style={{
                    backgroundColor: withAlpha(colors.status.warning, 0.12),
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                  }}
                >
                  <Icon size={9} color={colors.status.warning} strokeWidth={2} />
                  <Text
                    style={{
                      fontFamily: 'Inter_500Medium',
                      fontSize: 10,
                      color: colors.status.warning,
                    }}
                  >
                    {DISTRESS_SIGNAL_LABELS[sig]}
                  </Text>
                </View>
              )
            })}
          </View>
        ) : null}

        <View
          className="flex-row"
          style={{
            marginTop: 12,
            borderTopWidth: 1,
            borderTopColor: withAlpha(colors.slate, 0.15),
          }}
        >
          <Metric label="Est. Equity" value={formatCompactCurrency(lead.estimated_equity)} accent />
          <Divider />
          <Metric
            label="Owner"
            value={lead.owner_type ? shortOwner(lead.owner_type) : '—'}
          />
          <Divider />
          <Metric
            label="Yrs Owned"
            value={lead.years_owned != null ? `${lead.years_owned}` : '—'}
          />
          <Divider />
          <Metric
            label="Liens"
            value={lead.open_liens != null ? `${lead.open_liens}` : '—'}
            warn={(lead.open_liens ?? 0) > 0}
          />
        </View>

        <View
          className="flex-row gap-2"
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: withAlpha(colors.slate, 0.15),
          }}
        >
          <Pressable
            accessibilityRole="button"
            disabled={pipelineLoading}
            onPress={(e) => {
              e.stopPropagation()
              onTogglePipeline()
            }}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: inPipeline ? withAlpha(colors.brand.cyan, 0.16) : colors.graphite,
              borderWidth: 1,
              borderColor: inPipeline ? colors.brand.cyan : withAlpha(colors.slate, 0.3),
              opacity: pressed || pipelineLoading ? 0.7 : 1,
            })}
          >
            {inPipeline ? (
              <Check size={12} color={colors.brand.cyan} strokeWidth={2.5} />
            ) : (
              <Briefcase size={12} color={colors.soft} strokeWidth={2} />
            )}
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 11,
                color: inPipeline ? colors.brand.cyan : colors.soft,
                letterSpacing: 0.4,
              }}
            >
              {inPipeline ? 'In Pipeline' : 'Pipeline'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={(e) => {
              e.stopPropagation()
              router.push(`/(app)/intel/${encodeURIComponent(lead.id)}` as never)
            }}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: withAlpha(colors.brand.primary, 0.16),
              borderWidth: 1,
              borderColor: colors.brand.primary,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <FileText size={12} color={colors.brand.primary} strokeWidth={2} />
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 11,
                color: colors.brand.primary,
                letterSpacing: 0.4,
              }}
            >
              View Brief
            </Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  )
}

function shortOwner(owner: string): string {
  if (/absentee/i.test(owner)) return 'Absentee'
  if (/occupied/i.test(owner)) return 'Occupied'
  return owner.length > 12 ? `${owner.slice(0, 12)}…` : owner
}

function Metric({
  label,
  value,
  accent,
  warn,
}: {
  label: string
  value: string
  accent?: boolean
  warn?: boolean
}) {
  return (
    <View className="items-center" style={{ flex: 1, paddingVertical: 10 }}>
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          fontSize: 8,
          color: colors.muted,
          letterSpacing: 1.2,
          marginBottom: 2,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 13,
          color: warn
            ? colors.status.danger
            : accent
              ? colors.brand.cyan
              : colors.soft,
          letterSpacing: -0.3,
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
        marginVertical: 10,
      }}
    />
  )
}
