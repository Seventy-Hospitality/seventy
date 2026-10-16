import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import type { Booking } from '../lib/clutch';

type BookingStatus = Booking['status'];

export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'danger' | 'warning' | 'pro';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
}

const TONES: Record<BadgeVariant, { bg: string; fg: string }> = {
  neutral: { bg: 'rgba(174, 183, 158, 0.16)', fg: colors.textMuted },
  accent: { bg: 'rgba(236, 254, 170, 0.16)', fg: colors.accent },
  success: { bg: 'rgba(190, 206, 133, 0.18)', fg: colors.success },
  danger: { bg: 'rgba(220, 161, 131, 0.18)', fg: colors.danger },
  warning: { bg: 'rgba(220, 161, 131, 0.14)', fg: colors.dangerStrong },
  pro: { bg: colors.accent, fg: colors.textOnAccent },
};

/** Uppercase pill label (statuses, "PRO", "INVITE ONLY"). */
export function Badge({ label, variant = 'neutral', style }: BadgeProps) {
  const tone = TONES[variant];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }, style]}>
      <Text style={[styles.label, { color: tone.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const BOOKING_TONE: Record<BookingStatus, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'success',
  cancelled: 'danger',
  completed: 'neutral',
  no_show: 'neutral',
};

/** Player rows type their status as a string (`invited`, `accepted`, `declined`). */
const PLAYER_TONE: Record<string, BadgeVariant> = {
  accepted: 'success',
  invited: 'warning',
  declined: 'danger',
};

/** Map a Clutch booking status to a badge variant (bookings, home, groups). */
export function bookingStatusVariant(status: BookingStatus): BadgeVariant {
  return BOOKING_TONE[status] ?? 'neutral';
}

/** Map a booking player's status to a badge variant. */
export function playerStatusVariant(status: string): BadgeVariant {
  return PLAYER_TONE[status] ?? 'neutral';
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
