import { StyleSheet, Text, View } from 'react-native';
import type { Booking } from '../../lib/clutch';
import { Badge, bookingStatusVariant, PrimaryButton, Sheet } from '../../components';
import { colors, fonts, spacing } from '../../theme/tokens';
import {
  bookingStatusLabel,
  formatDateFull,
  formatMoney,
  formatTimeRangeCompact,
  sportLabel,
} from './booking';
import { BookingSummaryCard } from './BookingSummaryCard';

export interface ConfirmationSheetProps {
  booking: Booking;
  sport: string;
  courtName: string | null;
  onInvitePlayers: () => void;
  onViewBooking: () => void;
  onClose: () => void;
}

/**
 * The success sheet after Clutch confirmed the booking: what was booked, what
 * Clutch recorded as paid, and the next steps (invite players, open the
 * booking).
 */
export function ConfirmationSheet({
  booking,
  sport,
  courtName,
  onInvitePlayers,
  onViewBooking,
  onClose,
}: ConfirmationSheetProps) {
  const paid = booking.paid_cents ?? 0;
  return (
    <Sheet open onClose={onClose} title="Booking confirmed">
      <View style={styles.body}>
        <Text style={styles.title}>Your {sportLabel(sport).toLowerCase()} court is booked</Text>
        <Text style={styles.caption}>The club sends a confirmation to your email</Text>

        <BookingSummaryCard
          sport={sport}
          courtName={courtName}
          trailing={<Badge label={bookingStatusLabel(booking.status)} variant={bookingStatusVariant(booking.status)} />}
          rows={[
            { label: 'Date', value: formatDateFull(booking.date) },
            { label: 'Time', value: formatTimeRangeCompact(booking.start_time, booking.end_time) },
            {
              label: paid > 0 ? 'Amount paid' : 'Price',
              value: formatMoney(paid > 0 ? paid : booking.price_cents, booking.currency),
            },
          ]}
        />

        <View style={styles.actions}>
          <PrimaryButton label="Invite players" onPress={onInvitePlayers} />
          <PrimaryButton label="View booking" variant="ghost" onPress={onViewBooking} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 20,
  },
  caption: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    marginTop: -spacing.xs,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
