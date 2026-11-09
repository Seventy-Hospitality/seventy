/**
 * Who is looking at a booking and what they may do with it, from Clutch's
 * booking detail (GET /bookings/{id}) and the session's user id. Pure, so the
 * rules are testable. Clutch enforces every one of them again; these only
 * decide which actions the screen offers. Whether an action's Clutch route
 * is live (bookingParity) is the screen's call, not this one's.
 */
import type { BookingDetail, BookingDue, UserId } from '../../lib/clutch';
import { hasStarted } from '../reserve/booking';

/** One row of a booking's players: no names in the contract, only the user id. */
export type BookingPlayer = BookingDetail['players'][number];

/** How the viewer would pay what they owe, if anything. */
export type PayMode =
  /** The booker's unpaid hold: pay, then confirm. */
  | 'hold'
  /** The booker's balance on a confirmed booking: pay, then confirm records it. */
  | 'balance'
  /** A player's share (P4): shares/payment-intent, then shares/confirm. */
  | 'share';

export interface BookingViewer {
  isBooker: boolean;
  /** The viewer's own player row (null for the booker or a stranger). */
  me: BookingPlayer | null;
  /** The viewer's live due row from Clutch's booking_dues. */
  myDue: BookingDue | null;
  active: boolean;
  started: boolean;
  holdEnded: boolean;
  canCancel: boolean;
  canReschedule: boolean;
  canInvite: boolean;
  canRemovePlayers: boolean;
  canRespond: boolean;
  canLeave: boolean;
  payMode: PayMode | null;
}

export function viewerOf(
  booking: BookingDetail,
  userId: UserId | null,
  timezone: string,
  now: Date = new Date(),
): BookingViewer {
  const isBooker = !!userId && booking.user_id === userId;
  const me = (!isBooker && userId && booking.players.find((player) => player.user_id === userId)) || null;
  const myDue =
    (userId &&
      booking.dues.find((due) =>
        isBooker ? due.party === 'booker' : due.party === 'player' && due.user_id === userId,
      )) ||
    null;
  const active = booking.status === 'pending' || booking.status === 'confirmed';
  const started = hasStarted(booking, timezone, now);
  const holdEnded =
    booking.status === 'pending' &&
    !!booking.hold_expires_at &&
    new Date(booking.hold_expires_at).getTime() <= now.getTime();
  const open = active && !started;
  const owes = !!myDue && myDue.due_cents > 0 && open;

  let payMode: PayMode | null = null;
  if (owes && isBooker) payMode = booking.status === 'pending' ? (holdEnded ? null : 'hold') : 'balance';
  else if (owes && me && me.status === 'accepted' && booking.status === 'confirmed') payMode = 'share';

  return {
    isBooker,
    me,
    myDue,
    active,
    started,
    holdEnded,
    canCancel: isBooker && open,
    // One date of a standing weekly reservation can be cancelled, not moved.
    canReschedule: isBooker && booking.status === 'confirmed' && !started && !booking.recurring_booking_id,
    canInvite: isBooker && booking.status === 'confirmed' && !started,
    canRemovePlayers: isBooker && open,
    canRespond: !isBooker && me?.status === 'invited' && open,
    canLeave: !isBooker && me?.status === 'accepted' && open,
    payMode,
  };
}

/**
 * A player's name on the roster. GET /bookings/{id} sends no names for
 * players (only user ids), so every row reads "Player"; the viewer's own row
 * adds "(you)" on screen.
 */
export function playerDisplayName(_player: BookingPlayer): string {
  return 'Player';
}

/** Players still on the booking (declined rows are history, not the roster). */
export function rosterOf(booking: BookingDetail): BookingPlayer[] {
  return booking.players.filter((player) => player.status !== 'declined');
}
