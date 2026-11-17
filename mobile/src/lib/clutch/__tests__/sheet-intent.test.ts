import { bookingCheckoutToSheet, snakeCheckoutToSheet } from '../contract.pending';
import { makeLegacyCheckout, makeMoveCheckout, makeShareCheckout, TEST_PUBLISHABLE_KEY } from '../fixtures';

describe('booking checkout as a sheet', () => {
  it('initialises Stripe on the club account with the key from the same answer', () => {
    expect(bookingCheckoutToSheet(makeLegacyCheckout())).toMatchObject({
      mode: 'stripe',
      clientSecret: 'pi_123_secret_abc',
      intentId: 'pi_123',
      stripeAccount: 'acct_club',
      publishableKey: TEST_PUBLISHABLE_KEY,
    });
  });

  it('reads the snake_case account, so a platform club is an explicit null', () => {
    const sheet = bookingCheckoutToSheet(makeLegacyCheckout({ stripeAccount: undefined, stripe_account: null }));
    expect(sheet).toMatchObject({ mode: 'stripe', stripeAccount: null });
  });

  it('falls back to the camelCase account from a Clutch without #187', () => {
    const sheet = bookingCheckoutToSheet(
      makeLegacyCheckout({ stripe_account: undefined, publishable_key: undefined, stripeAccount: 'acct_old' }),
    );
    expect(sheet).toMatchObject({ mode: 'stripe', stripeAccount: 'acct_old', publishableKey: null });
  });

  it('is simulated when Clutch simulates payments', () => {
    expect(bookingCheckoutToSheet(makeLegacyCheckout({ simulated: true, publishable_key: null }))).toEqual({
      mode: 'simulated',
      intentType: 'payment',
      intentId: 'pi_123',
    });
  });
});

describe('share and move checkouts as a sheet', () => {
  it.each([
    ['share', makeShareCheckout()],
    ['move', makeMoveCheckout()],
  ])('a %s carries its key and account', (_name, checkout) => {
    expect(snakeCheckoutToSheet(checkout)).toMatchObject({
      mode: 'stripe',
      stripeAccount: 'acct_club',
      publishableKey: TEST_PUBLISHABLE_KEY,
    });
  });

  it('a null key reaches the sheet as null (no Stripe on this deployment)', () => {
    expect(snakeCheckoutToSheet(makeShareCheckout({ publishable_key: null }))).toMatchObject({ publishableKey: null });
  });
});
