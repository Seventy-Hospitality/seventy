import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  clutch,
  useMutationKey,
  type BookingId,
  type BookingRecord,
  type CourtAvailability,
} from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { PrimaryButton, Skeleton } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { formatDateLong, formatDuration, formatTimeRangeCompact, type TimeRange } from './booking';
import { describeBookingFailure, type BookingFailure } from './booking-failures';
import { BookingSummaryCard } from './BookingSummaryCard';
import { chargeFromQuote, chargeTotal, type Charge } from './charge';
import { ChargeSummary } from './ChargeSummary';
import type { HoldSession } from './hold-session';
import { MembershipInactiveState } from './MembershipInactiveState';
import { paymentLedger, usePaymentLedger } from './payment-ledger';
import { ProcessingOverlay } from './ProcessingOverlay';
import { quoteQuery } from './quote';
import { StepShell } from './StepShell';
import { useBookingPayment, type BookingFacts } from './useBookingPayment';
import { useCountdown } from './useCountdown';

const HOLD_WARNING_SECONDS = 120;

export interface CheckoutStepProps {
  sport: string;
  court: CourtAvailability;
  date: string;
  range: TimeRange;
  holdSession: HoldSession;
  /** Clutch confirmed the booking; `charge` is what checkout showed for it. */
  onConfirmed: (booking: BookingFacts, charge: Charge | null) => void;
  /** The time cannot be had (taken, hold ended, released): back to times. */
  onPickAnotherTime: (message: string | null) => void;
  /** A payment is clearing and the member leaves: open the booking to check it there. */
  onLeaveToBooking: (bookingId: BookingId) => void;
}

/**
 * Checkout: hold the court, pay, confirm.
 *
 *  1. POST /bookings holds the court for this range: a `pending` booking
 *     with a 15-minute hold.
 *  2. The total shown is Clutch's: the P4 quote's total_cents (tax
 *     included); without P4 there is no quote, so the court price shows with
 *     "total shown at payment", and once the intent exists, its subtotal and
 *     tax as Clutch returned them (never added up here).
 *  3. Pay through useBookingPayment (one intent per hold for the session,
 *     sheet or simulated checkout, confirm with the completed intent id; a
 *     free booking confirms directly). Clutch's answer is the success.
 *
 * Hold and payment are separate. A failed intent request or a closed sheet
 * KEEPS the hold so the member can try again until it expires; "Release
 * court" lets it go, but only through hold-release.ts (a fresh read says it
 * is still a pending hold and no payment is in flight). A payment Clutch has
 * not confirmed is re-checked, never re-paid, and leaving does not release.
 */
export function CheckoutStep({
  sport,
  court,
  date,
  range,
  holdSession,
  onConfirmed,
  onPickAnotherTime,
  onLeaveToBooking,
}: CheckoutStepProps) {
  const queryClient = useQueryClient();
  const { userId } = useSession();
  const createKey = useMutationKey();
  const [held, setHeld] = useState<BookingRecord | null>(null);
  usePaymentLedger();

  const input = {
    court_id: court.court_id,
    date,
    start_time: range.start,
    end_time: range.end,
  };

  const quote = useQuery(quoteQuery(input));

  const create = useMutation({
    // The hold is reported from inside mutationFn: the request can outlive
    // this step, and the ledger must learn of the hold to release it.
    mutationFn: async (body: typeof input) => {
      const attempt = holdSession.beginAttempt();
      const booking = await createKey.run(body, (key) =>
        clutch.bookings.create(body, { idempotencyKey: key }),
      );
      holdSession.holdCreated(booking.id, attempt);
      return booking;
    },
    onSuccess: (booking) => {
      setHeld(booking);
      void queryClient.invalidateQueries({ queryKey: queryKeys.availability(date) });
    },
  });

  const quoted = quote.data ? chargeFromQuote(quote.data) : null;
  const quotedRef = useRef<Charge | null>(null);
  quotedRef.current = quoted;

  const payment = useBookingPayment(held?.id ?? null, {
    mode: 'hold',
    currency: held?.currency ?? court.slots[0]?.currency ?? 'USD',
    // The confirmation shows what checkout showed: the quote, else the
    // intent's own lines.
    onConfirmed: (booking, charged) => onConfirmed(booking, quotedRef.current ?? charged),
    onLockChange: (locked) => holdSession.setPaymentLocked(locked),
  });

  // Hold the court as soon as checkout opens, once per mount (the wizard
  // remounts this step for a different court or range).
  const startedRef = useRef(false);
  const createMutate = create.mutate;
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    createMutate(input);
  }, [createMutate, input]);

  const secondsLeft = useCountdown(held?.hold_expires_at ?? null);
  const settling = payment.stage !== 'idle';
  const holdLapsed = secondsLeft !== null && secondsLeft <= 0 && !settling;

  const subtitle = 'Confirm and pay to book your court';

  // ── Hold could not be created ──

  if (create.isError) {
    const failure = describeBookingFailure(create.error, { bookingParity: clutch.capabilities.bookingParity });
    return (
      <StepShell title="Checkout" subtitle={subtitle}>
        <FailureBox
          failure={failure}
          onPickTime={() => onPickAnotherTime(failure.message)}
          onRetry={() => create.mutate(input)}
          retrying={create.isPending}
        />
      </StepShell>
    );
  }

  if (!held) {
    return (
      <StepShell title="Checkout" subtitle={subtitle}>
        <View style={styles.loading} accessibilityLabel="Holding your court">
          <Skeleton height={132} borderRadius={radius.lg} />
          <Skeleton height={96} borderRadius={radius.lg} />
          <Skeleton height={46} borderRadius={radius.pill} />
        </View>
      </StepShell>
    );
  }

  const inFlight = paymentLedger.inFlight(userId, held.id);

  // ── The hold ended before the booking was confirmed ──

  if (holdLapsed && !inFlight) {
    return (
      <StepShell title="Checkout" subtitle={subtitle}>
        <Notice
          title="Your hold ended"
          message="The court is no longer held for you. If a payment went through, the club returns it to your card."
        >
          <PrimaryButton label="Choose a new time" onPress={() => onPickAnotherTime(null)} />
        </Notice>
      </StepShell>
    );
  }

  const failure = payment.failure;
  if (
    failure &&
    payment.stage === 'idle' &&
    (failure.action === 'pick-time' || failure.action === 'membership' || failure.action === 'waiver')
  ) {
    return (
      <StepShell title="Checkout" subtitle={subtitle}>
        <FailureBox failure={failure} onPickTime={() => onPickAnotherTime(failure.message)} />
      </StepShell>
    );
  }

  if (payment.stage === 'unconfirmed') {
    // Money may be moving: no Pay here or on the booking screen, only asking
    // Clutch again. Leaving keeps the hold (nothing releases it while the
    // payment is in flight).
    return (
      <StepShell title="Checkout" subtitle={subtitle}>
        <Notice
          title={failure?.title ?? 'Your payment is clearing'}
          message={
            failure?.message ??
            'The club has not confirmed your payment yet. Check again in a moment; you will not be charged twice.'
          }
        >
          <PrimaryButton label="Check again" variant="secondary" onPress={() => void payment.checkAgain()} />
          <PrimaryButton label="Leave and check later" variant="ghost" onPress={() => onLeaveToBooking(held.id)} />
        </Notice>
      </StepShell>
    );
  }

  // ── The payable hold ──

  const free = held.price_cents <= 0;
  const charge: Charge = quoted ??
    payment.charge ?? { kind: 'unknown', currency: held.currency, price_cents: held.price_cents };
  const total = chargeTotal(charge);
  const payLabel = free ? 'Confirm booking' : total ? `Confirm and pay ${total}` : 'Continue to payment';
  const busy = payment.stage === 'preparing' || payment.stage === 'paying' || payment.stage === 'confirming';
  const canRelease = !busy && !inFlight;

  return (
    <StepShell
      title="Checkout"
      subtitle={subtitle}
      footer={
        <View style={styles.footer}>
          <PrimaryButton
            label={payLabel}
            loading={busy}
            onPress={() => void payment.pay({ free })}
          />
          {canRelease ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Release court"
              onPress={() => {
                holdSession.release();
                onPickAnotherTime(null);
              }}
              style={styles.release}
            >
              <Text style={styles.releaseLabel}>Release court</Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      <BookingSummaryCard
        sport={sport}
        courtName={court.court_name}
        rows={[
          { label: 'Date', value: formatDateLong(held.date) },
          { label: 'Time', value: formatTimeRangeCompact(held.start_time, held.end_time) },
          { label: 'Duration', value: formatDuration(range.minutes) },
        ]}
      />

      {free ? null : <ChargeSummary charge={charge} />}

      {secondsLeft !== null ? (
        <View style={styles.holdHint} accessibilityLabel={holdAnnouncement(court.court_name, secondsLeft)}>
          <Ionicons
            name="time-outline"
            size={16}
            color={secondsLeft <= HOLD_WARNING_SECONDS ? colors.dangerStrong : colors.textMuted}
          />
          <Text style={styles.holdHintText}>
            {court.court_name} is held for you for{' '}
            <Text style={styles.holdHintStrong}>{formatCountdown(Math.max(0, secondsLeft))}</Text>
          </Text>
        </View>
      ) : null}

      {payment.canceled ? (
        <Text style={styles.info} accessibilityRole="alert">
          Payment not completed. The court is still held for you; pay when you are ready, or release it.
        </Text>
      ) : null}

      {failure ? (
        <Text accessibilityRole="alert" style={styles.payError}>
          {failure.title}. {failure.message}
        </Text>
      ) : null}

      <ProcessingOverlay visible={payment.stage === 'confirming'} courtName={court.court_name} />
    </StepShell>
  );
}

/** A refusal with the recovery its action calls for. */
export function FailureBox({
  failure,
  onPickTime,
  onRetry,
  retrying,
}: {
  failure: BookingFailure;
  onPickTime?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (failure.action === 'membership') {
    return <MembershipInactiveState title={failure.title} description={failure.message} />;
  }
  return (
    <Notice title={failure.title} message={failure.message}>
      {failure.action === 'pick-time' && onPickTime ? (
        <PrimaryButton label="Pick another time" onPress={onPickTime} />
      ) : null}
      {(failure.action === 'retry' || failure.action === 'retry-payment') && onRetry ? (
        <PrimaryButton label="Try again" variant="secondary" loading={retrying} onPress={onRetry} />
      ) : null}
      {(failure.action === 'none' || failure.action === 'waiver' || failure.action === 'refresh') &&
      onPickTime ? (
        <PrimaryButton label="Back to times" variant="secondary" onPress={onPickTime} />
      ) : null}
    </Notice>
  );
}

export function Notice({
  title,
  message,
  children,
}: {
  title?: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.noticeBox} accessibilityRole="alert">
      {title ? <Text style={styles.noticeTitle}>{title}</Text> : null}
      <Text style={styles.noticeText}>{message}</Text>
      {children}
    </View>
  );
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function holdAnnouncement(courtName: string, secondsLeft: number): string {
  if (secondsLeft <= 0) return `${courtName} hold ended`;
  if (secondsLeft <= 60) return `${courtName} is held for less than a minute. Finish paying to keep it.`;
  if (secondsLeft <= HOLD_WARNING_SECONDS)
    return `${courtName} is held for less than two minutes. Finish paying to keep it.`;
  return `${courtName} is held for you while you pay.`;
}

const styles = StyleSheet.create({
  loading: {
    gap: spacing.md,
  },
  footer: {
    gap: spacing.xs,
  },
  release: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  releaseLabel: {
    color: colors.textLink,
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
  },
  holdHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  holdHintText: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  holdHintStrong: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
  },
  info: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  payError: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  noticeBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  noticeTitle: {
    color: colors.text,
    fontFamily: fonts.displaySemibold,
    fontSize: 16,
  },
  noticeText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 19,
  },
});
