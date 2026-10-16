import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clutch, asCourtId, type BookingPaymentIntent } from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import { makeBooking, makeCourtAvailability } from '../../../lib/clutch/fixtures';
import type { SheetResult } from '../../../lib/stripe';
import { CheckoutStep } from '../CheckoutStep';
import { createHoldSession } from '../hold-session';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});

const mockPresent = jest.fn<Promise<SheetResult>, unknown[]>();
jest.mock('../../../lib/stripe', () => ({
  usePaymentsConfigured: () => true,
  usePresentConnectedSheet: () => mockPresent,
}));

// Freeze the hold countdown so it never lapses mid-test.
jest.mock('../useCountdown', () => ({ useCountdown: () => 600 }));

const mockClutch = clutch as unknown as MockClutch;
const COURT = makeCourtAvailability(asCourtId('c0000000-0000-4000-8000-000000000001'), { court_name: 'Court 2' });
const HELD = makeBooking({ price_cents: 3000, hold_expires_at: '2099-01-01T00:15:00.000Z' });
const STRIPE_INTENT: BookingPaymentIntent = {
  clientSecret: 'pi_1_secret_x',
  paymentIntentId: 'pi_1',
  simulated: false,
  stripeAccount: 'acct_club',
};

function renderCheckout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const cancel = jest.fn();
  const holdSession = createHoldSession({ cancel });
  const onConfirmed = jest.fn();
  const onPickAnotherTime = jest.fn();
  const onLeaveToBooking = jest.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <CheckoutStep
      sport="badminton"
      court={COURT}
      date="2026-10-20"
      range={{ start: '18:00', end: '19:00', minutes: 60 }}
      holdSession={holdSession}
      onConfirmed={onConfirmed}
      onPickAnotherTime={onPickAnotherTime}
      onLeaveToBooking={onLeaveToBooking}
    />,
    { wrapper },
  );
  return { holdSession, cancel, onConfirmed, onPickAnotherTime, onLeaveToBooking };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.bookings.create.mockResolvedValue(HELD);
});

describe('CheckoutStep', () => {
  it('holds the court for the picked court and range, and shows the hold price', async () => {
    const { holdSession } = renderCheckout();
    expect(await screen.findByText('Confirm and pay $30.00')).toBeTruthy();
    expect(mockClutch.bookings.create).toHaveBeenCalledWith(
      { court_id: COURT.court_id, date: '2026-10-20', start_time: '18:00', end_time: '19:00' },
      { idempotencyKey: expect.any(String) },
    );
    expect(holdSession.heldId).toBe(HELD.id);
  });

  it('pays on the stripe sheet and confirms with the completed intent id', async () => {
    mockClutch.bookings.paymentIntent.mockResolvedValue(STRIPE_INTENT);
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_1' });
    const confirmed = makeBooking({ status: 'confirmed', paid_cents: 3000 });
    mockClutch.bookings.confirm.mockResolvedValue(confirmed);
    const { onConfirmed } = renderCheckout();

    fireEvent.press(await screen.findByText('Confirm and pay $30.00'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(confirmed));
    expect(mockPresent).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'stripe', clientSecret: 'pi_1_secret_x', stripeAccount: 'acct_club' }),
      expect.anything(),
    );
    expect(mockClutch.bookings.confirm).toHaveBeenCalledWith(HELD.id, 'pi_1', {
      idempotencyKey: expect.any(String),
    });
  });

  it('pays a simulated checkout without a sheet, then confirms', async () => {
    mockClutch.bookings.paymentIntent.mockResolvedValue({ ...STRIPE_INTENT, simulated: true, paymentIntentId: 'sim_pi_1' });
    mockClutch.bookings.paySimulated.mockResolvedValue({ status: 'succeeded' });
    mockClutch.bookings.confirm.mockResolvedValue(makeBooking({ status: 'confirmed' }));
    const { onConfirmed } = renderCheckout();

    fireEvent.press(await screen.findByText('Confirm and pay $30.00'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(mockPresent).not.toHaveBeenCalled();
    expect(mockClutch.bookings.paySimulated).toHaveBeenCalledWith(HELD.id, 'sim_pi_1', expect.anything());
    expect(mockClutch.bookings.confirm).toHaveBeenCalledWith(HELD.id, 'sim_pi_1', expect.anything());
  });

  it('confirms a free booking with no intent', async () => {
    mockClutch.bookings.create.mockResolvedValue(makeBooking({ price_cents: 0 }));
    mockClutch.bookings.confirm.mockResolvedValue(makeBooking({ status: 'confirmed', price_cents: 0 }));
    const { onConfirmed } = renderCheckout();

    fireEvent.press(await screen.findByText('Confirm booking'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(mockClutch.bookings.paymentIntent).not.toHaveBeenCalled();
    expect(mockClutch.bookings.confirm).toHaveBeenCalledWith(HELD.id, null, expect.anything());
  });

  it('keeps the hold when the sheet is closed, and releases it only on request', async () => {
    mockClutch.bookings.paymentIntent.mockResolvedValue(STRIPE_INTENT);
    mockPresent.mockResolvedValue({ status: 'canceled' });
    const { cancel, onPickAnotherTime } = renderCheckout();

    fireEvent.press(await screen.findByText('Confirm and pay $30.00'));
    expect(await screen.findByText(/The court is still held for you/)).toBeTruthy();
    expect(cancel).not.toHaveBeenCalled();
    expect(mockClutch.bookings.confirm).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Release court'));
    expect(cancel).toHaveBeenCalledWith(HELD.id);
    expect(onPickAnotherTime).toHaveBeenCalledWith(null);
  });

  it('keeps the hold when the intent cannot be created, and retries', async () => {
    mockClutch.bookings.paymentIntent.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(STRIPE_INTENT);
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_1' });
    mockClutch.bookings.confirm.mockResolvedValue(makeBooking({ status: 'confirmed' }));
    const { cancel, onConfirmed } = renderCheckout();

    fireEvent.press(await screen.findByText('Confirm and pay $30.00'));
    expect(await screen.findByText(/No connection/)).toBeTruthy();
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Confirm and pay $30.00'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    // A network failure decided nothing, so the retry replays the same key.
    const [first, second] = mockClutch.bookings.paymentIntent.mock.calls;
    expect(second[1]?.idempotencyKey).toBe(first[1]?.idempotencyKey);
  });

  it('re-checks a clearing payment with a new key and never pays twice', async () => {
    mockClutch.bookings.paymentIntent.mockResolvedValue(STRIPE_INTENT);
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_1' });
    mockClutch.bookings.confirm
      .mockRejectedValueOnce(clutchError('payment_processing', 409))
      .mockResolvedValueOnce(makeBooking({ status: 'confirmed' }));
    const { onConfirmed, holdSession } = renderCheckout();

    fireEvent.press(await screen.findByText('Confirm and pay $30.00'));
    expect(await screen.findByText('Your payment is clearing')).toBeTruthy();
    expect(holdSession.paymentLocked).toBe(true);

    fireEvent.press(screen.getByText('Check again'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(mockPresent).toHaveBeenCalledTimes(1);
    expect(mockClutch.bookings.paymentIntent).toHaveBeenCalledTimes(1);
    const [first, second] = mockClutch.bookings.confirm.mock.calls;
    expect(second[1]).toBe('pi_1');
    expect(second[2]?.idempotencyKey).not.toBe(first[2]?.idempotencyKey);
  });

  it('lets the member leave a clearing payment for the booking screen', async () => {
    mockClutch.bookings.paymentIntent.mockResolvedValue(STRIPE_INTENT);
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_1' });
    mockClutch.bookings.confirm.mockRejectedValue(clutchError('payment_not_verified', 402));
    const { onLeaveToBooking } = renderCheckout();

    fireEvent.press(await screen.findByText('Confirm and pay $30.00'));
    fireEvent.press(await screen.findByText('Leave and check later'));
    expect(onLeaveToBooking).toHaveBeenCalledWith(HELD);
  });

  it('sends the member back to times when the hold ended', async () => {
    mockClutch.bookings.paymentIntent.mockResolvedValue(STRIPE_INTENT);
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_1' });
    mockClutch.bookings.confirm.mockRejectedValue(clutchError('booking_changed', 409));
    const { onPickAnotherTime } = renderCheckout();

    fireEvent.press(await screen.findByText('Confirm and pay $30.00'));
    fireEvent.press(await screen.findByText('Pick another time'));
    expect(onPickAnotherTime).toHaveBeenCalledWith(expect.stringContaining('no longer held'));
  });

  it('explains a taken slot when the hold cannot be created', async () => {
    mockClutch.bookings.create.mockRejectedValue(clutchError('slot_unavailable', 409));
    const { onPickAnotherTime } = renderCheckout();
    expect(await screen.findByText('That time was just taken')).toBeTruthy();
    fireEvent.press(screen.getByText('Pick another time'));
    expect(onPickAnotherTime).toHaveBeenCalled();
  });

  it('shows the membership state for a members-only refusal', async () => {
    mockClutch.bookings.create.mockRejectedValue(clutchError('members_only', 403));
    renderCheckout();
    expect(await screen.findByText('Members only')).toBeTruthy();
  });
});
