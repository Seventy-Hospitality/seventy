import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makeGroupSummary } from '../../../lib/clutch/fixtures';
import { asClubId } from '../../../lib/clutch';
import { JoinGroupScreen } from '../JoinGroupScreen';
import { renderWithProviders } from './render';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;

jest.mock('expo-linking', () => ({ createURL: () => 'seventy://groups/join?token=t' }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
}));

const group = makeGroupSummary({ name: 'Baddies', member_count: 6, my_role: null });

beforeEach(() => jest.clearAllMocks());

describe('JoinGroupScreen', () => {
  it('a missing token gets the invalid-link state without calling Clutch', () => {
    renderWithProviders(<JoinGroupScreen token={null} />);
    expect(screen.getByText('Invite link not valid')).toBeTruthy();
    expect(mockClutch.groups.previewInvite).not.toHaveBeenCalled();
  });

  it('previews then joins and opens the group', async () => {
    mockClutch.groups.previewInvite.mockResolvedValue({ group, already_member: false });
    mockClutch.groups.join.mockResolvedValue({ group_id: group.id });
    renderWithProviders(<JoinGroupScreen token="tok123" />);
    expect(await screen.findByText('Baddies')).toBeTruthy();
    expect(screen.getByText('6 Members')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Join group' }));
    await waitFor(() =>
      expect(mockClutch.groups.join).toHaveBeenCalledWith('tok123', { idempotencyKey: expect.any(String) }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/groups/${group.id}`));
  });

  it('an existing member gets Open instead of Join', async () => {
    mockClutch.groups.previewInvite.mockResolvedValue({ group, already_member: true });
    renderWithProviders(<JoinGroupScreen token="tok123" />);
    fireEvent.press(await screen.findByRole('button', { name: 'Open Baddies' }));
    expect(mockReplace).toHaveBeenCalledWith(`/groups/${group.id}`);
    expect(mockClutch.groups.join).not.toHaveBeenCalled();
  });

  it('a dead link (invite_link_invalid) asks for a fresh one', async () => {
    mockClutch.groups.previewInvite.mockRejectedValue(clutchError('invite_link_invalid', 410));
    renderWithProviders(<JoinGroupScreen token="tok123" />);
    expect(await screen.findByText('Invite link not usable')).toBeTruthy();
  });

  it('refuses a group at another club', async () => {
    mockClutch.groups.previewInvite.mockResolvedValue({
      group: { ...group, club_id: asClubId('elsewhere') },
      already_member: false,
    });
    renderWithProviders(<JoinGroupScreen token="tok123" />);
    expect(await screen.findByText('Invite for another club')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join group' })).toBeNull();
  });
});
