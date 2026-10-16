import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  asBookingId,
  asCourtId,
  asGroupId,
  asGroupInvitationId,
  type Announcement,
  type BookingInvitation,
  type GroupInvitation,
  type Home,
} from '../../../lib/clutch';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, TEST_CLUB_ID } from '../../../lib/clutch/testing';
import {
  makeBookingWithCourt,
  makeClub,
  makeCourt,
  makeProfile,
  makeSubscription,
} from '../../../lib/clutch/fixtures';
import { ToastProvider } from '../../../components';
import { HomeScreen } from '../HomeScreen';

jest.mock('../../../lib/clutch', () => {
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...jest.requireActual('../../../lib/clutch'), clutch: createMockClutch() };
});
const mockClutch: MockClutch = jest.requireMock('../../../lib/clutch').clutch;

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

const INVITE_BOOKING = asBookingId('b0000000-0000-4000-8000-000000000009');

function makeHome(over: Partial<Home> = {}): Home {
  return {
    profile: makeProfile({ full_name: 'Alice Chen' }),
    upcoming_bookings: [],
    announcements: [],
    ...over,
  };
}

function makeInvitation(over: Partial<BookingInvitation> = {}): BookingInvitation {
  return {
    booking_player_id: 'bp1',
    booking_id: INVITE_BOOKING,
    status: 'invited',
    invited_at: '2026-10-15T12:00:00.000Z',
    court_name: 'Court 2',
    date: '2026-10-20',
    start_time: '18:00:00',
    end_time: '19:00:00',
    inviter_name: 'Sarah Lee',
    club_id: TEST_CLUB_ID,
    ...over,
  };
}

const groupInvitation: GroupInvitation = {
  id: asGroupInvitationId('gi1'),
  group_id: asGroupId('g2'),
  group_name: 'Night Owls',
  club_id: TEST_CLUB_ID,
  status: 'pending',
  created_at: '2026-10-10T00:00:00.000Z',
};

function announcement(over: Partial<Announcement> = {}): Announcement {
  return {
    id: 'a1',
    title: 'Courts resurfaced',
    body: 'Courts 1 to 4 are back.',
    isPinned: false,
    publishedAt: '2026-10-10T16:00:00.000Z',
    authorName: null,
    ...over,
  };
}

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
  mockClutch.me.home.mockResolvedValue(makeHome());
  mockClutch.me.bookingInvitations.mockResolvedValue([]);
  mockClutch.groups.invitations.mockResolvedValue([]);
  mockClutch.membership.get.mockResolvedValue({
    membership: { role: 'player' },
    subscription: makeSubscription({ tier_name: 'Pro' }),
  });
  mockClutch.club.verify.mockResolvedValue(
    makeClub({
      courts: [
        makeCourt({ id: asCourtId('c1'), court_type: 'tennis', sort_order: 1 }),
        makeCourt({ id: asCourtId('c2'), court_type: 'pickleball', sort_order: 2 }),
      ],
    }),
  );
});

describe('HomeScreen', () => {
  it('greets the member by first name and lists upcoming bookings and announcements', async () => {
    mockClutch.me.home.mockResolvedValue(
      makeHome({
        upcoming_bookings: [makeBookingWithCourt({ court_name: 'Court 3', court_type: 'tennis' })],
        announcements: [
          announcement({ id: 'n', title: 'Open house', publishedAt: '2026-10-12T16:00:00.000Z' }),
          announcement({ id: 'p', title: 'Holiday hours', isPinned: true }),
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

  it('shows a Book a court prompt per sport when nothing is upcoming and no invitations are pending', async () => {
    renderHome();

    expect(await screen.findByText('Welcome,')).toBeTruthy();
    expect(screen.getByText('BOOK YOUR FIRST SESSION')).toBeTruthy();
    fireEvent.press(await screen.findByLabelText('Book a Pickleball court'));
    expect(mockPush).toHaveBeenCalledWith('/reserve/pickleball');
    expect(screen.getByLabelText('Book a Tennis court')).toBeTruthy();
  });

  it('accepts a booking invitation inline and tells the member', async () => {
    mockClutch.me.bookingInvitations
      .mockResolvedValueOnce([makeInvitation()])
      .mockResolvedValue([]);
    mockClutch.bookings.respond.mockResolvedValue(null);
    renderHome();

    expect(await screen.findByText('SARAH LEE')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Accept the invitation from Sarah Lee'));

    await waitFor(() =>
      expect(mockClutch.bookings.respond).toHaveBeenCalledWith(INVITE_BOOKING, true, {
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText('Invite accepted! See you October 20.')).toBeTruthy();
    // Settling refetches the invitations (and home), so the answered card goes.
    await waitFor(() => expect(screen.queryByText('SARAH LEE')).toBeNull());
    expect(mockClutch.me.home).toHaveBeenCalledTimes(2);
  });

  it('refetches when the invitation moved on before the answer landed', async () => {
    mockClutch.me.bookingInvitations
      .mockResolvedValueOnce([makeInvitation()])
      .mockResolvedValue([]);
    mockClutch.bookings.respond.mockRejectedValue(clutchError('invite_not_pending'));
    renderHome();

    fireEvent.press(await screen.findByLabelText('Decline the invitation from Sarah Lee'));

    expect(await screen.findByText('This booking changed before your answer was saved.')).toBeTruthy();
    await waitFor(() => expect(mockClutch.me.bookingInvitations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('SARAH LEE')).toBeNull());
  });

  it('answers a group invitation from home', async () => {
    mockClutch.groups.invitations.mockResolvedValue([groupInvitation]);
    mockClutch.groups.respondInvitation.mockResolvedValue({ group_id: asGroupId('g2') });
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
