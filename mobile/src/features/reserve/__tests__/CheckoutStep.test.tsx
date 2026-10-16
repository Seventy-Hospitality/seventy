import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { asCourtId, asUserId, clutch, CAPABILITIES } from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import {
  ME_ID,
  makeBookingDetail,
  makeBookingRecord,
  makeCourtAvailability,
  makeLegacyCheckout,
  makeQuote,
} from '../../../lib/clutch/fixtures';
import type { SheetResult } from '../../../lib/stripe';
import { CheckoutStep } from '../CheckoutStep';
import { createHoldSession } from '../hold-session';
import { paymentLedger } from '../payment-ledger';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});

jest.mock('../../../lib/session', () => ({
  useSession: () => ({ userId: 'u0000000-0000-4000-8000-000000000001' }),
}));

const mockPresent = jest.fn<Promise<SheetResult>, unknown[]>();
jest.mock('../../../lib/stripe', () => ({
  usePaymentsConfigured: () => true,
  usePresentConnectedSheet: () => mockPresent,
}));

// Freeze the hold countdown so it never lapses mid-test.
jest.mock('../useCountdown', () => ({ useCountdown: () => 600 }));

const mockClutch = clutch as unknown as MockClutch;
const COURT = makeCourtAvailability(asCourtId('c0000000-0000-4000-8000-000000000001'), { court_name: 'Court 2' });
const HELD = makeBookingRecord({ price_cents: 3000, hold_expires_at: '2099-01-01T00:15:00.000Z' });
const CONFIRMED = makeBookingRecord({ status: 'confirmed', payment_status: 'paid', paid_cents: 3000, hold_expires_at: null });
const CHECKOUT = makeLegacyCheckout({ clientSecret: 'pi_1_secret_x', paymentIntentId: 'pi_1', subtotalCents: 3000, taxAmountCents: 240 });
void ME_ID;
void asUserId;

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

const PAY = 'Continue to payment';

beforeEach(() => {
  jest.clearAllMocks();
  paymentLedger.resetForTests();
  mockClutch.capabilities = { ...CAPABILITIES, bookingParity: false };
  mockClutch.bookings.create.mockResolvedValue(HELD);
  mockClutch.bookings.paymentIntent.mockResolvedValue(CHECKOUT);
});

describe('CheckoutStep: holding and pricing', () => {
  it('holds the picked court and range; without P4 the total is shown at payment', async () => {
    const { holdSession } = renderCheckout();
    expect(await screen.findByText(PAY)).toBeTruthy();
    expect(mockClutch.bookings.create).toHaveBeenCalledWith(
      { court_id: COURT.court_id, date: '2026-10-20', start_time: '18:00', end_time: '19:00' },
      { idempotencyKey: expect.any(String) },
    );
    expect(holdSession.heldId).toBe(HELD.id);
    expect(screen.getByText('Shown at payment')).toBeTruthy();
    expect(screen.getByText('$30.00')).toBeTruthy();
    expect(mockClutch.bookings.quote).not.toHaveBeenCalled();
  });

  it("with P4 shows the quote's total, tax included, on the Pay button", async () => {
    mockClutch.capabilities = { ...CAPABILITIES, bookingParity: true };
    mockClutch.bookings.quote.mockResolvedValue(makeQuote({ price_cents: 3000, tax_cents: 240, total_cents: 3240 }));
    renderCheckout();
    expect(await screen.findByText('Confirm and pay $32.40')).toBeTruthy();
    expect(screen.getByText('$2.40')).toBeTruthy();
  });

  it('explains a taken slot when the hold cannot be created', async () => {
    mockClutch.bookings.create.mockRejectedValue(clutchError('slot_unavailable', 409));
    const { onPickAnotherTime } = renderCheckout();
    expect(await screen.findByText('That time was just taken')).toBeTruthy();
    fireEvent.press(screen.getByText('Pick another time'));
    expect(onPickAnotherTime).toHaveBeenCalled();
  });

  it('shows the membership state for a membership refusal', async () => {
    mockClutch.bookings.create.mockRejectedValue(clutchError('not_club_member', 403));
    renderCheckout();
    expect(await screen.findByText('Club membership needed')).toBeTruthy();
  });
});

describe('CheckoutStep: paying', () => {
  it('pays on the sheet and confirms the completed intent with a rerunnable key', async () => {
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_1' });
    mockClutch.bookings.confirm.mockResolvedValue(CONFIRMED);
    const { onConfirmed } = renderCheckout();

    fireEvent.press(await screen.findByText(PAY));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(onConfirmed.mock.calls[0][0]).toEqual(CONFIRMED);
    // The intent's own subtotal and tax, as Clutch returned them.
    expect(onConfirmed.mock.calls[0][1]).toEqual({ kind: 'split', currency: 'USD', subtotal_cents: 3000, tax_cents: 240 });
    expect(mockPresent).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'stripe', clientSecret: 'pi_1_secret_x', stripeAccount: 'acct_club' }),
      expect.anything(),
    );
    expect(mockClutch.bookings.confirm).toHaveBeenCalledWith(HELD.id, 'pi_1', { idempotencyKey: expect.any(String) });
  });

  it('pays a simulated checkout without a sheet, then confirms', async () => {
    mockClutch.bookings.paymentIntent.mockResolvedValue(makeLegacyCheckout({ simulated: true, paymentIntentId: 'sim_pi_1' }));
    mockClutch.bookings.paySimulated.mockResolvedValue({ status: 'succeeded' });
    mockClutch.bookings.confirm.mockResolvedValue(CONFIRMED);
    const { onConfirmed } = renderCheckout();

    fireEvent.press(await screen.findByText(PAY));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(mockPresent).not.toHaveBeenCalled();
    expect(mockClutch.bookings.paySimulated).toHaveBeenCalledWith(HELD.id, 'sim_pi_1', expect.anything());
    expect(mockClutch.bookings.confirm).toHaveBeenCalledWith(HELD.id, 'sim_pi_1', expect.anything());
  });

  it('confirms a free booking with no intent', async () => {
    mockClutch.bookings.create.mockResolvedValue(makeBookingRecord({ price_cents: 0 }));
    mockClutch.bookings.confirm.mockResolvedValue(makeBookingRecord({ status: 'confirmed', price_cents: 0 }));
    const { onConfirmed } = renderCheckout();

    fireEvent.press(await screen.findByText('Confirm booking'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(mockClutch.bookings.paymentIntent).not.toHaveBeenCalled();
    expect(mockClutch.bookings.confirm).toHaveBeenCalledWith(HELD.id, null, expect.anything());
  });

  it('ignores a double tap: one intent, one sheet', async () => {
    let finish: (r: SheetResult) => void = () => undefined;
    mockPresent.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderCheckout();
    const button = await screen.findByText(PAY);
    fireEvent.press(button);
    fireEvent.press(button);
    await waitFor(() => expect(mockPresent).toHaveBeenCalledTimes(1));
    expect(mockClutch.bookings.paymentIntent).toHaveBeenCalledTimes(1);
    await act(async () => finish({ status: 'canceled' }));
  });

  it('keeps the hold when the sheet is closed, reuses the same intent, and releases only on request', async () => {
    mockPresent.mockResolvedValue({ status: 'canceled' });
    const { cancel, onPickAnotherTime } = renderCheckout();

    fireEvent.press(await screen.findByText(PAY));
    expect(await screen.findByText(/The court is still held for you/)).toBeTruthy();
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText(PAY));
    await waitFor(() => expect(mockPresent).toHaveBeenCalledTimes(2));
    expect(mockClutch.bookings.paymentIntent).toHaveBeenCalledTimes(1);
    expect(mockClutch.bookings.confirm).not.toHaveBeenCalled();

    fireEvent.press(await screen.findByLabelText('Release court'));
    expect(cancel).toHaveBeenCalledWith(HELD.id);
    expect(onPickAnotherTime).toHaveBeenCalledWith(null);
  });

  it('says a payment is already open when the sheet answers busy', async () => {
    mockPresent.mockResolvedValue({ status: 'busy' });
    renderCheckout();
    fireEvent.press(await screen.findByText(PAY));
    expect(await screen.findByText(/A payment is already open/)).toBeTruthy();
    expect(mockClutch.bookings.confirm).not.toHaveBeenCalled();
  });

  it('keeps the hold when the intent cannot be created, and retries with the same key', async () => {
    mockClutch.bookings.paymentIntent.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(CHECKOUT);
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_1' });
    mockClutch.bookings.confirm.mockResolvedValue(CONFIRMED);
    const { cancel, onConfirmed } = renderCheckout();

    fireEvent.press(await screen.findByText(PAY));
    expect(await screen.findByText(/No connection/)).toBeTruthy();
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText(PAY));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    const [first, second] = mockClutch.bookings.paymentIntent.mock.calls;
    expect(second[1]?.idempotencyKey).toBe(first[1]?.idempotencyKey);
  });
});

describe('CheckoutStep: after a failed sheet', () => {
  it('asks Clutch about the old intent before paying again (it may have gone through)', async () => {
    mockPresent.mockResolvedValueOnce({ status: 'failed', message: 'Card declined' });
    mockClutch.bookings.confirm.mockResolvedValue(CONFIRMED);
    const { onConfirmed, cancel } = renderCheckout();

    fireEvent.press(await screen.findByText(PAY));
    expect(await screen.findByText(/Card declined/)).toBeTruthy();
    // Money may still be moving: no release offered.
    expect(screen.queryByLabelText('Release court')).toBeNull();

    fireEvent.press(screen.getByText(PAY));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(mockClutch.bookings.confirm).toHaveBeenCalledWith(HELD.id, 'pi_1', expect.anything());
    expect(mockPresent).toHaveBeenCalledTimes(1);
    expect(mockClutch.bookings.paymentIntent).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('presents the SAME intent again when Clutch says it was not paid', async () => {
    mockPresent
      .mockResolvedValueOnce({ status: 'failed', message: 'Card declined' })
      .mockResolvedValueOnce({ status: 'completed', intentId: 'pi_1' });
    mockClutch.bookings.confirm
      .mockRejectedValueOnce(clutchError('payment_failed', 402))
      .mockResolvedValueOnce(CONFIRMED);
    const { onConfirmed } = renderCheckout();

    fireEvent.press(await screen.findByText(PAY));
    await screen.findByText(/Card declined/);
    fireEvent.press(screen.getByText(PAY));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(mockPresent).toHaveBeenCalledTimes(2);
    expect(mockPresent.mock.calls[1][0]).toEqual(mockPresent.mock.calls[0][0]);
    expect(mockClutch.bookings.paymentIntent).toHaveBeenCalledTimes(1);
  });
});

describe('CheckoutStep: confirm failures always reach an outcome', () => {
  beforeEach(() => mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_1' }));

  it('re-checks a clearing payment with a fresh key and never pays twice', async () => {
    mockClutch.bookings.confirm
      .mockRejectedValueOnce(clutchError('payment_processing', 409))
      .mockResolvedValueOnce(CONFIRMED);
    const { onConfirmed, holdSession } = renderCheckout();

    fireEvent.press(await screen.findByText(PAY));
    expect(await screen.findByText('Your payment is clearing')).toBeTruthy();
    expect(holdSession.paymentLocked).toBe(true);
    expect(screen.queryByText(PAY)).toBeNull();
    expect(screen.queryByLabelText('Release court')).toBeNull();

    fireEvent.press(screen.getByText('Check again'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(mockPresent).toHaveBeenCalledTimes(1);
    expect(mockClutch.bookings.paymentIntent).toHaveBeenCalledTimes(1);
    const [first, second] = mockClutch.bookings.confirm.mock.calls;
    expect(second[1]).toBe('pi_1');
    expect(second[2]?.idempotencyKey).not.toBe(first[2]?.idempotencyKey);
  });

  it('re-reads the booking after a network failure and shows it confirmed', async () => {
    mockClutch.bookings.confirm.mockRejectedValue(networkError());
    mockClutch.bookings.get.mockResolvedValue(makeBookingDetail({ status: 'confirmed' }));
    const { onConfirmed } = renderCheckout();
    fireEvent.press(await screen.findByText(PAY));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(mockClutch.bookings.get).toHaveBeenCalledWith(HELD.id);
  });

  it('stays locked on "check again" after a 5xx while the booking is still held, with a fresh key next time', async () => {
    mockClutch.bookings.confirm
      .mockRejectedValueOnce(clutchError('internal_error', 500))
      .mockResolvedValueOnce(CONFIRMED);
    mockClutch.bookings.get.mockResolvedValue(
      makeBookingDetail({ status: 'pending', hold_expires_at: '2099-01-01T00:15:00.000Z' }),
    );
    const { onConfirmed, holdSession } = renderCheckout();
    fireEvent.press(await screen.findByText(PAY));
    expect(await screen.findByText('Check again')).toBeTruthy();
    expect(holdSession.paymentLocked).toBe(true);
    fireEvent.press(screen.getByText('Check again'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    const [first, second] = mockClutch.bookings.confirm.mock.calls;
    expect(second[2]?.idempotencyKey).not.toBe(first[2]?.idempotencyKey);
  });

  it('ends at "hold ended" when the booking is gone', async () => {
    mockClutch.bookings.confirm.mockRejectedValue(clutchError('booking_not_found', 404));
    mockClutch.bookings.get.mockRejectedValue(clutchError('booking_not_found', 404));
    const { onPickAnotherTime } = renderCheckout();
    fireEvent.press(await screen.findByText(PAY));
    fireEvent.press(await screen.findByText('Pick another time'));
    expect(onPickAnotherTime).toHaveBeenCalledWith(expect.stringContaining('no longer held'));
  });

  it('ends a returned payment by showing what Clutch says, and lets the member pay afresh', async () => {
    mockClutch.bookings.confirm.mockRejectedValue(clutchError('payment_returned', 409, { reason: 'x' }));
    mockClutch.bookings.get.mockResolvedValue(
      makeBookingDetail({ status: 'pending', hold_expires_at: '2099-01-01T00:15:00.000Z' }),
    );
    renderCheckout();
    fireEvent.press(await screen.findByText(PAY));
    expect(await screen.findByText(/Payment returned/)).toBeTruthy();
    expect(screen.getByText(PAY)).toBeTruthy();
  });

  it('lets the member leave a clearing payment for the booking screen', async () => {
    mockClutch.bookings.confirm.mockRejectedValue(clutchError('payment_not_verified', 402));
    const { onLeaveToBooking } = renderCheckout();
    fireEvent.press(await screen.findByText(PAY));
    fireEvent.press(await screen.findByText('Leave and check later'));
    expect(onLeaveToBooking).toHaveBeenCalledWith(HELD.id);
  });
});
