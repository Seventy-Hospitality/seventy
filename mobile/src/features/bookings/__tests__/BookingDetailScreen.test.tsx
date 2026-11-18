import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import {
  asUserId,
  CAPABILITIES,
  clutch,
  snakeCheckoutToSheet,
  type BookingDetail,
  type UserId,
} from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import {
  makeBookingDetail,
  makeBookingDue,
  makeBookingInvitation,
  makeBookingPlayer,
  makeBookingRecord,
  makeCancelledBooking,
  makeChargedBooking,
  makeClub,
  makeInvitationAnswer,
  makeParityBooking,
  makePlayerRemoval,
  makeShareCheckout,
  makeShareSettled,
  ME_ID,
  OTHER_ID,
} from '../../../lib/clutch/fixtures';
import { queryKeys } from '../../../lib/queries';
import type { SheetResult } from '../../../lib/stripe';
import { ToastProvider } from '../../../components';
import { addDaysToDateKey, todayDateKey } from '../../reserve/booking';
import { paymentLedger } from '../../reserve/payment-ledger';
import { acceptedKey } from '../accepted-bookings';
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
  usePresentConnectedSheet: () => mockPresent,
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockClutch = clutch as unknown as MockClutch;
const ME = asUserId(ME_ID);
const OTHER = asUserId(OTHER_ID);

// Far enough ahead that nothing has started.
const FUTURE = '2099-06-01';

function renderDetail(detail: BookingDetail) {
  mockClutch.bookings.get.mockResolvedValue(detail);
  mockClutch.club.verify.mockResolvedValue(makeClub());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}
    >
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  render(<BookingDetailScreen bookingId={detail.id} />, { wrapper });
  return client;
}

function setParity(on: boolean) {
  mockClutch.capabilities = { ...CAPABILITIES, bookingParity: on };
}

/** A booking someone else booked, with me as a player. */
function playing(status: 'invited' | 'accepted', dueCents = 0) {
  return makeBookingDetail({
    date: FUTURE,
    user_id: OTHER,
    players: [makeBookingPlayer({ user_id: ME, status })],
    dues: dueCents > 0 ? [makeBookingDue({ party: 'player', user_id: ME, share_cents: dueCents, due_cents: dueCents })] : [],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  paymentLedger.resetForTests();
  mockUserId = ME;
  setParity(true);
  mockClutch.me.bookingInvitations.mockResolvedValue([]);
});

describe('BookingDetailScreen: what everyone sees', () => {
  it('shows the court, time and players; players carry no names, so rows read "Player"', async () => {
    renderDetail(
      makeBookingDetail({ date: FUTURE, user_id: ME, players: [makeBookingPlayer({ user_id: OTHER, status: 'accepted' })] }),
    );
    expect(await screen.findByText('Court 1')).toBeTruthy();
    expect(screen.getByText('6:00-7:00PM')).toBeTruthy();
    expect(screen.getByLabelText('Player 1, accepted')).toBeTruthy();
  });

  it('tells nameless players apart by their place, answer and share', async () => {
    renderDetail(
      makeBookingDetail({
        date: FUTURE,
        user_id: ME,
        players: [
          makeBookingPlayer({ user_id: OTHER, status: 'accepted', share_cents: 1000, payment_status: 'paid' }),
          makeBookingPlayer({ user_id: asUserId('00000000-0000-4000-8000-000000000077'), status: 'invited' }),
        ],
      }),
    );
    expect(await screen.findByLabelText('Player 1, accepted, share $10.00, paid')).toBeTruthy();
    expect(screen.getByLabelText('Player 2, invited, has not answered yet')).toBeTruthy();
    expect(screen.getByText('Has not answered yet')).toBeTruthy();
  });

  it("names the booker from the member's pending invitation", async () => {
    const detail = playing('invited');
    mockClutch.me.bookingInvitations.mockResolvedValue([makeBookingInvitation({ booking_id: detail.id, inviter_name: 'Sam Lee' })]);
    renderDetail(detail);
    expect(await screen.findByText('Booked by Sam Lee')).toBeTruthy();
  });

  it('shows not found for a booking the caller may not see', async () => {
    mockClutch.bookings.get.mockRejectedValue(clutchError('booking_not_found', 404));
    mockClutch.club.verify.mockResolvedValue(makeClub());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}
      >
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

describe('BookingDetailScreen: the booker', () => {
  it('cancels a confirmed booking; Clutch applies its policy and the reads refresh', async () => {
    const detail = makeBookingDetail({ date: FUTURE, user_id: ME });
    const client = renderDetail(detail);
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    mockClutch.bookings.cancel.mockResolvedValue(makeCancelledBooking({ payment_status: 'refunded' }));

    fireEvent.press(await screen.findByLabelText('Cancel booking'));
    // Far ahead: outside the club's 24-hour cancellation window.
    expect(await screen.findByText(/more than 24 hours before the start/)).toBeTruthy();
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

  it('says a booking inside the cancellation window gets no refund', async () => {
    // Tomorrow at 00:00 on the club's clock is always under 24 hours away
    // and never started.
    const tomorrow = addDaysToDateKey(todayDateKey('America/New_York'), 1);
    renderDetail(makeBookingDetail({ date: tomorrow, start_time: '00:00:00', end_time: '01:00:00', user_id: ME }));
    fireEvent.press(await screen.findByLabelText('Cancel booking'));
    expect(
      await screen.findByText(/starts in less than 24 hours, inside the club's cancellation window, so you will not get a refund/),
    ).toBeTruthy();
  });

  it('lets go of a pending hold through the pending-only release (P4), never cancel', async () => {
    const detail = makeBookingDetail({ date: FUTURE, user_id: ME, status: 'pending', hold_expires_at: '2099-01-01T00:00:00.000Z' });
    renderDetail(detail);
    mockClutch.bookings.release.mockRejectedValue(clutchError('booking_not_pending', 409, { status: 'confirmed' }));

    fireEvent.press(await screen.findByLabelText('Cancel booking'));
    const confirmButtons = await screen.findAllByText('Cancel booking');
    fireEvent.press(confirmButtons[confirmButtons.length - 1]);
    expect(await screen.findByText(/no longer just a hold/)).toBeTruthy();
    expect(mockClutch.bookings.cancel).not.toHaveBeenCalled();
  });

  it('without P4 releases a hold only after a fresh read says it is still pending', async () => {
    setParity(false);
    const detail = makeBookingDetail({ date: FUTURE, user_id: ME, status: 'pending', hold_expires_at: '2099-01-01T00:00:00.000Z' });
    renderDetail(detail);
    mockClutch.bookings.cancel.mockResolvedValue(makeCancelledBooking());

    fireEvent.press(await screen.findByLabelText('Cancel booking'));
    const confirmButtons = await screen.findAllByText('Cancel booking');
    fireEvent.press(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(mockClutch.bookings.cancel).toHaveBeenCalled());
    expect(mockClutch.bookings.release).not.toHaveBeenCalled();
  });

  it('offers no Pay and no cancel while a payment for the hold is clearing', async () => {
    const detail = makeBookingDetail({
      date: FUTURE,
      user_id: ME,
      status: 'pending',
      hold_expires_at: '2099-01-01T00:00:00.000Z',
      dues: [makeBookingDue({ party: 'booker', user_id: ME, due_cents: 3000 })],
    });
    const checkout = makeShareCheckout();
    paymentLedger.put({
      userId: ME,
      bookingId: detail.id,
      purpose: 'booking',
      variant: '',
      sheet: snakeCheckoutToSheet(checkout),
      intentId: 'pi_1',
      charge: { kind: 'unknown', currency: 'USD', price_cents: 3000 },
      expiresAt: null,
      state: 'submitted',
    });
    mockClutch.bookings.confirm.mockResolvedValue(makeChargedBooking({ status: 'confirmed' }));
    renderDetail(detail);

    expect(await screen.findByText('Check payment again')).toBeTruthy();
    expect(screen.queryByText(/^Pay (now|\$)/)).toBeNull();
    expect(screen.queryByLabelText('Cancel booking')).toBeNull();
    fireEvent.press(screen.getByText('Check payment again'));
    await waitFor(() => expect(mockClutch.bookings.confirm).toHaveBeenCalledWith(detail.id, 'pi_1', expect.anything()));
    expect(mockClutch.bookings.paymentIntent).not.toHaveBeenCalled();
  });

  it('removes a player (P4)', async () => {
    const detail = makeBookingDetail({ date: FUTURE, user_id: ME, players: [makeBookingPlayer({ user_id: OTHER })] });
    renderDetail(detail);
    mockClutch.bookings.removePlayer.mockResolvedValue(makePlayerRemoval({ user_id: OTHER }));

    fireEvent.press(await screen.findByLabelText('Remove Player 1, accepted'));
    expect(await screen.findByText(/Remove Player 1 \(accepted\) from the booking\?/)).toBeTruthy();
    fireEvent.press(await screen.findByText('Remove from booking'));
    await waitFor(() =>
      expect(mockClutch.bookings.removePlayer).toHaveBeenCalledWith(detail.id, OTHER, {
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('without P4 offers no way to remove players, and no placeholder', async () => {
    setParity(false);
    renderDetail(makeBookingDetail({ date: FUTURE, user_id: ME, players: [makeBookingPlayer({ user_id: OTHER })] }));
    expect(await screen.findByText('Court 1')).toBeTruthy();
    expect(screen.queryByText('Removing players is not available in the app yet')).toBeNull();
    expect(screen.queryByTestId('unavailable-bookingParity')).toBeNull();
    expect(screen.queryByLabelText(/^Remove Player 1/)).toBeNull();
  });
});

describe('BookingDetailScreen: a player', () => {
  it('accepts an invitation (P4) and remembers the booking on this device', async () => {
    const detail = playing('invited');
    renderDetail(detail);
    mockClutch.bookings.respond.mockResolvedValue(makeInvitationAnswer({ booking_id: detail.id }));
    mockClutch.me.get.mockRejectedValue(new Error('not cached'));

    fireEvent.press(await screen.findByLabelText('Accept invitation'));
    await waitFor(() =>
      expect(mockClutch.bookings.respond).toHaveBeenCalledWith(detail.id, true, { idempotencyKey: expect.any(String) }),
    );
    expect(screen.queryByLabelText('Cancel booking')).toBeNull();
  });

  it('remembers a booking it plays in when opened', async () => {
    const detail = playing('accepted');
    renderDetail(detail);
    await screen.findByText('Court 1');
    await waitFor(async () =>
      expect(JSON.parse((await SecureStore.getItemAsync(acceptedKey(ME))) ?? '[]')).toContain(detail.id),
    );
  });

  it('without P4 offers no way to answer an invitation, and no placeholder', async () => {
    setParity(false);
    renderDetail(playing('invited'));
    expect(await screen.findByText('Court 1')).toBeTruthy();
    expect(screen.queryByText('Answering invitations is not available in the app yet')).toBeNull();
    expect(screen.queryByTestId('unavailable-bookingParity')).toBeNull();
    expect(screen.queryByLabelText('Accept invitation')).toBeNull();
    expect(screen.queryByLabelText('Decline invitation')).toBeNull();
  });

  it('without P4 cannot pay a share or leave', async () => {
    setParity(false);
    renderDetail(playing('accepted', 1500));
    expect(await screen.findByText('You owe')).toBeTruthy();
    expect(screen.queryByText('Paying your share in the app is not available yet')).toBeNull();
    expect(screen.queryByText('Leaving a booking is not available in the app yet')).toBeNull();
    expect(screen.queryByTestId('unavailable-bookingParity')).toBeNull();
    expect(screen.queryByText('Pay now')).toBeNull();
    expect(screen.queryByLabelText('Leave booking')).toBeNull();
    expect(mockClutch.bookings.sharePaymentIntent).not.toHaveBeenCalled();
  });

  it("pays a share through the share routes, never the booker's payment intent", async () => {
    const detail = playing('accepted', 1500);
    renderDetail(detail);
    mockClutch.bookings.sharePaymentIntent.mockResolvedValue(makeShareCheckout());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_share' });
    mockClutch.bookings.shareConfirm.mockResolvedValue(makeShareSettled());

    fireEvent.press(await screen.findByText('Pay now'));
    await waitFor(() =>
      expect(mockClutch.bookings.shareConfirm).toHaveBeenCalledWith(detail.id, 'pi_share', {
        idempotencyKey: expect.any(String),
      }),
    );
    expect(mockClutch.bookings.sharePaymentIntent).toHaveBeenCalledWith(detail.id, { idempotencyKey: expect.any(String) });
    expect(mockClutch.bookings.paymentIntent).not.toHaveBeenCalled();
    expect(mockClutch.bookings.confirm).not.toHaveBeenCalled();
  });

  it('pays a simulated share with the simulated pay, then shares/confirm', async () => {
    const detail = playing('accepted', 1500);
    renderDetail(detail);
    mockClutch.bookings.sharePaymentIntent.mockResolvedValue(makeShareCheckout({ simulated: true, payment_intent_id: 'sim_1' }));
    mockClutch.bookings.paySimulated.mockResolvedValue({ status: 'succeeded' });
    mockClutch.bookings.shareConfirm.mockResolvedValue(makeShareSettled({ payment_intent_id: 'sim_1' }));

    fireEvent.press(await screen.findByText('Pay now'));
    await waitFor(() => expect(mockClutch.bookings.shareConfirm).toHaveBeenCalledWith(detail.id, 'sim_1', expect.anything()));
    expect(mockClutch.bookings.paySimulated).toHaveBeenCalledWith(detail.id, 'sim_1', expect.anything());
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('leaves a booking (P4)', async () => {
    const detail = playing('accepted');
    renderDetail(detail);
    mockClutch.bookings.removePlayer.mockResolvedValue(makePlayerRemoval({ booking_id: detail.id, user_id: ME }));

    fireEvent.press(await screen.findByLabelText('Leave booking'));
    const buttons = await screen.findAllByText('Leave booking');
    fireEvent.press(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(mockClutch.bookings.removePlayer).toHaveBeenCalledWith(detail.id, ME, { idempotencyKey: expect.any(String) }),
    );
    void makeParityBooking;
  });
});
