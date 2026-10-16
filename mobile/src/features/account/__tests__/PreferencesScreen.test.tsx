import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import type { NotificationPreferences } from '../../../lib/clutch';
import { PreferencesScreen } from '../PreferencesScreen';
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

const off = { push: false, email: false, sms: false };
const PREFS: NotificationPreferences = {
  bookings: { push: false, email: true, sms: true },
  tournaments: { push: true, email: false, sms: false },
  leagues: off,
  messages: off,
  clubAnnouncements: off,
  promotions: off,
  smsPhone: '+15550100',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.me.preferences.mockResolvedValue(PREFS);
  mockClutch.me.putPreferences.mockResolvedValue(null);
  mockClutch.me.registerDevice.mockResolvedValue({ token: 'ExponentPushToken[test]', platform: 'ios' });
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
});
