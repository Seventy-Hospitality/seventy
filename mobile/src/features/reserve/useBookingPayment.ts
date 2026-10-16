/**
 * The three things a member pays for on a booking, each on the one payment
 * path (usePaymentFlow):
 *
 * - useBookingPayment: the booker's hold (pending: pay, then confirm) or
 *   balance (confirmed: pay what Clutch says they still owe, then confirm
 *   records it). POST /bookings/{id}/payment-intent, then /confirm.
 * - useSharePayment (Clutch P4): a player's share of someone else's booking.
 *   POST /bookings/{id}/shares/payment-intent, then /shares/confirm; never
 *   the booker's /payment-intent. Simulated: /payment-intent/pay, then
 *   /shares/confirm.
 * - useMovePayment (Clutch P4): the difference plus tax on a dearer move.
 *   POST /bookings/{id}/reschedule/payment-intent, then /reschedule/confirm.
 *
 * Callers gate the P4 flows on clutch.capabilities.bookingParity.
 */
import {
  bookingCheckoutToSheet,
  checkoutIntentId,
  clutch,
  snakeCheckoutToSheet,
  type BookingDetail,
  type BookingId,
  type BookingMove,
  type BookingRecord,
  type ParityBooking,
  type ShareSettled,
  type UserId,
} from '../../lib/clutch';
import { useSession } from '../../lib/session';
import { endToMinutes, timeToMinutes } from './booking';
import type { BookingFailure } from './booking-failures';
import { chargeFromBookingCheckout, chargeFromSnakeCheckout, type Charge } from './charge';
import { usePaymentFlow, type Settled, type Verdict } from './usePaymentFlow';

export type { PaymentStage } from './usePaymentFlow';

/** The booking fields a confirmed payment hands back, from confirm or a re-read. */
export type BookingFacts = Pick<
  BookingRecord,
  'id' | 'date' | 'start_time' | 'end_time' | 'status' | 'currency' | 'price_cents' | 'paid_cents'
>;

const LIVE = new Set(['pending', 'confirmed']);

function holdExpired(booking: BookingDetail, now: Date): boolean {
  return !!booking.hold_expires_at && new Date(booking.hold_expires_at).getTime() <= now.getTime();
}

/** The booker's payment, judged from a fresh read of the booking. */
export function bookerVerdict(booking: BookingDetail, mode: 'hold' | 'balance', now: Date = new Date()): Verdict {
  if (!LIVE.has(booking.status)) return 'ended';
  if (booking.status === 'pending') return holdExpired(booking, now) ? 'ended' : 'open';
  if (mode === 'hold') return 'settled';
  const due = booking.dues.find((row) => row.party === 'booker');
  return !due || due.due_cents <= 0 ? 'settled' : 'open';
}

/** A player's share, judged from a fresh read (they see only their own due row). */
export function shareVerdict(booking: BookingDetail, userId: UserId | null): Verdict {
  if (!LIVE.has(booking.status) || !userId) return 'ended';
  const me = booking.players.find((player) => player.user_id === userId);
  if (!me || me.status !== 'accepted') return 'ended';
  const due = booking.dues.find((row) => row.party === 'player' && row.user_id === userId);
  return !due || due.due_cents <= 0 ? 'settled' : 'open';
}

/** A paid move, judged from a fresh read: made once the booking sits at the target. */
export function moveVerdict(booking: BookingDetail, move: BookingMove): Verdict {
  if (booking.status !== 'confirmed') return 'ended';
  const atTarget =
    booking.date === move.new_date &&
    timeToMinutes(booking.start_time) === timeToMinutes(move.new_start_time) &&
    endToMinutes(booking.end_time) === endToMinutes(move.new_end_time) &&
    (!move.new_court_id || booking.court_id === move.new_court_id);
  return atTarget ? 'settled' : 'open';
}

const HOLD_ENDED: BookingFailure = {
  action: 'pick-time',
  title: 'Your hold ended',
  message:
    'The court is no longer held for you. If a payment went through, the club returns it to your card. Pick a time again.',
};

const PAYMENT_ENDED: BookingFailure = {
  action: 'refresh',
  title: 'This payment can no longer go through',
  message:
    'The booking changed (it ended, or you are no longer on it). If money moved, the club returns it to your card.',
};

const MOVE_ENDED: BookingFailure = {
  action: 'pick-time',
  title: 'Your booking was not moved',
  message: 'The booking changed before the move was made. If money moved, the club returns it to your card.',
};

function factsOf<T extends BookingFacts>(outcome: Settled<T>): BookingFacts {
  return outcome.via === 'confirm' ? outcome.result : outcome.booking;
}

export interface UseBookingPaymentOptions {
  /** hold: the booker's pending booking. balance: what they still owe on a confirmed one. */
  mode: 'hold' | 'balance';
  currency: string;
  /** Balance only: Clutch's own due for the booker, echoed as a check. */
  shareCents?: number;
  onConfirmed?: (booking: BookingFacts, charge: Charge | null) => void;
  onLockChange?: (locked: boolean) => void;
  merchantDisplayName?: string;
}

export function useBookingPayment(bookingId: BookingId | null, options: UseBookingPaymentOptions) {
  const { userId } = useSession();
  return usePaymentFlow<BookingRecord>({
    bookingId,
    userId,
    purpose: 'booking',
    variant: options.shareCents === undefined ? '' : `share:${options.shareCents}`,
    createIntent: async (id, key) => {
      const checkout = await clutch.bookings.paymentIntent(id, {
        idempotencyKey: key,
        shareCents: options.shareCents,
      });
      return {
        sheet: bookingCheckoutToSheet(checkout),
        intentId: checkoutIntentId(checkout),
        charge: chargeFromBookingCheckout(checkout, options.currency),
      };
    },
    confirm: (id, intentId, key) => clutch.bookings.confirm(id, intentId, { idempotencyKey: key }),
    judge: (booking) => bookerVerdict(booking, options.mode),
    onSettled: (outcome, charge) => options.onConfirmed?.(factsOf(outcome), charge),
    ended: options.mode === 'hold' ? HOLD_ENDED : PAYMENT_ENDED,
    onLockChange: options.onLockChange,
    merchantDisplayName: options.merchantDisplayName,
  });
}

export interface UseSharePaymentOptions {
  currency: string;
  /** Clutch recorded the share: its own figures, or the re-read booking. */
  onPaid?: (outcome: Settled<ShareSettled>) => void;
  onLockChange?: (locked: boolean) => void;
}

/** P4: a player pays their share. Callers render it only with bookingParity on. */
export function useSharePayment(bookingId: BookingId | null, options: UseSharePaymentOptions) {
  const { userId } = useSession();
  return usePaymentFlow<ShareSettled>({
    bookingId,
    userId,
    purpose: 'share',
    createIntent: async (id, key) => {
      const checkout = await clutch.bookings.sharePaymentIntent(id, { idempotencyKey: key });
      return {
        sheet: snakeCheckoutToSheet(checkout),
        intentId: checkout.payment_intent_id,
        charge: chargeFromSnakeCheckout(checkout, options.currency),
      };
    },
    confirm: (id, intentId, key) => {
      // A share always has an intent; the flow never confirms one without.
      if (!intentId) return Promise.reject(new Error('A share payment needs its intent.'));
      return clutch.bookings.shareConfirm(id, intentId, { idempotencyKey: key });
    },
    judge: (booking) => shareVerdict(booking, userId),
    onSettled: (outcome) => options.onPaid?.(outcome),
    ended: PAYMENT_ENDED,
    onLockChange: options.onLockChange,
  });
}

export interface UseMovePaymentOptions {
  currency: string;
  onMoved?: (booking: Pick<BookingFacts, 'date' | 'start_time' | 'end_time'>) => void;
  onLockChange?: (locked: boolean) => void;
}

/** P4: pay the difference on a dearer move, then make the move. */
export function useMovePayment(bookingId: BookingId | null, move: BookingMove, options: UseMovePaymentOptions) {
  const { userId } = useSession();
  return usePaymentFlow<ParityBooking>({
    bookingId,
    userId,
    purpose: 'move',
    variant: JSON.stringify(move),
    createIntent: async (id, key) => {
      const checkout = await clutch.bookings.reschedulePaymentIntent(id, move, { idempotencyKey: key });
      return {
        sheet: snakeCheckoutToSheet(checkout),
        intentId: checkout.payment_intent_id,
        charge: chargeFromSnakeCheckout(checkout, options.currency),
        expiresAt: checkout.expires_at,
      };
    },
    confirm: (id, intentId, key) => {
      if (!intentId) return Promise.reject(new Error('A paid move needs its intent.'));
      return clutch.bookings.rescheduleConfirm(id, intentId, { idempotencyKey: key });
    },
    judge: (booking) => moveVerdict(booking, move),
    onSettled: (outcome) =>
      options.onMoved?.(outcome.via === 'confirm' ? outcome.result : outcome.booking),
    ended: MOVE_ENDED,
    onLockChange: options.onLockChange,
  });
}
