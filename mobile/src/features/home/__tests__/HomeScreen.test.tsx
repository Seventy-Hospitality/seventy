import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { asCourtId, InvitationAnswerSchema } from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import {
  makeAnnouncement,
  makeBooking,
  makeBookingInvitation,
  makeClub,
  makeCourt,
  makeGroupInvitation,
  makeHome,
  makeProfile,
  makeStandingMembership,
  TIER_ID,
} from '../../../lib/clutch/fixtures';
import { ToastProvider } from '../../../components';
import { HomeScreen } from '../HomeScreen';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;
const REAL_CAPABILITIES = { ...mockClutch.capabilities };

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

const home = (over: Parameters<typeof makeHome>[0] = {}) =>
  makeHome({ profile: makeProfile({ full_name: 'Alice Chen' }), ...over });

const invitation = makeBookingInvitation({
  booking_id: 'b0000000-0000-4000-8000-000000000009',
  court_name: 'Court 2',
  inviter_name: 'Sarah Lee',
});

const groupInvitation = makeGroupInvitation({ group_name: 'Night Owls' });

function renderHome() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  return { client, ...render(<HomeScreen />, { wrapper }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.capabilities = { ...REAL_CAPABILITIES };
  mockClutch.me.home.mockResolvedValue(home());
  mockClutch.me.bookingInvitations.mockResolvedValue([]);
  mockClutch.groups.invitations.mockResolvedValue([]);
  mockClutch.membership.get.mockResolvedValue(
    makeStandingMembership({
      membership: { role: 'player', skill_level: null, status: 'active', tier: { id: TIER_ID, name: 'Pro' } },
    }),
  );
  mockClutch.club.verify.mockResolvedValue(
    makeClub({
      courts: [
        makeCourt({ id: asCourtId('c0000000-0000-4000-8000-000000000011'), court_type: 'tennis', sort_order: 1 }),
        makeCourt({ id: asCourtId('c0000000-0000-4000-8000-000000000012'), court_type: 'pickleball', sort_order: 2 }),
      ],
    }),
  );
});

describe('HomeScreen', () => {
  it('greets the member by first name and lists upcoming bookings and announcements', async () => {
    mockClutch.me.home.mockResolvedValue(
      home({
        upcoming_bookings: [makeBooking({ court_name: 'Court 3', court_type: 'tennis', my_due_cents: null })],
        announcements: [
          makeAnnouncement({ id: 'n', title: 'Open house', published_at: '2026-10-12T16:00:00.000Z' }),
          makeAnnouncement({ id: 'p', title: 'Holiday hours', is_pinned: true, published_at: null }),
        ],
      }),
    );
    renderHome();

    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.getByText(/^Good (morning|afternoon|evening),$/)).toBeTruthy();
    expect(screen.getByText('Upcoming bookings')).toBeTruthy();
    expect(screen.getByText('Tennis · Court 3')).toBeTruthy();
    expect(screen.getByText('Club news')).toBeTruthy();
    expect(screen.getByText('PINNED')).toBeTruthy();
    // Pinned first, whatever order the list arrived in.
    const titles = screen.getAllByText(/Holiday hours|Open house/).map((n) => n.props.children);
    expect(titles).toEqual(['Holiday hours', 'Open house']);
    expect(mockClutch.me.home).toHaveBeenCalledTimes(1);
  });

  it('greets a member whose profile has no name yet (empty full_name)', async () => {
    mockClutch.me.home.mockResolvedValue(home({ profile: makeProfile({ full_name: '' }) }));
    renderHome();
    expect(await screen.findByText('Member')).toBeTruthy();
  });

  it('shows a Book a court prompt per sport when nothing is upcoming and no invitations are pending', async () => {
    renderHome();

    expect(await screen.findByText('Welcome,')).toBeTruthy();
    expect(screen.getByText('BOOK YOUR FIRST SESSION')).toBeTruthy();
    fireEvent.press(await screen.findByLabelText('Book a Pickleball court'));
    expect(mockPush).toHaveBeenCalledWith('/reserve/pickleball');
    expect(screen.getByLabelText('Book a Tennis court')).toBeTruthy();
  });

  describe('booking invitations without answering (P4 off, today)', () => {
    beforeEach(() => {
      mockClutch.capabilities = { ...REAL_CAPABILITIES, bookingParity: false };
      mockClutch.me.bookingInvitations.mockResolvedValue([invitation]);
    });

    it('shows the invitation and says answering is coming, with no buttons that would fail', async () => {
      renderHome();

      expect(await screen.findByText('SARAH LEE')).toBeTruthy();
      expect(screen.getByText('Answering invitations in the app is coming soon')).toBeTruthy();
      expect(screen.queryByLabelText('Accept the invitation from Sarah Lee')).toBeNull();
      expect(screen.queryByLabelText('Decline the invitation from Sarah Lee')).toBeNull();
      // An invitation is something on the schedule: not the first-session prompt.
      expect(screen.queryByText('BOOK YOUR FIRST SESSION')).toBeNull();

      fireEvent.press(screen.getByLabelText(/^Sarah Lee invited you to Court 2/));
      expect(mockPush).toHaveBeenCalledWith(`/bookings/${invitation.booking_id}`);
      expect(mockClutch.bookings.respond).not.toHaveBeenCalled();
    });
  });

  describe('booking invitations with answering (P4 on)', () => {
    beforeEach(() => {
      mockClutch.capabilities = { ...REAL_CAPABILITIES, bookingParity: true };
    });

    it('accepts inline and tells the member', async () => {
      mockClutch.me.bookingInvitations.mockResolvedValueOnce([invitation]).mockResolvedValue([]);
      mockClutch.bookings.respond.mockResolvedValue(
        InvitationAnswerSchema.parse({ booking_id: invitation.booking_id, status: 'accepted' }),
      );
      renderHome();

      expect(await screen.findByText('SARAH LEE')).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Accept the invitation from Sarah Lee'));

      await waitFor(() =>
        expect(mockClutch.bookings.respond).toHaveBeenCalledWith(invitation.booking_id, true, {
          idempotencyKey: expect.any(String),
        }),
      );
      expect(await screen.findByText('Invite accepted! See you October 20.')).toBeTruthy();
      // Settling refetches the invitations (and home), so the answered card goes.
      await waitFor(() => expect(screen.queryByText('SARAH LEE')).toBeNull());
      expect(mockClutch.me.home).toHaveBeenCalledTimes(2);
    });

    it('refetches when the invitation moved on before the answer landed', async () => {
      mockClutch.me.bookingInvitations.mockResolvedValueOnce([invitation]).mockResolvedValue([]);
      mockClutch.bookings.respond.mockRejectedValue(clutchError('invite_not_pending'));
      renderHome();

      fireEvent.press(await screen.findByLabelText('Decline the invitation from Sarah Lee'));

      expect(await screen.findByText('This booking changed before your answer was saved.')).toBeTruthy();
      await waitFor(() => expect(mockClutch.me.bookingInvitations).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByText('SARAH LEE')).toBeNull());
    });
  });

  it('answers a group invitation from home', async () => {
    mockClutch.groups.invitations.mockResolvedValue([groupInvitation]);
    mockClutch.groups.respondInvitation.mockResolvedValue({ group_id: groupInvitation.group_id });
    renderHome();

    expect(await screen.findByText('Group invitations')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Accept the Night Owls invitation'));
    await waitFor(() =>
      expect(mockClutch.groups.respondInvitation).toHaveBeenCalledWith(groupInvitation.id, true, {
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText('You joined Night Owls.')).toBeTruthy();
  });

  it('keeps the feed when an invitations read fails, with an inline retry', async () => {
    mockClutch.me.bookingInvitations.mockRejectedValue(clutchError('internal_error', 500));
    renderHome();

    expect(await screen.findByText('We could not load your booking invitations.')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    // An unknown invitation list never reads as "nothing scheduled".
    expect(screen.queryByText('BOOK YOUR FIRST SESSION')).toBeNull();
  });

  it('shows a retry when the home read fails', async () => {
    mockClutch.me.home.mockRejectedValueOnce(clutchError('internal_error', 500));
    renderHome();

    fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByText('Alice')).toBeTruthy();
  });

  it('opens the member card with the current tier', async () => {
    mockClutch.me.checkinToken.mockReturnValue(new Promise(() => undefined));
    renderHome();

    fireEvent.press(await screen.findByLabelText('Show membership card'));
    expect(await screen.findByText('Pro')).toBeTruthy();
    expect(screen.getByText('ALICE CHEN')).toBeTruthy();
  });
});
