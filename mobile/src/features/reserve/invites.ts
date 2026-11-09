/**
 * Who a member invites to a confirmed booking: fellow club members picked
 * one by one (POST /bookings/{id}/players) and whole groups (POST
 * /bookings/{id}/invite-group, a snapshot of the group's roster). Pure
 * selection logic; sending lives in useSendInvites.
 */
import type { GroupId, GroupSummary, ClubPlayer, UserId } from '../../lib/clutch';

export interface InviteSelection {
  /** Picked members, in pick order (chips render this order). */
  players: ClubPlayer[];
  /** Picked groups, in pick order. */
  groups: GroupSummary[];
}

export const EMPTY_INVITE_SELECTION: InviteSelection = { players: [], groups: [] };

/** A player's name for chips and rows; "Player" when Clutch sends none. */
export function playerName(player: { full_name?: string | null; username?: string | null }): string {
  return player.full_name?.trim() || player.username?.trim() || 'Player';
}

export function isPlayerSelected(selection: InviteSelection, userId: UserId): boolean {
  return selection.players.some((player) => player.user_id === userId);
}

export function isGroupSelected(selection: InviteSelection, groupId: GroupId): boolean {
  return selection.groups.some((group) => group.id === groupId);
}

export function togglePlayer(selection: InviteSelection, player: ClubPlayer): InviteSelection {
  if (isPlayerSelected(selection, player.user_id)) return removePlayer(selection, player.user_id);
  return { ...selection, players: [...selection.players, player] };
}

export function removePlayer(selection: InviteSelection, userId: UserId): InviteSelection {
  return { ...selection, players: selection.players.filter((player) => player.user_id !== userId) };
}

export function addGroup(selection: InviteSelection, group: GroupSummary): InviteSelection {
  if (isGroupSelected(selection, group.id)) return selection;
  return { ...selection, groups: [...selection.groups, group] };
}

export function removeGroup(selection: InviteSelection, groupId: GroupId): InviteSelection {
  return { ...selection, groups: selection.groups.filter((group) => group.id !== groupId) };
}

export function inviteCount(selection: InviteSelection): number {
  return selection.players.length + selection.groups.length;
}

/** Chip label: "GROUP: Tuesday Doubles (6)". */
export function groupChipLabel(group: GroupSummary): string {
  return `GROUP: ${group.name} (${group.member_count})`;
}

/** Search results minus people who are already on the booking (and the caller). */
export function invitablePlayers(results: readonly ClubPlayer[], exclude: ReadonlySet<string>): ClubPlayer[] {
  return results.filter((player) => !exclude.has(player.user_id));
}
