/**
 * Onboarding: choose a tier (Figma onboarding/choose-membership 68:1559).
 * A billing-interval toggle when the club offers more than one, one card per
 * tier GET /clubs/{club}/membership-tiers lists, Continue to checkout.
 * Prices are the tiers' own price_cents, formatted.
 *
 * Paying needs Clutch P2 (capabilities.nativePayments). Without it the tiers
 * are still shown, and in place of Continue the member is told paying is not
 * in the app yet and how to become a member meanwhile (at the club), with a
 * re-check for when the club has added them.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clutch, type BillingInterval, type MembershipTier, type TierId } from '../../lib/clutch';
import { queryKeys, tiersQuery } from '../../lib/queries';
import { AppScreen } from '../../components/AppScreen';
import { FeatureUnavailable } from '../../components/FeatureUnavailable';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Skeleton } from '../../components/Skeleton';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import { useSignOut } from '../account/useSignOut';
import {
  INTERVAL_LABELS,
  benefitLines,
  billingCadence,
  defaultInterval,
  formatCents,
  intervalSuffix,
  intervalsOffered,
  tiersForInterval,
} from './tier-format';

export function ChoosePlanScreen() {
  const router = useRouter();
  const signOut = useSignOut();
  const tiers = useQuery(tiersQuery);
  const [chosenInterval, setChosenInterval] = useState<BillingInterval | null>(null);
  const [chosenTier, setChosenTier] = useState<TierId | null>(null);
  const signOutMutation = useMutation({ mutationFn: signOut });
  const queryClient = useQueryClient();
  const recheck = useMutation({
    mutationFn: () =>
      Promise.all([
        queryClient.refetchQueries({ queryKey: queryKeys.me, exact: true }),
        queryClient.refetchQueries({ queryKey: queryKeys.membership, exact: true }),
      ]),
  });
  const canPay = clutch.capabilities.nativePayments;

  const all = tiers.data?.tiers ?? [];
  const intervals = intervalsOffered(all);
  const interval =
    chosenInterval !== null && intervals.includes(chosenInterval) ? chosenInterval : defaultInterval(all);
  const cards = tiersForInterval(all, interval);
  const selected = cards.find((tier) => tier.id === chosenTier) ?? cards[0] ?? null;

  return (
    <AppScreen contentStyle={styles.content}>
      <Text style={styles.title}>Become a member</Text>

      {tiers.isPending && (
        <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading memberships">
          <Skeleton height={44} borderRadius={radius.pill} />
          <Skeleton height={320} borderRadius={radius.lg} />
        </View>
      )}

      {tiers.isError && (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>We could not load the memberships.</Text>
          <PrimaryButton label="Try again" variant="ghost" onPress={() => void tiers.refetch()} />
        </View>
      )}

      {tiers.isSuccess && intervals.length === 0 && (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.emptyTitle}>Memberships are not available yet</Text>
          <Text style={styles.emptyBody}>The club has not published its memberships. Please check back soon.</Text>
          <PrimaryButton label="Try again" variant="ghost" onPress={() => void tiers.refetch()} />
        </View>
      )}

      {tiers.isSuccess && intervals.length > 0 && (
        <>
          {intervals.length > 1 && (
            <SegmentedControl
              label="Billing period"
              options={intervals.map((value) => ({ value, label: INTERVAL_LABELS[value] }))}
              value={interval}
              onChange={setChosenInterval}
            />
          )}

          <View style={styles.cards} accessibilityRole="radiogroup" accessibilityLabel="Memberships">
            {cards.map((tier) => (
              <TierCard
                key={tier.id}
                tier={tier}
                selected={selected?.id === tier.id}
                onSelect={() => setChosenTier(tier.id)}
              />
            ))}
          </View>

          <View style={styles.footer}>
            {canPay ? (
              <PrimaryButton
                label="Continue"
                disabled={!selected}
                onPress={() => {
                  if (selected) {
                    router.push({ pathname: '/onboarding/checkout', params: { tier: selected.id } });
                  }
                }}
              />
            ) : (
              <>
                <FeatureUnavailable
                  capability="nativePayments"
                  title="Joining in the app"
                  description="Paying for a membership is not available in the app yet. Become a member at the Club70 front desk; once the club has added your membership, check again."
                />
                <PrimaryButton
                  label="Check again"
                  variant="secondary"
                  loading={recheck.isPending}
                  onPress={() => recheck.mutate()}
                />
              </>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={signOutMutation.isPending}
              onPress={() => signOutMutation.mutate()}
            >
              <Text style={styles.signOut}>Sign out</Text>
            </Pressable>
          </View>
        </>
      )}

      {!(tiers.isSuccess && intervals.length > 0) && (
        <Pressable
          accessibilityRole="button"
          disabled={signOutMutation.isPending}
          onPress={() => signOutMutation.mutate()}
        >
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      )}
    </AppScreen>
  );
}

function TierCard({
  tier,
  selected,
  onSelect,
}: {
  tier: MembershipTier;
  selected: boolean;
  onSelect: () => void;
}) {
  const price = formatCents(tier.price_cents, tier.currency);
  const benefits = benefitLines(tier);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${tier.name} membership, ${price} ${intervalSuffix(tier.interval)}`}
      onPress={onSelect}
      style={[styles.card, selected ? styles.cardSelected : null]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{tier.name}</Text>
        {selected && (
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={16} color={colors.textOnAccent} />
          </View>
        )}
      </View>
      <View style={styles.priceRow}>
        <Text style={styles.price}>{price}</Text>
        <Text style={styles.priceSuffix}> {intervalSuffix(tier.interval)}</Text>
      </View>
      <Text style={styles.priceCaption}>{billingCadence(tier.interval)}</Text>
      {tier.description ? <Text style={styles.description}>{tier.description}</Text> : null}
      {benefits.length > 0 && (
        <View style={styles.features}>
          {benefits.map((line) => (
            <View key={line} style={styles.feature}>
              <Ionicons name="checkmark" size={16} color={colors.accent} />
              <Text style={styles.featureText}>{line}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
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
  emptyTitle: { ...typography.h3, color: colors.text },
  emptyBody: { ...typography.body, color: colors.textMuted },
  cards: { gap: spacing.md },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceOverlay,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardSelected: { borderColor: colors.borderActive },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { ...typography.h2, color: colors.text, flexShrink: 1 },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.xs },
  price: { fontFamily: fonts.displayHeavy, fontSize: 44, lineHeight: 50, color: colors.accent },
  priceSuffix: { ...typography.body, color: colors.textMuted },
  priceCaption: { ...typography.caption, color: colors.textSubtle },
  description: { ...typography.body, color: colors.textMuted },
  features: { gap: spacing.sm, marginTop: spacing.sm },
  feature: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  featureText: { ...typography.body, color: colors.text, flex: 1 },
  footer: { gap: spacing.md, marginTop: spacing.sm },
  signOut: { ...typography.body, color: colors.textSubtle, textAlign: 'center' },
});
