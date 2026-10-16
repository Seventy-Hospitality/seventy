/**
 * Accept or decline an invitation to someone else's booking (POST
 * /bookings/{id}/respond, PENDING P4). Shared by the booking screen and the
 * home screen's invitation cards so both answer the same way and refresh the
 * same reads: every booking read (detail, lists, invitations) and home.
 *
 * No optimistic write: the answer changes what the member owes (their share)
 * and who is on the roster, which Clutch decides. The screens show a pending
 * state and then Clutch's truth.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clutch, useMutationKey, type BookingId } from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';

export interface RespondInput {
  bookingId: BookingId;
  accept: boolean;
}

export function useRespondToBooking() {
  const queryClient = useQueryClient();
  const key = useMutationKey();

  return useMutation({
    mutationFn: (input: RespondInput) =>
      key.run(input, (idempotencyKey) =>
        clutch.bookings.respond(input.bookingId, input.accept, { idempotencyKey }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
