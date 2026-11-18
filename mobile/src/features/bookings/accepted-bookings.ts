/**
 * Bookings this member PLAYS in (an invitation they accepted), which no
 * Clutch list returns: GET /me/bookings lists only the bookings they booked,
 * and its invitations view lists only pending ones. Once accepted, a booking
 * would vanish from the app.
 *
 * Until Clutch adds an endpoint for it, the app keeps the ids itself: a small
 * JSON list per user in expo-secure-store (key namespaced by user id), added
 * to when the member accepts (useRespondToBooking) or opens a booking they
 * are an accepted player on. Each id is read with GET /bookings/{id}
 * (players may read the bookings they are on); an id whose booking is gone,
 * is over, or no longer has this member as an accepted player is dropped.
 *
 * The list is device-local: a booking accepted on the web or another phone
 * shows here once the member opens it on this device.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import {
  clutch,
  hasCode,
  type BookingDetail,
  type BookingDue,
  type BookingId,
  type UserId,
} from '../../lib/clutch';
import type { BookingCardBooking } from '../../components/BookingCard';
import { homeQuery, meQuery, queryKeys } from '../../lib/queries';
import { endToMinutes, timeToMinutes } from '../reserve/booking';

/** At most this many ids are kept (newest first); old ones fall off. */
export const MAX_ACCEPTED = 50;

/** SecureStore allows [A-Za-z0-9._-]; a UUID user id fits. */
export function acceptedKey(userId: UserId): string {
  return `club70.accepted_bookings.${String(userId).replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

// Read-modify-write through one chain, so two answers in a row cannot drop
// each other's id.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

async function readRaw(userId: UserId): Promise<BookingId[]> {
  try {
    const raw = await SecureStore.getItemAsync(acceptedKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((id) => typeof id === 'string') as BookingId[]) : [];
  } catch {
    return [];
  }
}

async function writeRaw(userId: UserId, ids: BookingId[]): Promise<void> {
  await SecureStore.setItemAsync(acceptedKey(userId), JSON.stringify(ids.slice(0, MAX_ACCEPTED)));
}

export function readAcceptedBookingIds(userId: UserId): Promise<BookingId[]> {
  return serial(() => readRaw(userId));
}

export function rememberAcceptedBooking(userId: UserId, bookingId: BookingId): Promise<void> {
  return serial(async () => {
    const ids = await readRaw(userId);
    if (ids[0] === bookingId) return;
    await writeRaw(userId, [bookingId, ...ids.filter((id) => id !== bookingId)]);
  });
}

export function forgetAcceptedBookings(userId: UserId, drop: readonly BookingId[]): Promise<void> {
  if (drop.length === 0) return Promise.resolve();
  return serial(async () => {
    const ids = await readRaw(userId);
    const next = ids.filter((id) => !drop.includes(id));
    if (next.length !== ids.length) await writeRaw(userId, next);
  });
}

/** A booking the member plays in, with their own due row. */
export interface PlayingBooking {
  booking: BookingDetail;
  /** The member's due (players see only their own row); null when no split was set. */
  myDue: BookingDue | null;
  /** The same booking in the Booking-row shape lists render (BookingCard). */
  card: BookingCardBooking;
}

/**
 * The signed-in member's user id, from Clutch's own profile (cached by the
 * home or /me read, else fetched). Read this way rather than from
 * useSession so the hooks here work wherever react-query does.
 */
export async function viewerUserId(queryClient: QueryClient): Promise<UserId | null> {
  const cached = queryClient.getQueryData(homeQuery.queryKey)?.profile.id ?? queryClient.getQueryData(meQuery.queryKey)?.profile.id;
  if (cached) return cached;
  try {
    return (await queryClient.fetchQuery(meQuery)).profile.id;
  } catch {
    return null;
  }
}

const LIVE = new Set(['pending', 'confirmed']);

/** Whether a read booking still belongs on the member's "playing" list. */
export function stillPlaying(booking: BookingDetail, userId: UserId): boolean {
  if (!LIVE.has(booking.status)) return false;
  return booking.players.some((player) => player.user_id === userId && player.status === 'accepted');
}

/**
 * Read every remembered id; keep the live ones this member still plays in,
 * forget the rest. A read that fails for another reason (offline) keeps the
 * id and leaves the booking out this time.
 */
export async function loadPlayingBookings(userId: UserId): Promise<PlayingBooking[]> {
  const ids = await readAcceptedBookingIds(userId);
  const reads = await Promise.allSettled(ids.map((id) => clutch.bookings.get(id)));
  const keep: PlayingBooking[] = [];
  const drop: BookingId[] = [];
  reads.forEach((read, index) => {
    if (read.status === 'fulfilled') {
      if (stillPlaying(read.value, userId)) {
        const myDue = read.value.dues.find((due) => due.party === 'player' && due.user_id === userId) ?? null;
        const booking = read.value;
        keep.push({
          booking,
          myDue,
          card: {
            id: booking.id,
            date: booking.date,
            start_time: booking.start_time,
            end_time: booking.end_time,
            status: booking.status,
            court_name: booking.court?.name ?? null,
            court_type: booking.court?.court_type ?? null,
            currency: booking.currency,
            my_due_cents: myDue?.due_cents ?? null,
          },
        });
      } else {
        drop.push(ids[index]);
      }
    } else if (hasCode(read.reason, 'booking_not_found', 'not_found', 'not_authorized')) {
      drop.push(ids[index]);
    }
  });
  await forgetAcceptedBookings(userId, drop);
  return keep.sort(
    (a, b) =>
      a.booking.date.localeCompare(b.booking.date) ||
      timeToMinutes(a.booking.start_time) - timeToMinutes(b.booking.start_time) ||
      endToMinutes(a.booking.end_time) - endToMinutes(b.booking.end_time),
  );
}

/** Under queryKeys.bookings, so every booking invalidation refreshes it (the cache is cleared on sign-out). */
export const playingBookingsKey = [...queryKeys.bookings, 'playing'] as const;

/**
 * Bookings the signed-in member plays in (accepted invitations), soonest
 * first; each row carries `card` (the Booking-row fields BookingCard takes),
 * so home can list them next to upcoming_bookings. Clutch should add an
 * endpoint for this; until then the ids live on the device.
 */
export function usePlayingBookings() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: playingBookingsKey,
    queryFn: async () => {
      const userId = await viewerUserId(queryClient);
      return userId ? loadPlayingBookings(userId) : [];
    },
  });
}
