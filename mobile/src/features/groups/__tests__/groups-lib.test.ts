import { asUserId } from '../../../lib/clutch/ids';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import {
  activityBadge,
  activityDayLabel,
  coverImageError,
  coverUploadErrorMessage,
  EMPTY_SELECTION,
  groupFormErrorMessage,
  inviteeIds,
  isDeadInviteLink,
  isGroupGone,
  isValidGroupName,
  leaveErrorMessage,
  memberActionErrorMessage,
  memberCountLabel,
  parseInviteToken,
  personHandle,
  personName,
  removeInvitee,
  respondErrorMessage,
  timeRangeLabel,
  toggleInvitee,
} from '../groups-lib';

describe('labels', () => {
  it('counts members', () => {
    expect(memberCountLabel(1)).toBe('1 Member');
    expect(memberCountLabel(6)).toBe('6 Members');
  });

  it('names a person by full name, then @username, then a fallback', () => {
    expect(personName({ full_name: ' Alex Morgan ', username: 'alex' })).toBe('Alex Morgan');
    expect(personName({ full_name: null, username: 'alex' })).toBe('@alex');
    expect(personName({ full_name: '', username: null })).toBe('Member');
    expect(personHandle({ full_name: 'Alex', username: 'alex' })).toBe('@alex');
    expect(personHandle({ full_name: null, username: 'alex' })).toBeNull();
  });

  it('labels the club-local day without device timezone drift', () => {
    expect(activityDayLabel('2026-10-20')).toBe('TUE 10/20');
    expect(activityDayLabel('nonsense')).toBe('');
  });

  it('formats club-local time ranges', () => {
    expect(timeRangeLabel('18:00:00', '19:30:00')).toBe('6-7:30 PM');
    expect(timeRangeLabel('11:00:00', '13:00:00')).toBe('11 AM-1 PM');
    expect(timeRangeLabel('07:30:00', '09:00:00')).toBe('7:30-9 AM');
    expect(timeRangeLabel('23:00:00', '00:00:00')).toBe('11 PM-12 AM');
  });

  it('badges activity by booking status', () => {
    expect(activityBadge({ status: 'confirmed' })).toEqual({ label: 'Confirmed', variant: 'success' });
    expect(activityBadge({ status: 'cancelled' })?.variant).toBe('danger');
    expect(activityBadge({ status: 'completed' })).toBeNull();
  });
});

describe('validation', () => {
  it('gates the name on Clutch limits', () => {
    expect(isValidGroupName('  ')).toBe(false);
    expect(isValidGroupName('Baddies')).toBe(true);
    expect(isValidGroupName('x'.repeat(81))).toBe(false);
  });

  it('checks cover type and size before upload', () => {
    expect(coverImageError({ type: 'image/png', size: 1000 })).toBeNull();
    expect(coverImageError({ type: 'image/heic' })).toMatch(/JPG, PNG, WebP, or GIF/);
    expect(coverImageError({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
  });
});

describe('invitee selection', () => {
  const a = { user_id: asUserId('a'), full_name: 'A' };
  const b = { user_id: asUserId('b'), full_name: 'B' };

  it('toggles, removes and lists user ids', () => {
    let sel = toggleInvitee(EMPTY_SELECTION, a);
    sel = toggleInvitee(sel, b);
    expect(inviteeIds(sel)).toEqual(['a', 'b']);
    expect(inviteeIds(toggleInvitee(sel, a))).toEqual(['b']);
    expect(inviteeIds(removeInvitee(sel, asUserId('b')))).toEqual(['a']);
  });
});

describe('parseInviteToken', () => {
  it('reads the token from a deep link or a pasted code', () => {
    expect(parseInviteToken('seventy://groups/join?token=abc_DEF-123456')).toBe('abc_DEF-123456');
    expect(parseInviteToken('exp://192.168.1.2:8081/--/groups/join?token=a%2Db12345678')).toBe('a-b12345678');
    expect(parseInviteToken('  Q1w2E3r4T5y6U7i8  ')).toBe('Q1w2E3r4T5y6U7i8');
    expect(parseInviteToken('hello there')).toBeNull();
    expect(parseInviteToken('')).toBeNull();
  });
});

describe('error copy branches on codes', () => {
  it('treats not found and not authorized as a gone group', () => {
    expect(isGroupGone(clutchError('group_not_found', 404))).toBe(true);
    expect(isGroupGone(clutchError('not_authorized', 403))).toBe(true);
    expect(isGroupGone(networkError())).toBe(false);
    expect(isGroupGone(null)).toBe(false);
  });

  it('maps create / edit refusals', () => {
    expect(groupFormErrorMessage(clutchError('name_required', 400), 'x')).toBe('Enter a group name.');
    expect(groupFormErrorMessage(clutchError('name_too_long', 400), 'x')).toMatch(/80 characters/);
    expect(groupFormErrorMessage(clutchError('field_too_long', 400), 'x')).toMatch(/500 characters/);
    expect(groupFormErrorMessage(networkError(), 'fallback')).toBe('fallback');
  });

  it('maps cover refusals', () => {
    expect(coverUploadErrorMessage(clutchError('unsupported_image_type', 400))).toMatch(/JPG/);
    expect(coverUploadErrorMessage(clutchError('file_too_large', 413))).toMatch(/5 MB/);
    expect(coverUploadErrorMessage(networkError())).toBe('The cover photo could not be uploaded.');
  });

  it('maps leave, member actions and invitation responses', () => {
    expect(leaveErrorMessage(clutchError('must_transfer_first'), 'G')).toMatch(/Transfer ownership/);
    expect(leaveErrorMessage(networkError(), 'G')).toBe('We could not remove you from G. Try again.');
    expect(memberActionErrorMessage(clutchError('cannot_remove_self'), 'x')).toMatch(/Leave the group/);
    expect(respondErrorMessage(clutchError('invitation_not_pending'))).toMatch(/no longer open/);
    expect(isDeadInviteLink(clutchError('invite_link_invalid', 410))).toBe(true);
    expect(isDeadInviteLink(networkError())).toBe(false);
  });
});
