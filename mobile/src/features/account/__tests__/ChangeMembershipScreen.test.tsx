import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import {
  makeBillingMembership,
  makeChangeTierResult,
  makeClub,
  makeEligibleChangeTier,
  makeMembershipConfirm,
  makeStandingMembership,
} from '../../../lib/clutch/fixtures';
import { asTierId } from '../../../lib/clutch';
import type { SheetResult } from '../../../lib/stripe';
import { ChangeMembershipScreen, changeSheetIntent } from '../ChangeMembershipScreen';
import { renderWithProviders } from './render-account';
import type { Capabilities } from '../../../lib/clutch/capabilities';

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

const PRO = makeEligibleChangeTier({ name: 'Pro' });
const SOCIAL = makeEligibleChangeTier({
  id: asTierId('70000000-0000-4000-8000-000000000003'),
  name: 'Social',
  price_cents: 4900,
  change_type: 'downgrade',
});

const CURRENT = makeBillingMembership();
if (CURRENT.kind !== 'billing' || !CURRENT.data.tier) throw new Error('fixture');
const BILLING = CURRENT.data.billing;
const MEMBER_TIER = CURRENT.data.tier;
const ON_PRO = makeBillingMembership({ tier: { ...MEMBER_TIER, id: PRO.id, name: 'Pro' } });

beforeEach(() => {
  jest.clearAllMocks();
  (mockClutch.capabilities as Capabilities).nativePayments = true;
  mockClutch.club.verify.mockResolvedValue(makeClub());
  mockClutch.membership.get.mockResolvedValue(CURRENT);
  mockClutch.membership.eligibleChanges.mockResolvedValue([PRO, SOCIAL]);
  mockClutch.membership.confirm.mockResolvedValue(makeMembershipConfirm());
});

async function choose(name: string, action: string) {
  fireEvent.press(await screen.findByText(name));
  fireEvent.press(screen.getByLabelText(action));
}

describe('ChangeMembershipScreen', () => {
  it('pays an upgrade through the sheet, confirms, and reports only what the re-read shows', async () => {
    mockClutch.membership.change.mockResolvedValue(makeChangeTierResult());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_up' });
    mockClutch.membership.get.mockResolvedValueOnce(CURRENT).mockResolvedValue(ON_PRO);

    renderWithProviders(<ChangeMembershipScreen />);
    await choose('Pro', 'Switch now');

    expect(await screen.findByText('You are now on Pro.')).toBeTruthy();
    expect(mockClutch.membership.change).toHaveBeenCalledWith(
      PRO.id,
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(mockPresent).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'stripe', clientSecret: 'pi_up_secret_abc' }),
      expect.anything(),
    );
    expect(mockClutch.membership.confirm).toHaveBeenCalled();
  });

  it('says the switch is still settling while Clutch shows the old tier', async () => {
    mockClutch.membership.change.mockResolvedValue(makeChangeTierResult());
    mockPresent.mockResolvedValue({ status: 'completed', intentId: 'pi_up' });

    renderWithProviders(<ChangeMembershipScreen />);
    await choose('Pro', 'Switch now');

    expect(await screen.findByText('Your switch is being confirmed')).toBeTruthy();
  });

  it('schedules a downgrade at the date Clutch gives', async () => {
    mockClutch.membership.change.mockResolvedValue(
      makeChangeTierResult({ kind: 'downgrade_scheduled', status: 'active', effective_at: '2026-11-16T12:00:00.000Z' }),
    );

    renderWithProviders(<ChangeMembershipScreen />);
    await choose('Social', 'Schedule switch');

    expect(await screen.findByText('Switch to Social scheduled for Nov 16, 2026.')).toBeTruthy();
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('cancels a booked downgrade by naming the current tier', async () => {
    mockClutch.membership.get.mockResolvedValue(
      makeBillingMembership({
        billing: { ...BILLING, pending_tier: { ...MEMBER_TIER, id: SOCIAL.id, name: 'Social' }, pending_tier_effective_at: '2026-11-16T12:00:00.000Z' },
      }),
    );
    mockClutch.membership.change.mockResolvedValue(
      makeChangeTierResult({ kind: 'downgrade_cancelled', status: 'active', clientSecret: null }),
    );

    renderWithProviders(<ChangeMembershipScreen />);
    fireEvent.press(await screen.findByLabelText('Keep Member'));

    expect(await screen.findByText('The switch is off. You keep Member.')).toBeTruthy();
    expect(mockClutch.membership.change).toHaveBeenCalledWith(MEMBER_TIER.id, expect.anything());
  });

  it("explains Clutch's P2 refusals by code", async () => {
    mockClutch.membership.change.mockRejectedValue(clutchError('tier_interval_mismatch'));

    renderWithProviders(<ChangeMembershipScreen />);
    await choose('Pro', 'Switch now');

    expect(
      await screen.findByText('You can only switch to a membership billed on the same schedule as yours.'),
    ).toBeTruthy();
  });

  it('offers resume, not cancel, when the membership is set to end', async () => {
    mockClutch.membership.get.mockResolvedValue(makeBillingMembership({ billing: { ...BILLING, cancel_at_period_end: true } }));
    mockClutch.membership.resume.mockResolvedValue({ cancel_at_period_end: false, membership: makeMembershipConfirm().membership });

    renderWithProviders(<ChangeMembershipScreen />);
    fireEvent.press(await screen.findByLabelText('Resume membership'));

    await waitFor(() => expect(mockClutch.membership.resume).toHaveBeenCalled());
    expect(screen.queryByLabelText('Cancel membership')).toBeNull();
  });

  it('shows the plan and says changes are not in the app yet without native payments', async () => {
    (mockClutch.capabilities as Capabilities).nativePayments = false;
    mockClutch.membership.get.mockResolvedValue(makeStandingMembership());

    renderWithProviders(<ChangeMembershipScreen />);

    expect(await screen.findByText('Member')).toBeTruthy();
    expect(screen.getByText(/not available in the app yet/)).toBeTruthy();
    expect(screen.queryByLabelText('Cancel membership')).toBeNull();
    expect(mockClutch.membership.eligibleChanges).not.toHaveBeenCalled();
  });
});

describe('changeSheetIntent', () => {
  it('builds a sheet only for an upgrade that waits on payment', () => {
    expect(changeSheetIntent(makeChangeTierResult())).toMatchObject({ mode: 'stripe', intentType: 'payment' });
    expect(changeSheetIntent(makeChangeTierResult({ status: 'active' }))).toBeNull();
    expect(changeSheetIntent(makeChangeTierResult({ kind: 'downgrade_scheduled', status: 'active' }))).toBeNull();
    expect(changeSheetIntent(makeChangeTierResult({ simulated: true, clientSecret: null }))).toMatchObject({
      mode: 'simulated',
    });
  });
});
