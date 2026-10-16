import { makeProfile, makeSubscription } from '../../../lib/clutch/fixtures';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import { asCardId, asTierId, type PaymentHistoryItem, type SavedPaymentMethod } from '../../../lib/clutch';
import { TEST_CLUB_ID } from '../../../lib/clutch/testing';
import {
  avatarErrorMessage,
  blockerSentences,
  canCancel,
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
  refundLabel,
  subscriptionStatusLine,
  tierChangeApplied,
} from '../account-lib';

const TZ = 'America/New_York';

function payment(over: Partial<PaymentHistoryItem> = {}): PaymentHistoryItem {
  return {
    id: 'p1',
    club_id: TEST_CLUB_ID,
    amount_cents: 3000,
    currency: 'USD',
    payment_type: 'booking',
    payment_method: 'stripe',
    status: 'succeeded',
    reference_id: null,
    description: null,
    created_at: '2026-10-10T15:00:00.000Z',
    refunded_amount_cents: 0,
    ...over,
  };
}

describe('profileDisplayName', () => {
  it('prefers the full name, then the username, then the email', () => {
    expect(profileDisplayName(makeProfile())).toBe('Alex Morgan');
    expect(profileDisplayName(makeProfile({ full_name: ' ', username: 'alexm' }))).toBe('@alexm');
    expect(profileDisplayName(makeProfile({ full_name: null, username: null }))).toBe('alex');
  });
});

describe('subscriptionStatusLine', () => {
  it('says what happens next, from Clutch fields only', () => {
    expect(subscriptionStatusLine(makeSubscription(), TZ)).toBe('Renews Nov 15, 2026');
    expect(subscriptionStatusLine(makeSubscription({ cancel_at_period_end: true }), TZ)).toBe('Ends Nov 15, 2026');
    expect(
      subscriptionStatusLine(
        makeSubscription({ pending_tier_name: 'Social', pending_effective_at: '2026-12-01T17:00:00.000Z' }),
        TZ,
      ),
    ).toBe('Switches to Social on Dec 1, 2026');
    expect(subscriptionStatusLine(makeSubscription({ subscription_status: 'past_due' }), TZ)).toBe('Payment past due');
  });
});

describe('membership gates', () => {
  it('offers change only on a live subscription with no cancellation scheduled', () => {
    expect(canChangeTier(makeSubscription())).toBe(true);
    expect(canChangeTier(makeSubscription({ subscription_status: 'past_due' }))).toBe(false);
    expect(canChangeTier(makeSubscription({ cancel_at_period_end: true }))).toBe(false);
    expect(canChangeTier(null)).toBe(false);
  });

  it('never traps a member: cancel stays open until the subscription is over', () => {
    expect(canCancel(makeSubscription({ subscription_status: 'past_due' }))).toBe(true);
    expect(canCancel(makeSubscription({ subscription_status: 'canceled' }))).toBe(false);
  });

  it('offers resume only for a scheduled cancellation', () => {
    expect(canResume(makeSubscription({ cancel_at_period_end: true }))).toBe(true);
    expect(canResume(makeSubscription())).toBe(false);
  });

  it('judges a tier change applied from the subscription Clutch returns', () => {
    const target = { id: asTierId('t2'), name: 'Pro' };
    expect(tierChangeApplied(makeSubscription({ tier_id: asTierId('t2') }), target)).toBe(true);
    expect(tierChangeApplied(makeSubscription({ tier_id: asTierId('t1'), tier_name: 'Pro' }), target)).toBe(false);
    expect(tierChangeApplied(makeSubscription({ tier_name: 'Pro' }), target)).toBe(true);
    expect(tierChangeApplied(null, target)).toBe(false);
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
    const card: SavedPaymentMethod = {
      id: asCardId('c1'),
      stripe_payment_method_id: 'pm_1',
      type: 'card',
      card_brand: 'visa',
      card_last4: '4242',
      card_exp_month: 9,
      card_exp_year: 2027,
      is_default: true,
    };
    expect(paymentMethodLabel(card)).toBe('Visa •••• 4242 · exp 09/27');
  });
});

describe('error copy', () => {
  it('maps profile codes', () => {
    expect(profileErrorMessage(clutchError('username_taken'))).toMatch(/taken/);
    expect(profileErrorMessage(clutchError('invalid_username', 400))).toMatch(/3 to 20/);
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
