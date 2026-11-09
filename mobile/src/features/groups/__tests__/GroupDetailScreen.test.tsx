import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makeGroup, makeGroupActivityItem, OTHER_ID } from '../../../lib/clutch/fixtures';
import { asClubId, type Group } from '../../../lib/clutch';
import { GroupDetailScreen } from '../GroupDetailScreen';
import { renderWithProviders } from './render';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;

jest.mock('../../../lib/session', () => ({
  useSession: () => ({ userId: jest.requireActual('../../../lib/clutch/fixtures').ME_ID }),
}));
jest.mock('expo-linking', () => ({
  createURL: (path: string, opts?: { queryParams?: Record<string, string> }) =>
    `seventy://${path.replace(/^\//, '')}?token=${opts?.queryParams?.token ?? ''}`,
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
}));

const OWNER_PERMS: Group['permissions'] = {
  can_edit: true,
  can_delete: true,
  can_manage_members: true,
  can_invite: true,
  can_leave: false,
};
const MEMBER_PERMS: Group['permissions'] = {
  can_edit: false,
  can_delete: false,
  can_manage_members: false,
  can_invite: true,
  can_leave: true,
};

function group(permissions: Group['permissions'], over: Parameters<typeof makeGroup>[0] = {}): Group {
  return makeGroup({
    name: 'Baddies',
    member_count: 6,
    my_role: permissions.can_edit ? 'owner' : 'member',
    permissions,
    ...over,
  });
}

function renderDetail(detail: Group) {
  mockClutch.groups.get.mockResolvedValue(detail);
  return renderWithProviders(<GroupDetailScreen groupId={detail.id} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.groups.activity.mockResolvedValue([]);
});

describe('GroupDetailScreen permissions', () => {
  it('owner: menu has Edit and Delete and the cannot-leave hint, no Leave', async () => {
    renderDetail(group(OWNER_PERMS));
    fireEvent.press(await screen.findByLabelText('Group actions'));
    expect(screen.getByRole('button', { name: 'Edit group' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete group' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Leave group' })).toBeNull();
    expect(screen.getByText(/As the owner you cannot leave this group/)).toBeTruthy();
  });

  it('member: menu has Leave only', async () => {
    renderDetail(group(MEMBER_PERMS));
    fireEvent.press(await screen.findByLabelText('Group actions'));
    expect(screen.getByRole('button', { name: 'Leave group' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit group' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete group' })).toBeNull();
  });

  it('shows Invite only with can_invite', async () => {
    renderDetail(group({ ...MEMBER_PERMS, can_invite: false }));
    expect(await screen.findByLabelText('Members')).toBeTruthy();
    expect(screen.queryByLabelText('Invite')).toBeNull();
  });
});

describe('GroupDetailScreen not found', () => {
  it('not_authorized reads as not found', async () => {
    mockClutch.groups.get.mockRejectedValue(clutchError('not_authorized', 403));
    renderWithProviders(<GroupDetailScreen groupId={group(MEMBER_PERMS).id} />);
    expect(await screen.findByText('Group not found')).toBeTruthy();
  });

  it('a group at another club reads as not found', async () => {
    renderDetail(group(MEMBER_PERMS, { club_id: asClubId('another-club') }));
    expect(await screen.findByText('Group not found')).toBeTruthy();
  });
});

describe('GroupDetailScreen leave / delete', () => {
  it('leave: confirm then POST leave with an idempotency key', async () => {
    mockClutch.groups.leave.mockResolvedValue(null);
    const detail = group(MEMBER_PERMS);
    renderDetail(detail);
    fireEvent.press(await screen.findByLabelText('Group actions'));
    fireEvent.press(screen.getByRole('button', { name: 'Leave group' }));
    expect(
      screen.getByText('Leave Baddies? You will need a new invitation or invite link to rejoin.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Leave group' }));
    await waitFor(() =>
      expect(mockClutch.groups.leave).toHaveBeenCalledWith(detail.id, {
        idempotencyKey: expect.any(String),
      }),
    );
    await waitFor(() => expect(screen.getByText('You left Baddies.')).toBeTruthy());
  });

  it('leave refused with must_transfer_first explains the transfer', async () => {
    mockClutch.groups.leave.mockRejectedValue(clutchError('must_transfer_first'));
    renderDetail(group(MEMBER_PERMS));
    fireEvent.press(await screen.findByLabelText('Group actions'));
    fireEvent.press(screen.getByRole('button', { name: 'Leave group' }));
    fireEvent.press(screen.getByRole('button', { name: 'Leave group' }));
    expect(
      await screen.findByText('Transfer ownership to another member before leaving.'),
    ).toBeTruthy();
  });

  it('delete refused for a non-owner says only the owner can delete', async () => {
    mockClutch.groups.delete.mockRejectedValue(clutchError('not_authorized', 403));
    renderDetail(group(OWNER_PERMS));
    fireEvent.press(await screen.findByLabelText('Group actions'));
    fireEvent.press(screen.getByRole('button', { name: 'Delete group' }));
    fireEvent.press(screen.getByRole('button', { name: 'Delete group' }));
    expect(await screen.findByText('Only the group owner can delete this group.')).toBeTruthy();
  });

  it('delete: confirm then DELETE', async () => {
    mockClutch.groups.delete.mockResolvedValue(null);
    const detail = group(OWNER_PERMS);
    renderDetail(detail);
    fireEvent.press(await screen.findByLabelText('Group actions'));
    fireEvent.press(screen.getByRole('button', { name: 'Delete group' }));
    expect(screen.getByText(/Delete Baddies for 6 members\?/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Delete group' }));
    await waitFor(() =>
      expect(mockClutch.groups.delete).toHaveBeenCalledWith(detail.id, {
        idempotencyKey: expect.any(String),
      }),
    );
  });
});

describe('GroupDetailScreen activity', () => {
  const row = makeGroupActivityItem({
    end_time: '19:30:00',
    court_name: 'Court 3',
    court_type: 'tennis',
    organizer_id: OTHER_ID,
    participant_count: 4,
  });

  it('a participant row opens the booking; Past switches the filter', async () => {
    mockClutch.groups.activity.mockResolvedValue([row]);
    const detail = group(MEMBER_PERMS);
    renderDetail(detail);
    const button = await screen.findByLabelText('TUE 10/20, 6-7:30 PM, Court 3 · 4 players, Confirmed');
    fireEvent.press(button);
    expect(mockPush).toHaveBeenCalledWith(`/bookings/${row.booking_id}`);
    expect(mockClutch.groups.activity).toHaveBeenCalledWith(detail.id, 'upcoming');

    fireEvent.press(screen.getByRole('tab', { name: 'Past' }));
    await waitFor(() => expect(mockClutch.groups.activity).toHaveBeenCalledWith(detail.id, 'past'));
  });

  it('a row the viewer is not in does not open the booking', async () => {
    mockClutch.groups.activity.mockResolvedValue([makeGroupActivityItem({ ...row, i_am_participant: false })]);
    renderDetail(group(MEMBER_PERMS));
    await screen.findByText('Court 3 · 4 players');
    expect(screen.queryByRole('button', { name: /TUE 10\/20/ })).toBeNull();
  });

  it('renders a row whose organizer account is gone (organizer_id null)', async () => {
    mockClutch.groups.activity.mockResolvedValue([makeGroupActivityItem({ organizer_id: null, court_name: null })]);
    renderDetail(group(MEMBER_PERMS));
    expect(await screen.findByText('Court · 3 players')).toBeTruthy();
  });
});
