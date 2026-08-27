import { Text, View } from 'react-native'
import { colors } from '@/theme/colors'

// Shown on every surface that displays ROI / max-bid / profit estimates.
// Apple requires a clear "not advice" disclaimer on financial-estimate UI.
const DISCLAIMER_TEXT = 'Estimates only — not investment, legal, or tax advice.'

interface FinancialDisclaimerProps {
  /** Append extra context (e.g. diligence reminders) after the standard line. */
  extra?: string
}

export function FinancialDisclaimer({ extra }: FinancialDisclaimerProps) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 10,
          color: colors.dim,
          textAlign: 'center',
          lineHeight: 14,
        }}
      >
        {DISCLAIMER_TEXT}
        {extra ? ` ${extra}` : ''}
      </Text>
    </View>
  )
}
