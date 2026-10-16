/**
 * Clutch /api/v1 contract: response schemas (zod 4) and the types inferred
 * from them, for every endpoint the app calls.
 *
 * HAND-WRITTEN, TO BE REPLACED BY THE GENERATOR. Clutch's feat/api-contract
 * (P3) adds explicit response projections + zod response schemas to every
 * route and emits docs/api/openapi.json. Once that is on origin/main,
 * `node scripts/gen-clutch-contract.mjs <path-to-openapi.json>` regenerates
 * this file and the hand-written version goes away. Until then every schema
 * below was read off the route handlers and the server actions they wrap on
 * we-are-clutch/club-management origin/main (2026-10-16), or, where marked
 * PENDING, off the design for an in-flight Clutch branch:
 *   P1 feat/expo-push, P2 feat/native-payments, P3 feat/api-contract,
 *   P4 feat/member-booking-parity, P5 feat/account-deletion-and-checkin.
 *
 * Conventions:
 * - Field names are Clutch's (snake_case, booking/court/tier/group words).
 *   The app uses them as they are; there is no adapter layer.
 * - Objects strip unknown keys: a field not listed here is not part of what
 *   the app relies on. A listed field that is missing or mistyped fails the
 *   parse (ClutchError kind 'contract'), so drift surfaces at the boundary.
 * - Ids are branded (ids.ts) at parse time.
 * - Times are Clutch's wall-clock strings in the club's timezone
 *   ("HH:MM" from availability, "HH:MM:SS" from booking rows); dates are
 *   "YYYY-MM-DD".
 */
import { z } from 'zod';
import {
  BookingIdSchema,
  CardIdSchema,
  ClubIdSchema,
  CourtIdSchema,
  GroupIdSchema,
  GroupInvitationIdSchema,
  TierIdSchema,
  UserIdSchema,
} from './ids';

// ─── Envelope ────────────────────────────────────────────────────────────────

/** Success: `{ data, count? }` and nothing else. */
export const SuccessEnvelopeSchema = z
  .object({ data: z.unknown(), count: z.number().int().nonnegative().optional() })
  .strict();

/** Failure: `{ error, message, details?, request_id? }` and nothing else. */
export const ErrorEnvelopeSchema = z
  .object({
    error: z.string().min(1),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string().optional(),
  })
  .strict();

// ─── Shared ──────────────────────────────────────────────────────────────────

const Nullable = <T extends z.ZodType>(schema: T) => schema.nullable();
const NullableString = z.string().nullable();

/** A route whose success body carries nothing the app reads (`data: null`). */
export const NoContentSchema = z.unknown();

// ─── Clubs (the venue) ───────────────────────────────────────────────────────

export const CourtTypeSchema = z.string(); // tennis | pickleball | badminton | ...
export type CourtType = z.infer<typeof CourtTypeSchema>;

export const CourtSchema = z.object({
  id: CourtIdSchema,
  name: z.string(),
  court_type: CourtTypeSchema,
  is_indoor: z.boolean(),
  surface: NullableString,
  sort_order: z.number(),
});
export type Court = z.infer<typeof CourtSchema>;

export const OperatingHoursSchema = z.object({
  day_of_week: z.number().int(),
  open_time: z.string(),
  close_time: z.string(),
  is_closed: z.boolean(),
});
export type OperatingHours = z.infer<typeof OperatingHoursSchema>;

export const BookingRulesSchema = z.object({
  slot_duration_minutes: z.number(),
  min_duration_minutes: z.number(),
  max_duration_minutes: z.number(),
  advance_booking_days: z.number(),
  cancellation_hours: z.number().nullish(),
});
export type BookingRules = z.infer<typeof BookingRulesSchema>;

/** GET /clubs/{club}: the club row plus what a booking UI renders. */
export const ClubSchema = z.object({
  id: ClubIdSchema,
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  currency: z.string(),
  court_types: z.array(CourtTypeSchema),
  address: NullableString.optional(),
  logo_url: NullableString.optional(),
  cover_image_url: NullableString.optional(),
  enabled_features: z.array(z.string()).nullish(),
  courts: z.array(CourtSchema),
  operating_hours: z.array(OperatingHoursSchema),
  booking_rules: Nullable(BookingRulesSchema),
});
export type Club = z.infer<typeof ClubSchema>;

/** GET /clubs/{club}/courts */
export const CourtListSchema = z.array(CourtSchema);

export const SlotStatusSchema = z.enum(['available', 'booked', 'maintenance', 'past']);
export type SlotStatus = z.infer<typeof SlotStatusSchema>;

export const AvailabilitySlotSchema = z.object({
  court_id: CourtIdSchema,
  start_time: z.string(),
  end_time: z.string(),
  status: SlotStatusSchema,
  /** What THIS caller would pay for the slot (member price when it applies). */
  price_cents: z.number().int(),
  member_price_cents: z.number().int().nullable(),
  currency: z.string(),
  is_peak: z.boolean(),
});
export type AvailabilitySlot = z.infer<typeof AvailabilitySlotSchema>;

export const CourtAvailabilitySchema = z.object({
  court_id: CourtIdSchema,
  court_name: z.string(),
  court_type: CourtTypeSchema,
  is_indoor: z.boolean(),
  surface: NullableString,
  max_booking_duration_minutes: z.number().nullish(),
  slots: z.array(AvailabilitySlotSchema),
});
export type CourtAvailability = z.infer<typeof CourtAvailabilitySchema>;

/** GET /clubs/{club}/availability?date= : one day, every court, every slot. */
export const AvailabilityGridSchema = z.array(CourtAvailabilitySchema);
export type AvailabilityGrid = z.infer<typeof AvailabilityGridSchema>;

/**
 * POST /clubs/{club}/join. On main `joined:false` means "already had a row"
 * (and also a suspended row, and a swallowed insert error); P3 adds the
 * resulting status. The app never infers membership from this: it re-reads
 * GET /me afterwards.
 */
export const JoinClubResultSchema = z.object({
  joined: z.boolean(),
  status: z.string().optional(), // PENDING P3
});
export type JoinClubResult = z.infer<typeof JoinClubResultSchema>;

// ─── Membership tiers ────────────────────────────────────────────────────────

export const BillingIntervalSchema = z.enum(['monthly', 'quarterly', 'yearly']);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

export const MembershipTierSchema = z.object({
  id: TierIdSchema,
  club_id: ClubIdSchema,
  name: z.string(),
  description: NullableString,
  price_cents: z.number().int(),
  currency: z.string(),
  interval: BillingIntervalSchema,
  advance_booking_days: z.number().nullish(),
  discount_percent: z.number().nullish(),
  benefits: z.array(z.unknown()).nullish(),
  sort_order: z.number().nullish(),
  is_active: z.boolean(),
});
export type MembershipTier = z.infer<typeof MembershipTierSchema>;

/** The caller's tier subscription at a club (getMySubscription). */
export const MySubscriptionSchema = z.object({
  membership_id: z.string(),
  tier_name: z.string(),
  tier_description: NullableString,
  price_cents: z.number().int(),
  currency: z.string(),
  interval: z.string(),
  /** Club standing on main; P2 moves billing to `subscription_status`. */
  status: z.string(),
  current_period_end: NullableString,
  stripe_subscription_id: NullableString,
  // PENDING P2: billing state separated from club standing, plus the pending
  // downgrade and cancellation the change/cancel endpoints record.
  tier_id: TierIdSchema.nullish(),
  subscription_status: NullableString.optional(),
  cancel_at_period_end: z.boolean().nullish(),
  pending_tier_id: TierIdSchema.nullish(),
  pending_tier_name: NullableString.optional(),
  pending_effective_at: NullableString.optional(),
});
export type MySubscription = z.infer<typeof MySubscriptionSchema>;

/** GET /clubs/{club}/membership-tiers */
export const MembershipTiersPageSchema = z.object({
  tiers: z.array(MembershipTierSchema),
  subscription: Nullable(MySubscriptionSchema),
});
export type MembershipTiersPage = z.infer<typeof MembershipTiersPageSchema>;

/**
 * GET /me/membership?club_id=. On main a failed sub-read comes back as null
 * (P3 makes it fail the request), so `null` here is "not known to exist",
 * never proof of absence.
 */
export const MyMembershipSchema = z.object({
  membership: Nullable(
    z.object({
      role: z.string(),
      skill_level: NullableString.optional(),
    }),
  ),
  subscription: Nullable(MySubscriptionSchema),
});
export type MyMembership = z.infer<typeof MyMembershipSchema>;

/** GET /me/membership/change?club_id= : tiers the caller may move to. */
export const EligibleChangeTierSchema = z.object({
  id: TierIdSchema,
  name: z.string(),
  description: NullableString,
  price_cents: z.number().int(),
  currency: z.string(),
  interval: z.string(),
  advance_booking_days: z.number().nullish(),
  changeType: z.enum(['upgrade', 'downgrade']),
});
export type EligibleChangeTier = z.infer<typeof EligibleChangeTierSchema>;
export const EligibleChangeTiersSchema = z.array(EligibleChangeTierSchema);

// ─── Payments: the PaymentSheet bundle (PENDING P2) ──────────────────────────

/**
 * What every endpoint that opens a sheet returns on P2:
 * `{clientSecret, intentType, customerId, ephemeralKeySecret, stripeAccount,
 * simulated}`. In simulated mode (a deployment-wide switch) clientSecret is
 * null and no sheet is shown.
 */
export const SheetBundleSchema = z.object({
  clientSecret: NullableString,
  intentType: z.enum(['payment', 'setup']),
  customerId: NullableString.optional(),
  ephemeralKeySecret: NullableString.optional(),
  stripeAccount: NullableString.optional(),
  simulated: z.boolean(),
});
export type SheetBundle = z.infer<typeof SheetBundleSchema>;

/**
 * The union every payment result is turned into. The ONLY way to show a sheet
 * is presentConnectedSheet(intent) with the `stripe` arm; the `simulated` arm
 * never reaches Stripe.
 */
export type SheetIntent =
  | {
      mode: 'stripe';
      intentType: 'payment' | 'setup';
      clientSecret: string;
      /** The club's connected account; null only for a platform-account intent. */
      stripeAccount: string | null;
      customerId?: string;
      ephemeralKeySecret?: string;
    }
  | { mode: 'simulated'; intentType: 'payment' | 'setup'; intentId: string | null };

export type StripeSheetIntent = Extract<SheetIntent, { mode: 'stripe' }>;

/** Stripe intent id from a client secret (`pi_123_secret_abc` -> `pi_123`). */
export function intentIdFromClientSecret(clientSecret: string): string {
  const at = clientSecret.indexOf('_secret_');
  return at > 0 ? clientSecret.slice(0, at) : clientSecret;
}

export function toSheetIntent(
  bundle: SheetBundle,
  simulatedIntentId: string | null = null,
): SheetIntent {
  if (bundle.simulated || !bundle.clientSecret) {
    return { mode: 'simulated', intentType: bundle.intentType, intentId: simulatedIntentId };
  }
  return {
    mode: 'stripe',
    intentType: bundle.intentType,
    clientSecret: bundle.clientSecret,
    stripeAccount: bundle.stripeAccount ?? null,
    customerId: bundle.customerId ?? undefined,
    ephemeralKeySecret: bundle.ephemeralKeySecret ?? undefined,
  };
}

/** POST /me/membership/subscribe (P2): a subscription attempt + its sheet. */
export const SubscribeResultSchema = SheetBundleSchema.extend({
  attempt_id: z.string().nullish(),
});
export type SubscribeResult = z.infer<typeof SubscribeResultSchema>;

/** POST /me/membership/change (P2). */
export const ChangeTierResultSchema = z.object({
  kind: z.enum(['upgraded', 'downgrade_scheduled']),
  clientSecret: NullableString,
  effectiveAt: NullableString,
  intentType: z.enum(['payment', 'setup']).optional(),
  customerId: NullableString.optional(),
  ephemeralKeySecret: NullableString.optional(),
  stripeAccount: NullableString.optional(),
  simulated: z.boolean().optional(),
});
export type ChangeTierResult = z.infer<typeof ChangeTierResultSchema>;

// ─── Saved payment methods ───────────────────────────────────────────────────

export const SavedPaymentMethodSchema = z.object({
  id: CardIdSchema,
  stripe_payment_method_id: z.string(),
  type: z.string(),
  card_brand: NullableString,
  card_last4: NullableString,
  card_exp_month: z.number().nullable(),
  card_exp_year: z.number().nullable(),
  bank_name: NullableString.optional(),
  bank_last4: NullableString.optional(),
  bank_account_type: NullableString.optional(),
  is_default: z.boolean(),
});
export type SavedPaymentMethod = z.infer<typeof SavedPaymentMethodSchema>;
export const SavedPaymentMethodsSchema = z.array(SavedPaymentMethodSchema);

// ─── Payment history ─────────────────────────────────────────────────────────

export const PaymentHistoryItemSchema = z.object({
  id: z.string(),
  club_id: ClubIdSchema,
  amount_cents: z.number().int(),
  currency: z.string(),
  payment_type: z.string(),
  payment_method: z.string(),
  status: z.string(),
  reference_id: NullableString,
  description: NullableString,
  created_at: z.string(),
  refunded_amount_cents: z.number().int().nullish(),
});
export type PaymentHistoryItem = z.infer<typeof PaymentHistoryItemSchema>;
export const PaymentHistorySchema = z.array(PaymentHistoryItemSchema);

// ─── Bookings ────────────────────────────────────────────────────────────────

export const BookingStatusSchema = z.enum(['pending', 'confirmed', 'cancelled', 'completed', 'no_show']);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const BookingPaymentStatusSchema = z.enum(['none', 'pending', 'partial', 'paid', 'refunded']);

/** A bookings row as POST /bookings, confirm, cancel and reschedule return it. */
export const BookingSchema = z.object({
  id: BookingIdSchema,
  club_id: ClubIdSchema,
  court_id: CourtIdSchema,
  user_id: UserIdSchema.nullable(),
  status: BookingStatusSchema,
  date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  price_cents: z.number().int(),
  currency: z.string(),
  paid_cents: z.number().int().nullish(),
  payment_status: BookingPaymentStatusSchema.nullish(),
  /** The pending hold's end (15 minutes from creation). */
  hold_expires_at: NullableString.optional(),
  original_price_cents: z.number().int().nullish(),
  discount_amount_cents: z.number().int().nullish(),
  cancelled_at: NullableString.optional(),
  created_at: z.string(),
});
export type Booking = z.infer<typeof BookingSchema>;

/** A row of GET /me/bookings: the booking plus its court and the caller's dues. */
export const BookingWithCourtSchema = BookingSchema.extend({
  court_name: NullableString,
  court_type: NullableString,
  share_path: NullableString.optional(),
  my_due_cents: z.number().int().optional(),
  my_paid_cents: z.number().int().optional(),
});
export type BookingWithCourt = z.infer<typeof BookingWithCourtSchema>;
export const BookingListSchema = z.array(BookingWithCourtSchema);

export const BookingPlayerStatusSchema = z.enum(['invited', 'accepted', 'declined']);
export type BookingPlayerStatus = z.infer<typeof BookingPlayerStatusSchema>;

export const BookingPlayerSchema = z.object({
  user_id: UserIdSchema,
  status: BookingPlayerStatusSchema,
  share_cents: z.number().int().nullable(),
  payment_status: z.string().nullish(),
  // PENDING P3: the projection adds who the player is (a member may see a
  // fellow player's name and avatar); until then the roster shows "Player".
  full_name: NullableString.optional(),
  avatar_url: NullableString.optional(),
});
export type BookingPlayer = z.infer<typeof BookingPlayerSchema>;

/** booking_dues: what each payer owes. The booker sees every row. */
export const BookingDueSchema = z.object({
  party: z.string(),
  user_id: UserIdSchema.nullable(),
  invitation_id: NullableString,
  live: z.boolean(),
  share_cents: z.number().int(),
  paid_cents: z.number().int(),
  due_cents: z.number().int(),
});
export type BookingDue = z.infer<typeof BookingDueSchema>;

/** GET /bookings/{id}: the row, its court, its players and the dues. */
export const BookingDetailSchema = BookingSchema.extend({
  court: z
    .object({
      id: CourtIdSchema,
      name: z.string(),
      court_type: CourtTypeSchema,
      is_indoor: z.boolean().nullish(),
      surface: NullableString.optional(),
    })
    .nullable(),
  players: z.array(BookingPlayerSchema),
  dues: z.array(BookingDueSchema),
  // PENDING P3: the booker's display name for guests' views.
  booker_name: NullableString.optional(),
});
export type BookingDetail = z.infer<typeof BookingDetailSchema>;

/** GET /me/bookings?include=invitations : bookings others invited the caller to. */
export const BookingInvitationSchema = z.object({
  booking_player_id: z.string(),
  booking_id: BookingIdSchema,
  status: z.string(),
  invited_at: NullableString,
  court_name: NullableString,
  date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  inviter_name: z.string(),
  club_id: ClubIdSchema,
});
export type BookingInvitation = z.infer<typeof BookingInvitationSchema>;
export const BookingInvitationsSchema = z.array(BookingInvitationSchema);

/**
 * POST /bookings/{id}/payment-intent. On main: clientSecret, paymentIntentId,
 * stripeAccount, simulated, tax/subtotal. P2 adds customerId +
 * ephemeralKeySecret so the sheet can offer saved cards.
 */
export const BookingPaymentIntentSchema = z.object({
  clientSecret: z.string(),
  paymentIntentId: z.string(),
  simulated: z.boolean(),
  stripeAccount: NullableString.optional(),
  subtotalCents: z.number().int().nullish(),
  taxAmountCents: z.number().int().nullish(),
  customerId: NullableString.optional(), // PENDING P2
  ephemeralKeySecret: NullableString.optional(), // PENDING P2
});
export type BookingPaymentIntent = z.infer<typeof BookingPaymentIntentSchema>;

export function bookingIntentToSheet(intent: BookingPaymentIntent): SheetIntent {
  if (intent.simulated) {
    return { mode: 'simulated', intentType: 'payment', intentId: intent.paymentIntentId };
  }
  return {
    mode: 'stripe',
    intentType: 'payment',
    clientSecret: intent.clientSecret,
    stripeAccount: intent.stripeAccount ?? null,
    customerId: intent.customerId ?? undefined,
    ephemeralKeySecret: intent.ephemeralKeySecret ?? undefined,
  };
}

/**
 * POST /bookings/quote (PENDING P4): what createBooking will charge for this
 * court and range, through Clutch's one pricing path. The app shows these
 * figures and never computes money itself.
 */
export const BookingQuoteSchema = z.object({
  subtotal_cents: z.number().int(),
  discount_cents: z.number().int().nullish(),
  tax_cents: z.number().int().nullish(),
  total_cents: z.number().int(),
  currency: z.string(),
});
export type BookingQuote = z.infer<typeof BookingQuoteSchema>;

/**
 * POST /bookings/{id}/reschedule. On main it returns the moved row and refuses
 * a move that costs more (reschedule_costs_more). PENDING P4: a dearer move
 * returns the difference as a payment intent to settle.
 */
export const RescheduleResultSchema = BookingSchema.extend({
  difference_cents: z.number().int().nullish(),
  payment_intent: BookingPaymentIntentSchema.nullish(),
});
export type RescheduleResult = z.infer<typeof RescheduleResultSchema>;

/** POST /bookings/{id}/invite-group, POST /groups/{id}/invitations */
export const InvitedResultSchema = z.object({ invited: z.array(UserIdSchema) });

/** Member-facing player search (PENDING P4): fellow members of the club only. */
export const PlayerSearchResultSchema = z.object({
  user_id: UserIdSchema,
  full_name: NullableString,
  username: NullableString.optional(),
  avatar_url: NullableString.optional(),
});
export type PlayerSearchResult = z.infer<typeof PlayerSearchResultSchema>;
export const PlayerSearchResultsSchema = z.array(PlayerSearchResultSchema);

// ─── Me ──────────────────────────────────────────────────────────────────────

/** publicProfile: the caller's own profile. */
export const ProfileSchema = z.object({
  id: UserIdSchema,
  full_name: NullableString,
  username: NullableString.optional(),
  email: NullableString.optional(),
  avatar_url: NullableString.optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * One club the caller holds a membership at (getMyClubs). On main only ACTIVE
 * memberships are listed and a failed read becomes `[]`; P3 lists every
 * membership with its status and tier, and fails the request instead.
 */
export const ClubMembershipSchema = z.object({
  id: ClubIdSchema,
  name: z.string(),
  slug: z.string(),
  address: NullableString.optional(),
  court_types: z.array(z.string()).nullish(),
  role: z.string(),
  status: z.string().optional(), // PENDING P3
  tier: z.object({ id: TierIdSchema, name: z.string() }).nullish(), // PENDING P3
});
export type ClubMembership = z.infer<typeof ClubMembershipSchema>;

/** GET /me */
export const MeSchema = z.object({
  profile: ProfileSchema,
  memberships: z.array(ClubMembershipSchema),
});
export type Me = z.infer<typeof MeSchema>;

export const AnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  isPinned: z.boolean(),
  publishedAt: z.string(),
  authorName: z.string().nullish(),
});
export type Announcement = z.infer<typeof AnnouncementSchema>;

/** GET /me/home?club_id= */
export const HomeSchema = z.object({
  profile: ProfileSchema,
  upcoming_bookings: BookingListSchema,
  announcements: z.array(AnnouncementSchema),
});
export type Home = z.infer<typeof HomeSchema>;

/** PATCH /me/profile returns the profile; POST /me/avatar the public URL. */
export const AvatarUrlSchema = z.string();

export const NOTIFICATION_CATEGORIES = [
  'bookings',
  'tournaments',
  'leagues',
  'messages',
  'clubAnnouncements',
  'promotions',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS = ['push', 'email', 'sms'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

const ChannelTogglesSchema = z.object({ push: z.boolean(), email: z.boolean(), sms: z.boolean() });

/** GET/PUT /me/preferences : the category x channel matrix (PUT is a full replace). */
export const NotificationPreferencesSchema = z.object({
  bookings: ChannelTogglesSchema,
  tournaments: ChannelTogglesSchema,
  leagues: ChannelTogglesSchema,
  messages: ChannelTogglesSchema,
  clubAnnouncements: ChannelTogglesSchema,
  promotions: ChannelTogglesSchema,
  smsPhone: NullableString.optional(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

/** GET /me/checkin-token?club_id= (PENDING P5): signed, short-lived member QR. */
export const CheckinTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  ttlSeconds: z.number(),
});
export type CheckinToken = z.infer<typeof CheckinTokenSchema>;

/** DELETE /me/account (PENDING P5). A 409 deletion_blocked carries `details.blockers`. */
export const DeleteAccountResultSchema = z.object({
  status: z.enum(['deleted', 'scheduled']),
});
export type DeleteAccountResult = z.infer<typeof DeleteAccountResultSchema>;

export const DeletionBlockerSchema = z.object({
  code: z.string(),
  message: z.string(),
  club_id: ClubIdSchema.nullish(),
});
export type DeletionBlocker = z.infer<typeof DeletionBlockerSchema>;

/** POST /me/devices (PENDING P1). */
export const RegisteredDeviceSchema = z.object({
  token: z.string(),
  platform: z.enum(['ios', 'android']),
});
export type RegisteredDevice = z.infer<typeof RegisteredDeviceSchema>;

// ─── Groups (member social groups, never "clubs") ────────────────────────────

export const GroupRoleSchema = z.enum(['owner', 'member']);
export type GroupRole = z.infer<typeof GroupRoleSchema>;

export const GroupSummarySchema = z.object({
  id: GroupIdSchema,
  club_id: ClubIdSchema,
  name: z.string(),
  description: NullableString,
  cover_image_url: NullableString,
  member_count: z.number().int(),
  my_role: GroupRoleSchema.nullable(),
  created_at: z.string(),
});
export type GroupSummary = z.infer<typeof GroupSummarySchema>;
export const GroupSummariesSchema = z.array(GroupSummarySchema);

export const GroupMemberSchema = z.object({
  user_id: UserIdSchema,
  role: GroupRoleSchema,
  joined_at: z.string(),
  full_name: NullableString,
  username: NullableString,
  avatar_url: NullableString,
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;
export const GroupMembersSchema = z.array(GroupMemberSchema);

export const GroupDetailSchema = GroupSummarySchema.extend({
  members: z.array(GroupMemberSchema),
  permissions: z.object({
    can_edit: z.boolean(),
    can_delete: z.boolean(),
    can_manage_members: z.boolean(),
    can_invite: z.boolean(),
    can_leave: z.boolean(),
  }),
});
export type GroupDetail = z.infer<typeof GroupDetailSchema>;

export const GroupInvitationSchema = z.object({
  id: GroupInvitationIdSchema,
  group_id: GroupIdSchema,
  group_name: z.string(),
  club_id: ClubIdSchema,
  status: z.string(),
  created_at: z.string(),
});
export type GroupInvitation = z.infer<typeof GroupInvitationSchema>;
export const GroupInvitationsSchema = z.array(GroupInvitationSchema);

export const GroupInviteLinkSchema = z.object({
  token: z.string(),
  expires_at: NullableString,
  max_uses: z.number().int().nullable(),
});
export type GroupInviteLink = z.infer<typeof GroupInviteLinkSchema>;

export const GroupInvitePreviewSchema = z.object({
  group: GroupSummarySchema,
  already_member: z.boolean(),
});
export type GroupInvitePreview = z.infer<typeof GroupInvitePreviewSchema>;

export const GroupActivityItemSchema = z.object({
  booking_id: BookingIdSchema,
  date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  status: z.string(),
  court_name: NullableString,
  court_type: NullableString,
  organizer_id: UserIdSchema,
  participant_count: z.number().int(),
  i_am_participant: z.boolean(),
});
export type GroupActivityItem = z.infer<typeof GroupActivityItemSchema>;
export const GroupActivitySchema = z.array(GroupActivityItemSchema);

/** create, respond, join all answer with the group id. */
export const GroupIdResultSchema = z.object({ group_id: GroupIdSchema });

/** POST /groups/{id}/cover-image : the new public URL. */
export const CoverUrlSchema = z.string();
