import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clutch,
  hasCode,
  useMutationKey,
  type BookingDetail,
  type BookingId,
  type BookingMove,
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
import { chargeTotal } from '../reserve/charge';
import { ChargeSummary } from '../reserve/ChargeSummary';
import { Notice } from '../reserve/CheckoutStep';
import { usableTimezone, useSportRules, type SportRules } from '../reserve/club-rules';
import { ProcessingOverlay } from '../reserve/ProcessingOverlay';
import { SelectTimeStep, type TimePick } from '../reserve/SelectTimeStep';
import { StepShell } from '../reserve/StepShell';
import { useMovePayment, type BookingFacts } from '../reserve/useBookingPayment';
import { WizardFrame } from '../reserve/WizardFrame';
import { viewerOf } from './booking-viewer';

const STEP_NAMES = { 1: 'Choose a new time', 2: 'Confirm the change' } as const;

/**
 * Move a confirmed booking to a new date and range (the booker only). Step 1
 * is the booking wizard's time step with this booking's own slots counted as
 * free; pickCourt names the court for the new range. Step 2 shows old and new
 * and makes the move.
 *
 * Money: Clutch decides, and a move is never priced with the new-booking
 * quote.
 * - With Clutch P4 (bookingParity): POST /bookings/{id}/reschedule/quote
 *   prices the move (difference, tax, total). payment_required: pay through
 *   /reschedule/payment-intent (the sheet), then /reschedule/confirm with the
 *   completed intent. Otherwise POST /bookings/{id}/reschedule; a 402
 *   reschedule_payment_required from it switches to the paid flow.
 *   move_not_applied means the move was not made and the payment is being
 *   returned; payment_processing stays locked on "check again".
 * - Without P4: plain reschedule only. A dearer move is refused
 *   (reschedule_costs_more / reschedule_payment_required), and the member is
 *   told such a move is not available in the app yet.
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
    <RescheduleRules key={detail.data.id} booking={detail.data} timezone={timezone} onDone={backToDetail} />
  );
}

/** The sport's booking rules (P4 per sport, else the club's) before the wizard. */
function RescheduleRules({
  booking,
  timezone,
  onDone,
}: {
  booking: BookingDetail;
  timezone: string;
  onDone: () => void;
}) {
  const sport = booking.court?.court_type ?? '';
  const sportRules = useSportRules(sport);
  if (sportRules.isPending || !sportRules.rules) {
    return (
      <WizardFrame onBack={onDone} onClose={onDone}>
        <View style={styles.center}>
          {sportRules.isError ? (
            <PrimaryButton label="Try again" variant="secondary" onPress={sportRules.refetch} />
          ) : (
            <ActivityIndicator color={colors.accent} />
          )}
        </View>
      </WizardFrame>
    );
  }
  return <RescheduleWizard booking={booking} rules={sportRules.rules} timezone={timezone} onDone={onDone} />;
}

function RescheduleWizard({
  booking,
  rules,
  timezone,
  onDone,
}: {
  booking: BookingDetail;
  rules: SportRules;
  timezone: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
    (moved: Pick<BookingFacts, 'date' | 'start_time' | 'end_time'>) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(booking.id) });
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
    [queryClient, booking.id, booking.date, toast, onDone],
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
          showTotal={false}
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
  onMoved: (booking: Pick<BookingFacts, 'date' | 'start_time' | 'end_time'>) => void;
  onBackToTimes: (message: string | null) => void;
}) {
  const parity = clutch.capabilities.bookingParity;
  const key = useMutationKey();
  // A plain reschedule answered 402 reschedule_payment_required: the move
  // costs more than the quote said, so take the paid flow.
  const [paidFlow, setPaidFlow] = useState(false);
  const move: BookingMove = useMemo(
    () => ({
      new_date: pick.date,
      new_start_time: pick.range.start,
      new_end_time: pick.range.end,
      new_court_id: pick.court.court_id,
    }),
    [pick.date, pick.range.start, pick.range.end, pick.court.court_id],
  );

  // P4 only: the move's own price (never the new-booking quote).
  const quote = useQuery({
    queryKey: [...queryKeys.booking(booking.id), 'reschedule-quote', move] as const,
    queryFn: () => clutch.bookings.rescheduleQuote(booking.id, move),
    enabled: parity,
    retry: false,
  });

  const payment = useMovePayment(booking.id, move, {
    currency: booking.currency,
    onMoved,
    onLockChange,
  });

  const reschedule = useMutation({
    mutationFn: () =>
      key.run(move, (idempotencyKey) => clutch.bookings.reschedule(booking.id, move, { idempotencyKey })),
    onSuccess: (moved) => onMoved(moved),
    onError: (error) => {
      if (parity && hasCode(error, 'reschedule_payment_required', 'reschedule_costs_more')) {
        setPaidFlow(true);
        void quote.refetch();
        return;
      }
      const failure = describeBookingFailure(error, { bookingParity: parity });
      if (failure.action === 'pick-time') onBackToTimes(`${failure.title}. ${failure.message}`);
    },
  });

  // A paid-move failure that ends the move (move_not_applied, the booking
  // changed) goes back to times with what happened.
  const paymentFailure = payment.failure;
  useEffect(() => {
    if (paymentFailure?.action === 'pick-time' && payment.stage === 'idle') {
      onBackToTimes(`${paymentFailure.title}. ${paymentFailure.message}`);
    }
  }, [paymentFailure, payment.stage, onBackToTimes]);

  const quoteFailure = quote.isError ? describeBookingFailure(quote.error, { bookingParity: parity }) : null;
  useEffect(() => {
    if (quoteFailure?.action === 'pick-time') onBackToTimes(`${quoteFailure.title}. ${quoteFailure.message}`);
  }, [quoteFailure, onBackToTimes]);

  const needsPayment = parity && (paidFlow || quote.data?.payment_required === true);
  const failure =
    reschedule.isError && !paidFlow
      ? describeBookingFailure(reschedule.error, { bookingParity: parity })
      : (paymentFailure ?? quoteFailure);
  const paying =
    payment.stage === 'preparing' || payment.stage === 'paying' || payment.stage === 'confirming';

  if (payment.stage === 'unconfirmed') {
    return (
      <StepShell title="Confirm the change">
        <Notice
          title={paymentFailure?.title ?? 'Your payment is clearing'}
          message={
            paymentFailure?.message ??
            'The club has not confirmed your payment yet. Check again in a moment; you will not be charged twice.'
          }
        >
          <PrimaryButton label="Check again" variant="secondary" onPress={() => void payment.checkAgain()} />
        </Notice>
      </StepShell>
    );
  }

  const quoted = quote.data;
  const payTotal =
    chargeTotal(payment.charge) ?? (quoted ? formatMoney(quoted.total_cents, quoted.currency) : null);

  const footer = needsPayment ? (
    <PrimaryButton
      label={payTotal ? `Pay ${payTotal} and move` : 'Pay the difference and move'}
      loading={paying}
      onPress={() => void payment.pay()}
    />
  ) : (
    <PrimaryButton
      label="Save change"
      loading={reschedule.isPending}
      // With P4, wait for the quote: it says whether the move must be paid.
      onPress={parity && quote.isPending ? undefined : () => reschedule.mutate()}
    />
  );

  return (
    <StepShell title="Confirm the change" footer={footer}>
      <BookingSummaryCard
        sport={sport}
        courtName={booking.court?.name ?? null}
        rows={[
          {
            label: 'Now',
            value: `${formatDateLong(booking.date)}, ${formatTimeRangeCompact(booking.start_time, booking.end_time)}`,
          },
        ]}
      />
      <BookingSummaryCard
        sport={sport}
        courtName={pick.court.court_name}
        rows={[
          {
            label: 'New time',
            value: `${formatDateLong(pick.date)}, ${formatTimeRangeCompact(pick.range.start, pick.range.end)}`,
          },
          { label: 'Duration', value: formatDuration(pick.range.minutes) },
        ]}
      />

      {parity ? (
        quoted ? (
          <View style={styles.priceBox} accessibilityLabel="Price of the move">
            <Row label="Current price" value={formatMoney(quoted.current_price_cents, quoted.currency)} />
            <Row label="New price" value={formatMoney(quoted.new_price_cents, quoted.currency)} />
            {quoted.payment_required ? (
              <>
                <Row label="Difference" value={formatMoney(quoted.difference_cents, quoted.currency)} />
                <Row label="Tax" value={formatMoney(quoted.tax_cents, quoted.currency)} />
                <Row label="To pay now" value={formatMoney(quoted.total_cents, quoted.currency)} strong />
              </>
            ) : (
              <Text style={styles.hint}>Nothing more to pay for this move.</Text>
            )}
          </View>
        ) : quote.isPending ? (
          <Text style={styles.hint}>Pricing the move...</Text>
        ) : null
      ) : (
        <Text style={styles.hint}>
          The club prices the new time when you save. A move to a time that costs more is not available in the
          app yet.
        </Text>
      )}

      {payment.charge ? <ChargeSummary charge={payment.charge} title="Payment" /> : null}

      <Text style={styles.hint}>Players already on the booking stay on it.</Text>
      {failure && failure.action !== 'pick-time' ? (
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

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.priceRow}>
      <Text style={strong ? styles.priceStrongLabel : styles.priceLabel}>{label}</Text>
      <Text style={strong ? styles.priceStrong : styles.priceValue}>{value}</Text>
    </View>
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
  priceBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  priceLabel: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
  priceValue: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 14 },
  priceStrongLabel: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 15 },
  priceStrong: { color: colors.accent, fontFamily: fonts.displayBold, fontSize: 18 },
});
