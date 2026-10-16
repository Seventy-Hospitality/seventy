/**
 * Where a signed-in person resumes onboarding, decided from Clutch's state.
 *
 * Supabase issues a session only after the email is confirmed, so there is no
 * verify-email step, and ID verification was dropped (owner decision). What
 * is left:
 *
 *   name     -> the Clutch profile has no name (accounts made from an emailed
 *               code or link): ask for it, PATCH /me/profile, re-read /me.
 *   join     -> GET /me lists no membership at this club. The gate calls
 *               POST /clubs/{club}/join (idempotent) and re-reads; it never
 *               infers membership from the join answer.
 *   plan     -> a member in good standing without a tier picks one.
 *   checkout -> a subscription attempt waits on its first payment: resume it.
 *   lapsed   -> was a member; the club standing (suspended, expired,
 *               inactive) or the billing (canceled, past_due, unpaid, ...)
 *               lapsed. Its own screen: renew, or talk to the club.
 *   done     -> in the app.
 *
 * Membership is decided ONLY through entitlement(view) (membership-view.ts),
 * never by reading rows here. Pure so every branch is a unit test; the gate
 * (OnboardingGate) and the hook (useOnboardingResume) apply it.
 */
import {
  entitlement,
  type ClubId,
  type ClubMembership,
  type GetMeResponse,
  type MembershipView,
  type Profile,
} from '../../lib/clutch';

/**
 * Recorded by Clutch when the member accepts the Terms of Service at
 * checkout. Bump when the terms text changes.
 */
export const TERMS_VERSION = '2026-08';

export type Me = GetMeResponse['data'];

export type OnboardingStep = 'name' | 'join' | 'plan' | 'checkout' | 'lapsed' | 'done';

/** The caller's membership at this club, if /me lists one. */
export function membershipAt(me: Me, clubId: ClubId): ClubMembership | null {
  return me.memberships.find((m) => m.id === clubId) ?? null;
}

/** Clutch sends '' for "no name"; whitespace is no name either. */
export function hasProfileName(profile: Pick<Profile, 'full_name'>): boolean {
  return profile.full_name.trim().length > 0;
}

/** Whether resolving the step needs GET /me/membership. */
export function needsMembershipView(me: Me, clubId: ClubId): boolean {
  return hasProfileName(me.profile) && membershipAt(me, clubId) !== null;
}

export interface OnboardingInput {
  me: Me;
  clubId: ClubId;
  /**
   * GET /me/membership, read once /me shows a membership here
   * (needsMembershipView). An empty answer means no membership (P3 fails the
   * request instead of answering empty).
   */
  view: MembershipView | null;
}

export function resolveOnboardingStep({ me, clubId, view }: OnboardingInput): OnboardingStep {
  if (!hasProfileName(me.profile)) return 'name';
  if (!membershipAt(me, clubId) || !view) return 'join';
  switch (entitlement(view)) {
    case 'entitled':
      return 'done';
    case 'no_membership':
      return 'join';
    case 'no_tier':
      return 'plan';
    case 'payment_pending':
      return 'checkout';
    case 'lapsed':
      return 'lapsed';
  }
}

/**
 * A lapsed member may renew in the app only when billing (not the club) is
 * what lapsed, and paying is available: a club standing that is not active
 * is the club's call, and subscribing would be refused.
 */
export function canRenewInApp(view: MembershipView, nativePayments: boolean): boolean {
  return nativePayments && view.kind === 'billing' && view.data.membership?.status === 'active';
}

/** The route of a step that has one; name, join and lapsed render in place. */
export function onboardingPathForStep(step: OnboardingStep): string | null {
  switch (step) {
    case 'plan':
      return '/onboarding/plan';
    case 'checkout':
      return '/onboarding/checkout';
    case 'done':
      return '/(tabs)';
    case 'name':
    case 'join':
    case 'lapsed':
      return null;
  }
}

/**
 * Which /onboarding/* routes a step may visit. Plan and checkout are
 * interchangeable while unpaid: checkout links back to change the tier, and
 * subscribe reuses a pending attempt for the same tier and replaces one for
 * another tier (P2). A lapsed member renewing in the app uses the same two.
 */
export function canVisitOnboardingPath(
  step: OnboardingStep,
  pathname: string,
  opts: { renewInApp: boolean } = { renewInApp: false },
): boolean {
  const tierRoute = pathname === '/onboarding/plan' || pathname === '/onboarding/checkout';
  switch (step) {
    case 'plan':
    case 'checkout':
      return tierRoute;
    case 'lapsed':
      return opts.renewInApp && tierRoute;
    case 'name':
    case 'join':
    case 'done':
      return false;
  }
}

/** What a checkout attempt came to. The sheet completing proves nothing; only Clutch does. */
export type CheckoutOutcome = 'active' | 'processing' | 'failed';

/** From POST /me/membership/confirm's answer. */
export function confirmOutcome(confirm: {
  activated: boolean;
  payment_status: 'succeeded' | 'pending' | 'failed' | 'none';
}): CheckoutOutcome {
  if (confirm.activated) return 'active';
  switch (confirm.payment_status) {
    case 'failed':
      return 'failed';
    case 'pending':
    case 'succeeded':
    case 'none':
      // Paid but not applied yet, or not paid yet: re-check, never claim success.
      return 'processing';
  }
}

/** From a re-read of GET /me/membership (when confirm itself could not answer). */
export function viewOutcome(view: MembershipView): CheckoutOutcome {
  switch (entitlement(view)) {
    case 'entitled':
      return 'active';
    case 'payment_pending':
    case 'no_tier':
      // Not applied yet (or not paid): offer a re-check, never a second charge.
      return 'processing';
    case 'no_membership':
    case 'lapsed':
      return 'failed';
  }
}

/** The word for why a membership lapsed (a standing or a billing status), for the lapsed screen. */
export function lapsedReason(view: MembershipView): string | null {
  const membership = view.data.membership;
  if (membership && membership.status !== 'active') return membership.status;
  if (view.kind === 'billing') return view.data.billing.subscription_status;
  return view.data.subscription && view.data.subscription.status !== 'active' ? view.data.subscription.status : null;
}
