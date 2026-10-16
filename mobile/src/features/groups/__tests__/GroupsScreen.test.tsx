import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, TEST_CLUB_ID } from '../../../lib/clutch/testing';
import { makeGroupSummary } from '../../../lib/clutch/fixtures';
import { asGroupId, asGroupInvitationId, type GroupInvitation } from '../../../lib/clutch';
import { GroupsScreen } from '../GroupsScreen';
import { renderWithProviders } from './render';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;

jest.mock('expo-linking', () => ({ createURL: () => 'seventy://groups/join?token=t' }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

const invitation: GroupInvitation = {
  id: asGroupInvitationId('inv1'),
  group_id: asGroupId('g2'),
  group_name: 'Night Owls',
  club_id: TEST_CLUB_ID,
  status: 'pending',
  created_at: '2026-10-10T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.groups.list.mockResolvedValue([makeGroupSummary({ name: 'Baddies', member_count: 6 })]);
  mockClutch.groups.invitations.mockResolvedValue([invitation]);
});

describe('GroupsScreen', () => {
  it('lists my groups and pending invitations', async () => {
    renderWithProviders(<GroupsScreen />);
    expect(await screen.findByText('Baddies')).toBeTruthy();
    expect(await screen.findByText('Night Owls')).toBeTruthy();
  });

  it('accepting an invitation responds once and opens the group', async () => {
    mockClutch.groups.respondInvitation.mockResolvedValue({ group_id: invitation.group_id });
    renderWithProviders(<GroupsScreen />);
    fireEvent.press(await screen.findByRole('button', { name: 'Accept the Night Owls invitation' }));
    await waitFor(() =>
      expect(mockClutch.groups.respondInvitation).toHaveBeenCalledWith('inv1', true, {
        idempotencyKey: expect.any(String),
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/groups/g2'));
  });

  it('a response to a closed invitation explains it', async () => {
    mockClutch.groups.respondInvitation.mockRejectedValue(clutchError('invitation_not_pending'));
    renderWithProviders(<GroupsScreen />);
    fireEvent.press(await screen.findByRole('button', { name: 'Decline the Night Owls invitation' }));
    expect(await screen.findByText('This group invitation is no longer open.')).toBeTruthy();
  });

  it('join with a pasted link goes to the join screen with its token', async () => {
    renderWithProviders(<GroupsScreen />);
    fireEvent.press(await screen.findByRole('button', { name: 'Join with an invite link' }));
    fireEvent.changeText(
      screen.getByPlaceholderText('Paste the link'),
      'seventy://groups/join?token=abcdefgh1234',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/groups/join', params: { token: 'abcdefgh1234' } });
  });

  it('shows an error state when the list fails', async () => {
    mockClutch.groups.list.mockRejectedValue(clutchError('internal_error', 500));
    renderWithProviders(<GroupsScreen />);
    expect(await screen.findByText('We could not load your groups.')).toBeTruthy();
  });
});
