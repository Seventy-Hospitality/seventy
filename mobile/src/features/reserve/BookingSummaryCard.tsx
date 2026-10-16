import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { sportLabel } from './booking';
import { SportTile } from './SportIcon';

export interface BookingSummaryRow {
  label: string;
  value: string;
}

export interface BookingSummaryCardProps {
  /** The court_type ("tennis"); shown as the sport. */
  sport: string;
  /** The court ("Court 2"). */
  courtName?: string | null;
  rows: BookingSummaryRow[];
  /** Trailing element in the header (a status badge). */
  trailing?: ReactNode;
  children?: ReactNode;
}

/**
 * A booking's card: sport glyph and name, the court, then label/value rows.
 * Used by checkout, the confirmation sheet, the booking screen and reschedule.
 */
export function BookingSummaryCard({ sport, courtName, rows, trailing, children }: BookingSummaryCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <SportTile sport={sport} />
        <View style={styles.headText}>
          <Text style={styles.sport} numberOfLines={1}>
            {sportLabel(sport)}
          </Text>
          {courtName ? (
            <Text style={styles.court} numberOfLines={1}>
              {courtName}
            </Text>
          ) : null}
        </View>
        {trailing ? <View style={styles.headTrailing}>{trailing}</View> : null}
      </View>

      {rows.length > 0 ? (
        <View>
          {rows.map((row, index) => (
            <View key={row.label} style={[styles.row, index === 0 ? styles.rowFirst : null]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value} numberOfLines={1}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  headTrailing: {
    marginLeft: 'auto',
  },
  sport: {
    color: colors.text,
    fontFamily: fonts.displaySemibold,
    fontSize: 17,
  },
  court: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowFirst: {
    borderTopWidth: 0,
    paddingTop: 0,
  },
  label: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
  },
});
