import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { networkError } from '../../../lib/clutch/testing';
import {
  makeBillingMembership,
  makeClub,
  makePayment,
  makeSavedCard,
  makeStandingMembership,
} from '../../../lib/clutch/fixtures';
import { BillingScreen } from '../BillingScreen';
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

function payment(id: string, over: Parameters<typeof makePayment>[0] = {}) {
  return makePayment({ id, description: null, ...over });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.club.verify.mockResolvedValue(makeClub());
  mockClutch.membership.get.mockResolvedValue(makeStandingMembership());
  mockClutch.me.payments.mockResolvedValue({ items: [], count: 0 });
  mockClutch.paymentMethods.list.mockResolvedValue([]);
});

describe('BillingScreen', () => {
  it("shows Clutch's amounts and refunds, and pages through history", async () => {
    mockClutch.me.payments
      .mockResolvedValueOnce({
        items: [payment('a', { description: 'Membership: Member', amount_cents: 9900, refunded_amount_cents: 2500 })],
        count: 2,
      })
      .mockResolvedValueOnce({ items: [payment('b', { status: 'failed' })], count: 2 });

    renderWithProviders(<BillingScreen />);

    expect(await screen.findByText('Membership: Member')).toBeTruthy();
    expect(screen.getByText('$99.00')).toBeTruthy();
    expect(screen.getByText('Refunded $25.00')).toBeTruthy();
    expect(screen.getByText('Renews Nov 15, 2026')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Show more'));
    expect(await screen.findByText('Court booking')).toBeTruthy();
    expect(mockClutch.me.payments).toHaveBeenLastCalledWith({ limit: 20, offset: 1 });
    await waitFor(() => expect(screen.queryByLabelText('Show more')).toBeNull());
  });

  it('shows an empty state with no payments', async () => {
    mockClutch.me.payments.mockResolvedValue({ items: [], count: 0 });
    renderWithProviders(<BillingScreen />);
    expect(await screen.findByText('No payments yet')).toBeTruthy();
  });

  it('says a failed saved-cards read failed (with a retry), never "no card"', async () => {
    mockClutch.paymentMethods.list.mockRejectedValueOnce(networkError()).mockResolvedValue([makeSavedCard()]);
    renderWithProviders(<BillingScreen />);

    expect(await screen.findByText('We could not load your payment method.')).toBeTruthy();
    expect(screen.queryByText('No payment method on file')).toBeNull();
    fireEvent.press(screen.getByLabelText('Try loading your payment method again'));
    expect(await screen.findByText('Visa •••• 4242 · exp 12/30')).toBeTruthy();
  });

  it('shows the P2 billing line, including a booked downgrade', async () => {
    const base = makeBillingMembership();
    if (base.kind !== 'billing') throw new Error('fixture');
    mockClutch.membership.get.mockResolvedValue(
      makeBillingMembership({
        billing: {
          ...base.data.billing,
          pending_tier: { ...base.data.tier!, name: 'Basic' },
          pending_tier_effective_at: '2026-11-20T12:00:00.000Z',
        },
      }),
    );
    renderWithProviders(<BillingScreen />);
    expect(await screen.findByText('Switches to Basic on Nov 20, 2026')).toBeTruthy();
  });
});
