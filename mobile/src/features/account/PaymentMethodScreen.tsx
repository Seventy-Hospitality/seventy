/**
 * Payment methods: the cards Clutch holds for this member at the club
 * (GET /me/payment-methods), make one the default (PATCH), remove one
 * (DELETE; Clutch may refuse to remove the card a live subscription bills,
 * and its explanation is shown), and add a card:
 *
 *   POST /me/payment-methods/setup-intent (PENDING P2) -> SetupIntent sheet
 *   on the club's connected account -> POST /me/payment-methods
 *   {setup_intent_id} (PENDING P2): Clutch retrieves the SetupIntent and
 *   stores the card it holds -> re-read the list.
 *
 * A completed sheet is not a saved card: only Clutch's save is. Simulated
 * deployments show no sheet. Card data never touches our code (SAQ-A).
 */
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  clutch,
  toSheetIntent,
  useMutationKey,
  type CardId,
  type SavedPaymentMethod,
} from '../../lib/clutch';
import { paymentMethodsQuery, queryKeys } from '../../lib/queries';
import { usePresentConnectedSheet } from '../../lib/stripe';
import { Badge, EmptyStateView, PrimaryButton, Skeleton, useToast } from '../../components';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import { AccountFrame } from './AccountFrame';
import { clutchErrorMessage, paymentMethodLabel } from './account-lib';

export function PaymentMethodScreen() {
  const methods = useQuery(paymentMethodsQuery);

  return (
    <AccountFrame
      title="Payment methods"
      backLabel="Back to billing"
      backTo="/account/billing"
      refreshing={methods.isRefetching && !methods.isPending}
      onRefresh={() => void methods.refetch()}
    >
      {methods.isPending ? (
        <View accessibilityLabel="Loading payment methods" style={styles.list}>
          <Skeleton height={64} borderRadius={radius.lg} />
          <Skeleton height={64} borderRadius={radius.lg} />
        </View>
      ) : methods.isError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.body}>We could not load your payment methods.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void methods.refetch()} />
        </View>
      ) : (
        <>
          {methods.data.length === 0 ? (
            <EmptyStateView
              title="No payment methods"
              description="Add a card to pay for your membership and bookings."
            />
          ) : (
            <View style={styles.card}>
              {methods.data.map((method, index) => (
                <MethodRow key={method.id} method={method} first={index === 0} />
              ))}
            </View>
          )}
          <AddCard />
        </>
      )}
    </AccountFrame>
  );
}

function MethodRow({ method, first }: { method: SavedPaymentMethod; first: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const defaultKey = useMutationKey();
  const removeKey = useMutationKey();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.paymentMethods });
    void queryClient.invalidateQueries({ queryKey: queryKeys.membership, exact: true });
  };

  const makeDefault = useMutation({
    mutationFn: (cardId: CardId) =>
      defaultKey.run(cardId, (k) => clutch.paymentMethods.setDefault(cardId, { idempotencyKey: k })),
    onSuccess: refresh,
    onError: (err) => toast({ variant: 'error', message: clutchErrorMessage(err, 'We could not change your default card.') }),
  });

  const remove = useMutation({
    mutationFn: (cardId: CardId) =>
      removeKey.run(cardId, (k) => clutch.paymentMethods.remove(cardId, { idempotencyKey: k })),
    onSuccess: () => {
      refresh();
      toast({ variant: 'success', message: 'Card removed.' });
    },
    // Clutch refuses to remove the card a live subscription bills: its reason is shown as is.
    onError: (err) => toast({ variant: 'error', message: clutchErrorMessage(err, 'We could not remove that card.') }),
  });

  const label = paymentMethodLabel(method);
  const confirmRemove = () =>
    Alert.alert('Remove card?', label, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(method.id) },
    ]);

  return (
    <View style={[styles.row, first ? null : styles.rowDivider]}>
      <Ionicons name="card-outline" size={20} color={colors.textMuted} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {method.is_default ? <Badge label="Default" variant="accent" /> : null}
      </View>
      <View style={styles.rowActions}>
        {!method.is_default ? (
          <TextAction
            label="Make default"
            accessibilityLabel={`Make ${label} the default`}
            busy={makeDefault.isPending}
            onPress={() => makeDefault.mutate(method.id)}
          />
        ) : null}
        <TextAction
          label="Remove"
          accessibilityLabel={`Remove ${label}`}
          destructive
          busy={remove.isPending}
          onPress={confirmRemove}
        />
      </View>
    </View>
  );
}

function TextAction({
  label,
  accessibilityLabel,
  onPress,
  busy,
  destructive,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  busy: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      hitSlop={6}
    >
      <Text style={[styles.action, destructive ? styles.actionDestructive : null, busy ? styles.actionBusy : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

type AddPhase = 'idle' | 'working';

function AddCard() {
  const queryClient = useQueryClient();
  const presentSheet = usePresentConnectedSheet();
  const setupKey = useMutationKey();
  const saveKey = useMutationKey();

  const [phase, setPhase] = useState<AddPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** A completed SetupIntent Clutch has not stored yet (the save failed): retry it. */
  const [unsaved, setUnsaved] = useState<string | null>(null);

  async function refreshList() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.paymentMethods });
  }

  async function saveWithClutch(setupIntentId: string) {
    try {
      await saveKey.run(setupIntentId, (k) => clutch.paymentMethods.save(setupIntentId, { idempotencyKey: k }));
      setUnsaved(null);
      setNotice('Card added.');
      await refreshList();
    } catch (err) {
      setUnsaved(setupIntentId);
      setError(clutchErrorMessage(err, 'Your card was accepted, but the club could not save it yet. Try again.'));
    }
  }

  async function add() {
    if (phase === 'working') return;
    setError(null);
    setNotice(null);
    setPhase('working');
    try {
      if (unsaved) {
        await saveWithClutch(unsaved);
        return;
      }
      let bundle;
      try {
        bundle = await setupKey.run('setup-intent', (k) => clutch.paymentMethods.setupIntent({ idempotencyKey: k }));
      } catch (err) {
        setError(clutchErrorMessage(err, 'We could not start adding a card. Please try again.'));
        return;
      }
      const intent = toSheetIntent(bundle);
      if (intent.mode === 'simulated') {
        // Simulated deployments have no Stripe: Clutch handles the card itself.
        setNotice('Cards are simulated in this environment: no card details are needed.');
        await refreshList();
        return;
      }
      const sheet = await presentSheet(intent, { merchantDisplayName: 'Club70' });
      switch (sheet.status) {
        case 'canceled':
          return;
        case 'unconfigured':
          setError('Payments are not configured in this build.');
          return;
        case 'failed':
          setError(sheet.message || 'Your card could not be added. Please try again.');
          return;
        case 'completed':
          await saveWithClutch(sheet.intentId);
          return;
      }
    } finally {
      setPhase('idle');
    }
  }

  return (
    <View style={styles.addBlock}>
      <View style={styles.secureRow}>
        <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
        <Text style={styles.secureText}>Card details are entered securely in the next step.</Text>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        label={unsaved ? 'Finish saving card' : 'Add card'}
        loading={phase === 'working'}
        onPress={() => void add()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  body: { ...typography.body, color: colors.textMuted },
  errorBox: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowText: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  rowLabel: { color: colors.text, fontFamily: fonts.bodyMedium, fontSize: 15 },
  rowActions: { alignItems: 'flex-end', gap: spacing.sm },
  action: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 14 },
  actionDestructive: { color: colors.danger },
  actionBusy: { opacity: 0.5 },
  addBlock: { gap: spacing.md },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  secureText: { ...typography.body, color: colors.textMuted, flex: 1 },
  notice: { ...typography.body, color: colors.textMuted },
  errorText: { ...typography.body, color: colors.danger },
});
