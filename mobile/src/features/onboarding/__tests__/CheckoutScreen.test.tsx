import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makeSubscription, makeTier } from '../../../lib/clutch/fixtures';
import { asTierId, type SubscribeResult } from '../../../lib/clutch';
import type { SheetResult } from '../../../lib/stripe';
import { renderWithProviders } from '../../account/__tests__/render-account';
import { CheckoutScreen, resolveCheckoutTier } from '../CheckoutScreen';
import { TERMS_VERSION } from '../onboarding';

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

function bundle(over: Partial<SubscribeResult> = {}): SubscribeResult {
  return {
    clientSecret: 'pi_123_secret_abc',
    intentType: 'payment',
    customerId: 'cus_1',
    ephemeralKeySecret: 'ek_1',
    stripeAccount: 'acct_club',
    simulated: false,
    attempt_id: 'att_1',
    ...over,
  };
}

async function confirmMembership() {
  fireEvent.press(await screen.findByLabelText('I agree to the Terms of Service and Privacy Policy'));
  fireEvent.press(screen.getByLabelText('Confirm membership'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.club.tiers.mockResolvedValue({ tiers: [TIER], subscription: null });
  mockClutch.membership.get.mockResolvedValue({ membership: { role: 'player' }, subscription: null });
  mockClutch.membership.confirm.mockResolvedValue({ membership: { role: 'player' }, subscription: null });
});

describe('CheckoutScreen', () => {
  it('pays through the connected sheet, confirms with Clutch, and decides from the re-read', async () => {
    mockClutch.membership.subscribe.mockResolvedValue(bundle());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_123' });
    mockClutch.membership.get
      .mockResolvedValueOnce({ membership: { role: 'player' }, subscription: null })
      .mockResolvedValue({
        membership: { role: 'player' },
        subscription: makeSubscription({ subscription_status: 'active' }),
      });

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
    expect(mockClutch.membership.subscribe).toHaveBeenCalledWith(
      TIER.id,
      TERMS_VERSION,
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(mockPresent).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'stripe', clientSecret: 'pi_123_secret_abc', stripeAccount: 'acct_club' }),
      expect.anything(),
    );
    expect(mockClutch.membership.confirm).toHaveBeenCalled();
  });

  it('shows no sheet in simulated mode and waits while Clutch still shows the attempt incomplete', async () => {
    mockClutch.membership.subscribe.mockResolvedValue(bundle({ clientSecret: null, simulated: true }));
    mockClutch.membership.get
      .mockResolvedValueOnce({ membership: { role: 'player' }, subscription: null })
      .mockResolvedValue({
        membership: { role: 'player' },
        subscription: makeSubscription({ subscription_status: 'incomplete', tier_id: TIER.id }),
      });

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    expect(await screen.findByText('Your payment is processing')).toBeTruthy();
    expect(mockPresent).not.toHaveBeenCalled();
    expect(mockClutch.membership.confirm).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not confirm when the member dismisses the sheet', async () => {
    mockClutch.membership.subscribe.mockResolvedValue(bundle());
    mockPresent.mockResolvedValue({ status: 'canceled' });

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    await waitFor(() => expect(mockPresent).toHaveBeenCalled());
    expect(mockClutch.membership.confirm).not.toHaveBeenCalled();
  });

  it('re-reads Clutch instead of paying when a subscription already exists', async () => {
    mockClutch.membership.subscribe.mockRejectedValue(clutchError('subscription_exists'));
    mockClutch.membership.get
      .mockResolvedValueOnce({ membership: { role: 'player' }, subscription: null })
      .mockResolvedValue({ membership: { role: 'player' }, subscription: makeSubscription() });

    renderWithProviders(<CheckoutScreen />);
    await confirmMembership();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
    expect(mockPresent).not.toHaveBeenCalled();
  });
});

describe('resolveCheckoutTier', () => {
  it('takes an active tier from the param', () => {
    expect(resolveCheckoutTier(TIER.id, [TIER], null)?.id).toBe(TIER.id);
    expect(resolveCheckoutTier(TIER.id, [{ ...TIER, is_active: false }], null)).toBeNull();
    expect(resolveCheckoutTier('nope', [TIER], null)).toBeNull();
  });

  it('resumes the tier of an incomplete attempt when there is no param', () => {
    const other = asTierId('70000000-0000-4000-8000-000000000009');
    const sub = makeSubscription({ subscription_status: 'incomplete', tier_id: other, tier_name: 'Pro' });
    expect(resolveCheckoutTier(null, [TIER], sub)).toMatchObject({ id: other, name: 'Pro' });
    expect(resolveCheckoutTier(null, [TIER], makeSubscription())).toBeNull();
  });
});
