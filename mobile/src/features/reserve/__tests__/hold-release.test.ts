import { asBookingId, asUserId, CAPABILITIES, clutch, snakeCheckoutToSheet } from '../../../lib/clutch';
import { clutchError, type MockClutch } from '../../../lib/clutch/testing';
import { ME_ID, makeBookingDetail, makeShareCheckout } from '../../../lib/clutch/fixtures';
import { releaseHoldIfPending } from '../hold-release';
import { paymentLedger } from '../payment-ledger';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});

const mockClutch = clutch as unknown as MockClutch;
const ID = asBookingId('b0000000-0000-4000-8000-000000000001');
const USER = asUserId(ME_ID);

function submit(state: 'submitted' | 'sheet_failed' | 'ready') {
  const checkout = makeShareCheckout();
  paymentLedger.put({
    userId: USER,
    bookingId: ID,
    purpose: 'booking',
    variant: '',
    sheet: snakeCheckoutToSheet(checkout),
    intentId: checkout.payment_intent_id,
    charge: { kind: 'unknown', currency: 'USD', price_cents: 3000 },
    expiresAt: null,
    state,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  paymentLedger.resetForTests();
  mockClutch.capabilities = { ...CAPABILITIES, bookingParity: false };
});

function actions() {
  return { cancel: jest.fn().mockResolvedValue(undefined), release: jest.fn().mockResolvedValue(undefined) };
}

describe('releaseHoldIfPending with P4', () => {
  beforeEach(() => {
    mockClutch.capabilities = { ...CAPABILITIES, bookingParity: true };
  });

  it("uses the pending-only release, never cancel or a read", async () => {
    const a = actions();
    await expect(releaseHoldIfPending(ID, USER, a)).resolves.toBe('released');
    expect(a.release).toHaveBeenCalledWith(ID);
    expect(a.cancel).not.toHaveBeenCalled();
    expect(mockClutch.bookings.get).not.toHaveBeenCalled();
  });

  it('treats booking_not_pending (confirmed meanwhile) as kept, not an error', async () => {
    const a = actions();
    a.release.mockRejectedValue(clutchError('booking_not_pending', 409, { status: 'confirmed' }));
    await expect(releaseHoldIfPending(ID, USER, a)).resolves.toBe('kept');
  });

  it('does not release while a payment is in flight', async () => {
    submit('submitted');
    const a = actions();
    await expect(releaseHoldIfPending(ID, USER, a)).resolves.toBe('kept');
    expect(a.release).not.toHaveBeenCalled();
  });
});

describe('releaseHoldIfPending without P4 (read-then-cancel)', () => {
  it('cancels only after a fresh read says the booking is still a pending hold', async () => {
    mockClutch.bookings.get.mockResolvedValue(makeBookingDetail({ status: 'pending' }));
    const a = actions();
    await expect(releaseHoldIfPending(ID, USER, a)).resolves.toBe('released');
    expect(mockClutch.bookings.get).toHaveBeenCalledWith(ID);
    expect(a.cancel).toHaveBeenCalledWith(ID);
    expect(a.release).not.toHaveBeenCalled();
  });

  it('never cancels a booking the read shows confirmed', async () => {
    mockClutch.bookings.get.mockResolvedValue(makeBookingDetail({ status: 'confirmed' }));
    const a = actions();
    await expect(releaseHoldIfPending(ID, USER, a)).resolves.toBe('kept');
    expect(a.cancel).not.toHaveBeenCalled();
  });

  it.each(['submitted', 'sheet_failed'] as const)('keeps the hold while a payment is %s', async (state) => {
    submit(state);
    const a = actions();
    await expect(releaseHoldIfPending(ID, USER, a)).resolves.toBe('kept');
    expect(mockClutch.bookings.get).not.toHaveBeenCalled();
    expect(a.cancel).not.toHaveBeenCalled();
  });

  it('releases a hold whose sheet was only closed, and forgets its intent', async () => {
    submit('ready');
    mockClutch.bookings.get.mockResolvedValue(makeBookingDetail({ status: 'pending' }));
    const a = actions();
    await expect(releaseHoldIfPending(ID, USER, a)).resolves.toBe('released');
    expect(paymentLedger.get({ userId: USER, bookingId: ID, purpose: 'booking' })).toBeNull();
  });

  it('does not cancel when the read fails', async () => {
    mockClutch.bookings.get.mockRejectedValue(new Error('offline'));
    const a = actions();
    await expect(releaseHoldIfPending(ID, USER, a)).rejects.toThrow('offline');
    expect(a.cancel).not.toHaveBeenCalled();
  });
});
