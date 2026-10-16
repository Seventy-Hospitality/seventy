/**
 * Whether the member may book, decided ONLY through entitlement() over
 * GET /me/membership (membership-view.ts), and what to tell them when not.
 * Clutch still enforces membership on every hold; this gate keeps a member
 * who cannot book from walking into a refusal, and sends them where it is
 * fixed: onboarding to join or pick a tier, billing to finish or restore a
 * payment.
 */
import type { Entitlement } from '../../lib/clutch';

export interface MembershipGateCopy {
  title: string;
  description: string;
  actionLabel: string;
  href: '/onboarding/plan' | '/account/billing';
}

export function membershipGateCopy(entitlement: Exclude<Entitlement, 'entitled'>): MembershipGateCopy {
  switch (entitlement) {
    case 'no_membership':
      return {
        title: 'Join the club to book',
        description: 'Booking courts is for club members. Choose a membership to get started.',
        actionLabel: 'Choose a membership',
        href: '/onboarding/plan',
      };
    case 'no_tier':
      return {
        title: 'Choose a membership tier',
        description: 'You are a member, but booking needs a membership tier. Pick one to start booking.',
        actionLabel: 'Choose a tier',
        href: '/onboarding/plan',
      };
    case 'payment_pending':
      return {
        title: 'Your membership payment is not finished',
        description: 'Your membership starts once its first payment goes through. Finish it to book courts.',
        actionLabel: 'Finish payment',
        href: '/account/billing',
      };
    case 'lapsed':
      return {
        title: 'Your membership is not active',
        description:
          'Your membership lapsed or is on hold, so booking is paused. Check your billing to restore it.',
        actionLabel: 'Check billing',
        href: '/account/billing',
      };
  }
}
