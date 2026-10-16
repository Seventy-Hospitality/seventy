import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import {
  makeBillingMembership,
  makeMembershipConfirm,
  makeSubscribeResult,
  makeTier,
} from '../../../lib/clutch/fixtures';
import { asTierId } from '../../../lib/clutch';
import type { SheetResult } from '../../../lib/stripe';
import { renderWithProviders } from '../../account/__tests__/render-account';
import { CheckoutScreen, resolveCheckoutTier } from '../CheckoutScreen';
import { TERMS_VERSION } from '../onboarding';
import type { Capabilities } from '../../../lib/clutch/capabilities';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ tier: '70000000-0000-4000-8000-000000000001' }),
  Redirect: () => null,
}));

const mockPresent = jest.fn<Promise<SheetResult>, unknown[]>();
jest.mock('../../../lib/stripe', () => ({
  usePresentConnectedSheet: () => mockPresent,
  usePaymentsConfigured: () => true,
}));

const TIER = makeTier();
const BASE = makeBillingMembership();
if (BASE.kind !== 'billing') throw new Error('fixture');
const NO_TIER = makeBillingMembership({
  tier: null,
  billing: { ...BASE.data.billing, has_subscription: false, subscription_status: null, entitled: false },
});

async function confirmMembership() {
  fireEvent.press(await screen.findByLabelText('I agree to the Terms of Service and Privacy Policy'));
  fireEvent.press(screen.getByLabelText('Confirm membership'));
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockClutch.capabilities as Capabilities).nativePayments = true;
  mockClutch.club.tiers.mockResolvedValue({ tiers: [TIER], subscription: null });
  mockClutch.membership.get.mockResolvedValue(NO_TIER);
  mockClutch.membership.confirm.mockResolvedValue(makeMembershipConfirm());
});

describe('CheckoutScreen', () => {
  it('pays through the connected sheet, then lets Clutch confirm decide', async () => {
    mockClutch.membership.subscribe.mockResolvedValue(makeSubscribeResult());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_sub' });

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
    expect(mockClutch.membership.subscribe).toHaveBeenCalledWith(
      TIER.id,
      TERMS_VERSION,
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(mockPresent).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'stripe',
        clientSecret: 'pi_sub_secret_abc',
        stripeAccount: 'acct_club',
        customer: { id: 'cus_123', ephemeralKeySecret: 'ek_123' },
      }),
      expect.anything(),
    );
    expect(mockClutch.membership.confirm).toHaveBeenCalledTimes(1);
  });

  it('never claims success when confirm says the payment is still pending', async () => {
    mockClutch.membership.subscribe.mockResolvedValue(makeSubscribeResult());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_sub' });
    mockClutch.membership.confirm.mockResolvedValue(
      makeMembershipConfirm({ activated: false, payment_status: 'pending' }),
    );

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    expect(await screen.findByText('Your payment is processing')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows no sheet in simulated mode and still asks Clutch', async () => {
    mockClutch.membership.subscribe.mockResolvedValue(makeSubscribeResult({ clientSecret: null, simulated: true }));
    mockClutch.membership.confirm.mockResolvedValue(
      makeMembershipConfirm({ activated: false, payment_status: 'none' }),
    );

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    expect(await screen.findByText('Your payment is processing')).toBeTruthy();
    expect(mockPresent).not.toHaveBeenCalled();
    expect(mockClutch.membership.confirm).toHaveBeenCalledTimes(1);
  });

  it('skips the sheet when subscribe says nothing is due', async () => {
    mockClutch.membership.subscribe.mockResolvedValue(makeSubscribeResult({ status: 'active' }));

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('falls back to a membership re-read when confirm cannot answer', async () => {
    mockClutch.membership.subscribe.mockResolvedValue(makeSubscribeResult());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_sub' });
    mockClutch.membership.confirm.mockRejectedValue(networkError());
    mockClutch.membership.get.mockResolvedValueOnce(NO_TIER).mockResolvedValue(BASE);

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
  });

  it('does not confirm when the member dismisses the sheet or a sheet is already up', async () => {
    mockClutch.membership.subscribe.mockResolvedValue(makeSubscribeResult());
    mockPresent.mockResolvedValueOnce({ status: 'canceled' }).mockResolvedValueOnce({ status: 'busy' });

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();
    await waitFor(() => expect(mockPresent).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByLabelText('Confirm membership'));
    await waitFor(() => expect(mockPresent).toHaveBeenCalledTimes(2));

    expect(mockClutch.membership.confirm).not.toHaveBeenCalled();
  });

  it('asks Clutch instead of paying when the member is already subscribed', async () => {
    mockClutch.membership.subscribe.mockRejectedValue(clutchError('already_subscribed'));

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('says paying is not in the app yet, and calls nothing, without native payments', async () => {
    (mockClutch.capabilities as Capabilities).nativePayments = false;

    renderWithProviders(<CheckoutScreen />);

    expect(await screen.findByText(/not available in the app yet/)).toBeTruthy();
    expect(screen.queryByLabelText('Confirm membership')).toBeNull();
    expect(mockClutch.membership.get).not.toHaveBeenCalled();
    expect(mockClutch.membership.subscribe).not.toHaveBeenCalled();
  });
});

describe('resolveCheckoutTier', () => {
  it('takes a listed tier from the param', () => {
    expect(resolveCheckoutTier(TIER.id, [TIER], null)?.id).toBe(TIER.id);
    expect(resolveCheckoutTier('nope', [TIER], null)).toBeNull();
  });

  it('resumes the tier of the pending attempt when there is no param', () => {
    const pending = makeBillingMembership({
      tier: null,
      billing: { ...BASE.data.billing, subscription_status: 'incomplete', entitled: false },
      pending_attempt: { id: 'att_1', tier_id: TIER.id, created_at: null },
    });
    expect(resolveCheckoutTier(null, [TIER], pending)?.id).toBe(TIER.id);
    expect(resolveCheckoutTier(null, [TIER], BASE)).toBeNull();
    const elsewhere = makeBillingMembership({
      pending_attempt: { id: 'att_2', tier_id: asTierId('70000000-0000-4000-8000-000000000009'), created_at: null },
    });
    expect(resolveCheckoutTier(null, [TIER], elsewhere)).toBeNull();
  });
});
