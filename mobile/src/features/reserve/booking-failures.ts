/**
 * Clutch's booking refusals mapped to what the member reads and what the
 * screen offers next. Branches only on ClutchError.code (a misspelled code is
 * a compile error against ErrorCode); the message Clutch sent is never shown
 * or parsed, so copy stays the app's.
 *
 * Used by every booking mutation: create (hold), payment intent, simulated
 * pay, confirm, cancel, reschedule, invites, respond, remove player.
 */
import { formatDateHeading } from './booking';
import { asClubId, isClutchError, type ClubId } from '../../lib/clutch';

/**
 * What the screen offers next:
 * - pick-time: the slot or range cannot be had; back to times with a fresh grid.
 * - retry: nothing was decided (or a fresh attempt may work); same action again.
 * - retry-payment: the payment did not go through; the hold is kept, pay again.
 * - check-again: the payment reached Stripe but is not settled; ask Clutch
 *   again (confirm) with a new key, never pay again.
 * - membership: booking needs a club membership or a tier the member lacks.
 * - waiver: the club needs a signed waiver first (on the web).
 * - none: a final answer; nothing to retry here.
 * - refresh: the booking changed under us; reload it and show the truth.
 */
export type FailureAction =
  | 'pick-time'
  | 'retry'
  | 'retry-payment'
  | 'check-again'
  | 'membership'
  | 'waiver'
  | 'none'
  | 'refresh';

export interface BookingFailure {
  action: FailureAction;
  title: string;
  message: string;
  /** waiver_required: the club whose waiver is missing. */
  clubId?: ClubId;
  /** no_show_penalty: when booking opens again ("YYYY-MM-DD" or ISO). */
  until?: string;
}

function untilLabel(until: unknown): string | null {
  if (typeof until !== 'string' || until.length < 10) return null;
  return formatDateHeading(until.slice(0, 10));
}

const GENERIC: BookingFailure = {
  action: 'retry',
  title: 'Something went wrong',
  message: 'We could not finish that. Try again.',
};

export function describeBookingFailure(error: unknown): BookingFailure {
  if (!isClutchError(error)) return GENERIC;
  if (error.kind === 'network') {
    return {
      action: 'retry',
      title: 'No connection',
      message: 'We could not reach the club. Check your connection and try again.',
    };
  }
  if (error.kind === 'contract') {
    return {
      action: 'retry',
      title: 'Something went wrong',
      message: 'The club answered in a way this version of the app does not understand. Try again, or update the app.',
    };
  }

  switch (error.code) {
    // ── The slot or range ──
    case 'slot_already_booked':
    case 'slot_unavailable':
      return {
        action: 'pick-time',
        title: 'That time was just taken',
        message: 'Another member booked it first. Pick another time.',
      };
    case 'court_not_available':
      return {
        action: 'pick-time',
        title: 'Court not available',
        message: 'That court is not open for booking at that time. Pick another time.',
      };
    case 'cannot_book_past':
      return {
        action: 'pick-time',
        title: 'That time has passed',
        message: 'Pick a time later today or another day.',
      };
    case 'advance_booking_exceeded':
      return {
        action: 'pick-time',
        title: 'Too far ahead',
        message: 'That date is beyond how far ahead you can book. Pick an earlier date.',
      };
    case 'duration_out_of_range':
      return {
        action: 'pick-time',
        title: 'Length not allowed',
        message: 'The club does not allow a booking of that length. Pick a shorter or longer range.',
      };
    case 'booking_changed':
    case 'booking_not_pending':
      return {
        action: 'pick-time',
        title: 'Your hold ended',
        message:
          'The court is no longer held for you. If a payment went through, the club returns it to your card. Pick a time again.',
      };

    // ── Who may book ──
    case 'not_club_member':
      return {
        action: 'membership',
        title: 'Club membership needed',
        message: 'Booking courts needs a membership at the club.',
      };
    case 'members_only':
      return {
        action: 'membership',
        title: 'Members only',
        message: 'This court is for members only.',
      };
    case 'tier_required':
      return {
        action: 'membership',
        title: 'Membership tier needed',
        message: 'This booking needs a different membership tier.',
      };
    case 'no_show_penalty': {
      const until = untilLabel(error.details?.until);
      return {
        action: 'none',
        title: 'Booking paused',
        message: until
          ? `After a missed booking, you can book again from ${until}.`
          : 'After a missed booking, booking is paused for a while.',
        until: typeof error.details?.until === 'string' ? error.details.until : undefined,
      };
    }
    case 'waiver_required': {
      const clubId = error.details?.club_id;
      return {
        action: 'waiver',
        title: 'Waiver needed',
        message: 'The club needs you to sign its waiver before you book. Sign it on the club website, then try again.',
        clubId: typeof clubId === 'string' ? asClubId(clubId) : undefined,
      };
    }

    // ── Payment ──
    case 'club_stripe_not_connected':
      return {
        action: 'none',
        title: 'Online payment unavailable',
        message: 'The club does not take online payments yet. Release the court, or ask the front desk.',
      };
    case 'payment_failed':
      return {
        action: 'retry-payment',
        title: 'Payment did not go through',
        message: 'Your card was not charged. The court is still held for you; try paying again.',
      };
    case 'payment_requires_action':
      return {
        action: 'retry-payment',
        title: 'Payment needs another step',
        message: 'Your bank asked for one more step. Pay again to finish it.',
      };
    case 'payment_not_verified':
    case 'payment_processing':
      return {
        action: 'check-again',
        title: 'Your payment is clearing',
        message:
          'The club has not seen your payment settle yet. Check again in a moment; you will not be charged twice.',
      };
    case 'already_paid':
    case 'nothing_owed':
      return {
        action: 'refresh',
        title: 'Nothing to pay',
        message: 'There is nothing left to pay on this booking.',
      };

    // ── Changing a booking ──
    case 'cancellation_window_passed':
      return {
        action: 'none',
        title: 'Too late to cancel',
        message: "This booking is inside the club's cancellation window and can no longer be cancelled here.",
      };
    case 'reschedule_costs_more':
      return {
        action: 'pick-time',
        title: 'That move costs more',
        message:
          'The new time is priced higher than your booking, and the club does not take the difference here yet. Pick a time at the same price or less, or cancel and book again.',
      };
    case 'booking_started':
    case 'booking_ended':
    case 'booking_completed':
      return {
        action: 'refresh',
        title: 'Booking already started',
        message: 'This booking has started, so it can no longer be changed.',
      };
    case 'booking_cancelled':
      return {
        action: 'refresh',
        title: 'Booking cancelled',
        message: 'This booking was cancelled.',
      };
    case 'cannot_cancel':
    case 'cannot_reschedule':
      return {
        action: 'none',
        title: 'Not allowed',
        message: 'The club does not allow this change to this booking.',
      };
    case 'booking_not_found':
      return {
        action: 'refresh',
        title: 'Booking not found',
        message: 'This booking no longer exists, or you are not part of it.',
      };
    case 'booking_not_confirmed':
      return {
        action: 'none',
        title: 'Booking not confirmed yet',
        message: 'You can invite a group once the booking is confirmed.',
      };
    case 'invite_not_pending':
    case 'invitation_not_pending':
      return {
        action: 'refresh',
        title: 'Invitation already answered',
        message: 'This invitation was already answered or withdrawn.',
      };
    case 'not_a_participant':
      return {
        action: 'refresh',
        title: 'Not on this booking',
        message: 'You are no longer a player on this booking.',
      };
    case 'group_exceeds_capacity':
      return {
        action: 'none',
        title: 'Group too big',
        message: 'The group has more members than the court holds.',
      };

    // ── Transport ──
    case 'rate_limit_exceeded':
      return {
        action: 'retry',
        title: 'Slow down a moment',
        message: 'Too many requests in a short time. Wait a few seconds and try again.',
      };

    default:
      return GENERIC;
  }
}
