import { useMemo } from 'react'
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
  ChevronLeft,
  ExternalLink,
  MapPin,
  Phone,
  Sparkles,
} from 'lucide-react-native'
import { GradientButton } from '@/components/ui/GradientButton'
import { Screen } from '@/components/ui/Screen'
import { FinancialDisclaimer } from '@/components/ui/FinancialDisclaimer'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import {
  addLeadToPipeline,
  fetchLead,
  fetchLeadPipelineEntries,
  removeLeadFromPipeline,
  updateLeadAIBrief,
} from '@/lib/leads-api'
import { formatCompactCurrency, formatCurrency, formatDate } from '@/lib/format'
import {
  DISTRESS_SIGNAL_LABELS,
  EQUITY_TIER_LABELS,
} from '@/lib/types'
import { colors, withAlpha } from '@/theme/colors'

export default function IntelBriefScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { user, hasActiveAccess } = useAuth()
  const userId = user?.id ?? null
  const queryClient = useQueryClient()

  const leadQuery = useQuery({
    queryKey: ['lead', id],
    queryFn: () => fetchLead(id),
    enabled: !!id,
  })

  const pipelineQuery = useQuery({
    queryKey: ['lead-pipeline', userId],
    queryFn: () => (userId ? fetchLeadPipelineEntries(userId) : Promise.resolve([])),
    enabled: !!userId,
  })

  const inPipeline = useMemo(
    () => (pipelineQuery.data ?? []).some((r) => r.lead_id === id),
    [pipelineQuery.data, id]
  )

  const toggleMut = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in')
      if (inPipeline) {
        await removeLeadFromPipeline(userId, id)
      } else {
        await addLeadToPipeline(userId, id, 'qualified')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline', userId] })
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline-joined', userId] })
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't update pipeline",
        err instanceof Error ? err.message : String(err)
      ),
  })

  const generateMut = useMutation({
    mutationFn: async () => {
      if (!leadQuery.data) throw new Error('Lead not loaded')
      // Generate the brief server-side via the `generate-brief` edge function,
      // which returns { brief }. The function authenticates the caller from the
      // bearer token the SDK attaches automatically.
      const { data, error } = await supabase.functions.invoke<{ brief: string }>('generate-brief', {
        body: { lead: leadQuery.data },
      })
      if (error) throw error
      const brief = data?.brief?.trim()
      if (!brief) throw new Error('The brief came back empty. Please try again.')
      // Persist so it shows immediately on revisit (function may also write it
      // server-side; updating here keeps the row in sync if it does not).
      await updateLeadAIBrief(id, brief)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead', id] }),
    onError: (err) =>
      Alert.alert(
        "Couldn't generate brief",
        err instanceof Error ? err.message : String(err)
      ),
  })

  if (leadQuery.isLoading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      </Screen>
    )
  }

  if (leadQuery.isError || !leadQuery.data) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, color: colors.soft }}>
            Couldn&rsquo;t load lead.
          </Text>
          {leadQuery.error ? (
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 12,
                color: colors.status.danger,
                textAlign: 'center',
                paddingHorizontal: 24,
              }}
            >
              {leadQuery.error instanceof Error
                ? leadQuery.error.message
                : String(leadQuery.error)}
            </Text>
          ) : null}
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

  const l = leadQuery.data
  const subtitle = [l.city, l.state, l.zip_code].filter(Boolean).join(', ')

  return (
    <Screen edges={['top']}>
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
        <View style={{ gap: 6 }}>
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 11,
              color: colors.brand.primary,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
            }}
          >
            BidWise Intel
          </Text>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 26,
              color: colors.soft,
              letterSpacing: -0.8,
              lineHeight: 30,
            }}
          >
            {l.address}
          </Text>
          {subtitle ? (
            <View className="flex-row items-center gap-1">
              <MapPin size={12} color={colors.muted} strokeWidth={1.75} />
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.muted }}>
                {subtitle}
                {l.county ? ` · ${l.county} County` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="flex-row gap-3">
          <StatCard
            label="Deal Score"
            value={l.deal_score != null ? `${Math.round(l.deal_score)}` : '—'}
            accent
          />
          <StatCard
            label="Equity"
            value={
              l.estimated_equity != null ? formatCompactCurrency(l.estimated_equity) : '—'
            }
          />
          <StatCard
            label="Tier"
            value={l.equity_tier ? EQUITY_TIER_LABELS[l.equity_tier] : '—'}
          />
        </View>

        <Section
          title="AI Brief"
          right={
            l.ai_brief_generated_at ? (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.muted }}>
                {formatDate(l.ai_brief_generated_at)}
              </Text>
            ) : null
          }
        >
          {l.ai_brief ? (
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 13,
                color: colors.soft,
                lineHeight: 19,
              }}
            >
              {l.ai_brief}
            </Text>
          ) : (
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 12 }}>
              <Sparkles size={24} color={colors.brand.primary} strokeWidth={1.75} />
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_600SemiBold',
                  fontSize: 14,
                  color: colors.soft,
                  textAlign: 'center',
                }}
              >
                No brief yet.
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
                Generate a structured summary of equity, distress signals, and recommended
                outreach.
              </Text>
            </View>
          )}
          <View style={{ paddingTop: 8 }}>
            <GradientButton
              label={l.ai_brief ? 'Regenerate brief' : 'Generate brief'}
              loading={generateMut.isPending}
              variant={l.ai_brief ? 'secondary' : 'primary'}
              onPress={() => generateMut.mutate()}
            />
          </View>
        </Section>

        {l.distress_signals?.length ? (
          <Section title="Distress signals">
            <View className="flex-row flex-wrap" style={{ gap: 6 }}>
              {l.distress_signals.map((s) => (
                <View
                  key={s}
                  style={{
                    backgroundColor: withAlpha(colors.status.warning, 0.14),
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Inter_500Medium',
                      fontSize: 11,
                      color: colors.status.warning,
                    }}
                  >
                    {DISTRESS_SIGNAL_LABELS[s]}
                  </Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="Property">
          <Row label="Beds" value={l.beds != null ? `${l.beds}` : '—'} />
          <Row label="Baths" value={l.baths != null ? `${l.baths}` : '—'} />
          <Row
            label="Sq Ft"
            value={l.building_sqft ? l.building_sqft.toLocaleString() : '—'}
          />
          <Row label="Built" value={l.year_built ? `${l.year_built}` : '—'} />
          <Row label="Assessed value" value={formatCurrency(l.assessed_value)} />
          <Row
            label="Est. value"
            value={formatCurrency(l.est_value ?? l.assessed_value)}
          />
          <Row label="Tax amount" value={formatCurrency(l.tax_amount)} />
        </Section>

        <Section title="Ownership">
          <Row label="Owner type" value={l.owner_type ?? '—'} />
          <Row label="Years owned" value={l.years_owned != null ? `${l.years_owned}` : '—'} />
          <Row
            label="Last sold"
            value={
              l.last_sold_price
                ? `${formatCurrency(l.last_sold_price)}${l.last_sold_date ? ` · ${l.last_sold_date}` : ''}`
                : '—'
            }
          />
          <Row label="Mortgage balance" value={formatCurrency(l.mortgage_balance)} />
          <Row label="Open liens" value={l.open_liens != null ? `${l.open_liens}` : '—'} />
          <Row label="Foreclosure status" value={l.foreclosure_status ?? 'None'} />
          {l.owner_name ? <Row label="Owner name" value={l.owner_name} /> : null}
        </Section>

        {l.owner_phone || l.owner_email || l.mailing_address ? (
          <Section title="Owner contact">
            {l.owner_phone ? (
              <Pressable
                onPress={() => Linking.openURL(`tel:${l.owner_phone}`).catch(() => {})}
                accessibilityRole="button"
              >
                <View className="flex-row items-center justify-between" style={{ paddingVertical: 4 }}>
                  <View className="flex-row items-center gap-2">
                    <Phone size={13} color={colors.brand.primary} strokeWidth={2} />
                    <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.muted }}>
                      Phone
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: 'SpaceGrotesk_600SemiBold',
                      fontSize: 14,
                      color: colors.brand.primary,
                    }}
                  >
                    {l.owner_phone}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {l.owner_email ? (
              <Pressable
                onPress={() => Linking.openURL(`mailto:${l.owner_email}`).catch(() => {})}
                accessibilityRole="button"
              >
                <View className="flex-row items-center justify-between" style={{ paddingVertical: 4 }}>
                  <View className="flex-row items-center gap-2">
                    <ExternalLink size={13} color={colors.brand.primary} strokeWidth={2} />
                    <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.muted }}>
                      Email
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: 'SpaceGrotesk_600SemiBold',
                      fontSize: 13,
                      color: colors.brand.primary,
                    }}
                    numberOfLines={1}
                  >
                    {l.owner_email}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {l.mailing_address ? (
              <Row
                label="Mailing"
                value={[l.mailing_address, l.mailing_city, l.mailing_state, l.mailing_zip]
                  .filter(Boolean)
                  .join(', ')}
              />
            ) : null}
          </Section>
        ) : null}

        <View style={{ paddingTop: 8 }}>
          {hasActiveAccess ? (
            <GradientButton
              label={inPipeline ? '✓ In your pipeline' : 'Add lead to pipeline'}
              loading={toggleMut.isPending}
              variant={inPipeline ? 'secondary' : 'primary'}
              onPress={() => toggleMut.mutate()}
            />
          ) : (
            <GradientButton
              label="Upgrade to track leads"
              onPress={() => router.push('/paywall')}
            />
          )}
        </View>

        <FinancialDisclaimer extra="Off-market data is PropStream-sourced. Verify before contacting owners and follow all state/federal solicitation regulations." />
      </ScrollView>
    </Screen>
  )
}

function Section({
  title,
  right,
  children,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
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
          {title}
        </Text>
        {right}
      </View>
      {children}
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
          letterSpacing: 1.2,
          textTransform: 'uppercase',
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
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between" style={{ paddingVertical: 2 }}>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.muted }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_600SemiBold',
          fontSize: 13,
          color: colors.soft,
          fontVariant: ['tabular-nums'],
          maxWidth: '60%',
        }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  )
}
