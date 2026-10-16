/**
 * Releasing a court hold without ever cancelling a booking that might be
 * confirmed.
 *
 * A hold is a `pending` booking. Cancelling it is only right while it is
 * still a hold nobody paid for: a confirm whose answer was lost, or a payment
 * the Stripe webhook records after the sheet closed, can have confirmed it
 * already, and POST /bookings/{id}/cancel would then cancel a paid booking.
 *
 * So the release is read-then-cancel:
 * 1. no payment of this session is in flight for it (payment ledger:
 *    submitted, or a sheet that failed and was not asked about since);
 * 2. a FRESH GET /bookings/{id} says it is still `pending`;
 * 3. only then POST /bookings/{id}/cancel.
 *
 * Remaining race (without P4): between the read in step 2 and the cancel in
 * step 3 the webhook can still confirm a payment made outside this session.
 * With bookingParity on there is no race: POST /bookings/{id}/release lets
 * go of the hold only while it is still pending, under the booking's lock,
 * and answers 409 booking_not_pending (details.status) when the server
 * confirmed it meanwhile; that answer means "kept", never an error.
 */
import { clutch, hasCode, type BookingId, type UserId } from '../../lib/clutch';
import { paymentLedger } from './payment-ledger';

export type ReleaseOutcome = 'released' | 'kept';

export interface ReleaseActions {
  /** POST /bookings/{id}/cancel under the caller's key (fallback without P4). */
  cancel: (bookingId: BookingId) => Promise<unknown>;
  /** POST /bookings/{id}/release under the caller's key (P4). */
  release: (bookingId: BookingId) => Promise<unknown>;
}

export async function releaseHoldIfPending(
  bookingId: BookingId,
  userId: UserId | null,
  actions: ReleaseActions,
): Promise<ReleaseOutcome> {
  if (paymentLedger.inFlight(userId, bookingId)) return 'kept';
  if (clutch.capabilities.bookingParity) {
    try {
      await actions.release(bookingId);
    } catch (err) {
      if (hasCode(err, 'booking_not_pending')) return 'kept';
      throw err;
    }
    if (userId) paymentLedger.clearBooking(userId, bookingId);
    return 'released';
  }
  const booking = await clutch.bookings.get(bookingId);
  if (booking.status !== 'pending') return 'kept';
  // Re-check after the await: a payment may have been submitted meanwhile.
  if (paymentLedger.inFlight(userId, bookingId)) return 'kept';
  await actions.cancel(bookingId);
  if (userId) paymentLedger.clearBooking(userId, bookingId);
  return 'released';
}
