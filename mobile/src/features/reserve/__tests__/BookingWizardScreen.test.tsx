import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CAPABILITIES, clutch, type MembershipView } from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import {
  makeBillingMembership,
  makeBookingRules,
  makeClub,
  makeCourtTypeRules,
  makeStandingMembership,
} from '../../../lib/clutch/fixtures';
import { ToastProvider } from '../../../components';
import { BookingWizardScreen } from '../BookingWizardScreen';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
jest.mock('../../../lib/session', () => ({ useSession: () => ({ userId: null }) }));
jest.mock('../../../lib/stripe', () => ({
  usePaymentsConfigured: () => true,
  usePresentConnectedSheet: () => jest.fn(),
}));
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockClutch = clutch as unknown as MockClutch;

function renderWizard(membership: MembershipView) {
  mockClutch.club.verify.mockResolvedValue(makeClub());
  mockClutch.club.availability.mockResolvedValue([]);
  mockClutch.membership.get.mockResolvedValue(membership);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}
    >
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  render(<BookingWizardScreen sport="badminton" />, { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.capabilities = { ...CAPABILITIES, bookingParity: false };
});

describe('BookingWizardScreen entitlement gate', () => {
  it('lets an entitled member pick a time', async () => {
    renderWizard(makeStandingMembership());
    expect(await screen.findByText('Select date')).toBeTruthy();
  });

  it.each([
    ['no membership', makeStandingMembership({ membership: null, subscription: null }), 'Join the club to book', 'Choose a membership'],
    [
      'no tier',
      makeStandingMembership({ membership: { role: 'player', skill_level: null, status: 'active', tier: null } }),
      'Choose a membership tier',
      'Choose a tier',
    ],
    [
      'lapsed',
      makeStandingMembership({
        membership: { role: 'player', skill_level: null, status: 'suspended', tier: { id: '70000000-0000-4000-8000-000000000001', name: 'Member' } },
      }),
      'Your membership is not active',
      'Check billing',
    ],
    [
      'payment pending',
      makeBillingMembership({
        tier: null,
        billing: {
          has_subscription: true,
          subscription_status: 'incomplete',
          entitled: false,
          current_period_end: null,
          cancel_at_period_end: false,
          pending_tier: null,
          pending_tier_effective_at: null,
        },
      }),
      'Your membership payment is not finished',
      'Finish payment',
    ],
  ])('stops a member with %s, with honest copy and a way to fix it', async (_case, view, title, action) => {
    renderWizard(view as MembershipView);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText(action)).toBeTruthy();
    expect(screen.queryByText('Select date')).toBeNull();
  });

  it("with P4, stops a member whose tier may not book this sport", async () => {
    mockClutch.capabilities = { ...CAPABILITIES, bookingParity: true };
    mockClutch.club.bookingRules.mockResolvedValue(
      makeBookingRules({ court_types: [makeCourtTypeRules({ bookable_by_viewer: false, refusal: 'tier_required' })] }),
    );
    renderWizard(makeStandingMembership());
    expect(await screen.findByText('Membership tier needed')).toBeTruthy();
  });
});
