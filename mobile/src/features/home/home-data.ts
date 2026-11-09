/**
 * Pure helpers over the home feed's Clutch data: list ordering and what a
 * failed invitation answer means for the member. The reads themselves are the
 * shared queries in lib/queries.ts (homeQuery, bookingInvitationsQuery,
 * groupInvitationsQuery, membershipQuery).
 */
import { ClutchError, type Announcement, type BookingInvitation } from '../../lib/clutch';

/**
 * Pinned first, then newest first, an undated one (published_at null) after
 * the dated ones. Clutch already orders them this way; the sort keeps the
 * rule true on the client whatever order the list arrives in.
 */
export function orderAnnouncements(rows: readonly Announcement[]): Announcement[] {
  return [...rows].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    if (a.published_at === b.published_at) return 0;
    if (a.published_at === null) return 1;
    if (b.published_at === null) return -1;
    return b.published_at.localeCompare(a.published_at);
  });
}

/** Soonest first: the date then the club wall-clock start. */
export function orderInvitations(rows: readonly BookingInvitation[]): BookingInvitation[] {
  return [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time),
  );
}

export interface RespondFailure {
  message: string;
  /** The invitation moved on under the member: the lists are refetched, not retried. */
  conflict: boolean;
}

/**
 * What to tell the member when accepting or declining a booking invitation
 * fails. Only reachable once answering is live (P4 bookingParity).
 */
export function respondFailure(error: unknown): RespondFailure {
  if (error instanceof ClutchError && error.code !== 'unknown') {
    switch (error.code) {
      case 'invite_not_pending':
      case 'not_a_participant':
      case 'booking_not_found':
      case 'booking_cancelled':
      case 'booking_not_confirmed':
      case 'booking_not_bookable':
        return { message: 'This booking changed before your answer was saved.', conflict: true };
      case 'booking_started':
      case 'booking_ended':
        return { message: 'This booking has already started.', conflict: true };
      case 'not_club_member':
        return { message: 'Only club members can join this booking.', conflict: false };
      default:
        break;
    }
  }
  if (error instanceof ClutchError && error.kind === 'network') {
    return { message: 'You seem to be offline. Try again.', conflict: false };
  }
  return { message: 'We could not save your answer. Try again.', conflict: false };
}
