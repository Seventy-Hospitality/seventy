/**
 * Pure helpers over the home feed's Clutch data: list ordering and what a
 * failed invitation answer means for the member. The reads themselves are the
 * shared queries in lib/queries.ts (homeQuery, bookingInvitationsQuery,
 * groupInvitationsQuery, membershipQuery).
 */
import {
  ClutchError,
  type Announcement,
  type BookingInvitation,
  type MyMembership,
} from '../../lib/clutch';

/**
 * Pinned first, then newest first. Clutch already orders them this way; the
 * sort keeps the rule true on the client whatever order the list arrives in.
 */
export function orderAnnouncements(rows: readonly Announcement[]): Announcement[] {
  return [...rows].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

/** Soonest first: the date then the club wall-clock start. */
export function orderInvitations(rows: readonly BookingInvitation[]): BookingInvitation[] {
  return [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time),
  );
}

/** The member card's detail line: the current tier, when Clutch says there is one. */
export function tierDetail(membership: MyMembership | undefined): string | null {
  return membership?.subscription?.tier_name ?? null;
}

export interface RespondFailure {
  message: string;
  /** The invitation moved on under the member: the lists are refetched, not retried. */
  conflict: boolean;
}

/** What to tell the member when accepting or declining a booking invitation fails. */
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
