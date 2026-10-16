import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { makeTier } from '../../../lib/clutch/fixtures';
import { renderWithProviders } from '../../account/__tests__/render-account';
import { ChoosePlanScreen } from '../ChoosePlanScreen';
import type { Capabilities } from '../../../lib/clutch/capabilities';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('../../../lib/session', () => ({
  useSession: () => ({ status: 'authenticated', userId: 'u1', signOut: jest.fn(async () => undefined) }),
}));

const TIER = makeTier({ discount_percent: 10 });

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.club.tiers.mockResolvedValue({ tiers: [TIER], subscription: null });
});

describe('ChoosePlanScreen', () => {
  it("shows Clutch's tiers and continues to checkout when paying is available", async () => {
    (mockClutch.capabilities as Capabilities).nativePayments = true;
    renderWithProviders(<ChoosePlanScreen />);

    expect(await screen.findByText('10% off court bookings')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Continue'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/onboarding/checkout', params: { tier: TIER.id } });
  });

  it('shows the tiers but says paying is not in the app yet, and how to join meanwhile', async () => {
    (mockClutch.capabilities as Capabilities).nativePayments = false;
    renderWithProviders(<ChoosePlanScreen />);

    expect(await screen.findByText('Member')).toBeTruthy();
    expect(screen.queryByLabelText('Continue')).toBeNull();
    expect(screen.getByText(/front desk/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Check again'));
    await waitFor(() => expect(mockPush).not.toHaveBeenCalled());
  });
});
