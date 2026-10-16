/**
 * Manage membership: the current tier, a switch to another tier, keeping the
 * tier when a downgrade is booked, cancel and resume. All of it is Clutch P2
 * (capabilities.nativePayments); without it the screen shows the plan and
 * says changes are not in the app yet. Clutch decides everything and the
 * screen re-reads GET /me/membership after every action; nothing is inferred.
 *
 * - Tiers on offer: GET /me/membership/change (each marked upgrade or
 *   downgrade by Clutch, `change_type`).
 * - Switch: POST /me/membership/change answers `kind`:
 *   `upgraded` applies once its prorated invoice is paid (status
 *   `requires_payment`: sheet, then POST /me/membership/confirm and a
 *   re-read); `downgrade_scheduled` starts at `effective_at`;
 *   `downgrade_cancelled` when the current tier is named while a downgrade is
 *   booked (the "keep my tier" action).
 * - Cancel at period end or now: DELETE /me/membership/subscription.
 *   Resume a scheduled cancellation: POST /me/membership/subscription/resume.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  bundleToSheet,
  clutch,
  useMutationKey,
  type ChangeTierResult,
  type EligibleChangeTier,
  type MyMembershipBilling,
  type SheetIntent,
  type TierId,
} from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { membershipQuery, queryKeys } from '../../lib/queries';
import { usePresentConnectedSheet } from '../../lib/stripe';
import {
  Badge,
  Checkbox,
  EmptyStateView,
  FeatureUnavailable,
  PrimaryButton,
  Sheet,
  Skeleton,
  useToast,
} from '../../components';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import { AccountFrame } from './AccountFrame';
import { refreshMembershipState } from './account-data';
import {
  billingErrorMessage,
  canCancel,
  canCancelDowngrade,
  canChangeTier,
  canResume,
  formatCents,
  instantDateLabel,
  intervalNoun,
  planSummary,
  tierChangeApplied,
  type PlanSummary,
} from './account-lib';

const eligibleChangesQuery = {
  queryKey: queryKeys.eligibleTierChanges,
  queryFn: () => clutch.membership.eligibleChanges(),
};

/** The sheet for an upgrade's prorated invoice, when Clutch asked for one. */
export function changeSheetIntent(result: ChangeTierResult): SheetIntent | null {
  if (result.kind !== 'upgraded' || result.status !== 'requires_payment') return null;
  return bundleToSheet(result);
}

export function ChangeMembershipScreen() {
  const membership = useQuery(membershipQuery);
  const timezone = useClub().data?.timezone;

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
      ) : (
        (() => {
          const plan = planSummary(membership.data, timezone);
          if (!plan) {
            return (
              <EmptyStateView title="No membership tier on file" description="Contact the club if this looks wrong." />
            );
          }
          if (!clutch.capabilities.nativePayments || membership.data.kind !== 'billing') {
            return (
              <>
                <CurrentPlan plan={plan} />
                <FeatureUnavailable
                  capability="nativePayments"
                  title="Changing your membership"
                  description="Switching, cancelling or resuming your membership is not available in the app yet. The club front desk can help meanwhile."
                />
              </>
            );
          }
          return <ManageView plan={plan} data={membership.data.data} />;
        })()
      )}
    </AccountFrame>
  );
}

function CurrentPlan({ plan }: { plan: PlanSummary }) {
  return (
    <View style={styles.box}>
      <Text style={styles.label}>Current tier</Text>
      <View style={styles.tierRow}>
        <Text style={styles.tierName}>{plan.name}</Text>
        {plan.price ? (
          <Text style={styles.price}>
            {formatCents(plan.price.cents, plan.price.currency)}
            <Text style={styles.per}> / {intervalNoun(plan.price.interval)}</Text>
          </Text>
        ) : null}
      </View>
      <Text style={styles.muted}>{plan.statusLine}</Text>
    </View>
  );
}

interface Target {
  id: TierId;
  name: string;
}

type SwitchPhase =
  | { name: 'idle' }
  | { name: 'working' }
  /** The upgrade waits on its payment: pay (again) to finish. */
  | { name: 'pay'; intent: SheetIntent; target: Target }
  /** Paid, but Clutch does not show the new tier yet: re-check. */
  | { name: 'settling'; target: Target };

function ManageView({ plan, data }: { plan: PlanSummary; data: MyMembershipBilling }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const timezone = useClub().data?.timezone;
  const presentSheet = usePresentConnectedSheet();
  const changeKey = useMutationKey();
  const confirmKey = useMutationKey();
  const cancelKey = useMutationKey();
  const resumeKey = useMutationKey();

  const changeable = canChangeTier(data);
  const eligible = useQuery({ ...eligibleChangesQuery, enabled: changeable });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<SwitchPhase>({ name: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNow, setCancelNow] = useState(false);

  const periodEnd = data.billing.current_period_end
    ? instantDateLabel(data.billing.current_period_end, timezone)
    : null;
  const selected = eligible.data?.find((tier) => tier.id === selectedId) ?? null;

  /** Confirm with Clutch, re-read, and say what Clutch now shows. */
  async function settle(target: Target) {
    try {
      await confirmKey.run('confirm', (k) => clutch.membership.confirm({ idempotencyKey: k }), { rerunnable: true });
    } catch {
      // A failed ask of Stripe decides nothing; the membership read below does.
    }
    let applied = false;
    try {
      applied = tierChangeApplied(await queryClient.fetchQuery({ ...membershipQuery, staleTime: 0 }), target.id);
    } catch {
      // Unknown: offer a re-check rather than guessing.
    }
    await refreshMembershipState(queryClient);
    if (applied) {
      setPhase({ name: 'idle' });
      setSelectedId(null);
      setNotice(null);
      toast({ variant: 'success', message: `You are now on ${target.name}.` });
    } else {
      setPhase({ name: 'settling', target });
    }
  }

  async function pay(intent: SheetIntent, target: Target) {
    if (intent.mode === 'stripe') {
      const sheet = await presentSheet(intent, { merchantDisplayName: 'Club70' });
      switch (sheet.status) {
        case 'canceled':
          setNotice('The switch waits for this payment. Pay to finish it, or leave it and keep your current tier.');
          setPhase({ name: 'pay', intent, target });
          return;
        case 'busy':
          // Another sheet is already up; nothing was presented.
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

  async function change(target: Target) {
    if (phase.name === 'working') return;
    setNotice(null);
    setPhase({ name: 'working' });
    let result: ChangeTierResult;
    try {
      result = await changeKey.run(target.id, (k) => clutch.membership.change(target.id, { idempotencyKey: k }));
    } catch (err) {
      setNotice(billingErrorMessage(err, 'We could not change your membership. Please try again.'));
      setPhase({ name: 'idle' });
      await refreshMembershipState(queryClient);
      return;
    }
    switch (result.kind) {
      case 'downgrade_scheduled': {
        await refreshMembershipState(queryClient);
        setPhase({ name: 'idle' });
        setSelectedId(null);
        const when = result.effective_at ? instantDateLabel(result.effective_at, timezone) : periodEnd;
        toast({
          variant: 'success',
          message: when ? `Switch to ${target.name} scheduled for ${when}.` : `Switch to ${target.name} scheduled.`,
        });
        return;
      }
      case 'downgrade_cancelled':
        await refreshMembershipState(queryClient);
        setPhase({ name: 'idle' });
        toast({ variant: 'success', message: `The switch is off. You keep ${target.name}.` });
        return;
      case 'upgraded': {
        const intent = changeSheetIntent(result);
        if (intent) await pay(intent, target);
        else await settle(target);
        return;
      }
    }
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
      toast({ variant: 'error', message: billingErrorMessage(err, 'We could not cancel your membership. Please try again.') });
    },
  });

  const resume = useMutation({
    mutationFn: () => resumeKey.run('resume', (k) => clutch.membership.resume({ idempotencyKey: k })),
    onSettled: () => refreshMembershipState(queryClient),
    onSuccess: () => toast({ variant: 'success', message: 'Resume received. Your membership status is shown below.' }),
    onError: (err) =>
      toast({ variant: 'error', message: billingErrorMessage(err, 'We could not resume your membership. Please try again.') }),
  });

  const working = phase.name === 'working';
  const pendingTier = data.billing.pending_tier;
  const currentTier = data.tier;

  return (
    <>
      <CurrentPlan plan={plan} />

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

      {canCancelDowngrade(data) && pendingTier && currentTier ? (
        <View style={styles.box}>
          <Text style={styles.text}>
            {data.billing.pending_tier_effective_at
              ? `You switch to ${pendingTier.name} on ${instantDateLabel(data.billing.pending_tier_effective_at, timezone)}.`
              : `You switch to ${pendingTier.name} when this period ends.`}
          </Text>
          <PrimaryButton
            label={`Keep ${currentTier.name}`}
            variant="secondary"
            loading={working}
            onPress={() => void change({ id: currentTier.id, name: currentTier.name })}
          />
        </View>
      ) : null}

      {canResume(data) ? (
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
                {selected.change_type === 'upgrade'
                  ? `${selected.name} starts once its prorated charge is paid. You confirm it in the next step.`
                  : `${selected.name} starts when this billing period ends${periodEnd ? ` (${periodEnd})` : ''}. You keep ${plan.name} until then.`}
              </Text>
              <PrimaryButton
                label={selected.change_type === 'upgrade' ? 'Switch now' : 'Schedule switch'}
                loading={working}
                onPress={() => void change(selected)}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {canCancel(data) ? (
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
      accessibilityLabel={`${tier.name}, ${price} per ${intervalNoun(tier.interval)}, ${tier.change_type}`}
      onPress={onSelect}
      style={[styles.choice, selected ? styles.choiceSelected : null]}
    >
      <View style={styles.tierRow}>
        <Text style={styles.tierName}>{tier.name}</Text>
        <View style={styles.badges}>
          <Badge label={tier.change_type === 'upgrade' ? 'Upgrade' : 'Downgrade'} variant={tier.change_type === 'upgrade' ? 'accent' : 'neutral'} />
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
