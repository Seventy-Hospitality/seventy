/**
 * Where a signed-in person resumes onboarding, decided from Clutch's state.
 *
 * Supabase issues a session only after the email is confirmed, so there is no
 * verify-email step, and ID verification was dropped (owner decision). What
 * is left:
 *
 *   join     -> GET /me lists no membership at this club. The gate calls
 *               POST /clubs/{club}/join (idempotent) and re-reads /me; it
 *               never infers membership from the join answer.
 *   inactive -> a membership exists but its standing is not active
 *               (suspended, expired, inactive). Only Clutch P3 lists these;
 *               the member has to talk to the club, so this is support UI.
 *   plan     -> a player with no tier subscription picks a tier.
 *   checkout -> a subscription attempt was started and never completed
 *               (P2: subscription_status 'incomplete'): resume paying.
 *   done     -> in the app. Staff roles never pick a tier.
 *
 * Pure so every branch is a unit test; the gate (OnboardingGate) and the
 * hook (useOnboardingResume) apply it.
 */
import type {
  ClubId,
  ClubMembership,
  Me,
  MySubscription,
} from '../../lib/clutch';

/**
 * Recorded by Clutch when the member accepts the Terms and Conditions at
 * checkout. Bump when the terms text changes.
 */
export const TERMS_VERSION = '2026-08';

export type OnboardingStep = 'join' | 'inactive' | 'plan' | 'checkout' | 'done';

/** Club roles that run the club: they never pick or pay for a tier. */
const STAFF_ROLES = new Set(['coach', 'staff', 'admin', 'owner']);

export function isStaffRole(role: string): boolean {
  return STAFF_ROLES.has(role);
}

/** The caller's membership at this club, if /me lists one. */
export function membershipAt(me: Me, clubId: ClubId): ClubMembership | null {
  return me.memberships.find((m) => m.id === clubId) ?? null;
}

/**
 * The billing state of a subscription. P2 separates billing
 * (`subscription_status`, Stripe's words) from club standing (`status`); on
 * main only `status` exists and a tier row there means it was paid.
 */
export type BillingState = 'live' | 'incomplete' | 'expired';

export function billingState(sub: MySubscription): BillingState {
  switch (sub.subscription_status ?? null) {
    case 'incomplete':
      return 'incomplete';
    case 'incomplete_expired':
      return 'expired';
    default:
      // active, trialing, past_due, unpaid, paused, canceled, or main's
      // absent field: the purchase happened. A lapsed member is a renewal
      // concern (Billing), not onboarding, and keeps the app shell.
      return 'live';
  }
}

export interface OnboardingInput {
  me: Me;
  clubId: ClubId;
  /**
   * GET /me/membership's subscription. Only read once /me shows a membership;
   * `undefined` means "not read yet" and is never passed to the resolver.
   * `null` is uncertain until P3 (a failed sub-read looks the same), which is
   * acceptable here: the plan step moves no money, and subscribe answers
   * subscription_exists when one is live.
   */
  subscription: MySubscription | null;
}

export function resolveOnboardingStep({ me, clubId, subscription }: OnboardingInput): OnboardingStep {
  const membership = membershipAt(me, clubId);
  if (!membership) return 'join';
  // P3 lists non-active memberships with their standing; main lists active only.
  if (membership.status !== undefined && membership.status !== 'active') return 'inactive';
  if (isStaffRole(membership.role)) return 'done';
  if (!subscription) return 'plan';
  switch (billingState(subscription)) {
    case 'incomplete':
      return 'checkout';
    case 'expired':
      return 'plan';
    case 'live':
      return 'done';
  }
}

/** Whether resolving the step needs GET /me/membership (members who are not staff). */
export function needsSubscription(me: Me, clubId: ClubId): boolean {
  const membership = membershipAt(me, clubId);
  return (
    membership !== null &&
    (membership.status === undefined || membership.status === 'active') &&
    !isStaffRole(membership.role)
  );
}

/** The route of a step that has one; join and inactive render in place. */
export function onboardingPathForStep(step: OnboardingStep): string | null {
  switch (step) {
    case 'plan':
      return '/onboarding/plan';
    case 'checkout':
      return '/onboarding/checkout';
    case 'done':
      return '/(tabs)';
    case 'join':
    case 'inactive':
      return null;
  }
}

/**
 * Which /onboarding/* routes a step may visit. Plan and checkout are
 * interchangeable while unpaid: checkout links back to change the tier, and
 * subscribe reuses an incomplete attempt for the same tier and cancels one
 * for another tier (P2).
 */
export function canVisitOnboardingPath(step: OnboardingStep, pathname: string): boolean {
  switch (step) {
    case 'plan':
    case 'checkout':
      return pathname === '/onboarding/plan' || pathname === '/onboarding/checkout';
    case 'join':
    case 'inactive':
    case 'done':
      return false;
  }
}

/**
 * What a checkout attempt came to, read off Clutch's subscription after
 * confirm. The sheet completing proves nothing; only this does.
 */
export type CheckoutOutcome = 'active' | 'processing' | 'failed';

export function checkoutOutcome(subscription: MySubscription | null): CheckoutOutcome {
  // No subscription after confirm: Clutch has not applied it yet (or the
  // read failed, uncertain until P3). Never report success; offer a re-check.
  if (!subscription) return 'processing';
  const status = subscription.subscription_status ?? null;
  // main has no billing field: a tier row there was written by a paid checkout.
  if (status === null || status === 'active' || status === 'trialing') return 'active';
  if (status === 'incomplete' || status === 'processing') return 'processing';
  return 'failed';
}
