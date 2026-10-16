import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  clutch,
  hasCode,
  useMutationKey,
  type BookingDetail,
  type BookingId,
  type BookingPlayer,
} from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { bookingQuery, queryKeys } from '../../lib/queries';
import { useSession } from '../../lib/session';
import {
  Avatar,
  Badge,
  bookingStatusVariant,
  EmptyStateView,
  playerStatusVariant,
  PrimaryButton,
  Sheet,
  Skeleton,
  useToast,
} from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import {
  bookingStatusLabel,
  formatDateLong,
  formatDuration,
  formatMoney,
  formatTimeRangeCompact,
  playerStatusLabel,
  timeToMinutes,
} from '../reserve/booking';
import { describeBookingFailure } from '../reserve/booking-failures';
import { BookingSummaryCard } from '../reserve/BookingSummaryCard';
import { bookingRulesOf, usableTimezone } from '../reserve/club-rules';
import { useBookingPayment } from '../reserve/useBookingPayment';
import { playerDisplayName, rosterOf, viewerOf, type BookingViewer } from './booking-viewer';
import { useRespondToBooking } from './useRespondToBooking';

/**
 * One booking (GET /bookings/{id}): the court and time on the club's clock,
 * its status, the players, and what the viewer owes (Clutch's dues).
 *
 * - the booker cancels (Clutch applies the cancellation window and refund
 *   policy), reschedules, invites more, removes a player, pays a hold or a
 *   balance;
 * - an invited player accepts or declines; an accepted player leaves or pays
 *   their share.
 */
export function BookingDetailScreen({ bookingId }: { bookingId: BookingId }) {
  const detail = useQuery(bookingQuery(bookingId));
  const club = useClub();

  if (detail.isPending || club.isPending) {
    return (
      <DetailFrame>
        <View accessibilityLabel="Loading booking" style={styles.loading}>
          <Skeleton height={132} borderRadius={radius.lg} />
          <Skeleton height={220} borderRadius={radius.lg} />
        </View>
      </DetailFrame>
    );
  }

  if (detail.isError && hasCode(detail.error, 'booking_not_found', 'not_found')) {
    // Clutch answers "not found" for a booking the caller may not see, on
    // purpose: "denied" and "missing" look the same.
    return (
      <DetailFrame>
        <EmptyStateView
          title="Booking not found"
          description="This booking does not exist, was removed, or you are not part of it."
        />
      </DetailFrame>
    );
  }

  if (detail.isError || club.isError) {
    return (
      <DetailFrame>
        <View style={styles.banner} accessibilityRole="alert">
          <Text style={styles.bannerText}>We could not load this booking.</Text>
          <PrimaryButton
            label="Try again"
            variant="secondary"
            onPress={() => {
              if (detail.isError) void detail.refetch();
              if (club.isError) void club.refetch();
            }}
          />
        </View>
      </DetailFrame>
    );
  }

  return (
    <BookingDetailView
      booking={detail.data}
      timezone={usableTimezone(club.data.timezone)}
      cancellationHours={bookingRulesOf(club.data).cancellation_hours ?? null}
    />
  );
}

function DetailFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          hitSlop={8}
          style={styles.backLink}
        >
          <Ionicons name="chevron-back" size={18} color={colors.textLink} />
          <Text style={styles.backLinkText}>Back</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>
          Booking details
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function BookingDetailView({
  booking,
  timezone,
  cancellationHours,
}: {
  booking: BookingDetail;
  timezone: string;
  cancellationHours: number | null;
}) {
  const { userId } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const viewer = viewerOf(booking, userId, timezone);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<BookingPlayer | null>(null);

  const cancelKey = useMutationKey();
  const removeKey = useMutationKey();
  const respond = useRespondToBooking();

  const refreshEverywhere = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
    void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    void queryClient.invalidateQueries({ queryKey: queryKeys.availability(booking.date) });
  };

  const fail = (error: unknown) => {
    const failure = describeBookingFailure(error);
    toast({ variant: 'error', message: `${failure.title}. ${failure.message}` });
    if (failure.action === 'refresh') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(booking.id) });
    }
  };

  const cancel = useMutation({
    mutationFn: () =>
      cancelKey.run({ cancel: booking.id }, (key) =>
        clutch.bookings.cancel(booking.id, { idempotencyKey: key }),
      ),
    onSuccess: (result) => {
      setCancelOpen(false);
      refreshEverywhere();
      // Clutch applied its cancellation policy; say what it recorded.
      toast({
        variant: 'success',
        message:
          result.payment_status === 'refunded'
            ? 'Booking cancelled. The club is returning your payment to your card.'
            : 'Booking cancelled.',
      });
    },
    onError: (error) => {
      setCancelOpen(false);
      fail(error);
    },
  });

  const remove = useMutation({
    mutationFn: (target: BookingPlayer) =>
      removeKey.run({ booking: booking.id, user: target.user_id }, (key) =>
        clutch.bookings.removePlayer(booking.id, target.user_id, { idempotencyKey: key }),
      ),
    onSuccess: (_result, target) => {
      setRemoveTarget(null);
      setLeaveOpen(false);
      refreshEverywhere();
      toast({
        variant: 'success',
        message:
          target.user_id === userId
            ? 'You left this booking.'
            : `${playerDisplayName(target)} was removed from the booking.`,
      });
      if (target.user_id === userId) {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
      }
    },
    onError: (error) => {
      setRemoveTarget(null);
      setLeaveOpen(false);
      fail(error);
    },
  });

  const payment = useBookingPayment(booking.id, {
    onConfirmed: () => toast({ variant: 'success', message: 'Payment received.' }),
    onSubmitted: () =>
      toast({ variant: 'info', message: 'Payment sent. Your share shows as paid once the club records it.' }),
  });

  function payDue() {
    if (!viewer.payMode || !viewer.myDue) return;
    const due = viewer.myDue.due_cents;
    switch (viewer.payMode) {
      case 'hold':
        void payment.pay({ amountCents: due, settle: 'confirm' });
        return;
      case 'balance':
        void payment.pay({ amountCents: due, shareCents: due, settle: 'confirm' });
        return;
      case 'share':
        void payment.pay({ amountCents: due, shareCents: due, settle: 'refetch' });
        return;
    }
  }

  function respondWith(accept: boolean) {
    respond.mutate(
      { bookingId: booking.id, accept },
      {
        onSuccess: () =>
          toast({
            variant: 'success',
            message: accept ? 'You are in. See you on court.' : 'Invitation declined.',
          }),
        onError: fail,
      },
    );
  }

  const roster = rosterOf(booking);
  const minutes = timeToMinutes(booking.end_time) - timeToMinutes(booking.start_time);
  const sport = booking.court?.court_type ?? 'court';
  const paymentBusy = payment.stage !== 'idle' && payment.stage !== 'submitted';

  return (
    <DetailFrame>
      <StatusBanners booking={booking} viewer={viewer} />

      <BookingSummaryCard
        sport={sport}
        courtName={booking.court?.name ?? null}
        trailing={<Badge label={bookingStatusLabel(booking.status)} variant={bookingStatusVariant(booking.status)} />}
        rows={[
          { label: 'Date', value: formatDateLong(booking.date) },
          { label: 'Time', value: formatTimeRangeCompact(booking.start_time, booking.end_time) },
          { label: 'Duration', value: formatDuration(minutes) },
          ...(viewer.isBooker
            ? [{ label: 'Price', value: formatMoney(booking.price_cents, booking.currency) }]
            : []),
        ]}
      />

      {booking.booker_name && !viewer.isBooker ? (
        <Text style={styles.meta}>Booked by {booking.booker_name}</Text>
      ) : null}

      {viewer.myDue ? (
        <View style={styles.dueBox}>
          <View style={styles.dueRow}>
            <Text style={styles.dueLabel}>{viewer.myDue.due_cents > 0 ? 'You owe' : 'Your part'}</Text>
            <Text style={styles.dueAmount}>
              {formatMoney(
                viewer.myDue.due_cents > 0 ? viewer.myDue.due_cents : viewer.myDue.paid_cents,
                booking.currency,
              )}
            </Text>
          </View>
          {viewer.myDue.due_cents <= 0 && viewer.myDue.paid_cents > 0 ? (
            <Text style={styles.dueHint}>Paid. Thank you.</Text>
          ) : null}
          {viewer.payMode ? (
            <PrimaryButton
              label={`Pay ${formatMoney(viewer.myDue.due_cents, booking.currency)}`}
              loading={paymentBusy}
              onPress={payDue}
            />
          ) : null}
          {payment.stage === 'unconfirmed' ? (
            <PrimaryButton label="Check payment again" variant="secondary" onPress={() => void payment.checkAgain()} />
          ) : null}
          {payment.failure ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {payment.failure.title}. {payment.failure.message}
            </Text>
          ) : null}
          {payment.canceled ? (
            <Text style={styles.dueHint}>Payment not completed. You can pay any time before the booking.</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.playersHead}>
        <Text style={styles.sectionLabel}>
          Players <Text style={styles.sectionCount}>{roster.length}</Text>
        </Text>
        {viewer.canInvite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Invite more players"
            hitSlop={8}
            onPress={() => router.push(`/bookings/${booking.id}/invite`)}
          >
            <Text style={styles.sectionLink}>Invite more</Text>
          </Pressable>
        ) : null}
      </View>

      {roster.length === 0 ? (
        <Text style={styles.meta}>
          {viewer.canInvite ? 'No players yet. Invite members or a group.' : 'No other players yet.'}
        </Text>
      ) : (
        <View style={styles.roster} accessibilityLabel="Players">
          {roster.map((player) => {
            const isSelf = player.user_id === userId;
            const name = playerDisplayName(player);
            return (
              <View
                key={player.user_id}
                style={styles.playerRow}
                accessibilityLabel={`${name}${isSelf ? ' (you)' : ''}, ${playerStatusLabel(player.status)}`}
              >
                <Avatar name={name} src={player.avatar_url} size="md" />
                <Text style={styles.playerName} numberOfLines={1}>
                  {name}
                  {isSelf ? <Text style={styles.playerYou}> (you)</Text> : null}
                </Text>
                <Badge label={playerStatusLabel(player.status)} variant={playerStatusVariant(player.status)} />
                {viewer.canRemovePlayers ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${name}`}
                    hitSlop={8}
                    onPress={() => setRemoveTarget(player)}
                    style={({ pressed }) => [styles.menuButton, pressed ? styles.pressed : null]}
                  >
                    <Ionicons name="close" size={18} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {viewer.canRespond ? (
        <View style={styles.actions} accessibilityLabel="Respond to this invitation">
          <PrimaryButton
            label="Accept"
            accessibilityLabel="Accept invitation"
            loading={respond.isPending && respond.variables?.accept === true}
            disabled={respond.isPending}
            onPress={() => respondWith(true)}
          />
          <PrimaryButton
            label="Decline"
            accessibilityLabel="Decline invitation"
            variant="ghost"
            loading={respond.isPending && respond.variables?.accept === false}
            disabled={respond.isPending}
            onPress={() => respondWith(false)}
          />
        </View>
      ) : null}

      {viewer.canReschedule || viewer.canCancel || viewer.canLeave ? (
        <View style={styles.actions}>
          {viewer.canReschedule ? (
            <PrimaryButton label="Change time" onPress={() => router.push(`/bookings/${booking.id}/edit`)} />
          ) : null}
          {viewer.canCancel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel booking"
              onPress={() => setCancelOpen(true)}
              style={styles.textAction}
            >
              <Text style={styles.textActionLabel}>Cancel booking</Text>
            </Pressable>
          ) : null}
          {viewer.canLeave ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Leave booking"
              onPress={() => setLeaveOpen(true)}
              style={styles.textAction}
            >
              <Text style={styles.textActionLabel}>Leave booking</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Sheet
        open={cancelOpen}
        onClose={() => {
          if (!cancel.isPending) setCancelOpen(false);
        }}
        title="Cancel booking"
      >
        <View style={styles.dialogBody}>
          <Text style={styles.dialogText}>
            Cancel your booking on {formatDateLong(booking.date)},{' '}
            {formatTimeRangeCompact(booking.start_time, booking.end_time)}?
          </Text>
          <Text style={styles.dialogHint}>
            {cancellationHours
              ? `The club's cancellation policy applies (${cancellationHours} hours before the start). The club decides any refund and returns it to your card.`
              : "The club's cancellation policy applies. The club decides any refund and returns it to your card."}
          </Text>
          <View style={styles.dialogActions}>
            <PrimaryButton
              label="Cancel booking"
              variant="danger"
              loading={cancel.isPending}
              onPress={() => cancel.mutate()}
            />
            <PrimaryButton
              label="Keep booking"
              variant="ghost"
              disabled={cancel.isPending}
              onPress={() => setCancelOpen(false)}
            />
          </View>
        </View>
      </Sheet>

      <Sheet
        open={leaveOpen}
        onClose={() => {
          if (!remove.isPending) setLeaveOpen(false);
        }}
        title="Leave booking"
      >
        <View style={styles.dialogBody}>
          <Text style={styles.dialogText}>
            Leave this booking? You give up your spot and would need a new invitation to rejoin.
          </Text>
          <View style={styles.dialogActions}>
            <PrimaryButton
              label="Leave booking"
              variant="danger"
              loading={remove.isPending}
              onPress={() => {
                const self = viewer.me;
                if (self) remove.mutate(self);
              }}
            />
            <PrimaryButton
              label="Stay"
              variant="ghost"
              disabled={remove.isPending}
              onPress={() => setLeaveOpen(false)}
            />
          </View>
        </View>
      </Sheet>

      <Sheet
        open={removeTarget !== null}
        onClose={() => {
          if (!remove.isPending) setRemoveTarget(null);
        }}
        title={removeTarget ? `Remove ${playerDisplayName(removeTarget)}` : 'Remove player'}
      >
        {removeTarget ? (
          <View style={styles.dialogBody}>
            <Text style={styles.dialogText}>
              Remove {playerDisplayName(removeTarget)} from this booking? You can invite them again later.
            </Text>
            <View style={styles.dialogActions}>
              <PrimaryButton
                label="Remove from booking"
                variant="danger"
                loading={remove.isPending}
                onPress={() => remove.mutate(removeTarget)}
              />
              <PrimaryButton
                label="Keep"
                variant="ghost"
                disabled={remove.isPending}
                onPress={() => setRemoveTarget(null)}
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </DetailFrame>
  );
}

function StatusBanners({ booking, viewer }: { booking: BookingDetail; viewer: BookingViewer }) {
  if (booking.status === 'cancelled') return <StatusBanner tone="danger" text="This booking was cancelled." />;
  if (booking.status === 'no_show') return <StatusBanner tone="danger" text="This booking was marked as a no show." />;
  if (booking.status === 'pending' && viewer.isBooker) {
    return (
      <StatusBanner
        tone="neutral"
        text={
          viewer.holdEnded
            ? 'The hold on this court ended before it was paid. Book a new time from Reserve.'
            : 'This court is held for you until you pay. Pay below to confirm it.'
        }
      />
    );
  }
  if (viewer.me?.status === 'invited' && viewer.active) {
    return <StatusBanner tone="neutral" text="You are invited to this booking." />;
  }
  return null;
}

function StatusBanner({ tone, text }: { tone: 'danger' | 'neutral'; text: string }) {
  return (
    <View style={[styles.statusBanner, tone === 'danger' ? styles.statusBannerDanger : null]} accessibilityRole="alert">
      <Text style={styles.statusBannerText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: -4,
  },
  backLinkText: {
    color: colors.textLink,
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 28,
  },
  loading: {
    gap: spacing.md,
  },
  banner: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  bannerText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  statusBanner: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  statusBannerDanger: {
    borderColor: colors.dangerStrong,
    backgroundColor: colors.surfaceOverlay,
  },
  statusBannerText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  dueBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dueLabel: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
  },
  dueAmount: {
    color: colors.accent,
    fontFamily: fonts.displayBold,
    fontSize: 18,
  },
  dueHint: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  errorText: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  playersHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionCount: {
    color: colors.textSubtle,
  },
  sectionLink: {
    color: colors.accent,
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
  },
  roster: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  playerName: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
  },
  playerYou: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  menuButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.7,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  textAction: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  textActionLabel: {
    color: colors.textLink,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
  },
  dialogBody: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  dialogText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
  },
  dialogHint: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  dialogActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
