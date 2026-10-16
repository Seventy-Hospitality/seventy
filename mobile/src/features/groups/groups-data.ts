/**
 * Group reads private to this feature, the invitation-response hook (also used
 * by the home screen), and the invite-link hook.
 *
 * Shared reads (groupsQuery, groupQuery, groupInvitationsQuery and the
 * groupActivity key) live in src/lib/queries.ts. Every key here sits under
 * ['groups', ...], so invalidating queryKeys.groups after a group mutation
 * reaches every group screen at once.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import {
  clutch,
  isTransient,
  useMutationKey,
  type GroupId,
  type GroupInvitation,
} from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';

export const groupActivityQuery = (id: GroupId, filter: 'upcoming' | 'past') =>
  queryOptions({
    queryKey: queryKeys.groupActivity(id, filter),
    queryFn: () => clutch.groups.activity(id, filter),
    staleTime: 30_000,
  });

/**
 * A join-link preview. Always fresh (a link can die between opening the screen
 * and joining); a refusal (invite_link_invalid) is final, so only a transient
 * failure is retried.
 */
export const invitePreviewQuery = (token: string) =>
  queryOptions({
    queryKey: ['groups', 'invite-preview', token] as const,
    queryFn: () => clutch.groups.previewInvite(token),
    staleTime: 0,
    retry: (count, err) => count < 2 && isTransient(err),
  });

/**
 * Fellow club members the caller may invite (P4 bookingParity: Clutch's
 * member-facing player search, never the admin roster). Only MemberPicker
 * runs it, and only while the capability is on. An empty query asks for the
 * default page the endpoint offers.
 */
export const playerSearchQuery = (q: string) =>
  queryOptions({
    queryKey: ['groups', 'player-search', q] as const,
    queryFn: () => clutch.club.searchPlayers(q, 25),
    staleTime: 30_000,
  });

/** Invalidate everything a group change can move. */
export function invalidateGroups(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
  void queryClient.invalidateQueries({ queryKey: queryKeys.home });
}

export interface RespondInput {
  invitation: GroupInvitation;
  accept: boolean;
}

/**
 * Accept or decline a group invitation. Shared by the Groups tab and the home
 * screen so both lists converge on the same invalidation.
 */
export function useRespondToGroupInvitation() {
  const queryClient = useQueryClient();
  const key = useMutationKey();
  return useMutation({
    mutationFn: ({ invitation, accept }: RespondInput) =>
      key.run({ id: invitation.id, accept }, (k) =>
        clutch.groups.respondInvitation(invitation.id, accept, { idempotencyKey: k }),
      ),
    onSettled: () => invalidateGroups(queryClient),
  });
}

/**
 * The link a shared invite opens. Clutch has no web page for group invite
 * links yet, so this is the app's own deep link (seventy://groups/join?token=,
 * or the Expo dev URL in development): it only works on a phone with the app
 * installed.
 */
export function groupJoinUrl(token: string): string {
  return Linking.createURL('/groups/join', { queryParams: { token } });
}

export interface GroupInviteLinkController {
  /** The current share URL, or null until minted. */
  url: string | null;
  /** A mint or rotate is in flight. */
  isPending: boolean;
  /** The cached URL, minting one on first use (single-flighted). */
  ensureUrl: () => Promise<string>;
  /** Owner only: revoke every earlier link and mint a new one. */
  rotate: () => Promise<string>;
}

/**
 * The group's share URL, held in the query cache so the detail Share action
 * and the invite sheet show the same link and a rotate swaps it everywhere.
 * Clutch returns the raw token only when minting, so the URL is cached the
 * moment it is minted; the query itself never fetches.
 */
export function useGroupInviteLink(groupId: GroupId): GroupInviteLinkController {
  const queryClient = useQueryClient();
  const cacheKey = useMemo(() => ['groups', 'invite-link', groupId] as const, [groupId]);
  const mintKey = useMutationKey();
  const rotateKey = useMutationKey();
  const [isPending, setIsPending] = useState(false);
  const inFlight = useRef<Promise<string> | null>(null);

  const cached = useQuery({
    queryKey: cacheKey,
    queryFn: () => queryClient.getQueryData<string>(cacheKey) ?? null,
    enabled: false,
    staleTime: Infinity,
  });
  const url = cached.data ?? null;

  const ensureUrl = useCallback(async () => {
    const existing = queryClient.getQueryData<string>(cacheKey);
    if (existing) return existing;
    if (inFlight.current) return inFlight.current;
    setIsPending(true);
    const request = (async () => {
      const link = await mintKey.run({ groupId }, (k) =>
        clutch.groups.inviteLink(groupId, {}, { idempotencyKey: k }),
      );
      // A rotate that landed while this mint ran revoked it; keep the rotated one.
      const rotated = queryClient.getQueryData<string>(cacheKey);
      if (rotated) return rotated;
      const built = groupJoinUrl(link.token);
      queryClient.setQueryData(cacheKey, built);
      return built;
    })();
    inFlight.current = request;
    try {
      return await request;
    } finally {
      inFlight.current = null;
      setIsPending(false);
    }
  }, [cacheKey, groupId, mintKey, queryClient]);

  const rotate = useCallback(async () => {
    setIsPending(true);
    try {
      const link = await rotateKey.run({ groupId, rotate: true }, (k) =>
        clutch.groups.inviteLink(groupId, { rotate: true }, { idempotencyKey: k }),
      );
      const built = groupJoinUrl(link.token);
      queryClient.setQueryData(cacheKey, built);
      return built;
    } finally {
      setIsPending(false);
    }
  }, [cacheKey, groupId, queryClient, rotateKey]);

  return { url, isPending, ensureUrl, rotate };
}
