import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { TEST_CLUB_ID } from '../../../lib/clutch/testing';
import { makeClub, makeSubscription } from '../../../lib/clutch/fixtures';
import type { PaymentHistoryItem } from '../../../lib/clutch';
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

function payment(id: string, over: Partial<PaymentHistoryItem> = {}): PaymentHistoryItem {
  return {
    id,
    club_id: TEST_CLUB_ID,
    amount_cents: 3000,
    currency: 'USD',
    payment_type: 'booking',
    payment_method: 'stripe',
    status: 'succeeded',
    reference_id: null,
    description: null,
    created_at: '2026-10-10T15:00:00.000Z',
    refunded_amount_cents: 0,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.club.verify.mockResolvedValue(makeClub());
  mockClutch.membership.get.mockResolvedValue({ membership: { role: 'player' }, subscription: makeSubscription() });
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
});
