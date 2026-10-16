import { asBookingId } from '../../../lib/clutch';
import { clutchError, networkError, TEST_CLUB_ID } from '../../../lib/clutch/testing';
import { makeBookingWithCourt, makeSubscription } from '../../../lib/clutch/fixtures';
import type { Announcement, BookingInvitation } from '../../../lib/clutch';
import { orderAnnouncements, orderInvitations, respondFailure, tierDetail } from '../home-data';
import { firstNameOf, greetingEyebrow, homeLayout, timeOfDay } from '../home-sections';

function invitation(over: Partial<BookingInvitation> = {}): BookingInvitation {
  return {
    booking_player_id: 'bp1',
    booking_id: asBookingId('b0000000-0000-4000-8000-000000000009'),
    status: 'invited',
    invited_at: '2026-10-15T12:00:00.000Z',
    court_name: 'Court 2',
    date: '2026-10-20',
    start_time: '18:00:00',
    end_time: '19:00:00',
    inviter_name: 'Sarah Lee',
    club_id: TEST_CLUB_ID,
    ...over,
  };
}

function announcement(over: Partial<Announcement> = {}): Announcement {
  return {
    id: 'a1',
    title: 'Courts resurfaced',
    body: 'Courts 1 to 4 are back.',
    isPinned: false,
    publishedAt: '2026-10-10T12:00:00.000Z',
    authorName: null,
    ...over,
  };
}

describe('homeLayout', () => {
  it('is the empty first-session layout with nothing upcoming and no invitations', () => {
    expect(homeLayout({ upcoming: [], bookingInvitations: [] })).toEqual({
      isEmpty: true,
      showBookingInvitations: false,
      showUpcoming: false,
    });
  });

  it('is not empty while the invitations read has not answered', () => {
    expect(homeLayout({ upcoming: [], bookingInvitations: undefined }).isEmpty).toBe(false);
  });

  it('shows invitations alone when only an invitation is pending', () => {
    expect(homeLayout({ upcoming: [], bookingInvitations: [invitation()] })).toEqual({
      isEmpty: false,
      showBookingInvitations: true,
      showUpcoming: false,
    });
  });

  it('shows upcoming bookings without invitations', () => {
    expect(homeLayout({ upcoming: [makeBookingWithCourt()], bookingInvitations: [] })).toEqual({
      isEmpty: false,
      showBookingInvitations: false,
      showUpcoming: true,
    });
  });
});

describe('greeting', () => {
  it('reads the time of day off the device clock', () => {
    expect(timeOfDay(new Date(2026, 9, 16, 8))).toBe('morning');
    expect(timeOfDay(new Date(2026, 9, 16, 13))).toBe('afternoon');
    expect(timeOfDay(new Date(2026, 9, 16, 19))).toBe('evening');
    expect(timeOfDay(new Date(2026, 9, 16, 2))).toBe('evening');
  });

  it('welcomes a member with nothing scheduled, else greets by time of day', () => {
    expect(greetingEyebrow('morning', true)).toBe('Welcome,');
    expect(greetingEyebrow('morning', false)).toBe('Good morning,');
    expect(greetingEyebrow('afternoon', false)).toBe('Good afternoon,');
    expect(greetingEyebrow('evening', false)).toBe('Good evening,');
  });

  it('takes the first word of full_name', () => {
    expect(firstNameOf('Alex Morgan')).toBe('Alex');
    expect(firstNameOf('  Prince ')).toBe('Prince');
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });
});

describe('orderAnnouncements', () => {
  it('puts pinned first, then newest first', () => {
    const rows = [
      announcement({ id: 'old', publishedAt: '2026-10-01T00:00:00.000Z' }),
      announcement({ id: 'pinned', isPinned: true, publishedAt: '2026-09-01T00:00:00.000Z' }),
      announcement({ id: 'new', publishedAt: '2026-10-12T00:00:00.000Z' }),
    ];
    expect(orderAnnouncements(rows).map((a) => a.id)).toEqual(['pinned', 'new', 'old']);
  });
});

describe('orderInvitations', () => {
  it('lists the soonest first', () => {
    const rows = [
      invitation({ booking_player_id: 'late', date: '2026-10-21', start_time: '08:00:00' }),
      invitation({ booking_player_id: 'evening', date: '2026-10-20', start_time: '19:00:00' }),
      invitation({ booking_player_id: 'morning', date: '2026-10-20', start_time: '09:00:00' }),
    ];
    expect(orderInvitations(rows).map((i) => i.booking_player_id)).toEqual(['morning', 'evening', 'late']);
  });
});

describe('tierDetail', () => {
  it('names the current tier when Clutch knows one, else nothing', () => {
    expect(tierDetail({ membership: { role: 'player' }, subscription: makeSubscription({ tier_name: 'Pro' }) })).toBe(
      'Pro',
    );
    expect(tierDetail({ membership: { role: 'player' }, subscription: null })).toBeNull();
    expect(tierDetail(undefined)).toBeNull();
  });
});

describe('respondFailure', () => {
  it('treats an invitation that moved on as a conflict', () => {
    expect(respondFailure(clutchError('invite_not_pending'))).toEqual({
      message: 'This booking changed before your answer was saved.',
      conflict: true,
    });
    expect(respondFailure(clutchError('booking_cancelled')).conflict).toBe(true);
    expect(respondFailure(clutchError('booking_started')).message).toMatch(/already started/);
  });

  it('says offline for a network failure and try again otherwise', () => {
    expect(respondFailure(networkError())).toEqual({
      message: 'You seem to be offline. Try again.',
      conflict: false,
    });
    expect(respondFailure(clutchError('internal_error', 500)).message).toBe(
      'We could not save your answer. Try again.',
    );
    expect(respondFailure(new Error('boom')).conflict).toBe(false);
  });
});
