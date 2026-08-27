import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { ArrowDown, ArrowUp, Check, X } from 'lucide-react-native'
import { GradientButton } from '@/components/ui/GradientButton'
import {
  DEFAULT_FILTER,
  type FeedFilter,
  type PropType,
  type SortField,
} from '@/lib/types'
import { colors, withAlpha } from '@/theme/colors'

interface FilterSheetProps {
  visible: boolean
  initial: FeedFilter
  cities: string[]
  onApply: (filter: FeedFilter) => void
  onClose: () => void
}

const TYPES: (PropType | 'all')[] = ['all', 'SFR', 'Vacant Land', 'Multi-Family', 'Commercial']

const SORTS: { key: SortField; label: string }[] = [
  { key: 'roi', label: 'ROI' },
  { key: 'score', label: 'Deal Score' },
  { key: 'profit', label: 'Net Profit' },
  { key: 'taxDue', label: 'Tax Due' },
]

export function FilterSheet({ visible, initial, cities, onApply, onClose }: FilterSheetProps) {
  const [draft, setDraft] = useState<FeedFilter>(initial)

  // The sheet stays mounted for the life of the feed, so a draft captured at
  // mount goes stale the moment the applied filter changes anywhere else (e.g.
  // a reset from the feed's empty state). Resync on every open so the pills
  // always show what is actually applied.
  useEffect(() => {
    if (visible) setDraft(initial)
  }, [visible, initial])

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View
          style={{
            backgroundColor: colors.navy,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingTop: 12,
            paddingBottom: 32,
            borderTopWidth: 1,
            borderColor: withAlpha(colors.slate, 0.25),
            maxHeight: '88%',
          }}
        >
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              alignSelf: 'center',
              backgroundColor: colors.slate,
              marginBottom: 12,
              opacity: 0.5,
            }}
          />

          <View
            className="flex-row items-center justify-between"
            style={{ paddingHorizontal: 24, paddingBottom: 16 }}
          >
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 22,
                color: colors.soft,
                letterSpacing: -0.5,
              }}
            >
              Filter deals.
            </Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
              <X size={22} color={colors.muted} strokeWidth={1.75} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16, gap: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <Section title="Search">
              <TextInput
                value={draft.search}
                onChangeText={(t) => setDraft({ ...draft, search: t })}
                placeholder="Address contains…"
                placeholderTextColor={colors.dim}
                autoCapitalize="none"
                style={{
                  backgroundColor: colors.graphite,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: withAlpha(colors.slate, 0.3),
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontFamily: 'Inter_400Regular',
                  fontSize: 14,
                  color: colors.soft,
                }}
              />
            </Section>

            <Section title="Property type">
              <PillRow
                options={TYPES.map((t) => ({ value: t, label: t === 'all' ? 'All' : t }))}
                value={draft.propType}
                onChange={(v) => setDraft({ ...draft, propType: v })}
              />
            </Section>

            <Section title="City">
              <PillRow
                options={[
                  { value: null, label: 'All' },
                  ...cities.map((c) => ({ value: c, label: c })),
                ]}
                value={draft.city}
                onChange={(v) => setDraft({ ...draft, city: v })}
              />
            </Section>

            <Section title="Sort by">
              <PillRow
                options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
                value={draft.sortField}
                onChange={(k) => setDraft({ ...draft, sortField: k })}
              />
              <Pressable
                onPress={() => setDraft({ ...draft, sortDir: (draft.sortDir * -1) as 1 | -1 })}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  alignSelf: 'flex-start',
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: colors.graphite,
                  borderWidth: 1,
                  borderColor: withAlpha(colors.slate, 0.3),
                  marginTop: 8,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                {draft.sortDir === -1 ? (
                  <ArrowDown size={12} color={colors.soft} strokeWidth={2} />
                ) : (
                  <ArrowUp size={12} color={colors.soft} strokeWidth={2} />
                )}
                <Text
                  style={{ fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.soft }}
                >
                  {draft.sortDir === -1 ? 'High → Low' : 'Low → High'}
                </Text>
              </Pressable>
            </Section>
          </ScrollView>

          <View
            className="flex-row gap-3"
            style={{ paddingHorizontal: 24, paddingTop: 8 }}
          >
            <View style={{ flex: 1 }}>
              <GradientButton
                label="Reset"
                variant="secondary"
                onPress={() => setDraft(DEFAULT_FILTER)}
              />
            </View>
            <View style={{ flex: 1.4 }}>
              <GradientButton label="Apply" onPress={() => onApply(draft)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
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

interface PillRowProps<T> {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}

function PillRow<T>({ options, value, onChange }: PillRowProps<T>) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            onPress={() => {
              Haptics.selectionAsync()
              onChange(o.value)
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: active ? withAlpha(colors.brand.primary, 0.18) : colors.graphite,
              borderWidth: 1,
              borderColor: active ? colors.brand.primary : withAlpha(colors.slate, 0.3),
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {active ? <Check size={12} color={colors.brand.primary} strokeWidth={2.5} /> : null}
            <Text
              style={{
                fontFamily: 'Inter_500Medium',
                fontSize: 13,
                color: active ? colors.brand.primary : colors.soft,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
