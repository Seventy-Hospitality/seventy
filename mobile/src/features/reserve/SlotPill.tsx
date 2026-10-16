import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { formatPrice, formatSlotRange } from './booking';
import type { TimeOption } from './court-picker';

interface SlotPillProps {
  option: TimeOption;
  selected: boolean;
  onToggle: () => void;
}

/**
 * One offered start time as an accessible toggle, with the grid's per-slot
 * price for browsing ("from" when free courts are priced differently). Only
 * offered times render, so there is no disabled state.
 */
export function SlotPill({ option, selected, onToggle }: SlotPillProps) {
  const range = formatSlotRange(option.start, option.end);
  const price = `${option.pricesVary ? 'from ' : ''}${formatPrice(option.price.cents, option.price.currency)}`;
  const courts = option.freeCourts === 1 ? '1 court' : `${option.freeCourts} courts`;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${range}, ${price}, ${courts} free`}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.pill,
        selected ? styles.pillSelected : null,
        pressed ? styles.pillPressed : null,
      ]}
    >
      <View style={styles.text}>
        <Text style={styles.label}>{range}</Text>
        <Text style={styles.meta}>
          {price}
          {option.price.peak ? ' · peak' : ''} · {courts} free
        </Text>
      </View>
      <View style={[styles.check, selected ? styles.checkSelected : null]}>
        {selected ? <Ionicons name="checkmark" size={15} color={colors.textOnAccent} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceOverlay,
  },
  pillPressed: {
    opacity: 0.9,
  },
  text: {
    gap: 2,
  },
  label: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
});
