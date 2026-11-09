import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BookingCard, FeatureUnavailable, PrimaryButton, Sheet, useToast } from '../../components';
import { clutch } from '../../lib/clutch';
import { colors, fonts, spacing } from '../../theme/tokens';
import { describeBookingFailure } from '../reserve/booking-failures';
import { usePlayingBookings, type PlayingBooking } from './accepted-bookings';
import { SharePayBox } from './PayBoxes';
import { useLeaveBooking } from './useLeaveBooking';

/**
 * "Games you're playing": bookings this member accepted an invitation to
 * (usePlayingBookings; Clutch has no list of these yet). Each shows as a
 * booking card with Pay share and Leave, both Clutch P4 actions offered only
 * with bookingParity on. Renders nothing while there are none, so a home or
 * bookings list can drop it in unconditionally.
 */
export function PlayingBookingsSection({ title = "Games you're playing" }: { title?: string }) {
  const playing = usePlayingBookings();
  if (!playing.data || playing.data.length === 0) return null;
  return (
    <View style={styles.section} accessibilityLabel={title}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {playing.data.map((entry) => (
        <PlayingBookingRow key={entry.booking.id} entry={entry} />
      ))}
    </View>
  );
}

export function PlayingBookingRow({ entry }: { entry: PlayingBooking }) {
  const router = useRouter();
  const { toast } = useToast();
  const leave = useLeaveBooking();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const parity = clutch.capabilities.bookingParity;
  const { booking, myDue } = entry;
  const owes = !!myDue && myDue.due_cents > 0 && booking.status === 'confirmed';

  return (
    <View style={styles.row}>
      <BookingCard booking={entry.card} onPress={() => router.push(`/bookings/${booking.id}`)} />
      {owes && myDue ? <SharePayBox booking={booking} due={myDue} /> : null}
      {parity ? (
        <PrimaryButton label="Leave" variant="ghost" onPress={() => setLeaveOpen(true)} />
      ) : (
        <FeatureUnavailable
          capability="bookingParity"
          title="Leaving a booking is not available in the app yet"
          description="Ask the member who booked to take you off for now."
          compact
        />
      )}
      <Sheet
        open={leaveOpen}
        onClose={() => {
          if (!leave.isPending) setLeaveOpen(false);
        }}
        title="Leave booking"
      >
        <View style={styles.dialog}>
          <Text style={styles.dialogText}>
            Leave this booking? You give up your spot and would need a new invitation to rejoin.
          </Text>
          <PrimaryButton
            label="Leave booking"
            variant="danger"
            loading={leave.isPending}
            onPress={() =>
              leave.mutate(booking.id, {
                onSuccess: () => {
                  setLeaveOpen(false);
                  toast({ variant: 'success', message: 'You left this booking.' });
                },
                onError: (error) => {
                  setLeaveOpen(false);
                  const failure = describeBookingFailure(error, { bookingParity: parity });
                  toast({ variant: 'error', message: `${failure.title}. ${failure.message}` });
                },
              })
            }
          />
          <PrimaryButton label="Stay" variant="ghost" disabled={leave.isPending} onPress={() => setLeaveOpen(false)} />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  row: { gap: spacing.xs },
  dialog: { gap: spacing.md, paddingBottom: spacing.sm },
  dialogText: { color: colors.text, fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
});
