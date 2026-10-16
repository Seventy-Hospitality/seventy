import {
  makeBillingMembership,
  makeMe,
  makeProfile,
  makeStandingMembership,
  makeSubscription,
  TIER_ID,
} from '../../../lib/clutch/fixtures';
import { TEST_CLUB_ID } from '../../../lib/clutch/testing';
import { asClubId, asTierId } from '../../../lib/clutch';
import {
  canRenewInApp,
  canVisitOnboardingPath,
  confirmOutcome,
  hasProfileName,
  lapsedReason,
  needsMembershipView,
  onboardingPathForStep,
  resolveOnboardingStep,
  viewOutcome,
} from '../onboarding';

const OTHER_CLUB = asClubId('99999999-0000-4000-8000-000000000000');

const billing = (over: Parameters<typeof makeBillingMembership>[0]) => makeBillingMembership(over);
const BILLING_BASE = makeBillingMembership();
const baseBilling = BILLING_BASE.kind === 'billing' ? BILLING_BASE.data.billing : (null as never);

function step(view: Parameters<typeof resolveOnboardingStep>[0]['view'], me = makeMe()) {
  return resolveOnboardingStep({ me, clubId: TEST_CLUB_ID, view });
}

describe('resolveOnboardingStep', () => {
  it('asks for a name first when the Clutch profile has none (emailed code or link sign-up)', () => {
    const me = makeMe({ profile: makeProfile({ full_name: '' }), memberships: [] });
    expect(resolveOnboardingStep({ me, clubId: TEST_CLUB_ID, view: null })).toBe('name');
    const blank = makeMe({ profile: makeProfile({ full_name: '   ' }) });
    expect(resolveOnboardingStep({ me: blank, clubId: TEST_CLUB_ID, view: makeStandingMembership() })).toBe('name');
  });

  it('skips the name step once the profile has a name', () => {
    expect(hasProfileName(makeProfile({ full_name: 'Alex' }))).toBe(true);
    expect(hasProfileName(makeProfile({ full_name: '' }))).toBe(false);
    expect(step(makeStandingMembership())).toBe('done');
  });

  it('asks to join when /me lists no membership at this club', () => {
    expect(step(null, makeMe({ memberships: [] }))).toBe('join');
  });

  it('ignores memberships at other clubs', () => {
    const base = makeMe();
    const me = { ...base, memberships: [{ ...base.memberships[0], id: OTHER_CLUB }] };
    expect(resolveOnboardingStep({ me, clubId: TEST_CLUB_ID, view: null })).toBe('join');
    expect(needsMembershipView(me, TEST_CLUB_ID)).toBe(false);
  });

  it('reads the membership view only for a named profile with a membership here', () => {
    expect(needsMembershipView(makeMe(), TEST_CLUB_ID)).toBe(true);
    expect(needsMembershipView(makeMe({ profile: makeProfile({ full_name: '' }) }), TEST_CLUB_ID)).toBe(false);
  });

  describe('club standing view (today)', () => {
    it('is done for an active member with a tier', () => {
      expect(step(makeStandingMembership())).toBe('done');
    });

    it('asks for a tier when an active member has none', () => {
      expect(
        step(
          makeStandingMembership({
            membership: { role: 'player', skill_level: null, status: 'active', tier: null },
            subscription: null,
          }),
        ),
      ).toBe('plan');
    });

    it('treats a suspended or expired standing as lapsed, never done', () => {
      for (const status of ['suspended', 'expired', 'inactive'] as const) {
        const view = makeStandingMembership({
          membership: { role: 'player', skill_level: null, status, tier: { id: TIER_ID, name: 'Member' } },
          subscription: makeSubscription({ status }),
        });
        expect(step(view)).toBe('lapsed');
      }
    });

    it('lets active staff in without a tier', () => {
      const view = makeStandingMembership({
        membership: { role: 'coach', skill_level: null, status: 'active', tier: null },
        subscription: null,
      });
      expect(step(view)).toBe('done');
    });

    it('sends a member the view says is absent to join', () => {
      expect(step(makeStandingMembership({ membership: null, subscription: null }))).toBe('join');
    });
  });

  describe('billing view (P2)', () => {
    it('is done when Clutch says entitled', () => {
      expect(step(BILLING_BASE)).toBe('done');
    });

    it('treats canceled, past_due and unpaid as lapsed, never done', () => {
      for (const status of ['canceled', 'past_due', 'unpaid'] as const) {
        const view = billing({ billing: { ...baseBilling, subscription_status: status, entitled: false } });
        expect(step(view)).toBe('lapsed');
      }
    });

    it('resumes checkout while a first payment is pending', () => {
      const view = billing({
        tier: null,
        billing: { ...baseBilling, has_subscription: false, subscription_status: 'incomplete', entitled: false },
        pending_attempt: { id: 'att_1', tier_id: TIER_ID, created_at: null },
      });
      expect(step(view)).toBe('checkout');
    });

    it('asks for a tier when there is no subscription at all', () => {
      const view = billing({
        tier: null,
        billing: { ...baseBilling, has_subscription: false, subscription_status: null, entitled: false },
      });
      expect(step(view)).toBe('plan');
    });
  });
});

describe('canRenewInApp', () => {
  const lapsedBilling = billing({ billing: { ...baseBilling, subscription_status: 'canceled', entitled: false } });

  it('renews in the app only when paying is available and the club standing is active', () => {
    expect(canRenewInApp(lapsedBilling, true)).toBe(true);
    expect(canRenewInApp(lapsedBilling, false)).toBe(false);
    expect(canRenewInApp(makeStandingMembership(), true)).toBe(false);
  });

  it('never offers renewal when the club itself suspended the membership', () => {
    const view = makeBillingMembership();
    if (view.kind !== 'billing' || !view.data.membership) throw new Error('fixture');
    const suspended = billing({ membership: { ...view.data.membership, status: 'suspended' } });
    expect(canRenewInApp(suspended, true)).toBe(false);
  });
});

describe('lapsedReason', () => {
  it('names the standing first, then the billing status', () => {
    const view = makeBillingMembership();
    if (view.kind !== 'billing' || !view.data.membership) throw new Error('fixture');
    expect(lapsedReason(billing({ membership: { ...view.data.membership, status: 'suspended' } }))).toBe('suspended');
    expect(lapsedReason(billing({ billing: { ...baseBilling, subscription_status: 'past_due' } }))).toBe('past_due');
    expect(
      lapsedReason(
        makeStandingMembership({
          membership: { role: 'player', skill_level: null, status: 'expired', tier: null },
          subscription: null,
        }),
      ),
    ).toBe('expired');
  });
});

describe('onboarding routes', () => {
  it('routes plan and checkout, and renders name, join and lapsed in place', () => {
    expect(onboardingPathForStep('plan')).toBe('/onboarding/plan');
    expect(onboardingPathForStep('checkout')).toBe('/onboarding/checkout');
    expect(onboardingPathForStep('done')).toBe('/(tabs)');
    expect(onboardingPathForStep('name')).toBeNull();
    expect(onboardingPathForStep('join')).toBeNull();
    expect(onboardingPathForStep('lapsed')).toBeNull();
  });

  it('lets plan and checkout move between each other, and nothing else in', () => {
    expect(canVisitOnboardingPath('plan', '/onboarding/checkout')).toBe(true);
    expect(canVisitOnboardingPath('checkout', '/onboarding/plan')).toBe(true);
    expect(canVisitOnboardingPath('done', '/onboarding/plan')).toBe(false);
    expect(canVisitOnboardingPath('name', '/onboarding/plan')).toBe(false);
    expect(canVisitOnboardingPath('join', '/onboarding/plan')).toBe(false);
  });

  it('lets a lapsed member reach the tier step only to renew in the app', () => {
    expect(canVisitOnboardingPath('lapsed', '/onboarding/plan')).toBe(false);
    expect(canVisitOnboardingPath('lapsed', '/onboarding/plan', { renewInApp: true })).toBe(true);
    expect(canVisitOnboardingPath('lapsed', '/onboarding/checkout', { renewInApp: true })).toBe(true);
  });
});

describe('checkout outcomes', () => {
  it("decides from confirm's answer, never claiming success without activation", () => {
    expect(confirmOutcome({ activated: true, payment_status: 'succeeded' })).toBe('active');
    expect(confirmOutcome({ activated: false, payment_status: 'succeeded' })).toBe('processing');
    expect(confirmOutcome({ activated: false, payment_status: 'pending' })).toBe('processing');
    expect(confirmOutcome({ activated: false, payment_status: 'none' })).toBe('processing');
    expect(confirmOutcome({ activated: false, payment_status: 'failed' })).toBe('failed');
  });

  it('falls back to entitlement of a re-read', () => {
    expect(viewOutcome(BILLING_BASE)).toBe('active');
    expect(
      viewOutcome(
        billing({
          tier: null,
          billing: { ...baseBilling, has_subscription: false, subscription_status: 'incomplete', entitled: false },
          pending_attempt: { id: 'a', tier_id: asTierId(TIER_ID), created_at: null },
        }),
      ),
    ).toBe('processing');
    expect(viewOutcome(billing({ billing: { ...baseBilling, subscription_status: 'canceled', entitled: false } }))).toBe(
      'failed',
    );
  });
});
