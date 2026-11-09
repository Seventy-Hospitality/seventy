import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { hasCode, type BookingId } from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { bookingQuery } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { EmptyStateView, PrimaryButton, useToast } from '../../components';
import { colors, fonts, spacing } from '../../theme/tokens';
import { formatDateHeading, formatTimeRangeCompact } from '../reserve/booking';
import { usableTimezone } from '../reserve/club-rules';
import { InvitePlayersStep } from '../reserve/InvitePlayersStep';
import { WizardFrame } from '../reserve/WizardFrame';
import { viewerOf } from './booking-viewer';

/**
 * "Invite more" from the booking screen: the same invite step the wizard
 * shows after confirmation, against this booking. Only the booker of a
 * confirmed booking that has not started may invite (invite-group requires a
 * confirmed booking of the caller's).
 */
export function InviteMoreScreen({ bookingId }: { bookingId: BookingId }) {
  const router = useRouter();
  const { toast } = useToast();
  const { userId } = useSession();
  const detail = useQuery(bookingQuery(bookingId));
  const club = useClub();

  const backToDetail = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/bookings/${bookingId}`);
  }, [router, bookingId]);

  if (detail.isPending || club.isPending) {
    return (
      <WizardFrame onBack={backToDetail} onClose={backToDetail}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerText}>Loading booking</Text>
        </View>
      </WizardFrame>
    );
  }

  if (detail.isError || club.isError) {
    const missing = detail.isError && hasCode(detail.error, 'booking_not_found', 'not_found');
    return (
      <WizardFrame onBack={backToDetail} onClose={backToDetail}>
        <View style={styles.gate}>
          <EmptyStateView
            title={missing ? 'Booking not found' : 'We could not load this booking'}
            description={
              missing
                ? 'This booking does not exist, was removed, or you are not part of it.'
                : 'Check your connection and try again.'
            }
          />
          {missing ? null : (
            <PrimaryButton
              label="Try again"
              variant="secondary"
              onPress={() => {
                if (detail.isError) void detail.refetch();
                if (club.isError) void club.refetch();
              }}
            />
          )}
        </View>
      </WizardFrame>
    );
  }

  const booking = detail.data;
  const viewer = viewerOf(booking, userId, usableTimezone(club.data.timezone));
  if (!viewer.canInvite) {
    return (
      <WizardFrame onBack={backToDetail} onClose={backToDetail}>
        <View style={styles.gate}>
          <EmptyStateView
            title="Inviting is not available"
            description="The member who booked can invite players once the booking is confirmed and before it starts."
          />
          <PrimaryButton label="Back to booking" onPress={backToDetail} />
        </View>
      </WizardFrame>
    );
  }

  return (
    <WizardFrame onBack={backToDetail} onClose={backToDetail}>
      <InvitePlayersStep
        bookingId={booking.id}
        subtitle={`${formatDateHeading(booking.date)} · ${formatTimeRangeCompact(booking.start_time, booking.end_time)}`}
        excludeUserIds={booking.players.filter((p) => p.status !== 'declined').map((p) => p.user_id)}
        onSent={() => {
          toast({ variant: 'success', message: 'Invites sent' });
          backToDetail();
        }}
      />
    </WizardFrame>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  centerText: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  gate: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
});
