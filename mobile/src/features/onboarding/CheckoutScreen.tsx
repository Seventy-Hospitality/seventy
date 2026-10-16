/**
 * Onboarding checkout (Figma onboarding/checkout 26:841 / 32:569).
 *
 *  1. POST /me/membership/subscribe {tier, terms_version} (PENDING P2) starts
 *     a subscription attempt, or reuses the incomplete one for this tier, and
 *     returns its PaymentSheet bundle. A $0 or trial tier returns a SetupIntent
 *     (intentType 'setup') so a card is saved for later.
 *  2. Stripe mode: presentConnectedSheet on the club's connected account.
 *     Simulated mode: no sheet at all.
 *  3. POST /me/membership/confirm (PENDING P2) makes Clutch re-read Stripe
 *     through its one state function; then GET /me/membership is re-read and
 *     the outcome is decided from Clutch's subscription, never from the sheet.
 *     A charge still clearing parks in a "processing" hold with a re-check
 *     (re-checking reads, it never charges again).
 *
 * Resume: with no ?tier param, an incomplete attempt (P2 subscription_status
 * 'incomplete') is resumed for its tier.
 */
import { useState, type ReactNode } from 'react';
import { openLegalPage } from '../../lib/links';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  clutch,
  hasCode,
  isClutchError,
  toSheetIntent,
  useMutationKey,
  type MembershipTier,
  type MySubscription,
  type TierId,
} from '../../lib/clutch';
import { membershipQuery, queryKeys, tiersQuery } from '../../lib/queries';
import { usePresentConnectedSheet } from '../../lib/stripe';
import { AppScreen } from '../../components/AppScreen';
import { Checkbox } from '../../components/Checkbox';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Skeleton } from '../../components/Skeleton';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import { billingState, checkoutOutcome, TERMS_VERSION } from './onboarding';
import { formatCentsExact, intervalNoun } from './tier-format';

/** What the summary and subscribe need. */
export interface CheckoutTier {
  id: TierId;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval: string;
}

/**
 * The tier being bought: the ?tier param when it names an active tier,
 * otherwise the tier of an incomplete attempt being resumed.
 */
export function resolveCheckoutTier(
  tierParam: string | null,
  tiers: MembershipTier[],
  subscription: MySubscription | null,
): CheckoutTier | null {
  if (tierParam !== null) {
    return tiers.find((tier) => tier.id === tierParam && tier.is_active) ?? null;
  }
  if (subscription && billingState(subscription) === 'incomplete' && subscription.tier_id) {
    const tierId = subscription.tier_id;
    const listed = tiers.find((tier) => tier.id === tierId);
    return (
      listed ?? {
        id: tierId,
        name: subscription.tier_name,
        description: subscription.tier_description,
        price_cents: subscription.price_cents,
        currency: subscription.currency,
        interval: subscription.interval,
      }
    );
  }
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
    default:
      return err.kind === 'network'
        ? 'We could not reach Club70. Check your connection and try again.'
        : 'We could not start your checkout. Please try again.';
  }
}

type PayPhase = 'idle' | 'paying' | 'processing';

export function CheckoutScreen() {
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

  const tier = resolveCheckoutTier(tierParam, tiers.data.tiers, membership.data.subscription);
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
    for (const queryKey of [queryKeys.me, queryKeys.tiers, queryKeys.home, queryKeys.paymentMethods, queryKeys.payments]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  /** Ask Clutch to re-read Stripe, then decide from GET /me/membership. Never rejects. */
  async function confirmWithClutch(): Promise<void> {
    setChecking(true);
    try {
      try {
        await confirmKey.run('confirm', (k) => clutch.membership.confirm({ idempotencyKey: k }));
      } catch {
        // Confirm is a read of Stripe; a failure says nothing about the charge.
        // Fall through to the membership read, which decides.
      }
      let subscription: MySubscription | null;
      try {
        const fresh = await queryClient.fetchQuery({ ...membershipQuery, staleTime: 0 });
        subscription = fresh.subscription;
      } catch {
        setError('We could not check your membership. Check again in a moment; you will not be charged twice.');
        setPhase('processing');
        return;
      }
      switch (checkoutOutcome(subscription)) {
        case 'active':
          setError(null);
          setPhase('idle');
          invalidateMembershipViews();
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

    let result;
    try {
      const input = { tierId: tier.id, terms: TERMS_VERSION };
      result = await subscribeKey.run(input, (k) =>
        clutch.membership.subscribe(tier.id, TERMS_VERSION, { idempotencyKey: k }),
      );
    } catch (err) {
      if (hasCode(err, 'subscription_exists')) {
        // Already subscribed (another device, or a webhook got there first):
        // re-read and let Clutch's state route the member.
        await confirmWithClutch();
        return;
      }
      setError(subscribeErrorMessage(err));
      setPhase('idle');
      return;
    }

    const intent = toSheetIntent(result);
    if (intent.mode === 'stripe') {
      const sheet = await presentSheet(intent, { merchantDisplayName: 'Club70' });
      switch (sheet.status) {
        case 'canceled':
          // The attempt stays incomplete and is reused on the next tap.
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
