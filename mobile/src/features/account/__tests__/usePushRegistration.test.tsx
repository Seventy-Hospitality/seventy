import { waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { MockClutch } from '../../../lib/clutch/testing';
import type { NotificationPreferences } from '../../../lib/clutch';
import { anyPushOn, PushRegistrationSync, unregisterThisDevice } from '../usePushRegistration';
import { renderWithProviders } from './render-account';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

jest.mock('../../../lib/session', () => ({
  useSession: () => ({ status: 'authenticated', userId: 'u1' }),
}));

const off = { push: false, email: true, sms: false };
const ALL_OFF: NotificationPreferences = {
  bookings: off,
  tournaments: off,
  leagues: off,
  messages: off,
  clubAnnouncements: off,
  promotions: off,
};

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.me.registerDevice.mockResolvedValue({ token: 'ExponentPushToken[test]', platform: 'ios' });
  mockClutch.me.unregisterDevice.mockResolvedValue(null);
});

describe('anyPushOn', () => {
  it('counts every category, shown or not', () => {
    expect(anyPushOn(ALL_OFF)).toBe(false);
    expect(anyPushOn({ ...ALL_OFF, leagues: { ...off, push: true } })).toBe(true);
  });
});

describe('PushRegistrationSync', () => {
  it('registers this install when push is wanted and permission was already granted', async () => {
    getPermissions.mockResolvedValueOnce({ granted: true, canAskAgain: true });
    mockClutch.me.preferences.mockResolvedValue({ ...ALL_OFF, bookings: { ...off, push: true } });

    renderWithProviders(<PushRegistrationSync />);

    await waitFor(() =>
      expect(mockClutch.me.registerDevice).toHaveBeenCalledWith(
        { token: 'ExponentPushToken[test]', platform: 'ios' },
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('never prompts on launch, even when push is wanted', async () => {
    mockClutch.me.preferences.mockResolvedValue({ ...ALL_OFF, bookings: { ...off, push: true } });

    renderWithProviders(<PushRegistrationSync />);

    await waitFor(() => expect(getPermissions).toHaveBeenCalled());
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(mockClutch.me.registerDevice).not.toHaveBeenCalled();
  });

  it('does nothing when every push channel is off', async () => {
    mockClutch.me.preferences.mockResolvedValue(ALL_OFF);

    renderWithProviders(<PushRegistrationSync />);

    await waitFor(() => expect(mockClutch.me.preferences).toHaveBeenCalled());
    expect(getPermissions).not.toHaveBeenCalled();
    expect(mockClutch.me.registerDevice).not.toHaveBeenCalled();
  });
});

describe('unregisterThisDevice', () => {
  it('removes the registration without prompting', async () => {
    getPermissions.mockResolvedValueOnce({ granted: true, canAskAgain: true });
    await unregisterThisDevice('k1');
    expect(mockClutch.me.unregisterDevice).toHaveBeenCalledWith('ExponentPushToken[test]', { idempotencyKey: 'k1' });
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('is a silent no-op without permission', async () => {
    await unregisterThisDevice();
    expect(mockClutch.me.unregisterDevice).not.toHaveBeenCalled();
  });
});
