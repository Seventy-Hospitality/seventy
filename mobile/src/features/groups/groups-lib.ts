/**
 * Pure presentation, validation and error-copy helpers for groups (member
 * social groups at this club; in Clutch "club" means the venue). Kept free of
 * React and of the client so they are unit-tested in isolation.
 */
import type {
  GroupActivityItem,
  GroupMember,
  GroupRole,
  PlayerSearchResult,
} from '../../lib/clutch/contract.gen';
import { ClutchError, hasCode } from '../../lib/clutch/errors';
import type { UserId } from '../../lib/clutch/ids';

/** Clutch's limits (apps/web/app/actions/groups.ts NAME_MAX / DESCRIPTION_MAX / COVER_MAX_BYTES). */
export const GROUP_NAME_MAX = 80;
export const GROUP_DESCRIPTION_MAX = 500;
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export function roleLabel(role: GroupRole | null): string {
  return role === 'owner' ? 'Owner' : 'Member';
}

export function memberCountLabel(count: number): string {
  return count === 1 ? '1 Member' : `${count} Members`;
}

export function playersCountLabel(count: number): string {
  return count === 1 ? '1 player' : `${count} players`;
}

/** The name to show for a roster row or a search result. */
export function personName(person: Pick<GroupMember | PlayerSearchResult, 'full_name' | 'username'>): string {
  const full = person.full_name?.trim();
  if (full) return full;
  const username = person.username?.trim();
  if (username) return `@${username}`;
  return 'Member';
}

/** "@alex" under a full name, or null when there is nothing extra to say. */
export function personHandle(person: Pick<GroupMember | PlayerSearchResult, 'full_name' | 'username'>): string | null {
  const username = person.username?.trim();
  if (!username || !person.full_name?.trim()) return null;
  return `@${username}`;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * "MON 6/27" from a booking's local date ("YYYY-MM-DD"). Parsed in UTC so the
 * weekday never drifts with the device timezone: the date is already the
 * club's local day.
 */
export function activityDayLabel(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  if (!year || !month || !day) return '';
  const at = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAYS[at.getUTCDay()]} ${month}/${day}`;
}

function clock(time: string): { h: number; m: number } | null {
  const [h, m] = time.split(':').map((part) => Number(part));
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m };
}

function hourLabel({ h, m }: { h: number; m: number }): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, '0')}`;
}

/**
 * "6-7:30 PM" / "11 AM-1 PM" from Clutch's club-local "HH:MM:SS" times. An
 * end of 00:00 is midnight (the booking runs to the end of the day).
 */
export function timeRangeLabel(start: string, end: string): string {
  const s = clock(start);
  const e = clock(end);
  if (!s || !e) return '';
  const sPm = s.h >= 12;
  const ePm = e.h >= 12 && e.h < 24;
  const suffix = (pm: boolean) => (pm ? 'PM' : 'AM');
  if (sPm === ePm) return `${hourLabel(s)}-${hourLabel(e)} ${suffix(ePm)}`;
  return `${hourLabel(s)} ${suffix(sPm)}-${hourLabel(e)} ${suffix(ePm)}`;
}

/** The status badge of an activity row, or null for an unremarkable one. */
export function activityBadge(
  item: Pick<GroupActivityItem, 'status'>,
): { label: string; variant: 'success' | 'danger' | 'warning' } | null {
  switch (item.status) {
    case 'confirmed':
      return { label: 'Confirmed', variant: 'success' };
    case 'pending':
      return { label: 'Pending', variant: 'warning' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'danger' };
    default:
      return null;
  }
}

/**
 * Only a participant's row opens the booking: GET /bookings/{id} is scoped to
 * the booking's people, so anyone else would land on a not-found screen.
 */
export function isLinkableActivity(item: Pick<GroupActivityItem, 'i_am_participant'>): boolean {
  return item.i_am_participant;
}

/** The create / edit gate: a non-empty name within Clutch's limit. */
export function isValidGroupName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= GROUP_NAME_MAX;
}

/**
 * Check a picked cover against what Clutch accepts before uploading, so the
 * member sees an inline message instead of unsupported_image_type /
 * file_too_large. Returns the message, or null when the image is acceptable.
 */
export function coverImageError(image: { type: string; size?: number | null }): string | null {
  if (!(COVER_ACCEPTED_TYPES as readonly string[]).includes(image.type)) {
    return 'Cover photos must be JPG, PNG, WebP, or GIF files.';
  }
  if (image.size != null && image.size > COVER_MAX_BYTES) {
    return 'Cover photos must be 5 MB or smaller.';
  }
  return null;
}

// ─── Invitee selection (create wizard + invite sheet) ────────────────────────

export type InviteeSelection = readonly PlayerSearchResult[];

export const EMPTY_SELECTION: InviteeSelection = [];

export function isSelected(selection: InviteeSelection, userId: UserId): boolean {
  return selection.some((p) => p.user_id === userId);
}

export function toggleInvitee(selection: InviteeSelection, player: PlayerSearchResult): InviteeSelection {
  return isSelected(selection, player.user_id)
    ? selection.filter((p) => p.user_id !== player.user_id)
    : [...selection, player];
}

export function removeInvitee(selection: InviteeSelection, userId: UserId): InviteeSelection {
  return selection.filter((p) => p.user_id !== userId);
}

export function inviteeIds(selection: InviteeSelection): UserId[] {
  return selection.map((p) => p.user_id);
}

// ─── Error copy (branches on ClutchError.code only) ──────────────────────────

/** The group is gone or the caller is not in it (Clutch does not tell them apart). */
export function isGroupGone(err: unknown): boolean {
  if (!(err instanceof ClutchError)) return false;
  switch (err.code) {
    case 'group_not_found':
    case 'not_found':
    case 'not_authorized':
      return true;
    default:
      return false;
  }
}

/** Create / edit: the field-level refusals Clutch answers with. */
export function groupFormErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ClutchError)) return fallback;
  switch (err.code) {
    case 'name_required':
      return 'Enter a group name.';
    case 'name_too_long':
      return `Group names can be at most ${GROUP_NAME_MAX} characters.`;
    case 'field_too_long':
    case 'invalid_field':
      return `Descriptions can be at most ${GROUP_DESCRIPTION_MAX} characters.`;
    case 'not_club_member':
      return 'Only club members can create groups.';
    default:
      return fallback;
  }
}

/** A cover upload refusal. */
export function coverUploadErrorMessage(err: unknown): string {
  if (err instanceof ClutchError) {
    switch (err.code) {
      case 'unsupported_image_type':
        return 'Cover photos must be JPG, PNG, WebP, or GIF files.';
      case 'file_too_large':
        return 'Cover photos must be 5 MB or smaller.';
      case 'not_authorized':
        return 'Only the group owner can change the cover photo.';
      default:
        break;
    }
  }
  return 'The cover photo could not be uploaded.';
}

export function leaveErrorMessage(err: unknown, groupName: string): string {
  if (hasCode(err, 'must_transfer_first')) {
    return 'Transfer ownership to another member before leaving.';
  }
  return `We could not remove you from ${groupName}. Try again.`;
}

/** Owner actions on a roster row (transfer ownership, remove). */
export function memberActionErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ClutchError)) return fallback;
  switch (err.code) {
    case 'cannot_remove_self':
      return 'You cannot remove yourself. Leave the group instead.';
    case 'target_not_member':
    case 'member_not_found':
      return 'That person is no longer in the group.';
    case 'not_club_member':
      return 'That person is no longer a member of the club.';
    case 'not_authorized':
      return 'Only the group owner can do that.';
    default:
      return fallback;
  }
}

export function inviteErrorMessage(err: unknown): string {
  if (err instanceof ClutchError) {
    switch (err.code) {
      case 'group_exceeds_capacity':
        return 'The group is full.';
      case 'not_authorized':
        return 'You cannot invite people to this group.';
      default:
        break;
    }
  }
  return 'We could not send those invites. Try again.';
}

export function respondErrorMessage(err: unknown): string {
  if (err instanceof ClutchError) {
    switch (err.code) {
      case 'invitation_not_pending':
      case 'invitation_not_found':
        return 'This group invitation is no longer open.';
      case 'group_exceeds_capacity':
        return 'That group is full.';
      default:
        break;
    }
  }
  return 'We could not save your response. Try again.';
}

/** A dead invite link (expired, revoked, used up, unknown). */
export function isDeadInviteLink(err: unknown): boolean {
  return hasCode(err, 'invite_link_invalid');
}

/**
 * The invite token from whatever the member pasted: a shared link (any scheme,
 * carrying `token=`) or the bare token. Null when nothing usable is there.
 */
export function parseInviteToken(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const match = /[?&]token=([^&#\s]+)/.exec(text);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }
  // Clutch tokens are short opaque strings with no spaces or URL syntax.
  if (/^[A-Za-z0-9_-]{8,64}$/.test(text)) return text;
  return null;
}
