import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { TEST_CLUB_ID } from '../../../lib/clutch/testing';
import { InboxNotificationSchema } from '../../../lib/clutch';
import { renderWithProviders } from '../../account/__tests__/render-account';
import { noticeFromData, routeForNotice } from '../notification-routing';
import { clubNotices, NotificationsScreen } from '../NotificationsScreen';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

let mockParams: { focus?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));

function notice(over: Record<string, unknown> = {}) {
  return InboxNotificationSchema.parse({
    id: 'n1',
    club_id: TEST_CLUB_ID,
    type: 'booking_confirmed',
    title: 'Booking confirmed',
    body: 'Court 1, Tue 6pm',
    read: false,
    created_at: '2026-10-16T12:00:00.000Z',
    ...over,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockClutch.clubId = TEST_CLUB_ID as never;
  mockClutch.me.markNotificationsRead.mockResolvedValue(null);
});

describe('tap routing', () => {
  it('opens the inbox focused on the tapped notice', () => {
    const data = { notificationId: 'n1', type: 'booking_confirmed', clubId: TEST_CLUB_ID, link: '/notifications' };
    const notice = noticeFromData(data);
    expect(notice).not.toBeNull();
    expect(routeForNotice(notice!)).toEqual({ pathname: '/account/notifications', params: { focus: 'n1' } });
  });

  it('ignores data that is not a Clutch notice (the verification push included)', () => {
    expect(noticeFromData({ type: 'clutch.device_verification', code: '123456' })).toBeNull();
    expect(noticeFromData(undefined)).toBeNull();
  });
});

describe('NotificationsScreen', () => {
  it('lists this club only, newest first', () => {
    const rows = clubNotices(
      [
        notice({ id: 'old', created_at: '2026-10-01T00:00:00.000Z' }),
        notice({ id: 'new', created_at: '2026-10-15T00:00:00.000Z' }),
        notice({ id: 'other', club_id: 'aaaaaaaa-0000-4000-8000-000000000000' }),
      ],
      TEST_CLUB_ID,
    );
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('marks the tapped notice read when it opens focused on it', async () => {
    mockParams = { focus: 'n1' };
    mockClutch.me.notifications.mockResolvedValue({ items: [notice()], count: 1 });
    renderWithProviders(<NotificationsScreen />);
    await waitFor(() =>
      expect(mockClutch.me.markNotificationsRead).toHaveBeenCalledWith({ id: 'n1' }, expect.anything()),
    );
  });

  it('marks everything read on request', async () => {
    mockClutch.me.notifications.mockResolvedValue({ items: [notice()], count: 1 });
    renderWithProviders(<NotificationsScreen />);
    fireEvent.press(await screen.findByText('Mark all as read'));
    await waitFor(() =>
      expect(mockClutch.me.markNotificationsRead).toHaveBeenCalledWith({ all: true }, expect.anything()),
    );
  });

  it('shows an error with retry when the inbox cannot load', async () => {
    mockClutch.me.notifications.mockRejectedValue(new Error('offline'));
    renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByText('We could not load your notifications.')).toBeTruthy();
  });
});
