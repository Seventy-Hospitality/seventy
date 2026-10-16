import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { BookingWithCourt } from '../lib/clutch';
import {
  bookingStatusLabel,
  formatDateHeading,
  formatMoney,
  formatTimeRangeCompact,
  sportLabel,
} from '../features/reserve/booking';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { Badge, bookingStatusVariant } from './Badge';

/** The fields of a Clutch booking row (GET /me/bookings) the card renders. */
export type BookingCardBooking = Pick<
  BookingWithCourt,
  'id' | 'date' | 'start_time' | 'end_time' | 'status' | 'court_name' | 'court_type' | 'currency'
> &
  Partial<Pick<BookingWithCourt, 'my_due_cents'>>;

interface BookingCardProps {
  booking: BookingCardBooking;
  variant?: 'standard' | 'highlight';
  /** Defaults to opening the booking (/bookings/[id]). */
  onPress?: () => void;
}

/**
 * A booking in a list (home, groups): date and time on the club's clock, the
 * sport and court, its status, and what the viewer still owes when Clutch
 * says they owe something.
 */
export function BookingCard({ booking, onPress, variant = 'standard' }: BookingCardProps) {
  const router = useRouter();
  const open = onPress ?? (() => router.push(`/bookings/${booking.id}`));
  const sport = booking.court_type ? sportLabel(booking.court_type) : 'Court';
  const when = `${formatDateHeading(booking.date)} | ${formatTimeRangeCompact(booking.start_time, booking.end_time)}`;
  const due = booking.my_due_cents ?? 0;
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${sport}, ${booking.court_name ?? 'court'}, ${when}, ${bookingStatusLabel(booking.status)}`}
      style={({ pressed }) => [
        styles.card,
        variant === 'highlight' ? styles.highlightCard : null,
        pressed ? styles.cardPressed : null,
      ]}
    >
      <View style={styles.row}>
        <Text style={styles.title}>{when}</Text>
        <Badge label={bookingStatusLabel(booking.status)} variant={bookingStatusVariant(booking.status)} />
      </View>
      <Text style={styles.meta}>
        {sport}
        {booking.court_name ? ` · ${booking.court_name}` : ''}
      </Text>
      {due > 0 ? <Text style={styles.due}>You owe {formatMoney(due, booking.currency)}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(125, 151, 124, 0.22)',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: 'rgba(240, 246, 232, 0.06)',
  },
  highlightCard: {
    backgroundColor: 'rgba(210, 195, 166, 0.22)',
  },
  cardPressed: {
    opacity: 0.92,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.bodyBold,
    fontSize: 15,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
  },
  due: {
    color: colors.accent,
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
  },
});
