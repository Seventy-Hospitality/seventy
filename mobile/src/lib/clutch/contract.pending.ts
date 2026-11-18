/**
 * HAND-WRITTEN: operations that are NOT in clutch/openapi.json yet.
 *
 * Each block mirrors the actual schema code of the Clutch branch that adds the
 * operation. When that branch merges and its routes appear in the published
 * OpenAPI document, regenerate contract.gen.ts, delete the block here, point
 * client.ts at the generated schemas and flip its capability in
 * capabilities.ts. Nothing else in the app should define response shapes.
 *
 *   P1 feat/expo-push (pushed)          apps/web/app/api/v1/me/devices/route.ts, _shape.ts publicDevice
 *   P5 feat/account-deletion-and-checkin (pushed)
 *                                        apps/web/app/api/v1/me/{account,account/deletion,checkin-token}, _shape.ts
 *   P2 feat/native-payments (pushed)    apps/web/app/api/v1/_billing.ts. Its payment fields are
 *                                        being renamed to snake_case (client_secret, intent_type,
 *                                        customer_id, ephemeral_key_secret, stripe_account,
 *                                        simulated) as it is ported onto P3's contract; the
 *                                        schemas below use that agreed naming, to be checked at
 *                                        the final regeneration.
 *   P4 feat/member-booking-parity (pushed)
 *                                        apps/web/app/api/v1/_booking-contract.ts
 *   main (owned by P2, not in the P3 document): POST /bookings/{id}/payment-intent,
 *                                        GET /me/payment-methods, POST /bookings/{id}/payment-intent/pay
 *   feat/api-publishable-key (we-are-clutch #187) `publishable_key` and `stripe_account` on the
 *                                        two payment routes outside the document (booking checkout,
 *                                        setup intent). The routes in the document are generated.
 */
import { z } from 'zod';
import type { MoveCheckout, ShareCheckout } from './contract.gen';
import {
  BookingIdSchema,
  CardIdSchema,
  ClubIdSchema,
  CourtIdSchema,
  TierIdSchema,
  UserIdSchema,
} from './ids';

// ─── Error codes these branches add ─────────────────────────────────────────

export const PENDING_ERROR_CODES = [
  // P2 (packages/db/src/errors.ts on feat/native-payments)
  'already_subscribed',
  'membership_not_active',
  'membership_unconfirmed',
  'already_on_tier',
  'tier_interval_mismatch',
  'subscription_ending',
  'not_cancelling',
  'setup_incomplete',
  'card_in_use_by_subscription',
] as const;

// ─── feat/api-publishable-key: the Stripe key travels with the intent ──────

/**
 * Clutch's platform publishable key, next to the `client_secret` of the routes
 * outside the OpenAPI document. Null when nothing is charged or the deployment
 * has no key. Read as optional so a deployment without #187 degrades to "no
 * key" (the sheet resolves `unconfigured`) instead of failing to parse.
 */
const PublishableKey = { publishable_key: z.string().nullable().optional() };

// ─── Push payloads (packages/notifications; not API responses) ──────────────

/** `data.type` of the verification push (packages/notifications/src/push.ts). */
export const DEVICE_VERIFICATION_PUSH_TYPE = 'clutch.device_verification';

/** `data` of every notice Clutch pushes (packages/notifications/src/expo.ts PushData). */
export const PushNoticeDataSchema = z.object({
  notificationId: z.string(),
  type: z.string(),
  clubId: z.string(),
  /** The path that shows the notice: today always the inbox ("/notifications"). */
  link: z.string(),
});
export type PushNoticeData = z.infer<typeof PushNoticeDataSchema>;

export const DeviceVerificationPushSchema = z.object({
  type: z.literal(DEVICE_VERIFICATION_PUSH_TYPE),
  code: z.string(),
});

// ─── main today (P2 replaces): booking checkout and saved cards ─────────────

/** POST /bookings/{id}/payment-intent on main: no customer, no ephemeral key. */
export const LegacyBookingCheckoutSchema = z.object({
  clientSecret: z.string(),
  paymentIntentId: z.string(),
  simulated: z.boolean(),
  /** The original camelCase account: absent for a club on the platform account. */
  stripeAccount: z.string().optional(),
  /** #187: the account in snake_case, null for a club on the platform account. Preferred. */
  stripe_account: z.string().nullable().optional(),
  taxAmountCents: z.number().int().optional(),
  subtotalCents: z.number().int().optional(),
  /** What the card is charged, tax included (Clutch states it since #181). */
  total_cents: z.number().int().optional(),
  ...PublishableKey,
});
export type LegacyBookingCheckout = z.infer<typeof LegacyBookingCheckoutSchema>;

/** POST /bookings/{id}/payment-intent/pay (simulated deployments). */
export const SimulatedPaySchema = z.object({ status: z.string() });

// ─── P2: native payments (_billing.ts) ──────────────────────────────────────

/** What every endpoint that opens Stripe's PaymentSheet returns (snake_case per the merge plan). */
export const SheetBundleSchema = z.object({
  client_secret: z.string().nullable(),
  intent_type: z.enum(['payment', 'setup']),
  customer_id: z.string().nullable(),
  /** Present when the request asked for `sheet: true` and Stripe is real. */
  ephemeral_key_secret: z.string().nullable(),
  /** The connected account to initialise Stripe with; null for the platform. */
  stripe_account: z.string().nullable(),
  simulated: z.boolean(),
  ...PublishableKey,
});
export type SheetBundle = z.infer<typeof SheetBundleSchema>;

export const BillingTierSchema = z.object({
  id: TierIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  price_cents: z.number().int(),
  currency: z.string(),
  interval: z.string(),
});
export type BillingTier = z.infer<typeof BillingTierSchema>;

export const SubscriptionStatusSchema = z.enum([
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

/** `membership.status` is the club's standing; `billing` is Stripe's. */
export const MembershipBillingSchema = z.object({
  membership: z
    .object({
      id: z.string(),
      club_id: ClubIdSchema,
      role: z.string(),
      status: z.string(),
      skill_level: z.string().nullable(),
      agreed: z.boolean(),
    })
    .nullable(),
  tier: BillingTierSchema.nullable(),
  billing: z.object({
    has_subscription: z.boolean(),
    subscription_status: SubscriptionStatusSchema.nullable(),
    entitled: z.boolean(),
    current_period_end: z.string().nullable(),
    cancel_at_period_end: z.boolean(),
    pending_tier: BillingTierSchema.nullable(),
    pending_tier_effective_at: z.string().nullable(),
  }),
  pending_attempt: z
    .object({ id: z.string(), tier_id: TierIdSchema, created_at: z.string().nullable() })
    .nullable(),
});
export type MembershipBilling = z.infer<typeof MembershipBillingSchema>;

/** GET /me/membership on P2: the billing view plus the older summary. */
export const MyMembershipBillingSchema = MembershipBillingSchema.extend({
  subscription: z
    .object({
      membership_id: z.string(),
      tier_id: TierIdSchema,
      tier_name: z.string(),
      tier_description: z.string().nullable(),
      price_cents: z.number().int(),
      currency: z.string(),
      interval: z.string(),
      status: z.string(),
      subscription_status: z.string().nullable(),
      has_subscription: z.boolean(),
      current_period_end: z.string().nullable(),
      cancel_at_period_end: z.boolean(),
      pending_tier_id: TierIdSchema.nullable(),
      pending_tier_name: z.string().nullable(),
      pending_tier_effective_at: z.string().nullable(),
    })
    .nullable(),
});
export type MyMembershipBilling = z.infer<typeof MyMembershipBillingSchema>;

export const SubscribeResultSchema = SheetBundleSchema.extend({
  /** `active`: nothing to pay. Otherwise open the sheet, then POST /confirm. */
  status: z.enum(['active', 'requires_payment', 'requires_setup']),
  subscription_id: z.string(),
  attempt_id: z.string(),
  tier_id: TierIdSchema,
});
export type SubscribeResult = z.infer<typeof SubscribeResultSchema>;

export const MembershipConfirmSchema = z.object({
  activated: z.boolean(),
  payment_status: z.enum(['succeeded', 'pending', 'failed', 'none']),
  membership: MembershipBillingSchema,
});
export type MembershipConfirm = z.infer<typeof MembershipConfirmSchema>;

export const ChangeTierResultSchema = SheetBundleSchema.extend({
  kind: z.enum(['upgraded', 'downgrade_scheduled', 'downgrade_cancelled']),
  /** `requires_payment`: open the sheet with clientSecret, then POST /confirm. */
  status: z.enum(['active', 'requires_payment']),
  effective_at: z.string().nullable(),
});
export type ChangeTierResult = z.infer<typeof ChangeTierResultSchema>;

export const EligibleChangeTierSchema = BillingTierSchema.extend({
  advance_booking_days: z.number().int(),
  change_type: z.enum(['upgrade', 'downgrade']),
});
export type EligibleChangeTier = z.infer<typeof EligibleChangeTierSchema>;
export const EligibleChangeTiersSchema = z.array(EligibleChangeTierSchema);

export const CancelSubscriptionResultSchema = z.object({
  cancel_at_period_end: z.boolean(),
  ended: z.boolean(),
  membership: MembershipBillingSchema,
});
export const ResumeSubscriptionResultSchema = z.object({
  cancel_at_period_end: z.boolean(),
  membership: MembershipBillingSchema,
});

/** A card (or bank account) on file. Also the main GET /me/payment-methods row (main adds fields we ignore). */
export const SavedCardSchema = z.object({
  id: CardIdSchema,
  type: z.string(),
  card_brand: z.string().nullable(),
  card_last4: z.string().nullable(),
  card_exp_month: z.number().int().nullable(),
  card_exp_year: z.number().int().nullable(),
  bank_name: z.string().nullable(),
  bank_last4: z.string().nullable(),
  bank_account_type: z.string().nullable(),
  is_default: z.boolean(),
});
export type SavedCard = z.infer<typeof SavedCardSchema>;
export const SavedCardsSchema = z.array(SavedCardSchema);

export const RemovedCardSchema = z.object({
  removed: z.literal(true),
  new_default_id: CardIdSchema.nullable(),
});

export const SetupIntentSchema = SheetBundleSchema.extend({
  /** Save the card with POST /me/payment-methods { setup_intent_id }. */
  setup_intent_id: z.string(),
});
export type SetupIntent = z.infer<typeof SetupIntentSchema>;

export const BookingCheckoutSchema = SheetBundleSchema.extend({
  payment_intent_id: z.string(),
  subtotal_cents: z.number().int().nullable(),
  tax_cents: z.number().int().nullable(),
});
export type BookingCheckout = z.infer<typeof BookingCheckoutSchema>;

// ─── PaymentSheet intents (app side, built from the bundles above) ──────────

/**
 * The union every payment result is turned into. The ONLY way to show a sheet
 * is presentConnectedSheet(intent) with the `stripe` arm; the `simulated` arm
 * never reaches Stripe. A customer is only ever passed WITH its ephemeral key.
 */
export type SheetIntent =
  | {
      mode: 'stripe';
      intentType: 'payment' | 'setup';
      clientSecret: string;
      intentId: string;
      stripeAccount: string | null;
      /** The key to initialise Stripe with (from the same answer); null: no sheet. */
      publishableKey: string | null;
      customer?: { id: string; ephemeralKeySecret: string };
    }
  | { mode: 'simulated'; intentType: 'payment' | 'setup'; intentId: string | null };

export type StripeSheetIntent = Extract<SheetIntent, { mode: 'stripe' }>;

/** Stripe intent id from a client secret (`pi_123_secret_abc` -> `pi_123`). */
export function intentIdFromClientSecret(clientSecret: string): string {
  const at = clientSecret.indexOf('_secret_');
  return at > 0 ? clientSecret.slice(0, at) : clientSecret;
}

function customerOf(
  customerId: string | null | undefined,
  ephemeralKeySecret: string | null | undefined,
): StripeSheetIntent['customer'] {
  return customerId && ephemeralKeySecret ? { id: customerId, ephemeralKeySecret } : undefined;
}

/** A P2 bundle (subscribe, change, setup intent, booking checkout) as a SheetIntent. */
export function bundleToSheet(bundle: SheetBundle, simulatedIntentId: string | null = null): SheetIntent {
  if (bundle.simulated || !bundle.client_secret) {
    return { mode: 'simulated', intentType: bundle.intent_type, intentId: simulatedIntentId };
  }
  return {
    mode: 'stripe',
    intentType: bundle.intent_type,
    clientSecret: bundle.client_secret,
    intentId: intentIdFromClientSecret(bundle.client_secret),
    stripeAccount: bundle.stripe_account,
    publishableKey: bundle.publishable_key ?? null,
    customer: customerOf(bundle.customer_id, bundle.ephemeral_key_secret),
  };
}

function isP2Checkout(c: BookingCheckout | LegacyBookingCheckout): c is BookingCheckout {
  return 'payment_intent_id' in c;
}

/** The checkout's intent id, whichever shape it came in. */
export function checkoutIntentId(c: BookingCheckout | LegacyBookingCheckout): string {
  return isP2Checkout(c) ? c.payment_intent_id : c.paymentIntentId;
}

/** The checkout's own subtotal and tax, as Clutch computed them (never summed here). */
export function checkoutAmounts(c: BookingCheckout | LegacyBookingCheckout): {
  subtotal_cents: number | null;
  tax_cents: number | null;
} {
  return isP2Checkout(c)
    ? { subtotal_cents: c.subtotal_cents, tax_cents: c.tax_cents }
    : { subtotal_cents: c.subtotalCents ?? null, tax_cents: c.taxAmountCents ?? null };
}

/** A booking checkout (P2 bundle, or main's legacy shape) as a SheetIntent. */
export function bookingCheckoutToSheet(c: BookingCheckout | LegacyBookingCheckout): SheetIntent {
  const intentId = checkoutIntentId(c);
  if (c.simulated) return { mode: 'simulated', intentType: 'payment', intentId };
  if (isP2Checkout(c)) {
    if (!c.client_secret) return { mode: 'simulated', intentType: 'payment', intentId };
    return {
      mode: 'stripe',
      intentType: 'payment',
      clientSecret: c.client_secret,
      intentId,
      stripeAccount: c.stripe_account,
      publishableKey: c.publishable_key ?? null,
      customer: customerOf(c.customer_id, c.ephemeral_key_secret),
    };
  }
  return {
    mode: 'stripe',
    intentType: 'payment',
    clientSecret: c.clientSecret,
    intentId,
    stripeAccount: c.stripe_account !== undefined ? c.stripe_account : (c.stripeAccount ?? null),
    publishableKey: c.publishable_key ?? null,
  };
}

/** A P4 share or move checkout as a SheetIntent. */
export function snakeCheckoutToSheet(c: ShareCheckout | MoveCheckout): SheetIntent {
  if (c.simulated) return { mode: 'simulated', intentType: 'payment', intentId: c.payment_intent_id };
  return {
    mode: 'stripe',
    intentType: 'payment',
    clientSecret: c.client_secret,
    intentId: c.payment_intent_id,
    stripeAccount: c.stripe_account,
    publishableKey: c.publishable_key,
  };
}
