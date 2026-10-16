import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { chargeLines, type Charge } from './charge';

/**
 * The order summary: each line is a figure Clutch stated (see charge.ts).
 * Nothing is added up here.
 */
export function ChargeSummary({ charge, title = 'Order summary' }: { charge: Charge; title?: string }) {
  const lines = chargeLines(charge);
  return (
    <View style={styles.box} accessibilityLabel={title}>
      <Text style={styles.title}>{title}</Text>
      {lines.map((line) =>
        line.total ? (
          <View key={line.label}>
            <View style={styles.divider} />
            <View style={[styles.row, styles.totalRow]}>
              <Text style={styles.totalLabel}>{line.label}</Text>
              <Text style={styles.total}>{line.value}</Text>
            </View>
          </View>
        ) : (
          <View key={line.label} style={styles.row}>
            <Text style={styles.label}>{line.label}</Text>
            <Text style={styles.value}>{line.value}</Text>
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontFamily: fonts.displaySemibold, fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  totalRow: { marginTop: spacing.sm },
  label: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
  value: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 14 },
  divider: { height: 1, backgroundColor: colors.border },
  totalLabel: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 15 },
  total: { color: colors.accent, fontFamily: fonts.displayBold, fontSize: 18 },
});
