import { asUserId, type BookingMove } from '../../../lib/clutch';
import {
  ME_ID,
  OTHER_ID,
  makeBookingDetail,
  makeBookingDue,
  makeBookingPlayer,
} from '../../../lib/clutch/fixtures';
import { bookerVerdict, moveVerdict, shareVerdict } from '../useBookingPayment';

const NOW = new Date('2026-10-20T20:00:00.000Z');

describe('bookerVerdict', () => {
  it('settles a hold once confirmed, keeps it open while held, ends it when gone or expired', () => {
    expect(bookerVerdict(makeBookingDetail({ status: 'confirmed' }), 'hold', NOW)).toBe('settled');
    const held = makeBookingDetail({ status: 'pending', hold_expires_at: '2026-10-20T20:10:00.000Z' });
    expect(bookerVerdict(held, 'hold', NOW)).toBe('open');
    const expired = makeBookingDetail({ status: 'pending', hold_expires_at: '2026-10-20T19:50:00.000Z' });
    expect(bookerVerdict(expired, 'hold', NOW)).toBe('ended');
    expect(bookerVerdict(makeBookingDetail({ status: 'cancelled' }), 'hold', NOW)).toBe('ended');
  });

  it('settles a balance only when the booker owes nothing', () => {
    const owing = makeBookingDetail({ dues: [makeBookingDue({ due_cents: 500 })] });
    expect(bookerVerdict(owing, 'balance', NOW)).toBe('open');
    const paid = makeBookingDetail({ dues: [makeBookingDue({ due_cents: 0, paid_cents: 3000 })] });
    expect(bookerVerdict(paid, 'balance', NOW)).toBe('settled');
  });
});

describe('shareVerdict', () => {
  const me = asUserId(OTHER_ID);
  const base = { user_id: asUserId(ME_ID) };

  it('settles when the player owes nothing, stays open while they owe', () => {
    const players = [makeBookingPlayer({ user_id: me, status: 'accepted' })];
    const owing = makeBookingDetail({
      ...base,
      players,
      dues: [makeBookingDue({ party: 'player', user_id: me, due_cents: 1500 })],
    });
    expect(shareVerdict(owing, me)).toBe('open');
    const paid = makeBookingDetail({
      ...base,
      players,
      dues: [makeBookingDue({ party: 'player', user_id: me, due_cents: 0, paid_cents: 1500 })],
    });
    expect(shareVerdict(paid, me)).toBe('settled');
  });

  it('ends when the player is off the booking or it is over', () => {
    const left = makeBookingDetail({ ...base, players: [makeBookingPlayer({ user_id: me, status: 'declined' })] });
    expect(shareVerdict(left, me)).toBe('ended');
    const over = makeBookingDetail({
      ...base,
      status: 'cancelled',
      players: [makeBookingPlayer({ user_id: me, status: 'accepted' })],
    });
    expect(shareVerdict(over, me)).toBe('ended');
  });
});

describe('moveVerdict', () => {
  const move: BookingMove = { new_date: '2026-10-21', new_start_time: '23:00', new_end_time: '24:00' };

  it('settles once the booking sits at the target (midnight read as 24:00)', () => {
    const moved = makeBookingDetail({ date: '2026-10-21', start_time: '23:00:00', end_time: '00:00:00' });
    expect(moveVerdict(moved, move)).toBe('settled');
    expect(moveVerdict(makeBookingDetail(), move)).toBe('open');
    expect(moveVerdict(makeBookingDetail({ status: 'cancelled' }), move)).toBe('ended');
  });
});
