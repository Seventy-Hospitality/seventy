/**
 * A player leaves someone else's booking (DELETE /bookings/{id}/players/{me},
 * Clutch P4). Callers offer it only with clutch.capabilities.bookingParity on.
 * Leaving also forgets the booking from this device's "playing" list.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clutch, useMutationKey, type BookingId } from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { forgetAcceptedBookings } from './accepted-bookings';

export function useLeaveBooking() {
  const queryClient = useQueryClient();
  const { userId } = useSession();
  const key = useMutationKey();

  return useMutation({
    mutationFn: async (bookingId: BookingId) => {
      if (!userId) throw new Error('Signed out.');
      const result = await key.run({ leave: bookingId }, (idempotencyKey) =>
        clutch.bookings.removePlayer(bookingId, userId, { idempotencyKey }),
      );
      await forgetAcceptedBookings(userId, [bookingId]).catch(() => undefined);
      return result;
    },
    onSettled: (_result, _error, bookingId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(bookingId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
