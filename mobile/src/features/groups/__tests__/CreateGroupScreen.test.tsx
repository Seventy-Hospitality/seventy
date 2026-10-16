import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makeGroupSummary, OTHER_ID } from '../../../lib/clutch/fixtures';
import { CreateGroupScreen } from '../CreateGroupScreen';
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
jest.mock('expo-image-picker', () => ({}));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
}));

const created = makeGroupSummary();

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.club.searchPlayers.mockResolvedValue([
    { user_id: OTHER_ID, full_name: 'Sam Lee', username: 'sam', avatar_url: null },
  ]);
});

function goToInviteStep(name = 'Baddies') {
  fireEvent.changeText(screen.getByPlaceholderText('Enter name'), name);
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
}

describe('CreateGroupScreen', () => {
  it('gates Continue on a name', () => {
    renderWithProviders(<CreateGroupScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByText('Invite players')).toBeNull();
    goToInviteStep();
    expect(screen.getByText('Invite players')).toBeTruthy();
  });

  it('creates with the picked invitees and opens the group', async () => {
    mockClutch.groups.create.mockResolvedValue({ group_id: created.id });
    renderWithProviders(<CreateGroupScreen />);
    goToInviteStep();
    fireEvent.press(await screen.findByRole('checkbox', { name: 'Invite Sam Lee' }));
    fireEvent.press(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() =>
      expect(mockClutch.groups.create).toHaveBeenCalledWith(
        { name: 'Baddies', description: null, invitee_user_ids: [OTHER_ID] },
        { idempotencyKey: expect.any(String) },
      ),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/groups/${created.id}`));
    expect(mockClutch.groups.uploadCover).not.toHaveBeenCalled();
  });

  it('shows the refusal for an invalid name', async () => {
    mockClutch.groups.create.mockRejectedValue(clutchError('name_too_long', 400));
    renderWithProviders(<CreateGroupScreen />);
    goToInviteStep();
    fireEvent.press(screen.getByRole('button', { name: 'Create group' }));
    expect(await screen.findByText('Group names can be at most 80 characters.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
