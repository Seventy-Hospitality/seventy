import * as SecureStore from 'expo-secure-store';
import { asBookingId, asUserId, clutch } from '../../../lib/clutch';
import { clutchError, networkError, type MockClutch } from '../../../lib/clutch/testing';
import { ME_ID, OTHER_ID, makeBookingDetail, makeBookingDue, makeBookingPlayer } from '../../../lib/clutch/fixtures';
import {
  acceptedKey,
  forgetAcceptedBookings,
  loadPlayingBookings,
  readAcceptedBookingIds,
  rememberAcceptedBooking,
} from '../accepted-bookings';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});

const mockClutch = clutch as unknown as MockClutch;
const ME = asUserId(ME_ID);
const OTHER = asUserId(OTHER_ID);
const A = asBookingId('b0000000-0000-4000-8000-00000000000a');
const B = asBookingId('b0000000-0000-4000-8000-00000000000b');
const C = asBookingId('b0000000-0000-4000-8000-00000000000c');
const D = asBookingId('b0000000-0000-4000-8000-00000000000d');

function playingIn(id: typeof A, over: Parameters<typeof makeBookingDetail>[0] = {}) {
  return makeBookingDetail({
    id,
    user_id: OTHER,
    players: [makeBookingPlayer({ user_id: ME, status: 'accepted' })],
    dues: [makeBookingDue({ party: 'player', user_id: ME, due_cents: 1500, share_cents: 1500 })],
    ...over,
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await SecureStore.deleteItemAsync(acceptedKey(ME));
  await SecureStore.deleteItemAsync(acceptedKey(OTHER));
});

describe('the accepted-bookings list', () => {
  it('keeps ids per user, newest first, without duplicates', async () => {
    await rememberAcceptedBooking(ME, A);
    await rememberAcceptedBooking(ME, B);
    await rememberAcceptedBooking(ME, A);
    await rememberAcceptedBooking(OTHER, C);
    expect(await readAcceptedBookingIds(ME)).toEqual([A, B]);
    expect(await readAcceptedBookingIds(OTHER)).toEqual([C]);
    await forgetAcceptedBookings(ME, [A]);
    expect(await readAcceptedBookingIds(ME)).toEqual([B]);
  });

  it('survives a corrupt value', async () => {
    await SecureStore.setItemAsync(acceptedKey(ME), 'not json');
    expect(await readAcceptedBookingIds(ME)).toEqual([]);
  });
});

describe('loadPlayingBookings', () => {
  it('shows live bookings the member still plays in, drops the rest, keeps unreadable ones for later', async () => {
    for (const id of [D, C, B, A]) await rememberAcceptedBooking(ME, id);
    mockClutch.bookings.get.mockImplementation(async (id) => {
      if (id === A) return playingIn(A, { date: '2099-06-02' });
      if (id === B) return playingIn(B, { players: [makeBookingPlayer({ user_id: ME, status: 'declined' })] });
      if (id === C) throw clutchError('booking_not_found', 404);
      throw networkError();
    });

    const rows = await loadPlayingBookings(ME);
    expect(rows.map((row) => row.booking.id)).toEqual([A]);
    expect(rows[0].myDue?.due_cents).toBe(1500);
    expect(rows[0].card).toMatchObject({ id: A, court_name: 'Court 1', my_due_cents: 1500, status: 'confirmed' });
    // B (left) and C (gone) are forgotten; D (offline) is kept.
    expect(await readAcceptedBookingIds(ME)).toEqual([A, D]);
  });

  it('drops cancelled bookings', async () => {
    await rememberAcceptedBooking(ME, A);
    mockClutch.bookings.get.mockResolvedValue(playingIn(A, { status: 'cancelled' }));
    expect(await loadPlayingBookings(ME)).toEqual([]);
    expect(await readAcceptedBookingIds(ME)).toEqual([]);
  });
});
