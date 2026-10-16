/**
 * Clutch's booking refusals mapped to what the member reads and what the
 * screen offers next. Branches only on ClutchError.code; the message Clutch
 * sent is never shown or parsed, so copy stays the app's.
 *
 * EXHAUSTIVE: the switch names every ErrorCode Clutch can send (generated and
 * pending). Codes that cannot come from a booking call share one outcome
 * (re-read the booking and show what it says), and the default branch only
 * compiles while every code is named, so a code Clutch adds is a compile
 * error here until someone decides what it means for a booking.
 *
 * Used by every booking mutation: create (hold), quote, payment intent,
 * simulated pay, confirm, cancel, reschedule (plain and paid), share payment,
 * invites, respond, remove player.
 */
import { formatDateHeading } from './booking';
import { asClubId, ClutchUnavailableError, isClutchError, type ClubId } from '../../lib/clutch';

/**
 * What the screen offers next:
 * - pick-time: the slot or range cannot be had; back to times with a fresh grid.
 * - retry: nothing was decided (or a fresh attempt may work); same action again.
 * - retry-payment: the payment did not go through; pay again (the same
 *   payment, when Clutch still has it).
 * - check-again: the payment reached the provider but is not settled; ask
 *   Clutch again, never pay again.
 * - membership: booking needs a club membership or a tier the member lacks.
 * - waiver: the club needs a signed waiver first (on the web).
 * - none: a final answer; nothing to retry here.
 * - refresh: re-read the booking and show what it says now.
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

export interface FailureContext {
  /** Whether Clutch P4 (paid moves, share payments) is live for this app. */
  bookingParity?: boolean;
}

function untilLabel(until: unknown): string | null {
  if (typeof until !== 'string' || until.length < 10) return null;
  return formatDateHeading(until.slice(0, 10));
}

/** Why a paid move was not made (move_not_applied details.reason), in plain words. */
function moveReason(reason: unknown): string {
  switch (reason) {
    case 'slot_already_booked':
    case 'slot_unavailable':
      return 'Someone booked that time first.';
    case 'booking_changed':
      return 'Your booking changed while the payment was going through.';
    case 'cancellation_window_passed':
      return "The booking is now inside the club's change window.";
    case 'move_expired':
      return 'The offer for that time ran out before the payment arrived.';
    case 'max_bookings_reached':
      return 'That would be more bookings on one day than the club allows.';
    default:
      return 'The club could not make the move.';
  }
}

/** The one outcome for codes that say nothing specific about a booking. */
const REREAD: BookingFailure = {
  action: 'refresh',
  title: 'Something went wrong',
  message: 'We could not finish that. We reloaded the booking so you can see where it stands.',
};

const TRANSIENT: BookingFailure = {
  action: 'retry',
  title: 'Something went wrong',
  message: 'The club did not finish that. Try again in a moment.',
};

/** Compile-time proof that every ErrorCode above was named; maps to REREAD at runtime. */
function unnamedCode(code: never): BookingFailure {
  void code;
  return REREAD;
}

export function describeBookingFailure(error: unknown, context: FailureContext = {}): BookingFailure {
  if (error instanceof ClutchUnavailableError) {
    return {
      action: 'none',
      title: 'Not available yet',
      message: 'This is not available in the app yet. It is coming soon.',
    };
  }
  if (!isClutchError(error)) return REREAD;
  if (error.kind === 'network') {
    return {
      action: 'retry',
      title: 'No connection',
      message: 'We could not reach the club. Check your connection and try again.',
    };
  }
  if (error.kind === 'contract') {
    return {
      action: 'refresh',
      title: 'Something went wrong',
      message:
        'The club answered in a way this version of the app does not understand. We reloaded the booking so you can see where it stands; updating the app may help.',
    };
  }

  const code = error.code;
  switch (code) {
    // ── The slot or range ──
    case 'slot_already_booked':
    case 'slot_unavailable':
      return {
        action: 'pick-time',
        title: 'That time was just taken',
        message: 'Another member booked it first. Pick another time.',
      };
    case 'court_not_available':
    case 'court_not_found':
    case 'booking_not_bookable':
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
    case 'invalid_time_range':
    case 'slot_not_on_grid':
      return {
        action: 'pick-time',
        title: 'Time not on the schedule',
        message: "Bookings start and end on the court's time slots. Pick the time again.",
      };
    case 'outside_hours':
      return {
        action: 'pick-time',
        title: 'Outside opening hours',
        message: "That time is outside the court's opening hours. Pick another time.",
      };
    case 'max_bookings_reached':
      return {
        action: 'pick-time',
        title: 'Daily limit reached',
        message: 'That would be more bookings on one day than the club allows. Pick another day.',
      };
    case 'booking_changed':
    case 'booking_not_pending':
      return {
        action: 'pick-time',
        title: 'Your hold ended',
        message:
          'The court is no longer held for you. If a payment went through, the club returns it to your card. Pick a time again.',
      };
    case 'direct_booking_disabled':
      return {
        action: 'none',
        title: 'Booking at the desk only',
        message: 'The club takes bookings for this court at the front desk.',
      };

    // ── Who may book ──
    case 'not_club_member':
    case 'membership_not_active':
    case 'membership_unconfirmed':
    case 'no_active_subscription':
      return {
        action: 'membership',
        title: 'Club membership needed',
        message: 'Booking courts needs an active membership at the club.',
      };
    case 'tier_required':
      return {
        action: 'membership',
        title: 'Membership tier needed',
        message: 'Courts of this sport are kept for members of certain membership tiers.',
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
    case 'waiver_unavailable':
      return {
        action: 'none',
        title: 'Waiver unavailable',
        message: 'The club needs a waiver it cannot show right now. Ask the front desk.',
      };

    // ── Payment ──
    case 'club_stripe_not_connected':
    case 'ach_not_enabled':
      return {
        action: 'none',
        title: 'Online payment unavailable',
        message: 'The club does not take this kind of payment online yet. Release the court, or ask the front desk.',
      };
    case 'payment_failed':
      return {
        action: 'retry-payment',
        title: 'Payment did not go through',
        message: 'Your card was not charged. Try paying again, with another card if needed.',
      };
    case 'payment_requires_action':
    case 'payment_incomplete':
      return {
        action: 'retry-payment',
        title: 'Payment not finished',
        message: 'Your bank asked for one more step. Pay again to finish it; you will not be charged twice.',
      };
    case 'payment_required':
      return {
        action: 'retry-payment',
        title: 'Payment needed',
        message: 'The club takes payment in the app for this booking. Pay to confirm it.',
      };
    case 'payment_processing':
    case 'payment_not_verified':
      return {
        action: 'check-again',
        title: 'Your payment is clearing',
        message:
          'The club has not seen your payment settle yet. Check again in a moment; you will not be charged twice.',
      };
    case 'payment_mismatch':
      return {
        action: 'refresh',
        title: 'The amount changed',
        message: 'What you owe changed since this payment was started. We reloaded the booking; pay again from there.',
      };
    case 'payment_returned':
      return {
        action: 'refresh',
        title: 'Payment returned',
        message:
          'The booking could not take that payment (for example, someone already paid your part), so the club is returning it to your card.',
      };
    case 'payment_taken_booking_changed':
      return {
        action: 'refresh',
        title: 'Payment received, booking changed',
        message:
          'The club has your payment, but the booking changed while it went through. Do not pay again; the club sorts it out.',
      };
    case 'payment_not_found':
    case 'card_not_found':
    case 'not_simulated':
      return {
        action: 'retry-payment',
        title: 'Payment not found',
        message: 'The club could not find that payment. Try paying again.',
      };
    case 'already_paid':
    case 'nothing_owed':
    case 'nothing_to_pay':
    case 'no_amount':
      return {
        action: 'refresh',
        title: 'Nothing to pay',
        message: 'There is nothing left to pay on this booking.',
      };
    case 'shares_not_open':
      return {
        action: 'none',
        title: 'Not open for payment yet',
        message: 'Players can pay their share once the member who booked has confirmed the booking.',
      };
    case 'share_exceeds_total':
    case 'share_mismatch':
    case 'share_invalid':
    case 'price_below_collected':
      return {
        action: 'refresh',
        title: 'Shares do not add up',
        message: 'The split of this booking changed. We reloaded it so you can see who owes what.',
      };
    case 'insufficient_credits':
    case 'no_session_passes':
    case 'pass_limit_reached':
    case 'pass_already_used':
      return {
        action: 'none',
        title: 'Not enough credit',
        message: 'You do not have the credit or pass this booking needs.',
      };
    case 'discount_code_invalid':
    case 'discount_code_not_applicable':
    case 'discount_code_min_amount_not_met':
    case 'discount_code_maxed_out':
    case 'discount_code_already_used':
      return {
        action: 'none',
        title: 'Discount code not accepted',
        message: 'That discount code does not apply to this booking.',
      };

    // ── Changing a booking ──
    case 'cancellation_window_passed':
      return {
        action: 'none',
        title: 'Too late to change',
        message: "This booking is inside the club's cancellation window and can no longer be changed here.",
      };
    case 'reschedule_costs_more':
    case 'reschedule_payment_required':
      return context.bookingParity
        ? {
            action: 'retry-payment',
            title: 'That move costs more',
            message: 'The new time is priced higher than your booking. Pay the difference to move it.',
          }
        : {
            action: 'pick-time',
            title: 'That move costs more',
            message:
              'Moving to a time that costs more is not available in the app yet. Pick a time at the same price or less, or cancel and book again.',
          };
    case 'move_not_applied':
      return {
        action: 'pick-time',
        title: 'Your booking was not moved',
        message: `${moveReason(error.details?.reason)} The payment for the difference is being returned to your card. Pick another time.`,
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
    case 'not_authorized':
    case 'insufficient_scope':
      return {
        action: 'none',
        title: 'Not allowed',
        message: 'The club does not allow this change to this booking.',
      };
    case 'booking_not_found':
    case 'not_found':
      return {
        action: 'refresh',
        title: 'Booking not found',
        message: 'This booking no longer exists (a hold that ran out is removed), or you are not part of it.',
      };
    case 'booking_not_confirmed':
      return {
        action: 'none',
        title: 'Booking not confirmed yet',
        message: 'This can be done once the booking is confirmed.',
      };
    case 'invite_not_pending':
    case 'invitation_not_pending':
      return {
        action: 'refresh',
        title: 'Invitation already answered',
        message: 'This invitation was already answered or withdrawn.',
      };
    case 'not_a_participant':
    case 'target_not_member':
      return {
        action: 'refresh',
        title: 'Not on this booking',
        message: 'That member is no longer a player on this booking.',
      };
    case 'own_booking':
    case 'already_joined':
      return {
        action: 'refresh',
        title: 'Already on this booking',
        message: 'You are already on this booking.',
      };
    case 'organizer_cannot_leave':
      return {
        action: 'none',
        title: 'You booked this court',
        message: 'The member who booked cannot leave; cancel the booking instead.',
      };
    case 'group_exceeds_capacity':
      return {
        action: 'none',
        title: 'Group too big',
        message: 'The group has more members than the court holds.',
      };
    case 'group_not_found':
    case 'member_not_found':
    case 'club_mismatch':
      return {
        action: 'refresh',
        title: 'Group not available',
        message: 'That group is not available for this booking.',
      };

    // ── Session ──
    case 'auth_required':
    case 'invalid_token':
    case 'session_expired':
    case 'invalid_credentials':
    case 'mfa_required':
    case 'email_not_confirmed':
      return {
        action: 'none',
        title: 'Sign in again',
        message: 'Your session ended. Sign in again, then try once more.',
      };

    // ── Nothing was decided ──
    case 'internal_error':
    case 'upstream_error':
    case 'request_in_flight':
    case 'idempotency_key_reused':
      return TRANSIENT;
    case 'rate_limit_exceeded':
      return {
        action: 'retry',
        title: 'Slow down a moment',
        message: 'Too many requests in a short time. Wait a few seconds and try again.',
      };

    // ── Codes no booking call sends: re-read the booking and show it ──
    case 'club_creation_not_permitted':
    case 'platform_managed_column':
    case 'club_not_found':
    case 'service_not_found':
    case 'lesson_not_found':
    case 'program_not_found':
    case 'session_not_found':
    case 'enrollment_not_found':
    case 'registration_not_found':
    case 'tournament_not_found':
    case 'package_not_found':
    case 'payment_method_not_found':
    case 'payment_method_not_owned':
    case 'notification_not_found':
    case 'profile_not_found':
    case 'waiver_not_found':
    case 'tier_not_found':
    case 'coach_not_found':
    case 'owner_not_found':
    case 'invalid_json':
    case 'missing_parameter':
    case 'missing_field':
    case 'invalid_field':
    case 'field_too_long':
    case 'password_too_short':
    case 'weak_password':
    case 'invalid_timezone':
    case 'invalid_slug':
    case 'invalid_currency':
    case 'invalid_court_type':
    case 'invalid_hours':
    case 'invalid_booking_rules':
    case 'courts_required':
    case 'name_too_long':
    case 'invitation_not_found':
    case 'invite_link_invalid':
    case 'must_transfer_first':
    case 'cannot_remove_self':
    case 'group_operation_failed':
    case 'invalid_content_type':
    case 'unsupported_image_type':
    case 'file_too_large':
    case 'upload_failed':
    case 'invalid_username':
    case 'name_required':
    case 'already_registered':
    case 'already_enrolled':
    case 'already_on_waiting_list':
    case 'session_full':
    case 'session_not_full':
    case 'session_not_scheduled':
    case 'tournament_full':
    case 'registration_closed':
    case 'deadline_passed':
    case 'prerequisite_required':
    case 'age_out_of_range':
    case 'chat_not_allowed':
    case 'not_open_play':
    case 'wrong_password':
    case 'share_link_invalid':
    case 'not_enrolled':
    case 'username_taken':
    case 'program_not_available':
    case 'slug_already_exists':
    case 'club_limit_reached':
    case 'email_in_use':
    case 'tier_not_configured':
    case 'device_token_taken':
    case 'already_subscribed':
    case 'already_on_tier':
    case 'tier_interval_mismatch':
    case 'subscription_ending':
    case 'not_cancelling':
    case 'setup_incomplete':
    case 'card_in_use_by_subscription':
    case 'step_up_required':
    case 'account_deletion_blocked':
    case 'refunds_pending':
    case 'account_deletion_failed':
    case 'checkin_unavailable':
    case 'unknown':
      return REREAD;

    default:
      return unnamedCode(code);
  }
}
