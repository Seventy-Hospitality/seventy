import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { asCourtId, asUserId, CAPABILITIES, clutch, type AvailabilitySlot, type UserId } from '../../../lib/clutch';
import { clutchError, type MockClutch } from '../../../lib/clutch/testing';
import {
  COURT_ID,
  ME_ID,
  makeBookingDetail,
  makeBookingRecord,
  makeBookingRules,
  makeClub,
  makeCourtAvailability,
  makeMoveCheckout,
  makeParityBooking,
  makeRescheduleQuote,
  makeSlot,
} from '../../../lib/clutch/fixtures';
import type { SheetResult } from '../../../lib/stripe';
import { ToastProvider } from '../../../components';
import { paymentLedger } from '../../reserve/payment-ledger';
import { RescheduleScreen } from '../RescheduleScreen';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});

let mockUserId: UserId | null = null;
jest.mock('../../../lib/session', () => ({ useSession: () => ({ userId: mockUserId }) }));

const mockPresent = jest.fn<Promise<SheetResult>, unknown[]>();
jest.mock('../../../lib/stripe', () => ({
  usePaymentsConfigured: () => true,
  usePresentConnectedSheet: () => mockPresent,
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockClutch = clutch as unknown as MockClutch;
const ME = asUserId(ME_ID);
const COURT = asCourtId(COURT_ID);
const FUTURE = '2099-06-01';
const BOOKING = makeBookingDetail({ date: FUTURE, user_id: ME, start_time: '18:00:00', end_time: '19:00:00' });
const MOVE = { new_date: FUTURE, new_start_time: '19:00', new_end_time: '20:00', new_court_id: COURT };

function grid() {
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const slots: AvailabilitySlot[] = [0, 1, 2, 3].map((i) =>
    makeSlot({
      court_id: COURT,
      start_time: hh(18 * 60 + i * 30),
      end_time: hh(18 * 60 + (i + 1) * 30),
      status: i < 2 ? 'booked' : 'available',
    }),
  );
  return [makeCourtAvailability(COURT, {}, slots)];
}

function renderScreen() {
  mockClutch.bookings.get.mockResolvedValue(BOOKING);
  mockClutch.club.verify.mockResolvedValue(makeClub());
  mockClutch.club.availability.mockResolvedValue(grid());
  mockClutch.club.bookingRules.mockResolvedValue(makeBookingRules());
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
  render(<RescheduleScreen bookingId={BOOKING.id} />, { wrapper });
}

/** Move the booking from 18:00-19:00 to 19:00-20:00 and continue. */
async function pickLaterHour() {
  fireEvent.press(await screen.findByLabelText(/^6:00PM - 6:30PM/));
  fireEvent.press(screen.getByLabelText(/^6:30PM - 7:00PM/));
  fireEvent.press(screen.getByLabelText(/^7:00PM - 7:30PM/));
  fireEvent.press(screen.getByLabelText(/^7:30PM - 8:00PM/));
  fireEvent.press(screen.getByText('Continue'));
}

beforeEach(() => {
  jest.clearAllMocks();
  paymentLedger.resetForTests();
  mockUserId = ME;
  mockClutch.capabilities = { ...CAPABILITIES, bookingParity: true };
});

describe('RescheduleScreen without P4', () => {
  beforeEach(() => {
    mockClutch.capabilities = { ...CAPABILITIES, bookingParity: false };
  });

  it('makes a plain reschedule and never prices it with the new-booking quote', async () => {
    mockClutch.bookings.reschedule.mockResolvedValue(makeBookingRecord({ date: FUTURE, start_time: '19:00:00', end_time: '20:00:00' }));
    renderScreen();
    await pickLaterHour();
    fireEvent.press(await screen.findByText('Save change'));
    await waitFor(() =>
      expect(mockClutch.bookings.reschedule).toHaveBeenCalledWith(BOOKING.id, MOVE, { idempotencyKey: expect.any(String) }),
    );
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockClutch.bookings.quote).not.toHaveBeenCalled();
    expect(mockClutch.bookings.rescheduleQuote).not.toHaveBeenCalled();
  });

  it('says a dearer move is not available in the app yet', async () => {
    mockClutch.bookings.reschedule.mockRejectedValue(clutchError('reschedule_costs_more', 409));
    renderScreen();
    await pickLaterHour();
    fireEvent.press(await screen.findByText('Save change'));
    expect(await screen.findByText(/not available in the app yet/)).toBeTruthy();
  });
});

describe('RescheduleScreen with P4', () => {
  it('prices the move with its own quote and pays the difference before moving', async () => {
    mockClutch.bookings.rescheduleQuote.mockResolvedValue(makeRescheduleQuote());
    mockClutch.bookings.reschedulePaymentIntent.mockResolvedValue(makeMoveCheckout());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_move' });
    mockClutch.bookings.rescheduleConfirm.mockResolvedValue(
      makeParityBooking({ date: FUTURE, start_time: '19:00:00', end_time: '20:00:00' }),
    );
    renderScreen();
    await pickLaterHour();

    expect(await screen.findByText('$10.80')).toBeTruthy();
    fireEvent.press(await screen.findByText('Pay $10.80 and move'));
    await waitFor(() =>
      expect(mockClutch.bookings.rescheduleConfirm).toHaveBeenCalledWith(BOOKING.id, 'pi_move', {
        idempotencyKey: expect.any(String),
      }),
    );
    expect(mockClutch.bookings.rescheduleQuote).toHaveBeenCalledWith(BOOKING.id, MOVE);
    expect(mockClutch.bookings.reschedulePaymentIntent).toHaveBeenCalledWith(BOOKING.id, MOVE, {
      idempotencyKey: expect.any(String),
    });
    expect(mockClutch.bookings.quote).not.toHaveBeenCalled();
    expect(mockClutch.bookings.reschedule).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it('switches to the paid flow when a plain reschedule answers reschedule_payment_required', async () => {
    mockClutch.bookings.rescheduleQuote
      .mockResolvedValueOnce(makeRescheduleQuote({ payment_required: false }))
      .mockResolvedValue(makeRescheduleQuote());
    mockClutch.bookings.reschedule.mockRejectedValue(clutchError('reschedule_payment_required', 402));
    renderScreen();
    await pickLaterHour();
    expect(await screen.findByText('Nothing more to pay for this move.')).toBeTruthy();
    fireEvent.press(screen.getByText('Save change'));
    expect(await screen.findByText('Pay $10.80 and move')).toBeTruthy();
  });

  it('goes back to times when the paid move was not applied (the payment is returned)', async () => {
    mockClutch.bookings.rescheduleQuote.mockResolvedValue(makeRescheduleQuote());
    mockClutch.bookings.reschedulePaymentIntent.mockResolvedValue(makeMoveCheckout());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_move' });
    mockClutch.bookings.rescheduleConfirm.mockRejectedValue(
      clutchError('move_not_applied', 409, { reason: 'slot_already_booked' }),
    );
    mockClutch.bookings.get.mockResolvedValue(BOOKING);
    renderScreen();
    await pickLaterHour();
    fireEvent.press(await screen.findByText('Pay $10.80 and move'));
    expect(await screen.findByText(/Someone booked that time first/)).toBeTruthy();
    expect(screen.getByText(/being returned/)).toBeTruthy();
  });

  it('stays on "check again" while the move payment is processing', async () => {
    mockClutch.bookings.rescheduleQuote.mockResolvedValue(makeRescheduleQuote());
    mockClutch.bookings.reschedulePaymentIntent.mockResolvedValue(makeMoveCheckout());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_move' });
    mockClutch.bookings.rescheduleConfirm.mockRejectedValue(clutchError('payment_processing', 409));
    renderScreen();
    await pickLaterHour();
    fireEvent.press(await screen.findByText('Pay $10.80 and move'));
    expect(await screen.findByText('Check again')).toBeTruthy();
    expect(mockPresent).toHaveBeenCalledTimes(1);
  });
});
