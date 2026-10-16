import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { clutch, type BookingDetail, type UserId } from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { ME_ID, OTHER_ID, makeBooking, makeBookingDetail, makeClub } from '../../../lib/clutch/fixtures';
import { queryKeys } from '../../../lib/queries';
import type { SheetResult } from '../../../lib/stripe';
import { ToastProvider } from '../../../components';
import { BookingDetailScreen } from '../BookingDetailScreen';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});

let mockUserId: UserId | null = null;
jest.mock('../../../lib/session', () => ({
  useSession: () => ({ userId: mockUserId }),
}));

const mockPresent = jest.fn<Promise<SheetResult>, unknown[]>();
jest.mock('../../../lib/stripe', () => ({
  usePaymentsConfigured: () => true,
  usePresentConnectedSheet: () => mockPresent,
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockClutch = clutch as unknown as MockClutch;

// Far enough ahead that nothing has started.
const FUTURE = '2099-06-01';

function renderDetail(detail: BookingDetail) {
  mockClutch.bookings.get.mockResolvedValue(detail);
  mockClutch.club.verify.mockResolvedValue(makeClub());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  render(<BookingDetailScreen bookingId={detail.id} />, { wrapper });
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = ME_ID;
});

describe('BookingDetailScreen', () => {
  it('shows the court, time and players, naming unnamed players "Player"', async () => {
    renderDetail(
      makeBookingDetail({
        date: FUTURE,
        user_id: ME_ID,
        players: [{ user_id: OTHER_ID, status: 'accepted', share_cents: null }],
      }),
    );
    expect(await screen.findByText('Court 1')).toBeTruthy();
    expect(screen.getByText('6:00-7:00PM')).toBeTruthy();
    expect(screen.getByLabelText('Player, Accepted')).toBeTruthy();
  });

  it('the booker cancels; Clutch applies its policy and the reads refresh', async () => {
    const detail = makeBookingDetail({ date: FUTURE, user_id: ME_ID });
    const client = renderDetail(detail);
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    mockClutch.bookings.cancel.mockResolvedValue(makeBooking({ status: 'cancelled', payment_status: 'refunded' }));

    fireEvent.press(await screen.findByLabelText('Cancel booking'));
    const confirmButtons = await screen.findAllByText('Cancel booking');
    fireEvent.press(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() =>
      expect(mockClutch.bookings.cancel).toHaveBeenCalledWith(detail.id, { idempotencyKey: expect.any(String) }),
    );
    expect(await screen.findByText(/returning your payment/)).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.bookings });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.home });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.availability(FUTURE) });
  });

  it('shows the cancellation window refusal', async () => {
    renderDetail(makeBookingDetail({ date: FUTURE, user_id: ME_ID }));
    mockClutch.bookings.cancel.mockRejectedValue(clutchError('cancellation_window_passed', 409));

    fireEvent.press(await screen.findByLabelText('Cancel booking'));
    const confirmButtons = await screen.findAllByText('Cancel booking');
    fireEvent.press(confirmButtons[confirmButtons.length - 1]);
    expect(await screen.findByText(/Too late to cancel/)).toBeTruthy();
  });

  it('an invited player accepts', async () => {
    const detail = makeBookingDetail({
      date: FUTURE,
      user_id: OTHER_ID,
      players: [{ user_id: ME_ID, status: 'invited', share_cents: null }],
    });
    renderDetail(detail);
    mockClutch.bookings.respond.mockResolvedValue(null);

    fireEvent.press(await screen.findByLabelText('Accept invitation'));
    await waitFor(() =>
      expect(mockClutch.bookings.respond).toHaveBeenCalledWith(detail.id, true, {
        idempotencyKey: expect.any(String),
      }),
    );
    expect(screen.queryByLabelText('Cancel booking')).toBeNull();
  });

  it('a player pays their share with Clutch due and then reloads the booking', async () => {
    const detail = makeBookingDetail({
      date: FUTURE,
      user_id: OTHER_ID,
      players: [{ user_id: ME_ID, status: 'accepted', share_cents: 1500 }],
      dues: [
        {
          party: 'player',
          user_id: ME_ID,
          invitation_id: null,
          live: true,
          share_cents: 1500,
          paid_cents: 0,
          due_cents: 1500,
        },
      ],
    });
    renderDetail(detail);
    mockClutch.bookings.paymentIntent.mockResolvedValue({
      clientSecret: 'pi_9_secret_y',
      paymentIntentId: 'pi_9',
      simulated: false,
      stripeAccount: 'acct_club',
    });
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_9' });

    fireEvent.press(await screen.findByText('Pay $15.00'));
    await waitFor(() => expect(mockPresent).toHaveBeenCalled());
    expect(mockClutch.bookings.paymentIntent).toHaveBeenCalledWith(detail.id, {
      idempotencyKey: expect.any(String),
      shareCents: 1500,
    });
    // A player's share is recorded by Clutch from the provider: no confirm.
    expect(mockClutch.bookings.confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(mockClutch.bookings.get.mock.calls.length).toBeGreaterThan(1));
  });

  it('the booker removes a player', async () => {
    const detail = makeBookingDetail({
      date: FUTURE,
      user_id: ME_ID,
      players: [{ user_id: OTHER_ID, status: 'accepted', share_cents: null, full_name: 'Sam Lee' }],
    });
    renderDetail(detail);
    mockClutch.bookings.removePlayer.mockResolvedValue(null);

    fireEvent.press(await screen.findByLabelText('Remove Sam Lee'));
    fireEvent.press(await screen.findByText('Remove from booking'));
    await waitFor(() =>
      expect(mockClutch.bookings.removePlayer).toHaveBeenCalledWith(detail.id, OTHER_ID, {
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('shows not found for a booking the caller may not see', async () => {
    mockClutch.bookings.get.mockRejectedValue(clutchError('booking_not_found', 404));
    mockClutch.club.verify.mockResolvedValue(makeClub());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <BookingDetailScreen bookingId={makeBookingDetail().id} />
          </ToastProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
    expect(await screen.findByText('Booking not found')).toBeTruthy();
  });
});
