/**
 * The wizard's ledger of its court hold, kept framework-free so the rules are
 * testable.
 *
 * POST /bookings holds a court: a `pending` booking with a 15-minute hold
 * (hold_expires_at). The hold and the payment are tracked SEPARATELY: the hold
 * is this ledger, the payment intent lives in the checkout. A create request
 * can outlive the step that sent it (the member backs out mid-flight), so
 * responses can land late, and the client must never cancel the live hold on
 * behalf of an orphaned one.
 *
 * Payment lock: from the moment a payment is submitted (sheet presented or a
 * simulated checkout paid) until Clutch has answered, leaving the wizard must
 * not cancel the hold. Clutch would return any money a cancelled hold holds,
 * so this is not about losing money; it keeps a member who paid from undoing
 * their own booking by closing the screen while it settles.
 *
 * The rules:
 * - every create names an attempt token from beginAttempt();
 * - a hold that lands is adopted only while its token is the live attempt;
 *   otherwise the INCOMING hold is cancelled, never the live one;
 * - release() drops the live attempt and cancels the held booking, unless a
 *   submitted payment is still settling;
 * - settle() forgets the hold without cancelling (confirmed, expired, or
 *   left for the member to finish from the booking screen).
 */
import type { BookingId } from '../../lib/clutch';

export interface HoldSession {
  /** Marks a new create attempt as the live one; returns its token. */
  beginAttempt(): number;
  /** Reports the hold a create attempt produced (possibly late). */
  holdCreated(bookingId: BookingId, attempt: number): void;
  /** Back out: drop the live attempt and cancel the hold (unless locked). */
  release(): void;
  /** Forget the hold without cancelling; clears the lock. */
  settle(): void;
  /** The hold currently adopted, if any. */
  readonly heldId: BookingId | null;
  readonly paymentLocked: boolean;
  setPaymentLocked(locked: boolean): void;
}

export function createHoldSession(options: {
  /** Fire-and-forget cancel of a hold. */
  cancel: (bookingId: BookingId) => void;
  onLockChange?: (locked: boolean) => void;
}): HoldSession {
  const { cancel, onLockChange } = options;
  let attempts = 0;
  let liveAttempt: number | null = null;
  let heldId: BookingId | null = null;
  let paymentLocked = false;

  const setLock = (locked: boolean) => {
    if (paymentLocked === locked) return;
    paymentLocked = locked;
    onLockChange?.(locked);
  };

  return {
    beginAttempt() {
      liveAttempt = ++attempts;
      return liveAttempt;
    },
    holdCreated(bookingId, attempt) {
      if (attempt !== liveAttempt) {
        cancel(bookingId);
        return;
      }
      if (heldId && heldId !== bookingId) cancel(heldId);
      heldId = bookingId;
    },
    release() {
      liveAttempt = null;
      const id = heldId;
      heldId = null;
      if (id && !paymentLocked) cancel(id);
      setLock(false);
    },
    settle() {
      liveAttempt = null;
      heldId = null;
      setLock(false);
    },
    get heldId() {
      return heldId;
    },
    get paymentLocked() {
      return paymentLocked;
    },
    setPaymentLocked(locked) {
      setLock(locked);
    },
  };
}
