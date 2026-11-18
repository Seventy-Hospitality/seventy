import { StyleSheet, Text, View } from 'react-native';
import { Badge, bookingStatusVariant, PrimaryButton, Sheet } from '../../components';
import { colors, fonts, spacing } from '../../theme/tokens';
import {
  bookingStatusLabel,
  formatDateFull,
  formatMoney,
  formatTimeRangeCompact,
  sportLabel,
  type BookingStatus,
} from './booking';
import { BookingSummaryCard } from './BookingSummaryCard';
import { chargeLines, type Charge } from './charge';
import type { BookingFacts } from './useBookingPayment';

export interface ConfirmationSheetProps {
  booking: BookingFacts;
  /** What checkout showed for this booking (Clutch's figures); null when free. */
  charge: Charge | null;
  sport: string;
  courtName: string | null;
  onInvitePlayers: () => void;
  onViewBooking: () => void;
  onClose: () => void;
}

/**
 * The success sheet after Clutch confirmed the booking: what was booked, the
 * charge as checkout showed it (Clutch's own lines, tax included in any
 * total), and the next steps (invite players, open the booking).
 */
export function ConfirmationSheet({
  booking,
  charge,
  sport,
  courtName,
  onInvitePlayers,
  onViewBooking,
  onClose,
}: ConfirmationSheetProps) {
  const status = booking.status as BookingStatus;
  const priceRows = paidRows(booking, charge);
  return (
    <Sheet open onClose={onClose} title="Booking confirmed">
      <View style={styles.body}>
        <Text style={styles.title}>Your {sportLabel(sport).toLowerCase()} court is booked</Text>
        <Text style={styles.caption}>The club sends a confirmation to your email</Text>

        <BookingSummaryCard
          sport={sport}
          courtName={courtName}
          trailing={<Badge label={bookingStatusLabel(status)} variant={bookingStatusVariant(status)} />}
          rows={[
            { label: 'Date', value: formatDateFull(booking.date) },
            { label: 'Time', value: formatTimeRangeCompact(booking.start_time, booking.end_time) },
            ...priceRows,
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

/**
 * The money rows: the lines checkout showed when Clutch priced the tax (a
 * quote, or the intent's subtotal and tax); otherwise just the court price,
 * since the card statement is the only total we were not told.
 */
function paidRows(booking: BookingFacts, charge: Charge | null): { label: string; value: string }[] {
  if (!charge) return [{ label: 'Price', value: 'Free' }];
  const priced =
    charge.kind === 'quoted' ||
    charge.kind === 'checkout' ||
    (charge.kind === 'split' && (charge.subtotal_cents !== null || charge.tax_cents !== null));
  if (!priced) return [{ label: 'Court price', value: formatMoney(booking.price_cents, booking.currency) }];
  return chargeLines(charge).map((line) => ({
    label: line.label === 'Total due today' ? 'Total' : line.label,
    value: line.value,
  }));
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
