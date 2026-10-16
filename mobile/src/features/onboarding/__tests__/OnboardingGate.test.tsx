import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { makeMe } from '../../../lib/clutch/fixtures';
import { renderWithProviders } from '../../account/__tests__/render-account';
import { OnboardingEntry } from '../OnboardingGate';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

jest.mock('expo-router', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <RNText>{`redirect:${href}`}</RNText>,
    Stack: () => null,
    usePathname: () => '/',
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  };
});

const mockSignOut = jest.fn(async () => undefined);
jest.mock('../../../lib/session', () => ({
  useSession: () => ({ status: 'authenticated', userId: 'u1', signOut: mockSignOut }),
}));

const noMembership = makeMe({ memberships: [] });

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.club.join.mockResolvedValue({ joined: true });
  mockClutch.membership.get.mockResolvedValue({ membership: { role: 'player' }, subscription: null });
});

describe('OnboardingEntry', () => {
  it('joins the club, re-reads /me, and only then routes by the membership it shows', async () => {
    mockClutch.me.get.mockResolvedValueOnce(noMembership).mockResolvedValue(makeMe());

    renderWithProviders(<OnboardingEntry />);

    expect(await screen.findByText('redirect:/onboarding/plan')).toBeTruthy();
    expect(mockClutch.club.join).toHaveBeenCalledTimes(1);
    expect(mockClutch.me.get).toHaveBeenCalledTimes(2);
  });

  it('shows an error with retry, never the tier step, when /me still lists no membership after joining', async () => {
    mockClutch.me.get.mockResolvedValue(noMembership);
    mockClutch.club.join.mockResolvedValue({ joined: false });

    renderWithProviders(<OnboardingEntry />);

    expect(await screen.findByText('We could not set up your membership')).toBeTruthy();
    expect(screen.queryByText('redirect:/onboarding/plan')).toBeNull();

    fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(mockClutch.club.join).toHaveBeenCalledTimes(2));
  });

  it('sends staff straight to the app without a tier', async () => {
    const base = makeMe();
    mockClutch.me.get.mockResolvedValue({ ...base, memberships: [{ ...base.memberships[0], role: 'admin' }] });

    renderWithProviders(<OnboardingEntry />);

    expect(await screen.findByText('redirect:/(tabs)')).toBeTruthy();
    expect(mockClutch.membership.get).not.toHaveBeenCalled();
    expect(mockClutch.club.join).not.toHaveBeenCalled();
  });
});
