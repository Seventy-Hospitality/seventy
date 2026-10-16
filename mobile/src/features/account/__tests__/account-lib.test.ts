import {
  makeBillingMembership,
  makePayment,
  makeProfile,
  makeSavedCard,
  makeStandingMembership,
  makeSubscription,
  TIER_ID,
} from '../../../lib/clutch/fixtures';
import { clutchError, networkError, TEST_CLUB_ID } from '../../../lib/clutch/testing';
import { asTierId } from '../../../lib/clutch';
import {
  avatarErrorMessage,
  billingErrorMessage,
  billingStatusLine,
  blockerSentences,
  canCancel,
  canCancelDowngrade,
  canChangeTier,
  canResume,
  clutchErrorMessage,
  deletionBlockersFrom,
  hasDeletionBlockers,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentTitle,
  profileDisplayName,
  profileErrorMessage,
  planSummary,
  refundLabel,
  tierChangeApplied,
} from '../account-lib';

const TZ = 'America/New_York';

function payment(over: Parameters<typeof makePayment>[0] = {}) {
  return makePayment({ description: null, ...over });
}

describe('profileDisplayName', () => {
  it('prefers the full name, then the username, then the email', () => {
    expect(profileDisplayName(makeProfile())).toBe('Alex Morgan');
    expect(profileDisplayName(makeProfile({ full_name: ' ', username: 'alexm' }))).toBe('@alexm');
    expect(profileDisplayName(makeProfile({ full_name: '', username: null }))).toBe('alex');
    expect(profileDisplayName(makeProfile({ full_name: '', username: null, email: '' }))).toBe('Member');
  });
});

const BASE = makeBillingMembership();
if (BASE.kind !== 'billing') throw new Error('fixture');
const BILLING = BASE.data.billing;
const data = (over: Parameters<typeof makeBillingMembership>[0]) => {
  const view = makeBillingMembership(over);
  if (view.kind !== 'billing') throw new Error('fixture');
  return view.data;
};

describe('planSummary', () => {
  it('reads the club standing view (today)', () => {
    expect(planSummary(makeStandingMembership(), TZ)).toEqual({
      tierId: TIER_ID,
      name: 'Member',
      price: { cents: 9900, currency: 'USD', interval: 'monthly' },
      statusLine: 'Renews Nov 15, 2026',
    });
    expect(
      planSummary(
        makeStandingMembership({ subscription: makeSubscription({ status: 'suspended' }) }),
        TZ,
      )?.statusLine,
    ).toBe('Membership suspended');
    expect(planSummary(makeStandingMembership({ membership: null, subscription: null }), TZ)).toBeNull();
  });

  it('reads the P2 billing view', () => {
    expect(planSummary(BASE, TZ)?.statusLine).toBe('Renews Nov 15, 2026');
    expect(planSummary(makeBillingMembership({ tier: null }), TZ)).toBeNull();
  });
});

describe('billingStatusLine', () => {
  it('says what happens next, from Clutch fields only', () => {
    expect(billingStatusLine(data({}), TZ)).toBe('Renews Nov 15, 2026');
    expect(billingStatusLine(data({ billing: { ...BILLING, cancel_at_period_end: true } }), TZ)).toBe('Ends Nov 15, 2026');
    expect(
      billingStatusLine(
        data({
          billing: {
            ...BILLING,
            pending_tier: { ...BASE.data.tier!, name: 'Social' },
            pending_tier_effective_at: '2026-12-01T17:00:00.000Z',
          },
        }),
        TZ,
      ),
    ).toBe('Switches to Social on Dec 1, 2026');
    expect(billingStatusLine(data({ billing: { ...BILLING, subscription_status: 'past_due' } }), TZ)).toBe(
      'Payment past due',
    );
  });
});

describe('membership gates', () => {
  it('offers change only on a live subscription with no cancellation scheduled', () => {
    expect(canChangeTier(data({}))).toBe(true);
    expect(canChangeTier(data({ billing: { ...BILLING, subscription_status: 'past_due' } }))).toBe(false);
    expect(canChangeTier(data({ billing: { ...BILLING, cancel_at_period_end: true } }))).toBe(false);
  });

  it('never traps a member: cancel stays open until the subscription is over or ending', () => {
    expect(canCancel(data({ billing: { ...BILLING, subscription_status: 'past_due' } }))).toBe(true);
    expect(canCancel(data({ billing: { ...BILLING, subscription_status: 'canceled' } }))).toBe(false);
    expect(canCancel(data({ billing: { ...BILLING, cancel_at_period_end: true } }))).toBe(false);
  });

  it('offers resume only for a scheduled cancellation', () => {
    expect(canResume(data({ billing: { ...BILLING, cancel_at_period_end: true } }))).toBe(true);
    expect(canResume(data({}))).toBe(false);
  });

  it('offers keeping the tier only while a downgrade is booked', () => {
    expect(canCancelDowngrade(data({}))).toBe(false);
    expect(canCancelDowngrade(data({ billing: { ...BILLING, pending_tier: BASE.data.tier } }))).toBe(true);
  });

  it('judges a tier change applied from the tier Clutch now shows', () => {
    expect(tierChangeApplied(BASE, asTierId(TIER_ID))).toBe(true);
    expect(tierChangeApplied(BASE, asTierId('t2'))).toBe(false);
    expect(tierChangeApplied(makeStandingMembership(), asTierId(TIER_ID))).toBe(false);
    expect(tierChangeApplied(null, asTierId(TIER_ID))).toBe(false);
  });
});

describe('payments', () => {
  it('shows Clutch amounts and refunds without netting them', () => {
    const item = payment({ amount_cents: 3000, refunded_amount_cents: 1000, status: 'succeeded' });
    expect(refundLabel(item)).toBe('Refunded $10.00');
    expect(refundLabel(payment())).toBeNull();
    expect(paymentTitle(item)).toBe('Court booking');
    expect(paymentTitle(payment({ description: 'Court 2, Oct 10' }))).toBe('Court 2, Oct 10');
    expect(paymentStatusLabel('succeeded')).toBeNull();
    expect(paymentStatusLabel('processing')).toBe('Processing');
  });

  it('labels a saved card', () => {
    const card = makeSavedCard({ card_exp_month: 9, card_exp_year: 2027 });
    expect(paymentMethodLabel(card)).toBe('Visa •••• 4242 · exp 09/27');
  });
});

describe('error copy', () => {
  it('maps profile codes', () => {
    expect(profileErrorMessage(clutchError('username_taken'))).toMatch(/taken/);
    expect(profileErrorMessage(clutchError('invalid_username', 400))).toMatch(/3 to 20/);
  });

  it('maps P2 billing codes', () => {
    expect(billingErrorMessage(clutchError('already_on_tier'), 'x')).toMatch(/already on that/);
    expect(billingErrorMessage(clutchError('subscription_ending'), 'x')).toMatch(/Resume it first/);
    expect(billingErrorMessage(clutchError('card_in_use_by_subscription'), 'x')).toMatch(/pays your membership/);
    expect(billingErrorMessage(clutchError('setup_incomplete'), 'x')).toMatch(/not confirmed yet/);
    expect(billingErrorMessage(networkError(), 'x')).toMatch(/connection/);
  });

  it('maps avatar codes', () => {
    expect(avatarErrorMessage(clutchError('unsupported_image_type', 400))).toMatch(/JPG/);
    expect(avatarErrorMessage(clutchError('file_too_large', 400))).toMatch(/5 MB/);
  });

  it('shows a Clutch refusal, and generic copy for outages', () => {
    expect(clutchErrorMessage(clutchError('cannot_cancel', 409, undefined, 'This card pays your membership.'), 'x')).toBe(
      'This card pays your membership.',
    );
    expect(clutchErrorMessage(networkError(), 'x')).toMatch(/connection/);
    expect(clutchErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });

  it('reads deletion blockers and phrases each one', () => {
    const blockers = deletionBlockersFrom({
      owned_clubs: [{ club_id: TEST_CLUB_ID, club_name: 'Seventy' }],
      managed_children: [{ link_id: 'l1', name: 'Sam' }],
    });
    expect(blockers && hasDeletionBlockers(blockers)).toBe(true);
    expect(blockers && blockerSentences(blockers)).toEqual([
      'You own Seventy. Hand the club to another owner before deleting your account.',
      'You are the only guardian of Sam. Add another guardian or close their profile first.',
    ]);
    expect(hasDeletionBlockers({ owned_clubs: [], managed_children: [] })).toBe(false);
    expect(deletionBlockersFrom({ owned_clubs: 'nope' })).toBeNull();
    expect(deletionBlockersFrom(undefined)).toBeNull();
  });
});
