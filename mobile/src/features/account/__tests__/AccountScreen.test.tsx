import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makeClub, makeMe, makeProfile, makeSubscription } from '../../../lib/clutch/fixtures';
import { AccountScreen } from '../AccountScreen';
import { renderWithProviders } from './render-account';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('expo-image-picker', () => ({}));

const mockSignOut = jest.fn(async () => undefined);
jest.mock('../../../lib/session', () => ({
  useSession: () => ({ status: 'authenticated', userId: 'user-1', signOut: mockSignOut }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.me.get.mockResolvedValue(makeMe({ profile: makeProfile({ username: 'alexm' }) }));
  mockClutch.club.verify.mockResolvedValue(makeClub());
  mockClutch.membership.get.mockResolvedValue({ membership: { role: 'player' }, subscription: makeSubscription() });
  mockClutch.me.unregisterDevice.mockResolvedValue(null);
});

describe('AccountScreen', () => {
  it('shows the profile and the membership from Clutch, with no lifetime stats', async () => {
    renderWithProviders(<AccountScreen />);

    expect(await screen.findByText('Alex Morgan')).toBeTruthy();
    expect(screen.getByText('@alexm')).toBeTruthy();
    expect(screen.getByText('alex@example.com')).toBeTruthy();
    expect(await screen.findByText('Renews Nov 15, 2026')).toBeTruthy();
    expect(screen.queryByText('Courts booked')).toBeNull();
  });

  it('removes the push registration before signing out', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true, canAskAgain: true });
    renderWithProviders(<AccountScreen />);

    fireEvent.press(await screen.findByLabelText('Sign out'));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockClutch.me.unregisterDevice).toHaveBeenCalled();
    expect(mockClutch.me.unregisterDevice.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignOut.mock.invocationCallOrder[0],
    );
  });

  it('saves only the changed field and explains a taken username', async () => {
    mockClutch.me.updateProfile.mockRejectedValue(clutchError('username_taken'));
    renderWithProviders(<AccountScreen />);

    fireEvent.press(await screen.findByLabelText('Edit profile'));
    fireEvent.changeText(screen.getByLabelText('Username'), 'Taken_Name');
    fireEvent.press(screen.getByLabelText('Save'));

    expect(await screen.findByText('That username is taken. Try another.')).toBeTruthy();
    expect(mockClutch.me.updateProfile).toHaveBeenCalledWith(
      { username: 'taken_name' },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });
});
