import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { clutch, hasCode, useMutationKey, type BookingDetail, type BookingId } from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { bookingInvitationsQuery, bookingQuery, queryKeys } from '../../lib/queries';
import { useSession } from '../../lib/session';
import {
  Avatar,
  Badge,
  bookingStatusVariant,
  EmptyStateView,
  FeatureUnavailable,
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
  rangeMinutes,
} from '../reserve/booking';
import { describeBookingFailure } from '../reserve/booking-failures';
import { BookingSummaryCard } from '../reserve/BookingSummaryCard';
import { bookingRulesOf, usableTimezone } from '../reserve/club-rules';
import { releaseHoldIfPending } from '../reserve/hold-release';
import { paymentLedger, usePaymentLedger } from '../reserve/payment-ledger';
import { rememberAcceptedBooking } from './accepted-bookings';
import {
  playerDisplayName,
  rosterOf,
  viewerOf,
  type BookingPlayer,
  type BookingViewer,
} from './booking-viewer';
import { BookerPayBox, DueRow, SharePayBox } from './PayBoxes';
import { useLeaveBooking } from './useLeaveBooking';
import { useRespondToBooking } from './useRespondToBooking';

/**
 * One booking (GET /bookings/{id}): the court and time on the club's clock,
 * its status, the players, and what the viewer owes (Clutch's dues).
 *
 * - the booker cancels (Clutch applies the cancellation window and refund
 *   policy; a pending hold is released only after a fresh read says it is
 *   still a hold), reschedules, invites more, removes a player (P4), pays a
 *   hold or a balance;
 * - an invited player accepts or declines (P4); an accepted player leaves
 *   (P4) or pays their share (P4).
 *
 * Every P4 action is offered only with clutch.capabilities.bookingParity on;
 * otherwise its place says it is not available in the app yet. Players carry
 * no names in the contract: each row reads "Player" (the booker's name shows
 * from the pending invitation, when there is one).
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
    // purpose: "denied" and "missing" look the same. A hold that ran out is
    // removed too.
    return (
      <DetailFrame>
        <EmptyStateView
          title="Booking not found"
          description="This booking does not exist, was removed (a hold that ran out is), or you are not part of it."
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
      cancellationHours={bookingRulesOf(club.data).cancellation_hours}
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
  usePaymentLedger();
  const viewer = viewerOf(booking, userId, timezone);
  const parity = clutch.capabilities.bookingParity;

  const [cancelOpen, setCancelOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<BookingPlayer | null>(null);

  const cancelKey = useMutationKey();
  const removeKey = useMutationKey();
  const respond = useRespondToBooking();
  const leave = useLeaveBooking();

  // The booker's name, from the pending invitation (players have no names).
  const invitations = useQuery({ ...bookingInvitationsQuery, enabled: !viewer.isBooker && !!viewer.me });
  const inviterName = invitations.data?.find(
    (invitation) => invitation.booking_id === booking.id,
  )?.inviter_name;

  // Remember a booking this member plays in: Clutch lists none of them.
  const playing = !!userId && viewer.me?.status === 'accepted' && viewer.active;
  useEffect(() => {
    if (playing && userId) void rememberAcceptedBooking(userId, booking.id).catch(() => undefined);
  }, [playing, userId, booking.id]);

  const refreshEverywhere = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
    void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    void queryClient.invalidateQueries({ queryKey: queryKeys.availability(booking.date) });
  };

  const fail = (error: unknown) => {
    const failure = describeBookingFailure(error, { bookingParity: parity });
    toast({ variant: 'error', message: `${failure.title}. ${failure.message}` });
    void queryClient.invalidateQueries({ queryKey: queryKeys.booking(booking.id) });
  };

  const paymentInFlight = paymentLedger.inFlight(userId, booking.id);

  const cancel = useMutation({
    mutationFn: async () => {
      const run = (id: BookingId) =>
        cancelKey.run({ cancel: id }, (key) => clutch.bookings.cancel(id, { idempotencyKey: key }));
      if (booking.status === 'pending') {
        // A hold: let it go only while it is still one and no payment is in
        // flight (it may have been confirmed meanwhile): P4's pending-only
        // release, else read-then-cancel.
        const outcome = await releaseHoldIfPending(booking.id, userId, {
          cancel: run,
          release: (id) =>
            cancelKey.run({ release: id }, (key) => clutch.bookings.release(id, { idempotencyKey: key })),
        });
        return { released: outcome === 'released', refunded: false };
      }
      const result = await run(booking.id);
      return { released: true, refunded: result.payment_status === 'refunded' };
    },
    onSuccess: (result) => {
      setCancelOpen(false);
      refreshEverywhere();
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(booking.id) });
      if (!result.released) {
        toast({
          variant: 'info',
          message: 'This booking is no longer just a hold (a payment may have confirmed it). Check it again.',
        });
        return;
      }
      // Clutch applied its cancellation policy; say what it recorded.
      toast({
        variant: 'success',
        message: result.refunded
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
    onSuccess: () => {
      setRemoveTarget(null);
      refreshEverywhere();
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(booking.id) });
      toast({ variant: 'success', message: 'The player was removed from the booking.' });
    },
    onError: (error) => {
      setRemoveTarget(null);
      fail(error);
    },
  });

  function leaveBooking() {
    leave.mutate(booking.id, {
      onSuccess: () => {
        setLeaveOpen(false);
        refreshEverywhere();
        toast({ variant: 'success', message: 'You left this booking.' });
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
      },
      onError: (error) => {
        setLeaveOpen(false);
        fail(error);
      },
    });
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
  const sport = booking.court?.court_type ?? 'court';
  const myDue = viewer.myDue;
  const bookerPays = viewer.isBooker && !!myDue && (viewer.payMode !== null || paymentInFlight);

  return (
    <DetailFrame>
      <StatusBanners booking={booking} viewer={viewer} paymentInFlight={paymentInFlight} />

      <BookingSummaryCard
        sport={sport}
        courtName={booking.court?.name ?? null}
        trailing={
          <Badge label={bookingStatusLabel(booking.status)} variant={bookingStatusVariant(booking.status)} />
        }
        rows={[
          { label: 'Date', value: formatDateLong(booking.date) },
          { label: 'Time', value: formatTimeRangeCompact(booking.start_time, booking.end_time) },
          { label: 'Duration', value: formatDuration(rangeMinutes(booking.start_time, booking.end_time)) },
          ...(viewer.isBooker
            ? [{ label: 'Court price', value: formatMoney(booking.price_cents, booking.currency) }]
            : []),
        ]}
      />

      {inviterName && !viewer.isBooker ? <Text style={styles.meta}>Booked by {inviterName}</Text> : null}

      {myDue && bookerPays && viewer.isBooker ? (
        <BookerPayBox
          key={`booker:${viewer.payMode ?? 'clearing'}`}
          booking={booking}
          due={myDue}
          mode={booking.status === 'pending' ? 'hold' : 'balance'}
        />
      ) : myDue && viewer.payMode === 'share' ? (
        <SharePayBox booking={booking} due={myDue} />
      ) : myDue ? (
        <View style={styles.dueBox}>
          <DueRow booking={booking} due={myDue} />
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
          {roster.map((player, index) => {
            const isSelf = player.user_id === userId;
            const name = isSelf ? 'You' : `${playerDisplayName(player)} ${index + 1}`;
            return (
              <View
                key={player.user_id}
                style={styles.playerRow}
                accessibilityLabel={`${name}, ${playerStatusLabel(player.status)}`}
              >
                <Avatar name={name} size="md" />
                <Text style={styles.playerName} numberOfLines={1}>
                  {name}
                </Text>
                <Badge
                  label={playerStatusLabel(player.status)}
                  variant={playerStatusVariant(player.status)}
                />
                {viewer.canRemovePlayers && parity ? (
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

      {viewer.canRemovePlayers && !parity && roster.length > 0 ? (
        <FeatureUnavailable
          capability="bookingParity"
          title="Removing players is not available in the app yet"
          description="Ask the club to take a player off, or do it on the club website."
          compact
        />
      ) : null}

      {viewer.canRespond ? (
        parity ? (
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
        ) : (
          <FeatureUnavailable
            capability="bookingParity"
            title="Answering invitations is not available in the app yet"
            description="Accept or decline this invitation on the club website for now."
          />
        )
      ) : null}

      {viewer.canReschedule || viewer.canCancel || viewer.canLeave ? (
        <View style={styles.actions}>
          {viewer.canReschedule ? (
            <PrimaryButton label="Change time" onPress={() => router.push(`/bookings/${booking.id}/edit`)} />
          ) : null}
          {viewer.canCancel && !paymentInFlight ? (
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
            parity ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Leave booking"
                onPress={() => setLeaveOpen(true)}
                style={styles.textAction}
              >
                <Text style={styles.textActionLabel}>Leave booking</Text>
              </Pressable>
            ) : (
              <FeatureUnavailable
                capability="bookingParity"
                title="Leaving a booking is not available in the app yet"
                description="Ask the member who booked to take you off for now."
                compact
              />
            )
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
          if (!leave.isPending) setLeaveOpen(false);
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
              loading={leave.isPending}
              onPress={leaveBooking}
            />
            <PrimaryButton
              label="Stay"
              variant="ghost"
              disabled={leave.isPending}
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
        title="Remove player"
      >
        {removeTarget ? (
          <View style={styles.dialogBody}>
            <Text style={styles.dialogText}>
              Remove this player from the booking? You can invite them again later.
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

function StatusBanners({
  booking,
  viewer,
  paymentInFlight,
}: {
  booking: BookingDetail;
  viewer: BookingViewer;
  paymentInFlight: boolean;
}) {
  if (booking.status === 'cancelled')
    return <StatusBanner tone="danger" text="This booking was cancelled." />;
  if (booking.status === 'no_show')
    return <StatusBanner tone="danger" text="This booking was marked as a no show." />;
  if (booking.status === 'pending' && viewer.isBooker) {
    return (
      <StatusBanner
        tone="neutral"
        text={
          paymentInFlight
            ? 'Your payment is clearing. The booking is confirmed once the club sees it settle.'
            : viewer.holdEnded
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
    <View
      style={[styles.statusBanner, tone === 'danger' ? styles.statusBannerDanger : null]}
      accessibilityRole="alert"
    >
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
