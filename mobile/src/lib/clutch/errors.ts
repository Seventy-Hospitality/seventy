/**
 * Clutch's error vocabulary and the one error type the app handles.
 *
 * Every Clutch failure is `{ error, message, details? }` where `error` is a
 * stable snake_case code (packages/db/src/errors.ts CODES on the Clutch side).
 * The app branches ONLY on `ClutchError.code`, never on `message` (prose, not
 * load-bearing). A code the app does not know arrives as `code: 'unknown'`
 * with the wire value kept in `rawCode`, so an exhaustive switch over
 * ErrorCode stays honest when Clutch adds a code.
 *
 * TO BE REPLACED: once Clutch's feat/api-contract publishes ErrorCode in
 * docs/api/openapi.json, `scripts/gen-clutch-contract.mjs` emits this list.
 * Until then it is copied from origin/main packages/db/src/errors.ts, plus the
 * codes api.ts emits outside CODES and the codes the in-flight P-branches
 * specify (marked below).
 */

export const ERROR_CODES = [
  // packages/db/src/errors.ts CODES (origin/main)
  'auth_required',
  'invalid_credentials',
  'invalid_token',
  'session_expired',
  'mfa_required',
  'email_not_confirmed',
  'not_authorized',
  'insufficient_scope',
  'club_creation_not_permitted',
  'platform_managed_column',
  'not_found',
  'club_not_found',
  'court_not_found',
  'booking_not_found',
  'service_not_found',
  'lesson_not_found',
  'program_not_found',
  'session_not_found',
  'enrollment_not_found',
  'registration_not_found',
  'tournament_not_found',
  'package_not_found',
  'payment_method_not_found',
  'payment_method_not_owned',
  'notification_not_found',
  'profile_not_found',
  'waiver_not_found',
  'tier_not_found',
  'coach_not_found',
  'owner_not_found',
  'invalid_json',
  'missing_parameter',
  'missing_field',
  'invalid_field',
  'field_too_long',
  'invalid_time_range',
  'password_too_short',
  'invalid_timezone',
  'invalid_slug',
  'invalid_currency',
  'invalid_court_type',
  'invalid_hours',
  'invalid_booking_rules',
  'courts_required',
  'name_too_long',
  'group_not_found',
  'target_not_member',
  'member_not_found',
  'invitation_not_found',
  'invitation_not_pending',
  'invite_link_invalid',
  'group_exceeds_capacity',
  'club_mismatch',
  'must_transfer_first',
  'cannot_remove_self',
  'group_operation_failed',
  'invalid_content_type',
  'unsupported_image_type',
  'file_too_large',
  'upload_failed',
  'invalid_username',
  'name_required',
  'slot_already_booked',
  'slot_unavailable',
  'court_not_available',
  'booking_cancelled',
  'booking_completed',
  'booking_not_pending',
  'booking_changed',
  'cannot_book_past',
  'cancellation_window_passed',
  'waiver_required',
  'waiver_unavailable',
  'no_show_penalty',
  'not_club_member',
  'already_registered',
  'already_enrolled',
  'already_on_waiting_list',
  'already_paid',
  'session_full',
  'tournament_full',
  'registration_closed',
  'deadline_passed',
  'prerequisite_required',
  'age_out_of_range',
  'own_booking',
  'not_a_participant',
  'chat_not_allowed',
  'already_joined',
  'organizer_cannot_leave',
  'not_open_play',
  'wrong_password',
  'share_link_invalid',
  'booking_ended',
  'booking_started',
  'booking_not_confirmed',
  'booking_not_bookable',
  'invite_not_pending',
  'cannot_cancel',
  'cannot_reschedule',
  'not_enrolled',
  'no_active_subscription',
  'username_taken',
  'advance_booking_exceeded',
  'duration_out_of_range',
  'direct_booking_disabled',
  'program_not_available',
  'slug_already_exists',
  'club_limit_reached',
  'club_stripe_not_connected',
  'insufficient_credits',
  'no_session_passes',
  'nothing_to_pay',
  'payment_incomplete',
  'payment_mismatch',
  'payment_requires_action',
  'not_simulated',
  'payment_not_found',
  'payment_taken_booking_changed',
  'card_not_found',
  'no_amount',
  'tier_not_configured',
  'share_exceeds_total',
  'share_mismatch',
  'share_invalid',
  'payment_returned',
  'nothing_owed',
  'shares_not_open',
  'price_below_collected',
  'reschedule_costs_more',
  'discount_code_invalid',
  'discount_code_not_applicable',
  'discount_code_min_amount_not_met',
  'discount_code_maxed_out',
  'discount_code_already_used',
  'pass_limit_reached',
  'pass_already_used',
  'payment_not_verified',
  'ach_not_enabled',
  'payment_failed',
  'rate_limit_exceeded',
  'internal_error',
  'upstream_error',
  // packages/db/src/api.ts (idempotency) and route-level validation
  'request_in_flight',
  'idempotency_key_reused',
  'invalid_input',
  // Pending: feat/native-payments (P2)
  'subscription_exists',
  // Pending: feat/member-booking-parity (P4), payment_not_verified split
  'payment_processing',
  'members_only',
  'tier_required',
  // Pending: feat/account-deletion-and-checkin (P5)
  'step_up_required',
  'deletion_blocked',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const KNOWN = new Set<string>(ERROR_CODES);

export function isErrorCode(value: string): value is ErrorCode {
  return KNOWN.has(value);
}

/**
 * - `api`: Clutch answered with an error envelope.
 * - `network`: no answer (offline, DNS, timeout); status 0.
 * - `contract`: Clutch answered something that is not the documented shape.
 */
export type ClutchErrorKind = 'api' | 'network' | 'contract';

export class ClutchError extends Error {
  readonly code: ErrorCode | 'unknown';
  /** The code exactly as Clutch sent it (equals `code` unless unknown). */
  readonly rawCode: string;
  readonly status: number;
  readonly kind: ClutchErrorKind;
  readonly details?: Record<string, unknown>;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    kind: ClutchErrorKind;
    details?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = 'ClutchError';
    this.rawCode = init.code;
    this.code = isErrorCode(init.code) ? init.code : 'unknown';
    this.status = init.status;
    this.kind = init.kind;
    this.details = init.details;
  }
}

export function isClutchError(err: unknown): err is ClutchError {
  return err instanceof ClutchError;
}

/** True when `err` is a ClutchError carrying one of `codes`. */
export function hasCode(err: unknown, ...codes: ErrorCode[]): err is ClutchError {
  return err instanceof ClutchError && err.code !== 'unknown' && codes.includes(err.code);
}

/**
 * A failure worth retrying with the SAME Idempotency-Key: nothing durable was
 * decided (no answer, a 5xx, or the first attempt is still running). Clutch
 * caches every response below 500 under the key, so retrying a 4xx with the
 * same key would only replay it.
 */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof ClutchError)) return true;
  if (err.kind === 'network') return true;
  if (err.kind === 'contract') return false;
  return err.status >= 500 || err.code === 'request_in_flight';
}

/** Compile-time exhaustiveness guard for `switch (err.code)`. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}
