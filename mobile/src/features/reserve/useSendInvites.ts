/**
 * Sends a confirmed booking's invites: the picked players in one call, then
 * each picked group in its own call (invite-group takes one group).
 *
 * Each call is its own logical mutation with its own Idempotency-Key, kept
 * per item: a network blip on group B replays B with the same key on retry,
 * while players and group A, already sent, are dropped from the selection and
 * never sent again. A refusal ends that item's key (Clutch caches 4xx under
 * it), so a later retry of the same item is a fresh request.
 *
 * Invites go out only once the booking is confirmed: invite-group requires a
 * confirmed booking, and player invites follow the same point so the flow is
 * one and the same from the confirmation sheet and from "Invite more".
 */
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  clutch,
  createMutationKey,
  type BookingId,
  type GroupId,
  type MutationKey,
} from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import type { InviteSelection } from './invites';

export interface SendInvitesProgress {
  /** The players call succeeded. */
  playersSent?: boolean;
  /** This group's call succeeded. */
  groupSent?: GroupId;
}

export function useSendInvites(
  bookingId: BookingId,
  onProgress: (progress: SendInvitesProgress) => void,
) {
  const queryClient = useQueryClient();
  const keys = useRef(new Map<string, MutationKey>());
  const keyFor = (item: string) => {
    let key = keys.current.get(item);
    if (!key) {
      key = createMutationKey();
      keys.current.set(item, key);
    }
    return key;
  };

  return useMutation({
    mutationFn: async (selection: InviteSelection) => {
      if (selection.players.length > 0) {
        const ids = selection.players.map((player) => player.user_id);
        await keyFor('players').run({ bookingId, ids }, (key) =>
          clutch.bookings.invitePlayers(bookingId, ids, { idempotencyKey: key }),
        );
        onProgress({ playersSent: true });
      }
      for (const group of selection.groups) {
        await keyFor(`group:${group.id}`).run({ bookingId, group: group.id }, (key) =>
          clutch.bookings.inviteGroup(bookingId, group.id, { idempotencyKey: key }),
        );
        onProgress({ groupSent: group.id });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(bookingId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
