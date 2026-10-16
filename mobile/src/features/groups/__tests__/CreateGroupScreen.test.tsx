import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makeClubPlayer, makeGroupSummary, OTHER_ID } from '../../../lib/clutch/fixtures';
import { CreateGroupScreen } from '../CreateGroupScreen';
import { renderWithProviders } from './render';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;
const REAL_CAPABILITIES = { ...mockClutch.capabilities };

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
  mockClutch.capabilities = { ...REAL_CAPABILITIES };
  mockClutch.club.searchPlayers.mockResolvedValue([makeClubPlayer()]);
  mockClutch.groups.create.mockResolvedValue({ group_id: created.id });
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

  describe('without member search (P4 off, today)', () => {
    beforeEach(() => {
      mockClutch.capabilities = { ...REAL_CAPABILITIES, bookingParity: false };
    });

    it('says search is coming, never searches, and creates without an invitee list', async () => {
      renderWithProviders(<CreateGroupScreen />);
      goToInviteStep();
      expect(screen.getByTestId('unavailable-bookingParity')).toBeTruthy();
      expect(screen.getByText(/share its invite link from the group page/)).toBeTruthy();
      fireEvent.press(screen.getByRole('button', { name: 'Create group' }));
      await waitFor(() =>
        expect(mockClutch.groups.create).toHaveBeenCalledWith(
          { name: 'Baddies', description: null },
          { idempotencyKey: expect.any(String) },
        ),
      );
      // Clutch refuses an empty list: the key is absent, not [].
      expect(mockClutch.groups.create.mock.calls[0][0]).not.toHaveProperty('invitee_user_ids');
      expect(mockClutch.club.searchPlayers).not.toHaveBeenCalled();
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/groups/${created.id}`));
    });
  });

  describe('with member search (P4 on)', () => {
    beforeEach(() => {
      mockClutch.capabilities = { ...REAL_CAPABILITIES, bookingParity: true };
    });

    it('creates with the picked invitees and opens the group', async () => {
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

    it('omits the invitee list when nobody was picked', async () => {
      renderWithProviders(<CreateGroupScreen />);
      goToInviteStep();
      await screen.findByRole('checkbox', { name: 'Invite Sam Lee' });
      fireEvent.press(screen.getByRole('button', { name: 'Create group' }));
      await waitFor(() => expect(mockClutch.groups.create).toHaveBeenCalled());
      expect(mockClutch.groups.create.mock.calls[0][0]).not.toHaveProperty('invitee_user_ids');
    });
  });

  it('shows the refusal for a name that is too long', async () => {
    mockClutch.groups.create.mockRejectedValue(clutchError('name_too_long', 400));
    renderWithProviders(<CreateGroupScreen />);
    goToInviteStep();
    fireEvent.press(screen.getByRole('button', { name: 'Create group' }));
    expect(await screen.findByText('Group names can be at most 80 characters.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('says what invalid_field means instead of blaming the description length', async () => {
    mockClutch.groups.create.mockRejectedValue(clutchError('invalid_field', 400));
    renderWithProviders(<CreateGroupScreen />);
    goToInviteStep();
    fireEvent.press(screen.getByRole('button', { name: 'Create group' }));
    expect(
      await screen.findByText(
        'The club did not accept these group details. Check the name and description and try again.',
      ),
    ).toBeTruthy();
  });
});
