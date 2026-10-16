/**
 * Contract-shaped fixtures for tests. Import only from tests. Each builder
 * returns a value that parses with its contract schema; override fields as
 * needed.
 */
import type {
  AvailabilitySlot,
  Booking,
  BookingDetail,
  BookingWithCourt,
  Club,
  Court,
  CourtAvailability,
  GroupDetail,
  GroupSummary,
  Me,
  MembershipTier,
  MySubscription,
  Profile,
} from './contract.gen';
import {
  asBookingId,
  asCourtId,
  asGroupId,
  asTierId,
  asUserId,
  type CourtId,
} from './ids';
import { TEST_CLUB_ID } from './testing';

export const ME_ID = asUserId('00000000-0000-4000-8000-000000000001');
export const OTHER_ID = asUserId('00000000-0000-4000-8000-000000000002');

export function makeCourt(over: Partial<Court> = {}): Court {
  return {
    id: asCourtId('c0000000-0000-4000-8000-000000000001'),
    name: 'Court 1',
    court_type: 'badminton',
    is_indoor: true,
    surface: null,
    sort_order: 1,
    ...over,
  };
}

export function makeClub(over: Partial<Club> = {}): Club {
  return {
    id: TEST_CLUB_ID,
    name: 'Seventy',
    slug: '770',
    timezone: 'America/New_York',
    currency: 'USD',
    court_types: ['tennis', 'pickleball', 'badminton'],
    address: null,
    logo_url: null,
    cover_image_url: null,
    enabled_features: ['bookings', 'payments', 'members', 'membership'],
    courts: [makeCourt()],
    operating_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      day_of_week: d,
      open_time: '06:00:00',
      close_time: '22:00:00',
      is_closed: false,
    })),
    booking_rules: {
      slot_duration_minutes: 30,
      min_duration_minutes: 30,
      max_duration_minutes: 120,
      advance_booking_days: 14,
      cancellation_hours: 24,
    },
    ...over,
  };
}

export function makeSlot(over: Partial<AvailabilitySlot> = {}): AvailabilitySlot {
  return {
    court_id: asCourtId('c0000000-0000-4000-8000-000000000001'),
    start_time: '18:00',
    end_time: '18:30',
    status: 'available',
    price_cents: 1500,
    member_price_cents: 1500,
    currency: 'USD',
    is_peak: false,
    ...over,
  };
}

/** A court's grid row with consecutive slots from `start` (HH:MM), `count` long. */
export function makeCourtAvailability(
  courtId: CourtId,
  over: Partial<CourtAvailability> = {},
  slots?: AvailabilitySlot[],
): CourtAvailability {
  return {
    court_id: courtId,
    court_name: 'Court 1',
    court_type: 'badminton',
    is_indoor: true,
    surface: null,
    max_booking_duration_minutes: 120,
    slots: slots ?? [makeSlot({ court_id: courtId })],
    ...over,
  };
}

export function makeBooking(over: Partial<Booking> = {}): Booking {
  return {
    id: asBookingId('b0000000-0000-4000-8000-000000000001'),
    club_id: TEST_CLUB_ID,
    court_id: asCourtId('c0000000-0000-4000-8000-000000000001'),
    user_id: ME_ID,
    status: 'pending',
    date: '2026-10-20',
    start_time: '18:00:00',
    end_time: '19:00:00',
    price_cents: 3000,
    currency: 'USD',
    paid_cents: 0,
    payment_status: 'none',
    hold_expires_at: '2026-10-20T22:15:00.000Z',
    created_at: '2026-10-16T12:00:00.000Z',
    ...over,
  };
}

export function makeBookingWithCourt(over: Partial<BookingWithCourt> = {}): BookingWithCourt {
  return {
    ...makeBooking({ status: 'confirmed', payment_status: 'paid', paid_cents: 3000 }),
    court_name: 'Court 1',
    court_type: 'badminton',
    share_path: null,
    ...over,
  };
}

export function makeBookingDetail(over: Partial<BookingDetail> = {}): BookingDetail {
  return {
    ...makeBooking({ status: 'confirmed', payment_status: 'paid', paid_cents: 3000 }),
    court: { id: asCourtId('c0000000-0000-4000-8000-000000000001'), name: 'Court 1', court_type: 'badminton' },
    players: [],
    dues: [],
    ...over,
  };
}

export function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: ME_ID,
    full_name: 'Alex Morgan',
    username: null,
    email: 'alex@example.com',
    avatar_url: null,
    ...over,
  };
}

export function makeMe(over: Partial<Me> = {}): Me {
  return {
    profile: makeProfile(),
    memberships: [
      {
        id: TEST_CLUB_ID,
        name: 'Seventy',
        slug: '770',
        address: null,
        court_types: ['badminton'],
        role: 'player',
      },
    ],
    ...over,
  };
}

export function makeTier(over: Partial<MembershipTier> = {}): MembershipTier {
  return {
    id: asTierId('70000000-0000-4000-8000-000000000001'),
    club_id: TEST_CLUB_ID,
    name: 'Member',
    description: null,
    price_cents: 9900,
    currency: 'USD',
    interval: 'monthly',
    advance_booking_days: 14,
    discount_percent: 0,
    benefits: [],
    sort_order: 1,
    is_active: true,
    ...over,
  };
}

export function makeSubscription(over: Partial<MySubscription> = {}): MySubscription {
  return {
    membership_id: 'm0000000-0000-4000-8000-000000000001',
    tier_name: 'Member',
    tier_description: null,
    price_cents: 9900,
    currency: 'USD',
    interval: 'monthly',
    status: 'active',
    current_period_end: '2026-11-16T00:00:00.000Z',
    stripe_subscription_id: 'sub_123',
    ...over,
  };
}

export function makeGroupSummary(over: Partial<GroupSummary> = {}): GroupSummary {
  return {
    id: asGroupId('90000000-0000-4000-8000-000000000001'),
    club_id: TEST_CLUB_ID,
    name: 'Tuesday Doubles',
    description: null,
    cover_image_url: null,
    member_count: 4,
    my_role: 'owner',
    created_at: '2026-10-01T12:00:00.000Z',
    ...over,
  };
}

export function makeGroupDetail(over: Partial<GroupDetail> = {}): GroupDetail {
  return {
    ...makeGroupSummary(),
    members: [
      {
        user_id: ME_ID,
        role: 'owner',
        joined_at: '2026-10-01T12:00:00.000Z',
        full_name: 'Alex Morgan',
        username: null,
        avatar_url: null,
      },
    ],
    permissions: {
      can_edit: true,
      can_delete: true,
      can_manage_members: true,
      can_invite: true,
      can_leave: true,
    },
    ...over,
  };
}
