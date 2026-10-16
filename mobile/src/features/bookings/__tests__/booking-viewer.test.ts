import { playerDisplayName, rosterOf, viewerOf } from '../booking-viewer';
import type { BookingDetail, BookingDue, BookingPlayer } from '../../../lib/clutch';
import { ME_ID, OTHER_ID, makeBookingDetail } from '../../../lib/clutch/fixtures';

const TZ = 'America/New_York';
// 2026-10-16 12:00 in New York; the fixture booking is 2026-10-20 18:00.
const NOW = new Date('2026-10-16T16:00:00.000Z');

function player(over: Partial<BookingPlayer> = {}): BookingPlayer {
  return { user_id: ME_ID, status: 'invited', share_cents: null, ...over };
}

function due(over: Partial<BookingDue> = {}): BookingDue {
  return {
    party: 'booker',
    user_id: OTHER_ID,
    invitation_id: null,
    live: true,
    share_cents: 3000,
    paid_cents: 0,
    due_cents: 3000,
    ...over,
  };
}

function booking(over: Partial<BookingDetail> = {}): BookingDetail {
  return makeBookingDetail(over);
}

describe('viewerOf', () => {
  it('the booker of a confirmed booking may cancel, move, invite and remove', () => {
    const viewer = viewerOf(booking({ user_id: ME_ID }), ME_ID, TZ, NOW);
    expect(viewer).toMatchObject({
      isBooker: true,
      me: null,
      canCancel: true,
      canReschedule: true,
      canInvite: true,
      canRemovePlayers: true,
      canRespond: false,
      canLeave: false,
      payMode: null,
    });
  });

  it('an invited player may respond and nothing else', () => {
    const viewer = viewerOf(
      booking({ user_id: OTHER_ID, players: [player({ status: 'invited' })] }),
      ME_ID,
      TZ,
      NOW,
    );
    expect(viewer).toMatchObject({ isBooker: false, canRespond: true, canLeave: false, canCancel: false, canInvite: false });
  });

  it('an accepted player may leave and pays their own share', () => {
    const viewer = viewerOf(
      booking({
        user_id: OTHER_ID,
        players: [player({ status: 'accepted', share_cents: 1500 })],
        dues: [due({ party: 'player', user_id: ME_ID, share_cents: 1500, due_cents: 1500 })],
      }),
      ME_ID,
      TZ,
      NOW,
    );
    expect(viewer.canLeave).toBe(true);
    expect(viewer.myDue?.due_cents).toBe(1500);
    expect(viewer.payMode).toBe('share');
  });

  it('reads the booker due from the booker row, never a player row', () => {
    const detail = booking({
      user_id: ME_ID,
      dues: [
        due({ party: 'player', user_id: OTHER_ID, due_cents: 1500 }),
        due({ party: 'booker', user_id: ME_ID, due_cents: 500 }),
      ],
    });
    const viewer = viewerOf(detail, ME_ID, TZ, NOW);
    expect(viewer.myDue?.due_cents).toBe(500);
    expect(viewer.payMode).toBe('balance');
  });

  it('a booker with an unpaid hold pays the hold, until the hold ends', () => {
    const pending = booking({
      user_id: ME_ID,
      status: 'pending',
      hold_expires_at: '2026-10-16T16:10:00.000Z',
      dues: [due({ party: 'booker', user_id: ME_ID })],
    });
    expect(viewerOf(pending, ME_ID, TZ, NOW).payMode).toBe('hold');
    const later = new Date('2026-10-16T16:20:00.000Z');
    expect(viewerOf(pending, ME_ID, TZ, later)).toMatchObject({ payMode: null, holdEnded: true });
  });

  it('offers nothing once the booking started or was cancelled', () => {
    const started = viewerOf(booking({ user_id: ME_ID, date: '2026-10-16', start_time: '11:00:00' }), ME_ID, TZ, NOW);
    expect(started).toMatchObject({ started: true, canCancel: false, canReschedule: false, canInvite: false });
    const cancelled = viewerOf(booking({ user_id: ME_ID, status: 'cancelled' }), ME_ID, TZ, NOW);
    expect(cancelled).toMatchObject({ active: false, canCancel: false, canReschedule: false });
  });

  it('a stranger (or no session) gets no actions', () => {
    const viewer = viewerOf(booking({ user_id: OTHER_ID }), null, TZ, NOW);
    expect(viewer).toMatchObject({ isBooker: false, me: null, myDue: null, canRespond: false, payMode: null });
  });
});

describe('roster names', () => {
  it('falls back to "Player" until Clutch sends names', () => {
    expect(playerDisplayName({ full_name: null })).toBe('Player');
    expect(playerDisplayName({})).toBe('Player');
    expect(playerDisplayName({ full_name: ' Sam Lee ' })).toBe('Sam Lee');
  });

  it('leaves declined players off the roster', () => {
    const detail = booking({
      players: [player({ status: 'accepted' }), player({ user_id: OTHER_ID, status: 'declined' })],
    });
    expect(rosterOf(detail).map((p) => p.user_id)).toEqual([ME_ID]);
  });
});
