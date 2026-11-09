import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { networkError } from '../../../lib/clutch/testing';
import {
  makeBillingMembership,
  makeMe,
  makeProfile,
  makeStandingMembership,
  makeSubscription,
  makeWaiver,
  TIER_ID,
} from '../../../lib/clutch/fixtures';
import { renderWithProviders } from '../../account/__tests__/render-account';
import { OnboardingEntry } from '../OnboardingGate';
import type { Capabilities } from '../../../lib/clutch/capabilities';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <RNText>{`redirect:${href}`}</RNText>,
    Stack: () => null,
    usePathname: () => '/',
    useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  };
});

const mockSignOut = jest.fn(async () => undefined);
jest.mock('../../../lib/session', () => ({
  useSession: () => ({ status: 'authenticated', userId: 'u1', signOut: mockSignOut }),
}));

const noMembership = makeMe({ memberships: [] });
const NO_TIER = makeStandingMembership({
  membership: { role: 'player', skill_level: null, status: 'active', tier: null },
  subscription: null,
});
const SUSPENDED = makeStandingMembership({
  membership: { role: 'player', skill_level: null, status: 'suspended', tier: { id: TIER_ID, name: 'Member' } },
  subscription: makeSubscription({ status: 'suspended' }),
});

beforeEach(() => {
  jest.clearAllMocks();
  (mockClutch.capabilities as Capabilities).nativePayments = false;
  mockClutch.club.join.mockResolvedValue({ joined: true, status: 'active', role: 'player' });
  mockClutch.membership.get.mockResolvedValue(NO_TIER);
  mockClutch.me.unregisterDevice.mockResolvedValue({ removed: true });
  mockClutch.me.waivers.mockResolvedValue([]);
});

describe('OnboardingEntry', () => {
  it('asks for a name when the Clutch profile has none, saves it, then moves on', async () => {
    const unnamed = makeMe({ profile: makeProfile({ full_name: '' }) });
    mockClutch.me.get.mockResolvedValueOnce(unnamed).mockResolvedValue(makeMe());
    mockClutch.me.updateProfile.mockResolvedValue(makeProfile());

    renderWithProviders(<OnboardingEntry />);

    fireEvent.changeText(await screen.findByLabelText('Your name'), '  Alex Morgan ');
    fireEvent.press(screen.getByLabelText('Continue'));

    expect(await screen.findByText('redirect:/onboarding/plan')).toBeTruthy();
    expect(mockClutch.me.updateProfile).toHaveBeenCalledWith(
      { full_name: 'Alex Morgan' },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('joins the club, re-reads, and only then routes by the membership Clutch shows', async () => {
    mockClutch.me.get.mockResolvedValueOnce(noMembership).mockResolvedValue(makeMe());

    renderWithProviders(<OnboardingEntry />);

    expect(await screen.findByText('redirect:/onboarding/plan')).toBeTruthy();
    expect(mockClutch.club.join).toHaveBeenCalledTimes(1);
    expect(mockClutch.me.get).toHaveBeenCalledTimes(2);
  });

  it('shows an error with retry and sign-out, never the tier step, when /me still lists no membership', async () => {
    mockClutch.me.get.mockResolvedValue(noMembership);
    mockClutch.club.join.mockResolvedValue({ joined: false, status: 'active', role: 'player' });

    renderWithProviders(<OnboardingEntry />);

    expect(await screen.findByText('We could not set up your membership')).toBeTruthy();
    expect(screen.queryByText('redirect:/onboarding/plan')).toBeNull();

    fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(mockClutch.club.join).toHaveBeenCalledTimes(2));
  });

  it('offers sign-out on the load error screen', async () => {
    mockClutch.me.get.mockRejectedValue(networkError());

    renderWithProviders(<OnboardingEntry />);

    fireEvent.press(await screen.findByLabelText('Sign out'));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it('sends an entitled member to the app', async () => {
    mockClutch.me.get.mockResolvedValue(makeMe());
    mockClutch.membership.get.mockResolvedValue(makeStandingMembership());

    renderWithProviders(<OnboardingEntry />);

    expect(await screen.findByText('redirect:/(tabs)')).toBeTruthy();
    expect(mockClutch.club.join).not.toHaveBeenCalled();
  });

  it("asks a member for the club's required waiver, signs it in the app, then lets them in", async () => {
    mockClutch.me.get.mockResolvedValue(makeMe());
    mockClutch.membership.get.mockResolvedValue(makeStandingMembership());
    let signed = false;
    mockClutch.me.waivers.mockImplementation(async () => [
      makeWaiver(signed ? { signed: true, signed_at: '2026-11-01T12:00:00Z' } : {}),
    ]);
    mockClutch.me.signWaiver.mockImplementation(async () => {
      signed = true;
      return { id: 'sig-1', waiver_id: 'waiver-1', signed_at: '2026-11-01T12:00:00Z', signer_name: null };
    });

    renderWithProviders(<OnboardingEntry />);

    expect(await screen.findByText('Facility Liability Waiver')).toBeTruthy();
    expect(screen.queryByText('redirect:/(tabs)')).toBeNull();
    fireEvent.press(screen.getByLabelText('Sign waiver'));
    expect(mockClutch.me.signWaiver).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('I have read the waiver and agree to it'));
    fireEvent.press(screen.getByLabelText('Sign waiver'));

    expect(await screen.findByText('redirect:/(tabs)')).toBeTruthy();
    expect(mockClutch.me.signWaiver).toHaveBeenCalledTimes(1);
    expect(mockClutch.me.signWaiver.mock.calls[0][0]).toBe('waiver-1');
  });

  it('never holds a member on a waiver they signed, or one the club does not require', async () => {
    mockClutch.me.get.mockResolvedValue(makeMe());
    mockClutch.membership.get.mockResolvedValue(makeStandingMembership());
    mockClutch.me.waivers.mockResolvedValue([
      makeWaiver({ id: 'w-signed', signed: true, signed_at: '2026-10-01T12:00:00Z', frequency: 'every_time' }),
      makeWaiver({ id: 'w-optional', is_required: false }),
    ]);

    renderWithProviders(<OnboardingEntry />);

    expect(await screen.findByText('redirect:/(tabs)')).toBeTruthy();
  });

  it('never lets a lapsed member in: its own screen, honest copy, sign-out', async () => {
    mockClutch.me.get.mockResolvedValue(makeMe());
    mockClutch.membership.get.mockResolvedValue(SUSPENDED);

    renderWithProviders(<OnboardingEntry />);

    expect(await screen.findByText('Your club membership is not active')).toBeTruthy();
    expect(screen.queryByText('redirect:/(tabs)')).toBeNull();
    expect(screen.getByText(/not available in the app yet/)).toBeTruthy();
    expect(screen.queryByLabelText('Renew membership')).toBeNull();
    fireEvent.press(screen.getByLabelText('Sign out'));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it('lets a member whose billing lapsed renew through the tier step when paying is available', async () => {
    (mockClutch.capabilities as Capabilities).nativePayments = true;
    const base = makeBillingMembership();
    if (base.kind !== 'billing') throw new Error('fixture');
    mockClutch.me.get.mockResolvedValue(makeMe());
    mockClutch.membership.get.mockResolvedValue(
      makeBillingMembership({ billing: { ...base.data.billing, subscription_status: 'canceled', entitled: false } }),
    );

    renderWithProviders(<OnboardingEntry />);

    fireEvent.press(await screen.findByLabelText('Renew membership'));
    expect(mockPush).toHaveBeenCalledWith('/onboarding/plan');
  });
});
