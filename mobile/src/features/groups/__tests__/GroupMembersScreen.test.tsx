import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makeGroup, makeGroupMember, OTHER_ID } from '../../../lib/clutch/fixtures';
import { GroupMembersScreen } from '../GroupMembersScreen';
import { renderWithProviders } from './render';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;

jest.mock('../../../lib/session', () => ({
  useSession: () => ({ userId: jest.requireActual('../../../lib/clutch/fixtures').ME_ID }),
}));
jest.mock('expo-linking', () => ({ createURL: () => 'seventy://groups/join?token=t' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

const me = makeGroupMember();
const sam = makeGroupMember({
  user_id: OTHER_ID,
  role: 'member',
  joined_at: '2026-10-02T00:00:00.000Z',
  full_name: 'Sam Lee',
  username: 'sam',
});

function renderMembers(over: Parameters<typeof makeGroup>[0] = {}) {
  const detail = makeGroup({ name: 'Baddies', members: [me, sam], member_count: 2, ...over });
  mockClutch.groups.get.mockResolvedValue(detail);
  renderWithProviders(<GroupMembersScreen groupId={detail.id} />);
  return detail;
}

beforeEach(() => jest.clearAllMocks());

describe('GroupMembersScreen', () => {
  it('lists the roster with the owner badge and handles', async () => {
    renderMembers();
    expect(await screen.findByText('Sam Lee')).toBeTruthy();
    expect(screen.getByText('@sam')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText(' (you)')).toBeTruthy();
  });

  it('owner transfers ownership (PATCH role owner) to a member', async () => {
    mockClutch.groups.transferOwnership.mockResolvedValue(null);
    const detail = renderMembers();
    fireEvent.press(await screen.findByLabelText('Actions for Sam Lee'));
    fireEvent.press(screen.getByRole('button', { name: 'Transfer ownership' }));
    fireEvent.press(screen.getByRole('button', { name: 'Make Sam Lee the owner' }));
    await waitFor(() =>
      expect(mockClutch.groups.transferOwnership).toHaveBeenCalledWith(detail.id, OTHER_ID, {
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText('Sam Lee is now the group owner.')).toBeTruthy();
  });

  it('a transfer refused with target_not_member says the person left', async () => {
    mockClutch.groups.transferOwnership.mockRejectedValue(clutchError('target_not_member'));
    renderMembers();
    fireEvent.press(await screen.findByLabelText('Actions for Sam Lee'));
    fireEvent.press(screen.getByRole('button', { name: 'Transfer ownership' }));
    fireEvent.press(screen.getByRole('button', { name: 'Make Sam Lee the owner' }));
    expect(await screen.findByText('That person is no longer in the group.')).toBeTruthy();
  });

  it('owner removes a member; a refusal shows the code-specific copy', async () => {
    mockClutch.groups.removeMember.mockRejectedValue(clutchError('member_not_found', 404));
    const detail = renderMembers();
    fireEvent.press(await screen.findByLabelText('Actions for Sam Lee'));
    fireEvent.press(screen.getByRole('button', { name: 'Remove from group' }));
    fireEvent.press(screen.getByRole('button', { name: 'Remove from group' }));
    await waitFor(() =>
      expect(mockClutch.groups.removeMember).toHaveBeenCalledWith(detail.id, OTHER_ID, {
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText('That person is no longer in the group.')).toBeTruthy();
  });

  it('a member sees no per-row actions', async () => {
    renderMembers({
      my_role: 'member',
      permissions: {
        can_edit: false,
        can_delete: false,
        can_manage_members: false,
        can_invite: true,
        can_leave: true,
      },
    });
    await screen.findByText('Sam Lee');
    expect(screen.queryByLabelText('Actions for Sam Lee')).toBeNull();
  });
});
