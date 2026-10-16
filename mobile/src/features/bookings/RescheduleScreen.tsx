import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clutch,
  hasCode,
  useMutationKey,
  type Booking,
  type BookingDetail,
  type BookingId,
  type Club,
  type RescheduleResult,
} from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { bookingQuery, queryKeys } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { EmptyStateView, PrimaryButton, useToast } from '../../components';
import { colors, fonts, spacing } from '../../theme/tokens';
import {
  formatDateLong,
  formatDuration,
  formatMoney,
  formatTimeRangeCompact,
  slotsInRange,
} from '../reserve/booking';
import { describeBookingFailure } from '../reserve/booking-failures';
import { BookingSummaryCard } from '../reserve/BookingSummaryCard';
import { Notice } from '../reserve/CheckoutStep';
import { bookingRulesOf, usableTimezone } from '../reserve/club-rules';
import { ProcessingOverlay } from '../reserve/ProcessingOverlay';
import { SelectTimeStep, type TimePick } from '../reserve/SelectTimeStep';
import { StepShell } from '../reserve/StepShell';
import { useBookingPayment } from '../reserve/useBookingPayment';
import { WizardFrame } from '../reserve/WizardFrame';
import { viewerOf } from './booking-viewer';

const STEP_NAMES = { 1: 'Choose a new time', 2: 'Confirm the change' } as const;

/**
 * Move a confirmed booking to a new date and range (the booker only). Step 1
 * is the booking wizard's time step with this booking's own slots counted as
 * free; pickCourt names the court for the new range. Step 2 shows old and new
 * and calls POST /bookings/{id}/reschedule.
 *
 * Money: Clutch decides. On main a dearer move is refused with
 * reschedule_costs_more, which sends the member back to pick another time.
 * Clutch P4 instead returns the difference as a payment_intent; the app pays
 * it through the one payment path and hands the completed intent to
 * POST /bookings/{id}/confirm. Confirm accepts a verified booker payment on a
 * confirmed booking as a payment to record (it does not need a pending hold),
 * so the difference is recorded the same way a balance is, and Clutch's
 * answer, not the sheet, is what the member sees.
 */
export function RescheduleScreen({ bookingId }: { bookingId: BookingId }) {
  const router = useRouter();
  const detail = useQuery(bookingQuery(bookingId));
  const club = useClub();
  const { userId } = useSession();

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

  const timezone = usableTimezone(club.data.timezone);
  const viewer = viewerOf(detail.data, userId, timezone);
  if (!viewer.canReschedule) {
    return (
      <WizardFrame onBack={backToDetail} onClose={backToDetail}>
        <View style={styles.gate}>
          <EmptyStateView
            title="This booking cannot be moved"
            description={
              viewer.isBooker
                ? 'Only confirmed bookings that have not started can be moved.'
                : 'Only the member who booked can change the time.'
            }
          />
          <PrimaryButton label="Back to booking" onPress={backToDetail} />
        </View>
      </WizardFrame>
    );
  }

  return (
    <RescheduleWizard
      key={detail.data.id}
      booking={detail.data}
      club={club.data}
      timezone={timezone}
      onDone={backToDetail}
    />
  );
}

function RescheduleWizard({
  booking,
  club,
  timezone,
  onDone,
}: {
  booking: BookingDetail;
  club: Club;
  timezone: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const rules = bookingRulesOf(club);
  const sport = booking.court?.court_type ?? '';
  const currentSlots = useMemo(
    () => slotsInRange(booking.start_time, booking.end_time, rules.slot_duration_minutes),
    [booking.start_time, booking.end_time, rules.slot_duration_minutes],
  );
  const own = useMemo(
    () => ({
      court_id: booking.court_id,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
    }),
    [booking.court_id, booking.date, booking.start_time, booking.end_time],
  );

  const [step, setStep] = useState<1 | 2>(1);
  const [date, setDate] = useState(booking.date);
  const [slots, setSlots] = useState<string[]>(currentSlots);
  const [pick, setPick] = useState<TimePick | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const unchanged =
    date === booking.date &&
    slots.length === currentSlots.length &&
    slots.every((slot, index) => slot === currentSlots[index]);

  useEffect(() => {
    if (!locked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [locked]);

  const finish = useCallback(
    (moved: Booking) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.availability(booking.date) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.availability(moved.date) });
      toast({
        variant: 'success',
        message: `Moved to ${formatDateLong(moved.date)}, ${formatTimeRangeCompact(moved.start_time, moved.end_time)}.`,
      });
      onDone();
    },
    [queryClient, booking.date, toast, onDone],
  );

  const backToTimes = (message: string | null) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.availability(date) });
    setNotice(message);
    setStep(1);
  };

  return (
    <WizardFrame
      onBack={() => {
        if (locked) return;
        if (step === 2) setStep(1);
        else onDone();
      }}
      onClose={() => {
        if (!locked) onDone();
      }}
      step={step}
      steps={2}
      stepName={STEP_NAMES[step]}
      chromeDisabled={locked}
    >
      {step === 1 || !pick ? (
        <SelectTimeStep
          sport={sport}
          timezone={timezone}
          rules={rules}
          title="Change time"
          date={date}
          onDateChange={(next) => {
            setDate(next);
            setSlots(next === booking.date ? currentSlots : []);
          }}
          slots={slots}
          onSlotsChange={setSlots}
          own={own}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
          continueDisabled={unchanged}
          onContinue={(next) => {
            setPick(next);
            setStep(2);
          }}
        />
      ) : (
        <ConfirmMove
          booking={booking}
          sport={sport}
          pick={pick}
          onLockChange={setLocked}
          onMoved={finish}
          onBackToTimes={backToTimes}
        />
      )}
    </WizardFrame>
  );
}

function ConfirmMove({
  booking,
  sport,
  pick,
  onLockChange,
  onMoved,
  onBackToTimes,
}: {
  booking: BookingDetail;
  sport: string;
  pick: TimePick;
  onLockChange: (locked: boolean) => void;
  onMoved: (booking: Booking) => void;
  onBackToTimes: (message: string | null) => void;
}) {
  const key = useMutationKey();
  const [moved, setMoved] = useState<RescheduleResult | null>(null);
  const move = {
    new_date: pick.date,
    new_start_time: pick.range.start,
    new_end_time: pick.range.end,
    new_court_id: pick.court.court_id,
  };

  const quote = useQuery({
    queryKey: ['reserve', 'quote', pick.court.court_id, pick.date, pick.range.start, pick.range.end],
    queryFn: () =>
      clutch.bookings.quote({
        court_id: pick.court.court_id,
        date: pick.date,
        start_time: pick.range.start,
        end_time: pick.range.end,
      }),
    retry: false,
  });

  const payment = useBookingPayment(booking.id, {
    onConfirmed: (confirmed) => onMoved(confirmed),
    onLockChange,
  });

  const reschedule = useMutation({
    mutationFn: () =>
      key.run(move, (idempotencyKey) => clutch.bookings.reschedule(booking.id, move, { idempotencyKey })),
    onSuccess: (result) => {
      setMoved(result);
      if (result.payment_intent) {
        // A dearer move (P4): Clutch issued the difference. Pay it and hand the
        // completed intent back through confirm.
        void payment.pay({
          amountCents: result.difference_cents ?? 0,
          intent: result.payment_intent,
          settle: 'confirm',
        });
        return;
      }
      onMoved(result);
    },
    onError: (error) => {
      const failure = describeBookingFailure(error);
      if (failure.action === 'pick-time') onBackToTimes(`${failure.title}. ${failure.message}`);
    },
  });

  const failure = reschedule.isError ? describeBookingFailure(reschedule.error) : payment.failure;
  const paying = payment.stage === 'preparing' || payment.stage === 'paying' || payment.stage === 'confirming';
  const difference = moved?.difference_cents ?? null;

  if (payment.stage === 'unconfirmed') {
    return (
      <StepShell title="Confirm the change">
        <Notice
          title={payment.failure?.title ?? 'Your payment is clearing'}
          message={
            payment.failure?.message ??
            'The club has not seen your payment settle yet. Check again in a moment; you will not be charged twice.'
          }
        >
          <PrimaryButton label="Check again" variant="secondary" onPress={() => void payment.checkAgain()} />
        </Notice>
      </StepShell>
    );
  }

  return (
    <StepShell
      title="Confirm the change"
      footer={
        moved && moved.payment_intent ? (
          <PrimaryButton
            label={`Pay the difference${difference ? ` ${formatMoney(difference, booking.currency)}` : ''}`}
            loading={paying}
            onPress={() =>
              void payment.pay({
                amountCents: difference ?? 0,
                intent: moved.payment_intent ?? undefined,
                settle: 'confirm',
              })
            }
          />
        ) : (
          <PrimaryButton label="Save change" loading={reschedule.isPending} onPress={() => reschedule.mutate()} />
        )
      }
    >
      <BookingSummaryCard
        sport={sport}
        courtName={booking.court?.name ?? null}
        rows={[
          { label: 'Now', value: `${formatDateLong(booking.date)}, ${formatTimeRangeCompact(booking.start_time, booking.end_time)}` },
          { label: 'Price', value: formatMoney(booking.price_cents, booking.currency) },
        ]}
      />
      <BookingSummaryCard
        sport={sport}
        courtName={pick.court.court_name}
        rows={[
          { label: 'New time', value: `${formatDateLong(pick.date)}, ${formatTimeRangeCompact(pick.range.start, pick.range.end)}` },
          { label: 'Duration', value: formatDuration(pick.range.minutes) },
          {
            label: 'New price',
            value: quote.data
              ? formatMoney(quote.data.total_cents, quote.data.currency)
              : quote.isPending
                ? 'Pricing...'
                : 'Set by the club when you save',
          },
        ]}
      />
      <Text style={styles.hint}>
        Players already on the booking stay on it. The club prices the new time.
      </Text>
      {failure ? (
        <Text style={styles.error} accessibilityRole="alert">
          {failure.title}. {failure.message}
        </Text>
      ) : null}
      {payment.canceled ? (
        <Text style={styles.hint}>Payment not completed. Pay the difference to finish the change.</Text>
      ) : null}
      <ProcessingOverlay
        visible={payment.stage === 'confirming'}
        courtName={pick.court.court_name}
        title="Saving your change"
        body="We're recording the payment for your new time"
      />
    </StepShell>
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
    textAlign: 'center',
  },
  gate: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
});
