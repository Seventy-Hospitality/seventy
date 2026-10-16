import { makeMe, makeSubscription } from '../../../lib/clutch/fixtures';
import { TEST_CLUB_ID } from '../../../lib/clutch/testing';
import { asClubId, type Me } from '../../../lib/clutch';
import {
  canVisitOnboardingPath,
  checkoutOutcome,
  needsSubscription,
  onboardingPathForStep,
  resolveOnboardingStep,
} from '../onboarding';

const OTHER_CLUB = asClubId('99999999-0000-4000-8000-000000000000');

function meWithRole(role: string, status?: string): Me {
  const base = makeMe();
  return { ...base, memberships: [{ ...base.memberships[0], role, ...(status ? { status } : {}) }] };
}

describe('resolveOnboardingStep', () => {
  it('asks to join when /me lists no membership at this club', () => {
    const me = makeMe({ memberships: [] });
    expect(resolveOnboardingStep({ me, clubId: TEST_CLUB_ID, subscription: null })).toBe('join');
  });

  it('ignores memberships at other clubs', () => {
    const base = makeMe();
    const me = { ...base, memberships: [{ ...base.memberships[0], id: OTHER_CLUB }] };
    expect(resolveOnboardingStep({ me, clubId: TEST_CLUB_ID, subscription: null })).toBe('join');
  });

  it('shows the support screen for a membership whose standing is not active (P3)', () => {
    const me = meWithRole('player', 'suspended');
    expect(resolveOnboardingStep({ me, clubId: TEST_CLUB_ID, subscription: null })).toBe('inactive');
  });

  it('sends a player with no tier subscription to pick a tier', () => {
    expect(resolveOnboardingStep({ me: makeMe(), clubId: TEST_CLUB_ID, subscription: null })).toBe('plan');
  });

  it.each(['coach', 'staff', 'admin', 'owner'])('lets %s skip tier selection', (role) => {
    expect(resolveOnboardingStep({ me: meWithRole(role), clubId: TEST_CLUB_ID, subscription: null })).toBe('done');
  });

  it('resumes an incomplete attempt at checkout (P2)', () => {
    const subscription = makeSubscription({ subscription_status: 'incomplete' });
    expect(resolveOnboardingStep({ me: makeMe(), clubId: TEST_CLUB_ID, subscription })).toBe('checkout');
  });

  it('sends an expired attempt back to the tier step', () => {
    const subscription = makeSubscription({ subscription_status: 'incomplete_expired' });
    expect(resolveOnboardingStep({ me: makeMe(), clubId: TEST_CLUB_ID, subscription })).toBe('plan');
  });

  it.each([undefined, 'active', 'trialing', 'past_due', 'canceled'])(
    'treats a subscription with billing state %s as done',
    (subscription_status) => {
      const subscription = makeSubscription({ subscription_status });
      expect(resolveOnboardingStep({ me: makeMe(), clubId: TEST_CLUB_ID, subscription })).toBe('done');
    },
  );
});

describe('needsSubscription', () => {
  it('reads /me/membership only for an active player', () => {
    expect(needsSubscription(makeMe(), TEST_CLUB_ID)).toBe(true);
    expect(needsSubscription(meWithRole('admin'), TEST_CLUB_ID)).toBe(false);
    expect(needsSubscription(meWithRole('player', 'suspended'), TEST_CLUB_ID)).toBe(false);
    expect(needsSubscription(makeMe({ memberships: [] }), TEST_CLUB_ID)).toBe(false);
  });
});

describe('onboarding routes', () => {
  it('maps steps to routes, with join and inactive rendered in place', () => {
    expect(onboardingPathForStep('plan')).toBe('/onboarding/plan');
    expect(onboardingPathForStep('checkout')).toBe('/onboarding/checkout');
    expect(onboardingPathForStep('done')).toBe('/(tabs)');
    expect(onboardingPathForStep('join')).toBeNull();
    expect(onboardingPathForStep('inactive')).toBeNull();
  });

  it('lets an unpaid member move between plan and checkout only', () => {
    expect(canVisitOnboardingPath('plan', '/onboarding/checkout')).toBe(true);
    expect(canVisitOnboardingPath('checkout', '/onboarding/plan')).toBe(true);
    expect(canVisitOnboardingPath('done', '/onboarding/plan')).toBe(false);
    expect(canVisitOnboardingPath('join', '/onboarding/plan')).toBe(false);
  });
});

describe('checkoutOutcome', () => {
  it('is active only when Clutch shows a live subscription', () => {
    expect(checkoutOutcome(makeSubscription({ subscription_status: 'active' }))).toBe('active');
    expect(checkoutOutcome(makeSubscription({ subscription_status: 'trialing' }))).toBe('active');
    expect(checkoutOutcome(makeSubscription())).toBe('active');
  });

  it('keeps waiting while the attempt is incomplete or not visible yet', () => {
    expect(checkoutOutcome(makeSubscription({ subscription_status: 'incomplete' }))).toBe('processing');
    expect(checkoutOutcome(null)).toBe('processing');
  });

  it('fails an expired or cancelled attempt', () => {
    expect(checkoutOutcome(makeSubscription({ subscription_status: 'incomplete_expired' }))).toBe('failed');
    expect(checkoutOutcome(makeSubscription({ subscription_status: 'canceled' }))).toBe('failed');
  });
});
