import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { makeClub, makeSubscription } from '../../../lib/clutch/fixtures';
import { asTierId, type ChangeTierResult, type EligibleChangeTier } from '../../../lib/clutch';
import type { SheetResult } from '../../../lib/stripe';
import { ChangeMembershipScreen, changeSheetIntent } from '../ChangeMembershipScreen';
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

const mockPresent = jest.fn<Promise<SheetResult>, unknown[]>();
jest.mock('../../../lib/stripe', () => ({
  usePresentConnectedSheet: () => mockPresent,
  usePaymentsConfigured: () => true,
}));

const MEMBER = asTierId('70000000-0000-4000-8000-000000000001');
const PRO: EligibleChangeTier = {
  id: asTierId('70000000-0000-4000-8000-000000000002'),
  name: 'Pro',
  description: null,
  price_cents: 19900,
  currency: 'USD',
  interval: 'monthly',
  changeType: 'upgrade',
};
const SOCIAL: EligibleChangeTier = { ...PRO, id: asTierId('70000000-0000-4000-8000-000000000003'), name: 'Social', price_cents: 4900, changeType: 'downgrade' };

const current = makeSubscription({ tier_id: MEMBER, subscription_status: 'active' });

function upgraded(over: Partial<ChangeTierResult> = {}): ChangeTierResult {
  return {
    kind: 'upgraded',
    clientSecret: 'pi_7_secret_y',
    effectiveAt: null,
    intentType: 'payment',
    customerId: 'cus_1',
    ephemeralKeySecret: 'ek_1',
    stripeAccount: 'acct_club',
    simulated: false,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.club.verify.mockResolvedValue(makeClub());
  mockClutch.membership.get.mockResolvedValue({ membership: { role: 'player' }, subscription: current });
  mockClutch.membership.eligibleChanges.mockResolvedValue([PRO, SOCIAL]);
  mockClutch.membership.confirm.mockResolvedValue({ membership: { role: 'player' }, subscription: current });
  mockClutch.membership.cancel.mockResolvedValue(null);
});

describe('ChangeMembershipScreen', () => {
  it('upgrades: pays the prorated invoice in a sheet, confirms, and trusts only the re-read', async () => {
    mockClutch.membership.change.mockResolvedValue(upgraded());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_7' });

    renderWithProviders(<ChangeMembershipScreen />);
    fireEvent.press(await screen.findByLabelText(/^Pro,/));
    // Clutch has not applied it yet: the screen waits instead of claiming success.
    fireEvent.press(screen.getByLabelText('Switch now'));

    expect(await screen.findByText('Your switch is being confirmed')).toBeTruthy();
    expect(mockPresent).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'stripe', clientSecret: 'pi_7_secret_y', stripeAccount: 'acct_club' }),
      expect.anything(),
    );
    expect(mockClutch.membership.confirm).toHaveBeenCalledTimes(1);

    mockClutch.membership.get.mockResolvedValue({
      membership: { role: 'player' },
      subscription: makeSubscription({ tier_id: PRO.id, tier_name: 'Pro' }),
    });
    fireEvent.press(screen.getByLabelText('Check again'));
    expect(await screen.findByText('You are now on Pro.')).toBeTruthy();
    expect(mockClutch.membership.confirm).toHaveBeenCalledTimes(2);
  });

  it('schedules a downgrade without a sheet or a confirm', async () => {
    mockClutch.membership.change.mockResolvedValue({
      kind: 'downgrade_scheduled',
      clientSecret: null,
      effectiveAt: '2026-11-16T17:00:00.000Z',
    });

    renderWithProviders(<ChangeMembershipScreen />);
    fireEvent.press(await screen.findByLabelText(/^Social,/));
    fireEvent.press(screen.getByLabelText('Schedule switch'));

    expect(await screen.findByText('Switch to Social scheduled for Nov 16, 2026.')).toBeTruthy();
    expect(mockPresent).not.toHaveBeenCalled();
    expect(mockClutch.membership.confirm).not.toHaveBeenCalled();
  });

  it('cancels at period end by default and re-reads the membership', async () => {
    renderWithProviders(<ChangeMembershipScreen />);
    fireEvent.press(await screen.findByLabelText('Cancel membership'));
    const buttons = await screen.findAllByLabelText('Cancel membership');
    fireEvent.press(buttons[buttons.length - 1]);

    await waitFor(() =>
      expect(mockClutch.membership.cancel).toHaveBeenCalledWith(
        'period_end',
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
    await waitFor(() => expect(mockClutch.membership.get.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('changeSheetIntent', () => {
  it('builds a stripe intent from the bundle fields of an upgrade', () => {
    expect(changeSheetIntent(upgraded())).toMatchObject({ mode: 'stripe', intentType: 'payment' });
  });

  it('builds a simulated intent (no sheet) in simulated mode, and none when nothing is owed', () => {
    expect(changeSheetIntent(upgraded({ clientSecret: null, simulated: true }))).toMatchObject({ mode: 'simulated' });
    expect(changeSheetIntent(upgraded({ clientSecret: null, simulated: false }))).toBeNull();
    expect(changeSheetIntent({ kind: 'downgrade_scheduled', clientSecret: null, effectiveAt: null })).toBeNull();
  });
});
