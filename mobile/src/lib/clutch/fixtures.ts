/**
 * Test fixtures, built FROM the contract schemas: every builder runs its
 * object through the generated (or pending) zod schema, so a fixture that
 * drifts from what Clutch documents fails the test that uses it instead of
 * passing against a shape the server never sends. Import only from tests.
 *
 * Override fields with the builder's argument; the result is parsed again.
 */
import type { z } from 'zod';
import {
  AnnouncementSchema,
  AvailabilitySlotSchema,
  BookingDetailSchema,
  BookingInvitationSchema,
  BookingRecordSchema,
  BookingSchema,
  ClubDetailSchema,
  CourtAvailabilitySchema,
  CourtSchema,
  GetMeResponseSchema,
  GetMyClubMembershipResponseSchema,
  GetMyHomeResponseSchema,
  GroupActivityItemSchema,
  GroupInvitationSchema,
  GroupMemberSchema,
  GroupSchema,
  GroupSummarySchema,
  MembershipSubscriptionSchema,
  MembershipTierSchema,
  MyBookingSchema,
  NotificationPreferencesSchema,
  PaymentSchema,
  ProfileSchema,
  type AvailabilitySlot,
  type CourtAvailability,
} from './contract.gen';
import {
  BookingCheckoutSchema,
  BookingQuoteSchema,
  ClubBookingRulesSchema,
  ClubPlayerSchema,
  CourtTypeRulesSchema,
  LegacyBookingCheckoutSchema,
  MyMembershipBillingSchema,
  SavedCardSchema,
  type MyMembershipBilling,
} from './contract.pending';
import type { MembershipView } from './membership-view';
import { TEST_CLUB_ID } from './testing';

export const ME_ID = '00000000-0000-4000-8000-000000000001';
export const OTHER_ID = '00000000-0000-4000-8000-000000000002';
export const COURT_ID = 'c0000000-0000-4000-8000-000000000001';
export const BOOKING_ID = 'b0000000-0000-4000-8000-000000000001';
export const GROUP_ID = '90000000-0000-4000-8000-000000000001';
export const TIER_ID = '70000000-0000-4000-8000-000000000001';

type Over<S extends z.ZodType> = Partial<z.input<S>>;

/** Parse `base` with `over` merged in through `schema`. */
function build<S extends z.ZodType>(schema: S, base: z.input<S>, over: Over<S> = {}): z.output<S> {
  return schema.parse({ ...(base as object), ...(over as object) });
}

export function makeCourt(over: Over<typeof CourtSchema> = {}) {
  return build(
    CourtSchema,
    {
      id: COURT_ID,
      name: 'Court 1',
      court_type: 'badminton',
      is_indoor: true,
      surface: null,
      sort_order: 1,
    } as z.input<typeof CourtSchema>,
    over,
  );
}

export function makeClub(over: Over<typeof ClubDetailSchema> = {}) {
  return build(
    ClubDetailSchema,
    {
      id: TEST_CLUB_ID,
      name: 'Seventy',
      slug: '770',
      subdomain: null,
      timezone: 'America/New_York',
      currency: 'USD',
      locale: 'en',
      supported_locales: ['en'],
      court_types: ['tennis', 'pickleball', 'badminton'],
      address: null,
      latitude: null,
      longitude: null,
      phone: null,
      email: null,
      website: null,
      logo_url: null,
      cover_image_url: null,
      theme: {},
      enabled_features: ['bookings', 'payments', 'members', 'membership'],
      is_active: true,
      is_partner: true,
      courts: [makeCourt()],
      operating_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        id: `0000000${d}-0000-4000-8000-00000000000${d}`,
        day_of_week: d,
        open_time: '06:00:00',
        close_time: '22:00:00',
        is_closed: false,
      })),
      pricing_rules: [],
      booking_rules: {
        slot_duration_minutes: 30,
        min_duration_minutes: 30,
        max_duration_minutes: 120,
        advance_booking_days: 14,
        cancellation_hours: 24,
      },
    } as z.input<typeof ClubDetailSchema>,
    over,
  );
}

export function makeSlot(over: Over<typeof AvailabilitySlotSchema> = {}): AvailabilitySlot {
  return build(
    AvailabilitySlotSchema,
    {
      court_id: COURT_ID,
      start_time: '18:00',
      end_time: '18:30',
      status: 'available',
      price_cents: 1500,
      member_price_cents: 1500,
      currency: 'USD',
      is_peak: false,
    } as z.input<typeof AvailabilitySlotSchema>,
    over,
  );
}

export function makeCourtAvailability(
  courtId: string = COURT_ID,
  over: Over<typeof CourtAvailabilitySchema> = {},
  slots?: AvailabilitySlot[],
): CourtAvailability {
  return build(
    CourtAvailabilitySchema,
    {
      court_id: courtId,
      court_name: 'Court 1',
      court_type: 'badminton',
      is_indoor: true,
      surface: null,
      max_booking_duration_minutes: 120,
      slots: slots ?? [makeSlot({ court_id: courtId as never })],
    } as z.input<typeof CourtAvailabilitySchema>,
    over,
  );
}

/** Columns every booking shape shares (BookingRecord). */
function bookingColumns(): z.input<typeof BookingRecordSchema> {
  return {
    id: BOOKING_ID,
    club_id: TEST_CLUB_ID,
    court_id: COURT_ID,
    user_id: ME_ID,
    status: 'pending',
    booking_type: 'court',
    date: '2026-10-20',
    start_time: '18:00:00',
    end_time: '19:00:00',
    price_cents: 3000,
    original_price_cents: 3000,
    discount_amount_cents: 0,
    currency: 'USD',
    price_source: 'list',
    payment_status: 'none',
    paid_cents: 0,
    paid_at: null,
    hold_expires_at: '2026-10-20T22:15:00.000Z',
    recurring_booking_id: null,
    qr_code: null,
    notes: null,
    checked_in_at: null,
    no_show_recorded_at: null,
    cancelled_at: null,
    is_rainout: false,
    rainout_at: null,
    is_open_play: false,
    open_play_max_players: null,
    open_play_description: null,
    open_play_visibility: 'public',
    open_play_skill_level: null,
    created_at: '2026-10-16T12:00:00.000Z',
    updated_at: '2026-10-16T12:00:00.000Z',
  } as z.input<typeof BookingRecordSchema>;
}

const CONFIRMED = {
  status: 'confirmed',
  payment_status: 'paid',
  paid_cents: 3000,
  hold_expires_at: null,
} as const;

/** POST /bookings, confirm, cancel, reschedule. */
export function makeBookingRecord(over: Over<typeof BookingRecordSchema> = {}) {
  return build(BookingRecordSchema, bookingColumns(), over);
}

/** A row of /me/home upcoming_bookings and GET /bookings. */
export function makeBooking(over: Over<typeof BookingSchema> = {}) {
  return build(
    BookingSchema,
    {
      ...bookingColumns(),
      ...CONFIRMED,
      court_name: 'Court 1',
      court_type: 'badminton',
      share_path: null,
      my_due_cents: 0,
      my_paid_cents: 3000,
    } as z.input<typeof BookingSchema>,
    over,
  );
}

/** A row of GET /me/bookings (kind: booking). */
export function makeMyBooking(over: Over<typeof MyBookingSchema> = {}) {
  return build(MyBookingSchema, { ...(makeBooking() as object), kind: 'booking' } as z.input<typeof MyBookingSchema>, over);
}

export function makeBookingDetail(over: Over<typeof BookingDetailSchema> = {}) {
  return build(
    BookingDetailSchema,
    {
      ...bookingColumns(),
      ...CONFIRMED,
      court: { id: COURT_ID, name: 'Court 1', court_type: 'badminton', is_indoor: true, surface: null },
      players: [],
      dues: [],
    } as z.input<typeof BookingDetailSchema>,
    over,
  );
}

export function makeBookingInvitation(over: Over<typeof BookingInvitationSchema> = {}) {
  return build(
    BookingInvitationSchema,
    {
      kind: 'invitation',
      booking_player_id: `${BOOKING_ID}:${ME_ID}`,
      booking_id: BOOKING_ID,
      club_id: TEST_CLUB_ID,
      status: 'invited',
      invited_at: '2026-10-16T12:00:00.000Z',
      court_name: 'Court 1',
      date: '2026-10-20',
      start_time: '18:00:00',
      end_time: '19:00:00',
      inviter_name: 'Sam Lee',
    } as z.input<typeof BookingInvitationSchema>,
    over,
  );
}

export function makeProfile(over: Over<typeof ProfileSchema> = {}) {
  return build(
    ProfileSchema,
    {
      id: ME_ID,
      full_name: 'Alex Morgan',
      username: null,
      email: 'alex@example.com',
      avatar_url: null,
      bio: null,
      date_of_birth: null,
      preferred_locale: 'en',
      preferred_sports: [],
      skill_level: null,
      rating: null,
      matches_played: null,
      matches_won: null,
    } as z.input<typeof ProfileSchema>,
    over,
  );
}

type MeData = z.input<typeof GetMeResponseSchema>['data'];

/** GET /me with one active membership at this club (override `memberships`). */
export function makeMe(over: Partial<MeData> = {}) {
  return GetMeResponseSchema.shape.data.parse({
    profile: makeProfile(),
    memberships: [
      {
        id: TEST_CLUB_ID,
        name: 'Seventy',
        slug: '770',
        address: null,
        court_types: ['badminton'],
        role: 'player',
        status: 'active',
        joined_at: '2026-10-01T12:00:00.000Z',
        tier: { id: TIER_ID, name: 'Member' },
      },
    ],
    ...over,
  });
}

export function makeTier(over: Over<typeof MembershipTierSchema> = {}) {
  return build(
    MembershipTierSchema,
    {
      id: TIER_ID,
      name: 'Member',
      description: null,
      price_cents: 9900,
      currency: 'USD',
      interval: 'monthly',
      advance_booking_days: 14,
      discount_percent: 0,
      sort_order: 1,
    } as z.input<typeof MembershipTierSchema>,
    over,
  );
}

export function makeSubscription(over: Over<typeof MembershipSubscriptionSchema> = {}) {
  return build(
    MembershipSubscriptionSchema,
    {
      membership_id: 'a0000000-0000-4000-8000-000000000001',
      tier_name: 'Member',
      tier_description: null,
      price_cents: 9900,
      currency: 'USD',
      interval: 'monthly',
      status: 'active',
      current_period_end: '2026-11-16T00:00:00.000Z',
    } as z.input<typeof MembershipSubscriptionSchema>,
    over,
  );
}

type StandingData = z.input<typeof GetMyClubMembershipResponseSchema>['data'];

/** GET /me/membership as published today (club standing), wrapped as the client returns it. */
export function makeStandingMembership(over: Partial<StandingData> = {}): MembershipView {
  const data = GetMyClubMembershipResponseSchema.shape.data.parse({
    membership: { role: 'player', skill_level: null, status: 'active', tier: { id: TIER_ID, name: 'Member' } },
    subscription: makeSubscription(),
    ...over,
  });
  return { kind: 'standing', data };
}

/** GET /me/membership on P2 (billing view), wrapped as the client returns it. */
export function makeBillingMembership(over: Partial<z.input<typeof MyMembershipBillingSchema>> = {}): MembershipView {
  const tier = { id: TIER_ID, name: 'Member', description: null, price_cents: 9900, currency: 'USD', interval: 'monthly' };
  const data: MyMembershipBilling = MyMembershipBillingSchema.parse({
    membership: {
      id: 'a0000000-0000-4000-8000-000000000001',
      club_id: TEST_CLUB_ID,
      role: 'player',
      status: 'active',
      skill_level: null,
      agreed: true,
    },
    tier,
    billing: {
      has_subscription: true,
      subscription_status: 'active',
      entitled: true,
      current_period_end: '2026-11-16T00:00:00.000Z',
      cancel_at_period_end: false,
      pending_tier: null,
      pending_tier_effective_at: null,
    },
    pending_attempt: null,
    subscription: null,
    ...over,
  });
  return { kind: 'billing', data };
}

export function makeGroupSummary(over: Over<typeof GroupSummarySchema> = {}) {
  return build(
    GroupSummarySchema,
    {
      id: GROUP_ID,
      club_id: TEST_CLUB_ID,
      name: 'Tuesday Doubles',
      description: null,
      cover_image_url: null,
      member_count: 1,
      my_role: 'owner',
      created_at: '2026-10-01T12:00:00.000Z',
    } as z.input<typeof GroupSummarySchema>,
    over,
  );
}

export function makeGroupMember(over: Over<typeof GroupMemberSchema> = {}) {
  return build(
    GroupMemberSchema,
    {
      user_id: ME_ID,
      role: 'owner',
      joined_at: '2026-10-01T12:00:00.000Z',
      full_name: 'Alex Morgan',
      username: null,
      avatar_url: null,
    } as z.input<typeof GroupMemberSchema>,
    over,
  );
}

/** GET /groups/{id}. */
export function makeGroup(over: Over<typeof GroupSchema> = {}) {
  return build(
    GroupSchema,
    {
      ...(makeGroupSummary() as object),
      members: [makeGroupMember()],
      permissions: {
        can_edit: true,
        can_delete: true,
        can_manage_members: true,
        can_invite: true,
        can_leave: true,
      },
    } as unknown as z.input<typeof GroupSchema>,
    over,
  );
}

export function makeAnnouncement(over: Over<typeof AnnouncementSchema> = {}) {
  return build(
    AnnouncementSchema,
    {
      id: 'e0000000-0000-4000-8000-000000000001',
      title: 'Courts resurfaced',
      body: 'Court 3 is back.',
      is_pinned: false,
      published_at: '2026-10-15T12:00:00.000Z',
      author_name: null,
    } as z.input<typeof AnnouncementSchema>,
    over,
  );
}

type HomeData = z.input<typeof GetMyHomeResponseSchema>['data'];

export function makeHome(over: Partial<HomeData> = {}) {
  return GetMyHomeResponseSchema.shape.data.parse({
    profile: makeProfile(),
    upcoming_bookings: [],
    announcements: [],
    ...over,
  });
}

export function makePreferences(over: Over<typeof NotificationPreferencesSchema> = {}) {
  const on = { push: true, email: true, sms: false };
  return build(
    NotificationPreferencesSchema,
    {
      bookings: on,
      tournaments: on,
      leagues: on,
      messages: on,
      clubAnnouncements: on,
      promotions: { push: false, email: false, sms: false },
    } as z.input<typeof NotificationPreferencesSchema>,
    over,
  );
}

export function makePayment(over: Over<typeof PaymentSchema> = {}) {
  return build(
    PaymentSchema,
    {
      id: 'f0000000-0000-4000-8000-000000000001',
      club_id: TEST_CLUB_ID,
      user_id: ME_ID,
      amount_cents: 3000,
      currency: 'USD',
      payment_type: 'booking',
      payment_method: 'stripe',
      status: 'succeeded',
      reference_id: BOOKING_ID,
      description: 'Court booking',
      tax_cents: 0,
      refunded_amount_cents: 0,
      created_at: '2026-10-16T12:00:00.000Z',
    } as z.input<typeof PaymentSchema>,
    over,
  );
}

// ─── Pending-branch shapes (contract.pending.ts) ────────────────────────────

export function makeSavedCard(over: Over<typeof SavedCardSchema> = {}) {
  return build(
    SavedCardSchema,
    {
      id: 'd0000000-0000-4000-8000-000000000001',
      type: 'card',
      card_brand: 'visa',
      card_last4: '4242',
      card_exp_month: 12,
      card_exp_year: 2030,
      bank_name: null,
      bank_last4: null,
      bank_account_type: null,
      is_default: true,
    } as z.input<typeof SavedCardSchema>,
    over,
  );
}

export function makeLegacyCheckout(over: Over<typeof LegacyBookingCheckoutSchema> = {}) {
  return build(
    LegacyBookingCheckoutSchema,
    {
      clientSecret: 'pi_123_secret_abc',
      paymentIntentId: 'pi_123',
      simulated: false,
      stripeAccount: 'acct_club',
      subtotalCents: 3000,
      taxAmountCents: 0,
    },
    over,
  );
}

export function makeBookingCheckout(over: Over<typeof BookingCheckoutSchema> = {}) {
  return build(
    BookingCheckoutSchema,
    {
      clientSecret: 'pi_123_secret_abc',
      intentType: 'payment',
      customerId: 'cus_123',
      ephemeralKeySecret: 'ek_123',
      stripeAccount: 'acct_club',
      simulated: false,
      paymentIntentId: 'pi_123',
      subtotalCents: 3000,
      taxAmountCents: 0,
    },
    over,
  );
}

export function makeQuote(over: Over<typeof BookingQuoteSchema> = {}) {
  return build(
    BookingQuoteSchema,
    {
      club_id: TEST_CLUB_ID,
      court_id: COURT_ID,
      date: '2026-10-20',
      start_time: '18:00',
      end_time: '19:00',
      currency: 'USD',
      list_price_cents: 3000,
      discount_code_id: null,
      discount_amount_cents: 0,
      price_cents: 3000,
      tax_cents: 240,
      total_cents: 3240,
      tax_status: 'calculated',
      member_pricing: true,
      joins_club: false,
      venue_payment_allowed: false,
    } as z.input<typeof BookingQuoteSchema>,
    over,
  );
}

export function makeCourtTypeRules(over: Over<typeof CourtTypeRulesSchema> = {}) {
  return build(
    CourtTypeRulesSchema,
    {
      court_type: 'badminton',
      slot_duration_minutes: 30,
      min_duration_minutes: 30,
      max_duration_minutes: 120,
      advance_booking_days: 14,
      max_bookings_per_day: null,
      tier_restricted: false,
      allowed_tier_ids: [],
      hours: [],
      bookable_by_viewer: true,
      refusal: null,
    } as z.input<typeof CourtTypeRulesSchema>,
    over,
  );
}

export function makeBookingRules(over: Over<typeof ClubBookingRulesSchema> = {}) {
  return build(
    ClubBookingRulesSchema,
    {
      club_id: TEST_CLUB_ID,
      members_only: true,
      venue_payment_allowed: false,
      enforce_schedule: true,
      max_bookings_per_day: null,
      court_types: [makeCourtTypeRules()],
    } as z.input<typeof ClubBookingRulesSchema>,
    over,
  );
}

/** A row of GET /clubs/{club}/players (P4 member search). */
export function makeClubPlayer(over: Over<typeof ClubPlayerSchema> = {}) {
  return build(
    ClubPlayerSchema,
    {
      user_id: OTHER_ID,
      full_name: 'Sam Lee',
      username: 'sam',
      avatar_url: null,
    } as z.input<typeof ClubPlayerSchema>,
    over,
  );
}

/** A row of GET /groups/{id}/activity. */
export function makeGroupActivityItem(over: Over<typeof GroupActivityItemSchema> = {}) {
  return build(
    GroupActivityItemSchema,
    {
      booking_id: BOOKING_ID,
      date: '2026-10-20',
      start_time: '18:00:00',
      end_time: '19:00:00',
      status: 'confirmed',
      court_name: 'Court 1',
      court_type: 'badminton',
      organizer_id: ME_ID,
      participant_count: 3,
      i_am_participant: true,
    } as z.input<typeof GroupActivityItemSchema>,
    over,
  );
}

/** A row of GET /me/group-invitations. */
export function makeGroupInvitation(over: Over<typeof GroupInvitationSchema> = {}) {
  return build(
    GroupInvitationSchema,
    {
      id: '91000000-0000-4000-8000-000000000001',
      group_id: GROUP_ID,
      group_name: 'Tuesday Doubles',
      club_id: TEST_CLUB_ID,
      status: 'pending',
      created_at: '2026-10-10T00:00:00.000Z',
    } as z.input<typeof GroupInvitationSchema>,
    over,
  );
}
