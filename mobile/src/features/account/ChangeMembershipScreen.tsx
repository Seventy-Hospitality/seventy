/**
 * Manage membership: the current tier, a switch to another tier, cancel and
 * resume. Clutch decides everything and the screen re-reads it after every
 * action (GET /me/membership); nothing is inferred locally.
 *
 * - Tiers on offer: GET /me/membership/change (Clutch's eligible list, each
 *   marked upgrade or downgrade by Clutch).
 * - Switch: POST /me/membership/change (PENDING P2). An upgrade applies now
 *   and may need a payment sheet for the prorated invoice (built from the
 *   bundle fields in the answer); then POST /me/membership/confirm (PENDING
 *   P2) and a re-read. A downgrade is scheduled for `effectiveAt`.
 * - Cancel at period end or now: DELETE /me/membership/subscription
 *   (PENDING P2). Resume a scheduled cancellation: POST
 *   /me/membership/subscription/resume (PENDING P2).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  clutch,
  toSheetIntent,
  useMutationKey,
  type ChangeTierResult,
  type EligibleChangeTier,
  type MySubscription,
  type SheetIntent,
} from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { membershipQuery, queryKeys } from '../../lib/queries';
import { usePresentConnectedSheet } from '../../lib/stripe';
import { Badge, Checkbox, EmptyStateView, PrimaryButton, Sheet, Skeleton, useToast } from '../../components';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import { AccountFrame } from './AccountFrame';
import { refreshMembershipState } from './account-data';
import {
  canCancel,
  canChangeTier,
  canResume,
  clutchErrorMessage,
  formatCents,
  instantDateLabel,
  intervalNoun,
  subscriptionStatusLine,
  tierChangeApplied,
} from './account-lib';

const eligibleChangesQuery = {
  queryKey: queryKeys.eligibleTierChanges,
  queryFn: () => clutch.membership.eligibleChanges(),
};

/** The sheet for an upgrade's prorated invoice, when Clutch asked for one. */
export function changeSheetIntent(result: ChangeTierResult): SheetIntent | null {
  if (result.kind !== 'upgraded') return null;
  if (!result.clientSecret && !result.simulated) return null;
  return toSheetIntent({
    clientSecret: result.clientSecret,
    intentType: result.intentType ?? 'payment',
    customerId: result.customerId,
    ephemeralKeySecret: result.ephemeralKeySecret,
    stripeAccount: result.stripeAccount,
    simulated: result.simulated ?? false,
  });
}

export function ChangeMembershipScreen() {
  const membership = useQuery(membershipQuery);

  return (
    <AccountFrame
      title="Membership"
      backLabel="Back to billing"
      backTo="/account/billing"
      refreshing={membership.isRefetching && !membership.isPending}
      onRefresh={() => void membership.refetch()}
    >
      {membership.isPending ? (
        <View accessibilityLabel="Loading your membership" style={styles.stack}>
          <Skeleton height={120} borderRadius={radius.lg} />
          <Skeleton height={140} borderRadius={radius.lg} />
        </View>
      ) : membership.isError ? (
        <View style={styles.box} accessibilityRole="alert">
          <Text style={styles.text}>We could not load your membership.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void membership.refetch()} />
        </View>
      ) : membership.data.subscription ? (
        <ManageView subscription={membership.data.subscription} />
      ) : (
        <EmptyStateView
          title="No membership tier on file"
          description="Contact the club if this looks wrong."
        />
      )}
    </AccountFrame>
  );
}

type SwitchPhase =
  | { name: 'idle' }
  | { name: 'working' }
  /** The upgrade waits on its payment: pay (again) to finish. */
  | { name: 'pay'; intent: SheetIntent; target: EligibleChangeTier }
  /** Paid, but Clutch does not show the new tier yet: re-check. */
  | { name: 'settling'; target: EligibleChangeTier };

function ManageView({ subscription }: { subscription: MySubscription }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const timezone = useClub().data?.timezone;
  const presentSheet = usePresentConnectedSheet();
  const changeKey = useMutationKey();
  const confirmKey = useMutationKey();
  const cancelKey = useMutationKey();
  const resumeKey = useMutationKey();

  const changeable = canChangeTier(subscription);
  const eligible = useQuery({ ...eligibleChangesQuery, enabled: changeable });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<SwitchPhase>({ name: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNow, setCancelNow] = useState(false);

  const periodEnd = subscription.current_period_end
    ? instantDateLabel(subscription.current_period_end, timezone)
    : null;
  const selected = eligible.data?.find((tier) => tier.id === selectedId) ?? null;

  /** Confirm with Clutch, re-read, and say what Clutch now shows. */
  async function settle(target: EligibleChangeTier) {
    try {
      await confirmKey.run('confirm', (k) => clutch.membership.confirm({ idempotencyKey: k }));
    } catch {
      // A failed re-read of Stripe decides nothing; the membership read below does.
    }
    let fresh: MySubscription | null = null;
    try {
      fresh = (await queryClient.fetchQuery({ ...membershipQuery, staleTime: 0 })).subscription;
    } catch {
      // Unknown: offer a re-check rather than guessing.
    }
    await refreshMembershipState(queryClient);
    if (tierChangeApplied(fresh, target)) {
      setPhase({ name: 'idle' });
      setSelectedId(null);
      setNotice(null);
      toast({ variant: 'success', message: `You are now on ${target.name}.` });
    } else {
      setPhase({ name: 'settling', target });
    }
  }

  async function pay(intent: SheetIntent, target: EligibleChangeTier) {
    if (intent.mode === 'stripe') {
      const sheet = await presentSheet(intent, { merchantDisplayName: 'Club70' });
      switch (sheet.status) {
        case 'canceled':
          setNotice('The switch waits for this payment. Pay to finish it, or leave it and keep your current tier.');
          setPhase({ name: 'pay', intent, target });
          return;
        case 'unconfigured':
          setNotice('Payments are not configured in this build.');
          setPhase({ name: 'pay', intent, target });
          return;
        case 'failed':
          setNotice(sheet.message || 'Your payment could not be completed.');
          setPhase({ name: 'pay', intent, target });
          return;
        case 'completed':
          break;
      }
    }
    setPhase({ name: 'working' });
    await settle(target);
  }

  async function switchTo(target: EligibleChangeTier) {
    if (phase.name === 'working') return;
    setNotice(null);
    setPhase({ name: 'working' });
    let result: ChangeTierResult;
    try {
      result = await changeKey.run(target.id, (k) => clutch.membership.change(target.id, { idempotencyKey: k }));
    } catch (err) {
      setNotice(clutchErrorMessage(err, 'We could not change your membership. Please try again.'));
      setPhase({ name: 'idle' });
      await refreshMembershipState(queryClient);
      return;
    }
    if (result.kind === 'downgrade_scheduled') {
      await refreshMembershipState(queryClient);
      setPhase({ name: 'idle' });
      setSelectedId(null);
      const when = result.effectiveAt ? instantDateLabel(result.effectiveAt, timezone) : periodEnd;
      toast({ variant: 'success', message: when ? `Switch to ${target.name} scheduled for ${when}.` : `Switch to ${target.name} scheduled.` });
      return;
    }
    const intent = changeSheetIntent(result);
    if (intent) await pay(intent, target);
    else await settle(target);
  }

  const cancel = useMutation({
    mutationFn: (at: 'period_end' | 'now') =>
      cancelKey.run(at, (k) => clutch.membership.cancel(at, { idempotencyKey: k })),
    onSettled: () => refreshMembershipState(queryClient),
    onSuccess: () => {
      setCancelOpen(false);
      toast({ variant: 'success', message: 'Cancellation received. Your membership status is shown below.' });
    },
    onError: (err) => {
      setCancelOpen(false);
      toast({ variant: 'error', message: clutchErrorMessage(err, 'We could not cancel your membership. Please try again.') });
    },
  });

  const resume = useMutation({
    mutationFn: () => resumeKey.run('resume', (k) => clutch.membership.resume({ idempotencyKey: k })),
    onSettled: () => refreshMembershipState(queryClient),
    onSuccess: () => toast({ variant: 'success', message: 'Resume received. Your membership status is shown below.' }),
    onError: (err) =>
      toast({ variant: 'error', message: clutchErrorMessage(err, 'We could not resume your membership. Please try again.') }),
  });

  const working = phase.name === 'working';

  return (
    <>
      <View style={styles.box}>
        <Text style={styles.label}>Current tier</Text>
        <View style={styles.tierRow}>
          <Text style={styles.tierName}>{subscription.tier_name}</Text>
          <Text style={styles.price}>
            {formatCents(subscription.price_cents, subscription.currency)}
            <Text style={styles.per}> / {intervalNoun(subscription.interval)}</Text>
          </Text>
        </View>
        <Text style={styles.muted}>{subscriptionStatusLine(subscription, timezone)}</Text>
      </View>

      {notice ? (
        <Text style={styles.alert} accessibilityRole="alert">
          {notice}
        </Text>
      ) : null}

      {phase.name === 'pay' ? (
        <View style={styles.box}>
          <Text style={styles.text}>Pay the prorated amount to finish switching to {phase.target.name}.</Text>
          <PrimaryButton label="Pay and switch" onPress={() => void pay(phase.intent, phase.target)} />
          <PrimaryButton label="Not now" variant="ghost" onPress={() => setPhase({ name: 'idle' })} />
        </View>
      ) : phase.name === 'settling' ? (
        <View style={styles.box} accessibilityRole="progressbar">
          <Text style={styles.title}>Your switch is being confirmed</Text>
          <Text style={styles.muted}>
            The club has not confirmed {phase.target.name} yet. This can take a moment while the payment clears.
          </Text>
          <PrimaryButton
            label="Check again"
            onPress={() => {
              const { target } = phase;
              setPhase({ name: 'working' });
              void settle(target);
            }}
          />
        </View>
      ) : null}

      {canResume(subscription) ? (
        <View style={styles.box}>
          <Text style={styles.text}>
            {periodEnd ? `Your membership ends ${periodEnd}.` : 'Your membership is set to end.'} Resume it to keep
            your tier.
          </Text>
          <PrimaryButton label="Resume membership" loading={resume.isPending} onPress={() => resume.mutate()} />
        </View>
      ) : null}

      {changeable && (phase.name === 'idle' || phase.name === 'working') ? (
        <View style={styles.stack}>
          <Text style={styles.label}>Switch tier</Text>
          {eligible.isPending ? (
            <Skeleton height={120} borderRadius={radius.lg} />
          ) : eligible.isError ? (
            <View style={styles.box} accessibilityRole="alert">
              <Text style={styles.text}>We could not load the tiers you can switch to.</Text>
              <PrimaryButton label="Try again" variant="secondary" onPress={() => void eligible.refetch()} />
            </View>
          ) : eligible.data.length === 0 ? (
            <Text style={styles.muted}>There are no other tiers to switch to right now.</Text>
          ) : (
            <View style={styles.stack} accessibilityRole="radiogroup" accessibilityLabel="Tiers">
              {eligible.data.map((tier) => (
                <TierChoice
                  key={tier.id}
                  tier={tier}
                  selected={tier.id === selectedId}
                  onSelect={() => setSelectedId(tier.id)}
                />
              ))}
            </View>
          )}

          {selected ? (
            <View style={styles.box}>
              <Text style={styles.text}>
                {selected.changeType === 'upgrade'
                  ? `${selected.name} starts right away. If there is a prorated charge, you confirm it in the next step.`
                  : `${selected.name} starts when this billing period ends${periodEnd ? ` (${periodEnd})` : ''}. You keep ${subscription.tier_name} until then.`}
              </Text>
              <PrimaryButton
                label={selected.changeType === 'upgrade' ? 'Switch now' : 'Schedule switch'}
                loading={working}
                onPress={() => void switchTo(selected)}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {canCancel(subscription) && !subscription.cancel_at_period_end ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel membership"
          onPress={() => setCancelOpen(true)}
          hitSlop={8}
          style={styles.cancelZone}
        >
          <Text style={styles.cancelLink}>Cancel membership</Text>
        </Pressable>
      ) : null}

      <Sheet
        open={cancelOpen}
        onClose={() => {
          if (!cancel.isPending) setCancelOpen(false);
        }}
        title="Cancel membership"
      >
        <View style={styles.dialog}>
          <Text style={styles.text}>
            {periodEnd
              ? `Your membership stays active until ${periodEnd}, then ends. You will not be charged again.`
              : 'Your membership stays active until the end of this billing period, then ends.'}
          </Text>
          <Checkbox
            checked={cancelNow}
            onChange={setCancelNow}
            accessibilityLabel="Cancel immediately instead of at the end of the billing period"
            label={
              <Text style={styles.checkboxLabel}>
                Cancel immediately instead. Access ends now and the rest of the period is not refunded.
              </Text>
            }
          />
          <PrimaryButton
            label={cancelNow ? 'Cancel immediately' : 'Cancel membership'}
            variant="danger"
            loading={cancel.isPending}
            onPress={() => cancel.mutate(cancelNow ? 'now' : 'period_end')}
          />
          <PrimaryButton
            label="Keep membership"
            variant="ghost"
            disabled={cancel.isPending}
            onPress={() => setCancelOpen(false)}
          />
        </View>
      </Sheet>
    </>
  );
}

function TierChoice({
  tier,
  selected,
  onSelect,
}: {
  tier: EligibleChangeTier;
  selected: boolean;
  onSelect: () => void;
}) {
  const price = formatCents(tier.price_cents, tier.currency);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${tier.name}, ${price} per ${intervalNoun(tier.interval)}, ${tier.changeType}`}
      onPress={onSelect}
      style={[styles.choice, selected ? styles.choiceSelected : null]}
    >
      <View style={styles.tierRow}>
        <Text style={styles.tierName}>{tier.name}</Text>
        <View style={styles.badges}>
          <Badge label={tier.changeType === 'upgrade' ? 'Upgrade' : 'Downgrade'} variant={tier.changeType === 'upgrade' ? 'accent' : 'neutral'} />
          {selected ? (
            <View style={styles.check}>
              <Ionicons name="checkmark" size={16} color={colors.textOnAccent} />
            </View>
          ) : null}
        </View>
      </View>
      <Text style={styles.price}>
        {price}
        <Text style={styles.per}> / {intervalNoun(tier.interval)}</Text>
      </Text>
      {tier.description ? <Text style={styles.muted}>{tier.description}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  box: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  label: { ...typography.label, color: colors.textMuted, textTransform: 'uppercase' },
  title: { ...typography.h3, color: colors.text },
  text: { ...typography.body, color: colors.text },
  muted: { ...typography.body, color: colors.textMuted },
  alert: { ...typography.body, color: colors.danger },
  tierRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  tierName: { ...typography.h2, color: colors.text, flexShrink: 1 },
  price: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.accent },
  per: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  check: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choice: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceOverlay,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  choiceSelected: { borderColor: colors.borderActive },
  cancelZone: { alignItems: 'center', paddingVertical: spacing.md },
  cancelLink: { ...typography.bodyStrong, color: colors.danger },
  dialog: { gap: spacing.md, paddingBottom: spacing.sm },
  checkboxLabel: { flex: 1, ...typography.body, color: colors.textMuted },
});
