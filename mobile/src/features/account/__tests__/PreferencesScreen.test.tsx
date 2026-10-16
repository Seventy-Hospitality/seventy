import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makePreferences } from '../../../lib/clutch/fixtures';
import { PreferencesScreen } from '../PreferencesScreen';
import { renderWithProviders } from './render-account';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

// The install's push device_secret is made from random bytes.
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => require('crypto').randomUUID()),
  getRandomBytes: jest.fn((n: number) => new Uint8Array(require('crypto').randomBytes(n))),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

const off = { push: false, email: false, sms: false };
const PREFS = makePreferences({
  bookings: { push: false, email: true, sms: true },
  tournaments: { push: true, email: false, sms: false },
  leagues: off,
  messages: off,
  clubAnnouncements: off,
  promotions: off,
  smsPhone: '+15550100',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.me.preferences.mockResolvedValue(PREFS);
  mockClutch.me.putPreferences.mockImplementation(async (prefs) => prefs);
  mockClutch.me.registerDevice.mockResolvedValue({
    status: 'registered',
    token: 'ExponentPushToken[test]',
    platform: 'ios',
    registeredAt: '2026-10-16T12:00:00.000Z',
  });
  mockClutch.me.unregisterDevice.mockResolvedValue({ removed: true });
});

describe('PreferencesScreen', () => {
  it('PUTs the whole matrix, keeping hidden categories, sms and smsPhone', async () => {
    renderWithProviders(<PreferencesScreen />);

    fireEvent(await screen.findByLabelText('Bookings email notifications'), 'valueChange', false);

    await waitFor(() => expect(mockClutch.me.putPreferences).toHaveBeenCalledTimes(1));
    expect(mockClutch.me.putPreferences).toHaveBeenCalledWith(
      { ...PREFS, bookings: { push: false, email: false, sms: true } },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('rolls back only the switch whose save failed', async () => {
    mockClutch.me.putPreferences.mockRejectedValue(clutchError('invalid_field', 400));
    renderWithProviders(<PreferencesScreen />);

    const toggle = await screen.findByLabelText('Messages email notifications');
    fireEvent(toggle, 'valueChange', true);

    await waitFor(() => expect(mockClutch.me.putPreferences).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Messages email notifications').props.value).toBe(false));
  });

  it('may prompt for permission only when the member turns push on', async () => {
    renderWithProviders(<PreferencesScreen />);

    fireEvent(await screen.findByLabelText('Bookings push notifications'), 'valueChange', true);

    await waitFor(() => expect(Notifications.requestPermissionsAsync).toHaveBeenCalled());
    await waitFor(() => expect(mockClutch.me.putPreferences).toHaveBeenCalled());
  });

  it('keeps this install registered while a hidden category still wants push', async () => {
    mockClutch.me.preferences.mockResolvedValue({ ...PREFS, promotions: { push: true, email: false, sms: false } });
    (Notifications.getPermissionsAsync as jest.Mock)
      .mockResolvedValueOnce({ granted: true, canAskAgain: true })
      .mockResolvedValueOnce({ granted: true, canAskAgain: true });
    renderWithProviders(<PreferencesScreen />);

    fireEvent(await screen.findByLabelText('Promotions push notifications'), 'valueChange', false);

    await waitFor(() => expect(mockClutch.me.putPreferences).toHaveBeenCalled());
    await waitFor(() => expect(mockClutch.me.registerDevice).toHaveBeenCalled());
    expect(mockClutch.me.unregisterDevice).not.toHaveBeenCalled();
  });

  it('opens the legal pages in the in-app browser and contact in the mail app', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderWithProviders(<PreferencesScreen />);

    fireEvent.press(await screen.findByText('Privacy policy'));
    fireEvent.press(screen.getByText('Terms of Service'));
    fireEvent.press(screen.getByText('Contact us'));

    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://seventyhospitality.com/privacy.html');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://seventyhospitality.com/terms.html');
    expect(openURL).toHaveBeenCalledWith('mailto:contact@seventyhospitality.com');
    openURL.mockRestore();
  });
});
