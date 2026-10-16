/**
 * Pure layout and greeting selection for the home feed, over Clutch's types,
 * so the screen and its tests agree on what renders.
 */
import type { BookingInvitation, BookingWithCourt } from '../../lib/clutch';

export interface HomeLayoutInput {
  upcoming: readonly BookingWithCourt[];
  /** undefined while the invitations read has not answered (or failed). */
  bookingInvitations: readonly BookingInvitation[] | undefined;
}

export interface HomeLayout {
  /**
   * The first-session state: nothing upcoming and no booking invitations.
   * Only when the invitations read has answered, so a slow or failed read
   * never flashes "book your first session" at a member who has an invite.
   */
  isEmpty: boolean;
  showBookingInvitations: boolean;
  showUpcoming: boolean;
}

export function homeLayout({ upcoming, bookingInvitations }: HomeLayoutInput): HomeLayout {
  const invitationCount = bookingInvitations?.length ?? 0;
  return {
    isEmpty: upcoming.length === 0 && bookingInvitations !== undefined && invitationCount === 0,
    showBookingInvitations: invitationCount > 0,
    showUpcoming: upcoming.length > 0,
  };
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

/**
 * The member's own time of day, on the device clock: "Good evening" is about
 * where the member is, and nothing depends on it.
 */
export function timeOfDay(now: Date): TimeOfDay {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/** The eyebrow above the member's first name in the greeting header. */
export function greetingEyebrow(when: TimeOfDay, isEmpty: boolean): string {
  if (isEmpty) return 'Welcome,';
  switch (when) {
    case 'morning':
      return 'Good morning,';
    case 'afternoon':
      return 'Good afternoon,';
    case 'evening':
      return 'Good evening,';
  }
}

/** The first word of the profile's full_name; null when Clutch has no name. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}
