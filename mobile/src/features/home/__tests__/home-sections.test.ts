import { clutchError, networkError } from '../../../lib/clutch/testing';
import { makeAnnouncement, makeBooking, makeBookingInvitation } from '../../../lib/clutch/fixtures';
import { orderAnnouncements, orderInvitations, respondFailure } from '../home-data';
import { firstNameOf, greetingEyebrow, homeLayout, timeOfDay } from '../home-sections';

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
    expect(homeLayout({ upcoming: [], bookingInvitations: [makeBookingInvitation()] })).toEqual({
      isEmpty: false,
      showBookingInvitations: true,
      showUpcoming: false,
    });
  });

  it('shows upcoming bookings without invitations', () => {
    expect(homeLayout({ upcoming: [makeBooking()], bookingInvitations: [] })).toEqual({
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
  it('puts pinned first, then newest first, undated last', () => {
    const rows = [
      makeAnnouncement({ id: 'old', published_at: '2026-10-01T00:00:00.000Z' }),
      makeAnnouncement({ id: 'undated', published_at: null }),
      makeAnnouncement({ id: 'pinned', is_pinned: true, published_at: '2026-09-01T00:00:00.000Z' }),
      makeAnnouncement({ id: 'new', published_at: '2026-10-12T00:00:00.000Z' }),
    ];
    expect(orderAnnouncements(rows).map((a) => a.id)).toEqual(['pinned', 'new', 'old', 'undated']);
  });

  it('keeps an undated pinned one above unpinned ones', () => {
    const rows = [
      makeAnnouncement({ id: 'news', published_at: '2026-10-12T00:00:00.000Z' }),
      makeAnnouncement({ id: 'pinned', is_pinned: true, published_at: null }),
    ];
    expect(orderAnnouncements(rows).map((a) => a.id)).toEqual(['pinned', 'news']);
  });
});

describe('orderInvitations', () => {
  it('lists the soonest first', () => {
    const rows = [
      makeBookingInvitation({ booking_player_id: 'late', date: '2026-10-21', start_time: '08:00:00' }),
      makeBookingInvitation({ booking_player_id: 'evening', date: '2026-10-20', start_time: '19:00:00' }),
      makeBookingInvitation({ booking_player_id: 'morning', date: '2026-10-20', start_time: '09:00:00' }),
    ];
    expect(orderInvitations(rows).map((i) => i.booking_player_id)).toEqual(['morning', 'evening', 'late']);
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
