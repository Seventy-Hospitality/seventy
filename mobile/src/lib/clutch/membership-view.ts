/**
 * One reading of "may this member use the club right now", whichever shape
 * GET /me/membership answers in: the club-standing view published today (P3)
 * or the billing view feat/native-payments adds (P2). Booking and onboarding
 * both decide from `entitlement()`; nothing else interprets membership rows.
 */
import type { GetMyClubMembershipResponse } from './contract.gen';
import type { MyMembershipBilling } from './contract.pending';

export type StandingMembership = GetMyClubMembershipResponse['data'];

export type MembershipView =
  | { kind: 'standing'; data: StandingMembership }
  | { kind: 'billing'; data: MyMembershipBilling };

export type Entitlement =
  /** May book: an active member with a tier (or a staff role, which needs none). */
  | 'entitled'
  /** No membership row at this club: join first. */
  | 'no_membership'
  /** A member in good standing without a tier: choose one. */
  | 'no_tier'
  /** A subscription attempt is waiting on its first payment. */
  | 'payment_pending'
  /** Was a paying member; billing or standing lapsed (canceled, past_due, unpaid, suspended, expired, ...). */
  | 'lapsed';

const STAFF_ROLES = new Set(['coach', 'staff', 'admin', 'owner']);

export function membershipRole(view: MembershipView): string | null {
  return view.data.membership?.role ?? null;
}

export function currentTierName(view: MembershipView): string | null {
  if (view.kind === 'billing') return view.data.tier?.name ?? null;
  return view.data.membership?.tier?.name ?? view.data.subscription?.tier_name ?? null;
}

export function entitlement(view: MembershipView): Entitlement {
  const membership = view.data.membership;
  if (!membership) return 'no_membership';
  const staff = STAFF_ROLES.has(membership.role);

  if (view.kind === 'billing') {
    const { billing, tier, pending_attempt } = view.data;
    if (membership.status !== 'active') return staff ? 'entitled' : 'lapsed';
    if (staff) return 'entitled';
    if (billing.entitled && tier) return 'entitled';
    if (pending_attempt || billing.subscription_status === 'incomplete') return 'payment_pending';
    if (billing.has_subscription || billing.subscription_status !== null) return 'lapsed';
    return 'no_tier';
  }

  // Club standing only: billing lapses show up as the club suspending or
  // expiring the membership.
  const standing = view.data.membership;
  if (!standing || standing.status !== 'active') return 'lapsed';
  if (staff) return 'entitled';
  return standing.tier ? 'entitled' : 'no_tier';
}
