/**
 * Onboarding checkout (Figma onboarding/checkout 26:841 / 32:569). Clutch P2
 * (capabilities.nativePayments); without it the screen says paying is not in
 * the app yet and never calls a P2 route.
 *
 *  1. POST /me/membership/subscribe {tier, terms_version} starts a
 *     subscription attempt (or reuses the pending one for this tier) and
 *     answers its PaymentSheet bundle with a `status`: `active` (nothing to
 *     pay), `requires_payment`, or `requires_setup` (a trial: save a card).
 *  2. Stripe mode: presentConnectedSheet on the club's connected account.
 *     Simulated mode: no sheet at all.
 *  3. POST /me/membership/confirm makes Clutch ask Stripe now; its answer
 *     ({activated, payment_status}) decides, never the sheet. If confirm
 *     cannot answer, GET /me/membership is re-read and entitlement() decides.
 *     A charge still clearing parks in "processing" with a re-check
 *     (re-checking asks, it never charges again).
 *
 * Resume: with no ?tier param, the pending attempt (billing.pending_attempt)
 * is resumed for its tier.
 */
import { useState, type ReactNode } from 'react';
import { openLegalPage } from '../../lib/links';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  bundleToSheet,
  clutch,
  hasCode,
  isClutchError,
  useMutationKey,
  type MembershipTier,
  type MembershipView,
  type SubscribeResult,
} from '../../lib/clutch';
import { membershipQuery, queryKeys, tiersQuery } from '../../lib/queries';
import { usePresentConnectedSheet } from '../../lib/stripe';
import { AppScreen } from '../../components/AppScreen';
import { Checkbox } from '../../components/Checkbox';
import { FeatureUnavailable } from '../../components/FeatureUnavailable';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Skeleton } from '../../components/Skeleton';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import { confirmOutcome, TERMS_VERSION, viewOutcome, type CheckoutOutcome } from './onboarding';
import { formatCentsExact, intervalNoun } from './tier-format';

/** What the summary and subscribe need. */
export type CheckoutTier = Pick<MembershipTier, 'id' | 'name' | 'description' | 'price_cents' | 'currency' | 'interval'>;

/**
 * The tier being bought: the ?tier param when it names a listed tier,
 * otherwise the tier of the pending attempt being resumed.
 */
export function resolveCheckoutTier(
  tierParam: string | null,
  tiers: MembershipTier[],
  view: MembershipView | null,
): CheckoutTier | null {
  if (tierParam !== null) return tiers.find((tier) => tier.id === tierParam) ?? null;
  const pending = view?.kind === 'billing' ? view.data.pending_attempt : null;
  if (pending) return tiers.find((tier) => tier.id === pending.tier_id) ?? null;
  return null;
}

function subscribeErrorMessage(err: unknown): string {
  if (!isClutchError(err)) return 'We could not start your checkout. Please try again.';
  switch (err.code) {
    case 'tier_not_found':
    case 'tier_not_configured':
      return 'That membership is no longer available. Go back and choose another.';
    case 'club_stripe_not_connected':
      return 'The club cannot take payments right now. Please try again later.';
    case 'rate_limit_exceeded':
      return 'Too many attempts. Wait a minute and try again.';
    case 'not_club_member':
      return 'Your club membership is not set up yet. Go back and try again.';
    case 'membership_not_active':
      return 'Your club membership is on hold. Contact the club front desk to sort it out.';
    case 'membership_unconfirmed':
      return 'The club has not confirmed your membership yet. Contact the club front desk.';
    default:
      return err.kind === 'network'
        ? 'We could not reach Club70. Check your connection and try again.'
        : 'We could not start your checkout. Please try again.';
  }
}

type PayPhase = 'idle' | 'paying' | 'processing';

export function CheckoutScreen() {
  if (!clutch.capabilities.nativePayments) {
    return (
      <CheckoutFrame>
        <FeatureUnavailable
          capability="nativePayments"
          title="Paying in the app"
          description="Paying for a membership is not available in the app yet. Become a member at the Club70 front desk meanwhile."
        />
        <BackToPlans />
      </CheckoutFrame>
    );
  }
  return <CheckoutLoader />;
}

function CheckoutLoader() {
  const params = useLocalSearchParams<{ tier?: string | string[] }>();
  const tierParam = Array.isArray(params.tier) ? (params.tier[0] ?? null) : (params.tier ?? null);

  const tiers = useQuery(tiersQuery);
  const membership = useQuery(membershipQuery);

  if (tiers.isPending || membership.isPending) {
    return (
      <CheckoutFrame>
        <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading checkout">
          <Skeleton height={150} borderRadius={radius.lg} />
          <Skeleton height={120} borderRadius={radius.lg} />
        </View>
      </CheckoutFrame>
    );
  }

  if (tiers.isError || membership.isError) {
    return (
      <CheckoutFrame>
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>We could not load your checkout.</Text>
          <PrimaryButton
            label="Try again"
            variant="ghost"
            onPress={() => {
              if (tiers.isError) void tiers.refetch();
              if (membership.isError) void membership.refetch();
            }}
          />
        </View>
        <BackToPlans />
      </CheckoutFrame>
    );
  }

  const tier = resolveCheckoutTier(tierParam, tiers.data.tiers, membership.data);
  if (!tier) return <Redirect href="/onboarding/plan" />;
  return <CheckoutView tier={tier} />;
}

function CheckoutView({ tier }: { tier: CheckoutTier }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const presentSheet = usePresentConnectedSheet();
  const subscribeKey = useMutationKey();
  const confirmKey = useMutationKey();

  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState<PayPhase>('idle');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);

  /** Clutch's view of the membership changed: every screen that shows it re-reads. */
  function invalidateMembershipViews() {
    for (const queryKey of [
      queryKeys.me,
      queryKeys.membership,
      queryKeys.tiers,
      queryKeys.home,
      queryKeys.paymentMethods,
      queryKeys.payments,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  /** Ask Clutch to re-read Stripe; decide from its answer (or a re-read). Never rejects. */
  async function confirmWithClutch(): Promise<void> {
    setChecking(true);
    try {
      let outcome: CheckoutOutcome;
      try {
        const confirmed = await confirmKey.run(
          'confirm',
          (k) => clutch.membership.confirm({ idempotencyKey: k }),
          { rerunnable: true },
        );
        outcome = confirmOutcome(confirmed);
      } catch {
        // Confirm could not answer; that says nothing about the charge. The
        // membership read decides.
        try {
          outcome = viewOutcome(await queryClient.fetchQuery({ ...membershipQuery, staleTime: 0 }));
        } catch {
          setError('We could not check your membership. Check again in a moment; you will not be charged twice.');
          setPhase('processing');
          return;
        }
      }
      invalidateMembershipViews();
      switch (outcome) {
        case 'active':
          setError(null);
          setPhase('idle');
          router.replace('/(tabs)');
          return;
        case 'processing':
          setError(null);
          setPhase('processing');
          return;
        case 'failed':
          setError('Your payment was not completed. Please try again.');
          setPhase('idle');
          return;
      }
    } finally {
      setChecking(false);
    }
  }

  async function pay(): Promise<void> {
    if (phase !== 'idle') return;
    setError(null);
    setPhase('paying');

    let result: SubscribeResult;
    try {
      const input = { tierId: tier.id, terms: TERMS_VERSION };
      result = await subscribeKey.run(input, (k) =>
        clutch.membership.subscribe(tier.id, TERMS_VERSION, { idempotencyKey: k }),
      );
    } catch (err) {
      if (hasCode(err, 'already_subscribed')) {
        // Already paying (another device, or a webhook got there first):
        // let Clutch's state route the member.
        await confirmWithClutch();
        return;
      }
      setError(subscribeErrorMessage(err));
      setPhase('idle');
      return;
    }

    if (result.status !== 'active') {
      const intent = bundleToSheet(result);
      if (intent.mode === 'stripe') {
        const sheet = await presentSheet(intent, { merchantDisplayName: 'Club70' });
        switch (sheet.status) {
          case 'canceled':
          case 'busy':
            // Nothing was paid (or another sheet is up). The attempt stays
            // pending and is reused on the next tap.
            setPhase('idle');
            return;
          case 'unconfigured':
            setError('Payments are not configured in this build.');
            setPhase('idle');
            return;
          case 'failed':
            setError(sheet.message || 'Your payment could not be completed.');
            setPhase('idle');
            return;
          case 'completed':
            break;
        }
      } else {
        setSimulated(true);
      }
    }
    await confirmWithClutch();
  }

  return (
    <CheckoutFrame>
      <OrderSummary tier={tier} />

      {phase === 'processing' ? (
        <View style={styles.processing} accessibilityRole="progressbar">
          {error ? (
            <Text style={styles.payAlert} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Text style={styles.processingTitle}>Your payment is processing</Text>
          <Text style={styles.processingBody}>
            Your membership starts as soon as the club confirms the payment. This can take a moment for
            some payment methods.
          </Text>
          <PrimaryButton
            label="Check again"
            variant="ghost"
            loading={checking}
            onPress={() => void confirmWithClutch()}
          />
        </View>
      ) : (
        <>
          <View style={styles.paymentNotice}>
            <Text style={styles.sectionLabel}>Payment</Text>
            <View style={styles.paymentRow}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
              <Text style={styles.paymentText}>
                {simulated
                  ? 'Payments are simulated in this environment: no card is charged.'
                  : 'Card details are entered securely when you confirm.'}
              </Text>
            </View>
          </View>

          <Checkbox
            checked={agreed}
            onChange={setAgreed}
            accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
            label={
              <Text style={styles.termsLabel}>
                I agree to the{' '}
                <Text
                  style={styles.termsLink}
                  accessibilityRole="link"
                  onPress={() => void openLegalPage('terms')}
                >
                  Terms of Service
                </Text>{' '}
                and{' '}
                <Text
                  style={styles.termsLink}
                  accessibilityRole="link"
                  onPress={() => void openLegalPage('privacy')}
                >
                  Privacy Policy
                </Text>
              </Text>
            }
          />

          {error ? (
            <Text style={styles.payAlert} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </>
      )}

      <View style={styles.footer}>
        <BackToPlans />
        {phase !== 'processing' ? (
          <PrimaryButton
            label="Confirm membership"
            loading={phase === 'paying'}
            disabled={!agreed}
            onPress={() => void pay()}
          />
        ) : null}
      </View>
    </CheckoutFrame>
  );
}

function CheckoutFrame({ children }: { children: ReactNode }) {
  return (
    <AppScreen contentStyle={styles.content}>
      <Text style={styles.title}>Checkout</Text>
      {children}
    </AppScreen>
  );
}

function BackToPlans() {
  const router = useRouter();
  return (
    <Pressable accessibilityRole="link" onPress={() => router.replace('/onboarding/plan')}>
      <Text style={styles.footerLink}>Back to memberships</Text>
    </Pressable>
  );
}

/** The tier's own price, formatted; the sheet shows what Stripe will charge. */
function OrderSummary({ tier }: { tier: CheckoutTier }) {
  return (
    <View style={styles.summary}>
      <Text style={styles.sectionLabel}>Order summary</Text>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryFeeLabel}>{tier.name}</Text>
        <Text style={styles.summaryPrice}>
          {formatCentsExact(tier.price_cents, tier.currency)}
          <Text style={styles.summaryPeriod}> / {intervalNoun(tier.interval)}</Text>
        </Text>
      </View>
      {tier.description ? <Text style={styles.summaryCaption}>{tier.description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  title: { ...typography.display, color: colors.text, marginTop: spacing.sm },
  loading: { gap: spacing.md },
  errorBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  errorText: { ...typography.body, color: colors.text },
  summary: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionLabel: { ...typography.label, color: colors.textMuted, textTransform: 'uppercase' },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  summaryFeeLabel: { ...typography.bodyStrong, color: colors.text, flexShrink: 1 },
  summaryPrice: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.accent },
  summaryPeriod: { ...typography.caption, color: colors.textMuted },
  summaryCaption: { ...typography.caption, color: colors.textSubtle },
  paymentNotice: { gap: spacing.sm },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  paymentText: { ...typography.body, color: colors.textMuted, flex: 1 },
  termsLabel: { ...typography.body, color: colors.text, flex: 1 },
  termsLink: { color: colors.accent, textDecorationLine: 'underline' },
  payAlert: { ...typography.body, color: colors.danger },
  processing: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  processingTitle: { ...typography.h3, color: colors.text },
  processingBody: { ...typography.body, color: colors.textMuted },
  footer: { gap: spacing.md, marginTop: spacing.sm },
  footerLink: { ...typography.bodyStrong, color: colors.accent, textAlign: 'center' },
});
