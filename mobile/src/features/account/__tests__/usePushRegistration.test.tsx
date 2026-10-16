import { act, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import { makePreferences } from '../../../lib/clutch/fixtures';
import {
  anyPushOn,
  base64Url,
  deviceSecret,
  PushRegistrationSync,
  registerThisDevice,
  REGISTER_RETRY_DELAYS_MS,
  unregisterPushForSignOut,
} from '../usePushRegistration';
import { renderWithProviders } from './render-account';
import type { Capabilities } from '../../../lib/clutch/capabilities';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => require('crypto').randomUUID()),
  getRandomBytes: jest.fn((n: number) => new Uint8Array(require('crypto').randomBytes(n))),
}));

let mockTokenListener: (() => void) | null = null;
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  addPushTokenListener: jest.fn((listener: () => void) => {
    mockTokenListener = listener;
    return { remove: () => (mockTokenListener = null) };
  }),
}));

jest.mock('../../../lib/session', () => ({
  useSession: () => ({ status: 'authenticated', userId: 'u1' }),
}));

const off = { push: false, email: true, sms: false };
const ALL_OFF = makePreferences({
  bookings: off,
  tournaments: off,
  leagues: off,
  messages: off,
  clubAnnouncements: off,
  promotions: off,
});

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const getToken = Notifications.getExpoPushTokenAsync as jest.Mock;
const GRANTED = { granted: true, canAskAgain: true };
const DENIED = { granted: false, canAskAgain: true };

beforeEach(async () => {
  jest.clearAllMocks();
  (mockClutch.capabilities as Capabilities).pushDevices = true;
  getPermissions.mockResolvedValue(GRANTED);
  getToken.mockResolvedValue({ data: 'ExponentPushToken[test]' });
  mockClutch.me.registerDevice.mockResolvedValue({ token: 'ExponentPushToken[test]', platform: 'ios' });
  mockClutch.me.unregisterDevice.mockResolvedValue({ removed: true });
  await SecureStore.deleteItemAsync('clutch.push.registered_token');
});

describe('anyPushOn', () => {
  it('counts every category, the hidden tournaments and leagues included', () => {
    expect(anyPushOn(ALL_OFF)).toBe(false);
    expect(anyPushOn({ ...ALL_OFF, leagues: { ...off, push: true } })).toBe(true);
    expect(anyPushOn({ ...ALL_OFF, tournaments: { ...off, push: true } })).toBe(true);
  });
});

describe('device secret', () => {
  it('encodes base64url without padding', () => {
    for (const n of [1, 2, 3, 31, 32]) {
      const bytes = new Uint8Array(require('crypto').randomBytes(n));
      expect(base64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });

  it('makes 32 random bytes once per install and keeps them in secure storage', async () => {
    const first = await deviceSecret();
    const second = await deviceSecret();
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await SecureStore.getItemAsync('clutch.push.device_secret')).toBe(first);
  });
});

describe('registerThisDevice', () => {
  it('sends the token, platform and the install secret', async () => {
    expect(await registerThisDevice({ prompt: false })).toBe('registered');
    expect(mockClutch.me.registerDevice).toHaveBeenCalledWith(
      { token: 'ExponentPushToken[test]', platform: 'ios', device_secret: await deviceSecret() },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('leaves a token another account holds alone (409 device_token_taken)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockClutch.me.registerDevice.mockRejectedValue(clutchError('device_token_taken'));
    expect(await registerThisDevice({ prompt: false })).toBe('taken');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reports a transient failure as worth retrying', async () => {
    mockClutch.me.registerDevice.mockRejectedValue(networkError());
    expect(await registerThisDevice({ prompt: false })).toBe('retry');
  });

  it('calls nothing when the capability is off', async () => {
    (mockClutch.capabilities as Capabilities).pushDevices = false;
    expect(await registerThisDevice({ prompt: false })).toBe('unavailable');
    expect(mockClutch.me.registerDevice).not.toHaveBeenCalled();
  });

  it('removes the old token after Expo rotates it', async () => {
    await registerThisDevice({ prompt: false });
    getToken.mockResolvedValue({ data: 'ExponentPushToken[new]' });
    await registerThisDevice({ prompt: false });
    expect(mockClutch.me.unregisterDevice).toHaveBeenCalledWith('ExponentPushToken[test]');
  });
});

describe('PushRegistrationSync', () => {
  it('registers at launch when push is wanted and permission was already granted', async () => {
    mockClutch.me.preferences.mockResolvedValue({ ...ALL_OFF, bookings: { ...off, push: true } });

    renderWithProviders(<PushRegistrationSync />);

    await waitFor(() => expect(mockClutch.me.registerDevice).toHaveBeenCalledTimes(1));
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('never prompts on launch', async () => {
    getPermissions.mockResolvedValue(DENIED);
    mockClutch.me.preferences.mockResolvedValue({ ...ALL_OFF, bookings: { ...off, push: true } });

    renderWithProviders(<PushRegistrationSync />);

    await waitFor(() => expect(getPermissions).toHaveBeenCalled());
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(mockClutch.me.registerDevice).not.toHaveBeenCalled();
  });

  it('registers when only a hidden category wants push', async () => {
    mockClutch.me.preferences.mockResolvedValue({ ...ALL_OFF, tournaments: { ...off, push: true } });

    renderWithProviders(<PushRegistrationSync />);

    await waitFor(() => expect(mockClutch.me.registerDevice).toHaveBeenCalled());
  });

  it('does nothing when every push channel is off', async () => {
    mockClutch.me.preferences.mockResolvedValue(ALL_OFF);

    renderWithProviders(<PushRegistrationSync />);

    await waitFor(() => expect(mockClutch.me.preferences).toHaveBeenCalled());
    expect(mockClutch.me.registerDevice).not.toHaveBeenCalled();
  });

  it('registers again when Expo rotates the token', async () => {
    mockClutch.me.preferences.mockResolvedValue(makePreferences());

    renderWithProviders(<PushRegistrationSync />);
    await waitFor(() => expect(mockClutch.me.registerDevice).toHaveBeenCalledTimes(1));

    getToken.mockResolvedValue({ data: 'ExponentPushToken[rotated]' });
    await act(async () => mockTokenListener?.());
    await waitFor(() => expect(mockClutch.me.registerDevice).toHaveBeenCalledTimes(2));
    expect(mockClutch.me.registerDevice.mock.calls[1][0]).toMatchObject({ token: 'ExponentPushToken[rotated]' });
  });

  it('retries a transient failure with backoff, and never loops on device_token_taken', async () => {
    jest.useFakeTimers();
    try {
      mockClutch.me.preferences.mockResolvedValue(makePreferences());
      mockClutch.me.registerDevice
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(clutchError('device_token_taken'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      renderWithProviders(<PushRegistrationSync />);
      await waitFor(() => expect(mockClutch.me.registerDevice).toHaveBeenCalledTimes(1));

      await act(async () => {
        jest.advanceTimersByTime(REGISTER_RETRY_DELAYS_MS[0]);
      });
      await waitFor(() => expect(mockClutch.me.registerDevice).toHaveBeenCalledTimes(2));

      await act(async () => {
        jest.advanceTimersByTime(REGISTER_RETRY_DELAYS_MS[2] * 2);
      });
      expect(mockClutch.me.registerDevice).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('unregisterPushForSignOut', () => {
  it('removes the registered token without prompting, even after permission was revoked', async () => {
    await registerThisDevice({ prompt: false });
    getPermissions.mockResolvedValue(DENIED);

    await unregisterPushForSignOut();

    expect(mockClutch.me.unregisterDevice).toHaveBeenCalledWith('ExponentPushToken[test]', {
      idempotencyKey: expect.any(String),
    });
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('is a silent no-op with nothing registered and no permission', async () => {
    getPermissions.mockResolvedValue(DENIED);
    await unregisterPushForSignOut();
    expect(mockClutch.me.unregisterDevice).not.toHaveBeenCalled();
  });

  it('never throws when Clutch cannot be reached', async () => {
    await registerThisDevice({ prompt: false });
    mockClutch.me.unregisterDevice.mockRejectedValue(networkError());
    await expect(unregisterPushForSignOut()).resolves.toBeUndefined();
  });
});
