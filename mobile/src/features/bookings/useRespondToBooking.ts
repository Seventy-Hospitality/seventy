/**
 * Accept or decline an invitation to someone else's booking (POST
 * /bookings/{id}/respond, Clutch P4). Shared by the booking screen and the
 * home screen's invitation cards so both answer the same way and refresh the
 * same reads: every booking read (detail, lists, invitations) and home.
 *
 * Callers offer it only with clutch.capabilities.bookingParity on (export
 * `respondAvailable`); without it the client refuses locally.
 *
 * An accepted invitation is remembered on this device (accepted-bookings.ts):
 * Clutch has no list of the bookings a member plays in, and the booking
 * would otherwise vanish from the app once it leaves the invitations list.
 *
 * No optimistic write: the answer changes what the member owes (their share)
 * and who is on the roster, which Clutch decides. The screens show a pending
 * state and then Clutch's truth.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clutch, useMutationKey, type BookingId } from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import { rememberAcceptedBooking, viewerUserId } from './accepted-bookings';

export interface RespondInput {
  bookingId: BookingId;
  accept: boolean;
}

/** Whether accepting or declining can be offered at all (Clutch P4). */
export function respondAvailable(): boolean {
  return clutch.capabilities.bookingParity;
}

export function useRespondToBooking() {
  const queryClient = useQueryClient();
  const key = useMutationKey();

  return useMutation({
    mutationFn: async (input: RespondInput) => {
      const answer = await key.run(input, (idempotencyKey) =>
        clutch.bookings.respond(input.bookingId, input.accept, { idempotencyKey }),
      );
      if (answer.status === 'accepted') {
        // Best effort: a failed write only means the booking shows once the
        // member opens it again.
        const userId = await viewerUserId(queryClient);
        if (userId) await rememberAcceptedBooking(userId, answer.booking_id).catch(() => undefined);
      }
      return answer;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
