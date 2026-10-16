import { clutchError, networkError } from '../../../lib/clutch/testing';
import { makeClubPlayer, makeGroupMember, ME_ID, OTHER_ID } from '../../../lib/clutch/fixtures';
import { asUserId, ClutchError } from '../../../lib/clutch';
import {
  activityBadge,
  activityDayLabel,
  coverImageError,
  coverUploadErrorMessage,
  createGroupErrorMessage,
  createGroupInput,
  deleteGroupErrorMessage,
  EMPTY_SELECTION,
  inviteErrorMessage,
  inviteLinkErrorMessage,
  inviteeIds,
  isDeadInviteLink,
  isGroupGone,
  isValidGroupName,
  joinErrorMessage,
  leaveErrorMessage,
  memberCountLabel,
  parseInviteToken,
  personHandle,
  personName,
  removeInvitee,
  removeMemberErrorMessage,
  respondErrorMessage,
  timeRangeLabel,
  toggleInvitee,
  transferErrorMessage,
  updateGroupErrorMessage,
} from '../groups-lib';

describe('labels', () => {
  it('counts members', () => {
    expect(memberCountLabel(1)).toBe('1 Member');
    expect(memberCountLabel(6)).toBe('6 Members');
  });

  it('names a person by full name, then @username, then a fallback', () => {
    expect(personName(makeGroupMember({ full_name: ' Alex Morgan ', username: 'alex' }))).toBe('Alex Morgan');
    expect(personName(makeGroupMember({ full_name: null, username: 'alex' }))).toBe('@alex');
    expect(personName(makeGroupMember({ full_name: null, username: null }))).toBe('Member');
    expect(personName(makeClubPlayer({ full_name: '', username: null }))).toBe('Member');
    expect(personHandle(makeClubPlayer({ full_name: 'Sam', username: 'sam' }))).toBe('@sam');
    expect(personHandle(makeGroupMember({ full_name: null, username: 'alex' }))).toBeNull();
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
  const a = makeClubPlayer({ user_id: ME_ID, full_name: 'A' });
  const b = makeClubPlayer({ user_id: OTHER_ID, full_name: 'B' });

  it('toggles, removes and lists user ids', () => {
    let sel = toggleInvitee(EMPTY_SELECTION, a);
    sel = toggleInvitee(sel, b);
    expect(inviteeIds(sel)).toEqual([ME_ID, OTHER_ID]);
    expect(inviteeIds(toggleInvitee(sel, a))).toEqual([OTHER_ID]);
    expect(inviteeIds(removeInvitee(sel, asUserId(OTHER_ID)))).toEqual([ME_ID]);
  });
});

describe('createGroupInput', () => {
  it('trims, nulls an empty description and omits an empty invitee list', () => {
    const input = createGroupInput('  Baddies ', '   ', []);
    expect(input).toEqual({ name: 'Baddies', description: null });
    expect(input).not.toHaveProperty('invitee_user_ids');
  });

  it('sends the invitees when there are some', () => {
    expect(createGroupInput('Baddies', ' Tuesdays ', [asUserId(OTHER_ID)])).toEqual({
      name: 'Baddies',
      description: 'Tuesdays',
      invitee_user_ids: [OTHER_ID],
    });
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

  it('create: each code says what happened; validation codes are not blamed on something else', () => {
    expect(createGroupErrorMessage(clutchError('name_required', 400))).toBe('Enter a group name.');
    expect(createGroupErrorMessage(clutchError('name_too_long', 400))).toMatch(/80 characters/);
    const invalid = createGroupErrorMessage(clutchError('invalid_field', 400));
    expect(invalid).toMatch(/did not accept these group details/);
    expect(invalid).not.toMatch(/500 characters/);
    expect(createGroupErrorMessage(clutchError('missing_field', 400))).toMatch(/did not reach the club complete/);
    expect(createGroupErrorMessage(clutchError('not_club_member', 403))).toMatch(/active members/);
    expect(createGroupErrorMessage(clutchError('auth_required', 401))).toMatch(/Sign in again/);
  });

  it('update: missing_field is "nothing to save", not_authorized is owner-only', () => {
    expect(updateGroupErrorMessage(clutchError('missing_field', 400))).toBe('There were no changes to save.');
    expect(updateGroupErrorMessage(clutchError('invalid_field', 400))).toMatch(/did not accept these changes/);
    expect(updateGroupErrorMessage(clutchError('not_authorized', 403))).toMatch(/Only the group owner/);
    expect(updateGroupErrorMessage(clutchError('name_required', 400))).toBe('Enter a group name.');
  });

  it('maps cover refusals', () => {
    expect(coverUploadErrorMessage(clutchError('unsupported_image_type', 400))).toMatch(/JPG/);
    expect(coverUploadErrorMessage(clutchError('file_too_large', 413))).toMatch(/5 MB/);
    expect(coverUploadErrorMessage(clutchError('invalid_content_type', 415))).toMatch(/not sent as an image upload/);
    expect(coverUploadErrorMessage(clutchError('missing_field', 400))).toMatch(/did not reach the club/);
    expect(coverUploadErrorMessage(clutchError('not_authorized', 403))).toMatch(/Only the group owner/);
  });

  it('maps leave and delete', () => {
    expect(leaveErrorMessage(clutchError('must_transfer_first'), 'G')).toMatch(/Transfer ownership/);
    expect(leaveErrorMessage(clutchError('not_authorized', 403), 'G')).toBe('You are no longer a member of G.');
    expect(deleteGroupErrorMessage(clutchError('not_authorized', 403))).toMatch(/Only the group owner/);
  });

  it('maps transfer and remove separately', () => {
    expect(transferErrorMessage(clutchError('target_not_member'))).toMatch(/no longer in the group/);
    expect(transferErrorMessage(clutchError('invalid_field', 400))).toMatch(/did not accept that ownership change/);
    expect(removeMemberErrorMessage(clutchError('member_not_found', 404))).toMatch(/no longer in the group/);
    expect(removeMemberErrorMessage(clutchError('cannot_remove_self'))).toMatch(/Leave the group/);
  });

  it('maps invites, invite links, responses and joins', () => {
    expect(inviteErrorMessage(clutchError('missing_field', 400))).toMatch(/at least one person/);
    expect(inviteErrorMessage(clutchError('invalid_field', 400))).toMatch(/at most 100 people/);
    expect(inviteErrorMessage(clutchError('not_authorized', 403))).toMatch(/Only members of this group/);
    expect(inviteLinkErrorMessage(clutchError('not_authorized', 403), true)).toMatch(/Only the group owner can reset/);
    expect(inviteLinkErrorMessage(clutchError('not_authorized', 403), false)).toMatch(/Only members/);
    expect(respondErrorMessage(clutchError('invitation_not_pending'))).toMatch(/already answered or withdrawn/);
    expect(respondErrorMessage(clutchError('invitation_not_found', 404))).toMatch(/no longer exists/);
    expect(respondErrorMessage(clutchError('not_club_member', 403))).toMatch(/active members/);
    expect(joinErrorMessage(clutchError('invite_link_invalid', 410))).toMatch(/no longer works/);
    expect(joinErrorMessage(clutchError('not_club_member', 403))).toMatch(/active members/);
    expect(isDeadInviteLink(clutchError('invite_link_invalid', 410))).toBe(true);
    expect(isDeadInviteLink(networkError())).toBe(false);
  });

  it('an unknown code or a server failure gets the neutral message; offline says so', () => {
    const unknown = new ClutchError({ code: 'brand_new_code', message: 'x', status: 409, kind: 'api' });
    expect(unknown.code).toBe('unknown');
    expect(createGroupErrorMessage(unknown)).toBe('We could not create the group. Try again.');
    expect(updateGroupErrorMessage(clutchError('internal_error', 500))).toBe('We could not save your changes. Try again.');
    expect(coverUploadErrorMessage(new Error('boom'))).toBe('The cover photo could not be uploaded.');
    expect(leaveErrorMessage(networkError(), 'G')).toMatch(/Check your connection/);
    expect(joinErrorMessage(networkError())).toMatch(/Check your connection/);
  });

  it('field_too_long says text is too long without naming a field Clutch did not name', () => {
    expect(createGroupErrorMessage(clutchError('field_too_long', 400))).toMatch(/text is too long/);
    expect(updateGroupErrorMessage(clutchError('field_too_long', 400))).toMatch(/text is too long/);
  });
});
