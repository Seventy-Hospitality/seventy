/**
 * Stripe PaymentSheet for Clutch's connected-account charges (SAQ-A: card data
 * never touches our code; the native sheet collects and tokenizes it).
 *
 * Clutch charges are DIRECT charges on the club's Stripe connected account, so
 * a client secret only resolves when the SDK is initialised with that
 * account id. presentConnectedSheet(intent) is the ONLY way the app shows a
 * sheet: it re-initialises the SDK with `{publishableKey, stripeAccountId}`
 * for the intent's account, inits and presents the sheet, and reports the
 * completed intent id. The SDK's account is process-global, so presentations
 * are serialised behind a lock: two flows can never race each other's
 * account.
 *
 * A sheet completing is NOT proof of payment. The caller always hands the
 * intent id back to Clutch (confirm / save), and Clutch asks Stripe; the app
 * never reports success on its own.
 *
 * Without EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY the app still runs; sheets
 * resolve `unconfigured` and flows show a notice.
 */
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { initStripe, StripeProvider, useStripe } from '@stripe/stripe-react-native';
import { STRIPE_MERCHANT_ID, STRIPE_PUBLISHABLE_KEY } from './env';
import type { StripeSheetIntent } from './clutch/contract.pending';

interface PaymentsContextValue {
  configured: boolean;
}

const PaymentsContext = createContext<PaymentsContextValue>({ configured: false });

export function StripeAppProvider({ children }: { children: ReactNode }) {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return (
      <PaymentsContext.Provider value={{ configured: false }}>{children}</PaymentsContext.Provider>
    );
  }
  return (
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY}
      merchantIdentifier={STRIPE_MERCHANT_ID ?? undefined}
      urlScheme="seventy"
    >
      <PaymentsContext.Provider value={{ configured: true }}>{children}</PaymentsContext.Provider>
    </StripeProvider>
  );
}

/** Whether Stripe is configured (drives the "payments not configured" notice). */
export function usePaymentsConfigured(): boolean {
  return useContext(PaymentsContext).configured;
}

export interface SheetOptions {
  merchantDisplayName?: string;
  /** Prefilled billing name shown on the sheet. */
  billingName?: string;
}

export type SheetResult =
  /** The sheet finished; hand `intentId` to Clutch to confirm. Not proof of payment. */
  | { status: 'completed'; intentId: string }
  | { status: 'canceled' }
  /** A sheet is already up (a double tap): this call presented nothing. */
  | { status: 'busy' }
  | { status: 'unconfigured' }
  | { status: 'failed'; message: string };

/**
 * One sheet at a time: the SDK's connected account is process-global, and a
 * second presentation while one is up (a double tap) must not charge twice.
 * A call made while a sheet is up resolves `busy` without presenting.
 */
let sheetUp = false;

async function withSheetLock(task: () => Promise<SheetResult>): Promise<SheetResult> {
  if (sheetUp) return { status: 'busy' };
  sheetUp = true;
  try {
    return await task();
  } finally {
    sheetUp = false;
  }
}

/** Test seam: whether a sheet is being presented. */
export function isSheetUp(): boolean {
  return sheetUp;
}

/**
 * Returns presentConnectedSheet(intent, options). Accepts only the `stripe`
 * arm of SheetIntent: a simulated intent has no sheet by construction.
 */
export function usePresentConnectedSheet() {
  const { configured } = useContext(PaymentsContext);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  return useCallback(
    (intent: StripeSheetIntent, options: SheetOptions = {}): Promise<SheetResult> => {
      if (!configured || !STRIPE_PUBLISHABLE_KEY) {
        return Promise.resolve({ status: 'unconfigured' });
      }
      const publishableKey = STRIPE_PUBLISHABLE_KEY;

      return withSheetLock(async () => {
        try {
          await initStripe({
            publishableKey,
            stripeAccountId: intent.stripeAccount ?? undefined,
            merchantIdentifier: STRIPE_MERCHANT_ID ?? undefined,
            urlScheme: 'seventy',
          });
        } catch (err) {
          return {
            status: 'failed',
            message: err instanceof Error ? err.message : 'Payments could not start.',
          };
        }

        // A customer is passed only together with its ephemeral key (the
        // sheet refuses one without the other); without both the sheet
        // still takes a new card, it just cannot list saved ones.
        const common = {
          merchantDisplayName: options.merchantDisplayName ?? 'Club70',
          ...(intent.customer
            ? {
                customerId: intent.customer.id,
                customerEphemeralKeySecret: intent.customer.ephemeralKeySecret,
              }
            : {}),
          returnURL: 'seventy://stripe-redirect',
          defaultBillingDetails: options.billingName ? { name: options.billingName } : undefined,
        };
        const init =
          intent.intentType === 'setup'
            ? await initPaymentSheet({ ...common, setupIntentClientSecret: intent.clientSecret })
            : await initPaymentSheet({ ...common, paymentIntentClientSecret: intent.clientSecret });
        if (init.error) return { status: 'failed', message: init.error.message };

        const presented = await presentPaymentSheet();
        if (presented.error) {
          if (presented.error.code === 'Canceled') return { status: 'canceled' };
          return { status: 'failed', message: presented.error.message };
        }
        return { status: 'completed', intentId: intent.intentId };
      });
    },
    [configured, initPaymentSheet, presentPaymentSheet],
  );
}
