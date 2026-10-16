/**
 * Delete account (P5, origin/feat/account-deletion-and-checkin).
 *
 * GET /me/account/deletion first: what stands in the way (clubs the member
 * owns, children they alone guard) is shown up front, before anyone is asked
 * to sign in again. With no blockers, an "I understand" gate, then:
 * - step_up.satisfied (signed in recently enough): delete straight away;
 * - otherwise a fresh sign-in by the member's own method (password, an
 *   emailed code, or Google / Apple) immediately followed by DELETE /me/account.
 *
 * Clutch's answers to the delete:
 * - 403 step_up_required: the sign-in was not recent enough; ask again.
 * - 409 account_deletion_blocked: details are the blockers; show them.
 * - 409 refunds_pending: money is still on its way back; try later.
 * - 500 account_deletion_failed: nothing was deleted; try again.
 * - { deleted: true }: every token is dead; end the local session.
 * The password and code never leave this screen except to GoTrue.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { authErrorMessage } from '../../lib/auth-errors';
import { clutch, isClutchError, StepUpStateSchema, useMutationKey, type DeletionBlockers } from '../../lib/clutch';
import { OAuthCancelledError } from '../../lib/oauth';
import { useSession } from '../../lib/session';
import { Checkbox, FormField, Input, PasswordInput, PrimaryButton, Skeleton } from '../../components';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { AccountFrame } from './AccountFrame';
import { identitiesQuery } from './account-data';
import { blockerSentences, clutchErrorMessage, deletionBlockersFrom, hasDeletionBlockers } from './account-lib';
import {
  sendStepUpCode,
  StepUpWrongAccountError,
  stepUpMethods,
  stepUpWithCode,
  stepUpWithPassword,
  stepUpWithProvider,
  type StepUpMethod,
} from './step-up';

const CONSEQUENCES = [
  'Ends your Club70 membership and any tier subscription.',
  'Cancels your upcoming court bookings under the club cancellation policy.',
  'Removes you from your groups.',
  'Removes your profile and signs you out on every device.',
];

/** Feature-private: re-read every time the screen asks, never cached long. */
export const accountDeletionQuery = {
  queryKey: ['account', 'deletion'] as const,
  queryFn: () => clutch.me.accountDeletion(),
  staleTime: 0,
};

export function DeleteAccountScreen() {
  const identities = useQuery(identitiesQuery);
  const preview = useQuery(accountDeletionQuery);

  return (
    <AccountFrame title="Delete account" backLabel="Back to preferences" backTo="/account/preferences">
      <View style={styles.box}>
        <Text style={styles.strong}>Deleting your account:</Text>
        {CONSEQUENCES.map((line) => (
          <View key={line} style={styles.bulletRow}>
            <Ionicons name="ellipse" size={5} color={colors.textMuted} style={styles.bullet} />
            <Text style={styles.bulletText}>{line}</Text>
          </View>
        ))}
        <Text style={styles.strong}>This cannot be undone.</Text>
      </View>

      {identities.isPending || preview.isPending ? (
        <Skeleton height={160} borderRadius={radius.lg} />
      ) : identities.isError || preview.isError ? (
        <View style={styles.box} accessibilityRole="alert">
          <Text style={styles.text}>We could not check whether your account can be deleted.</Text>
          <PrimaryButton
            label="Try again"
            variant="secondary"
            onPress={() => {
              if (identities.isError) void identities.refetch();
              if (preview.isError) void preview.refetch();
            }}
          />
        </View>
      ) : hasDeletionBlockers(preview.data.blockers) ? (
        <BlockedView blockers={preview.data.blockers} onCheckAgain={() => void preview.refetch()} />
      ) : (
        <DeleteFlow
          methods={stepUpMethods(identities.data)}
          stepUpSatisfied={preview.data.step_up.satisfied}
          onStateChanged={() => void preview.refetch()}
        />
      )}
    </AccountFrame>
  );
}

function BlockedView({ blockers, onCheckAgain }: { blockers: DeletionBlockers; onCheckAgain: () => void }) {
  const router = useRouter();
  return (
    <View style={[styles.box, styles.blocked]} accessibilityRole="alert">
      <Text style={styles.title}>We cannot delete your account yet.</Text>
      {blockerSentences(blockers).map((line) => (
        <View key={line} style={styles.bulletRow}>
          <Ionicons name="ellipse" size={5} color={colors.textMuted} style={styles.bullet} />
          <Text style={styles.bulletText}>{line}</Text>
        </View>
      ))}
      <Text style={styles.muted}>Once that is resolved you can try again. Contact the club if you need help.</Text>
      <PrimaryButton label="Check again" variant="secondary" onPress={onCheckAgain} />
      <PrimaryButton label="Back to preferences" variant="ghost" onPress={() => router.replace('/account/preferences')} />
    </View>
  );
}

function stepUpMessage(details: Record<string, unknown> | undefined): string {
  const state = StepUpStateSchema.safeParse(details);
  if (state.success && state.data.second_factor_required) {
    return 'Your account uses a second sign-in factor, which this app cannot check yet. Delete your account from the Club70 website instead.';
  }
  return 'For your security, confirm it is you again, then delete straight away.';
}

function DeleteFlow({
  methods,
  stepUpSatisfied,
  onStateChanged,
}: {
  methods: StepUpMethod[];
  stepUpSatisfied: boolean;
  onStateChanged: () => void;
}) {
  const router = useRouter();
  const { userId, email, signOut } = useSession();
  const deleteKey = useMutationKey();

  const [understood, setUnderstood] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<DeletionBlockers | null>(null);

  const hasEmail = methods.some((m) => m.kind === 'password');
  const providers = methods.flatMap((m) => (m.kind === 'federated' ? [m.provider] : []));

  const sendCode = useMutation({
    mutationFn: () => sendStepUpCode(email ?? ''),
    onSuccess: () => {
      setCodeSent(true);
      setError(null);
    },
    onError: (err) => setError(authErrorMessage(err, 'We could not send the code. Please try again.')),
  });

  const run = useMutation({
    mutationFn: async (stepUp: () => Promise<void>) => {
      if (!userId) throw new Error('Not signed in.');
      await stepUp();
      return deleteKey.run('delete-account', (k) => clutch.me.deleteAccount({ idempotencyKey: k }));
    },
    onSuccess: async () => {
      // The account is gone (or its deletion is scheduled): end the local session.
      try {
        await signOut();
      } finally {
        router.replace('/auth/sign-in');
      }
    },
    onError: async (err) => {
      if (err instanceof OAuthCancelledError) return;
      if (err instanceof StepUpWrongAccountError) {
        // The session now belongs to that other login: leave it rather than act as it.
        await signOut();
        router.replace('/auth/sign-in');
        return;
      }
      if (isClutchError(err)) {
        switch (err.code) {
          case 'step_up_required':
            setError(stepUpMessage(err.details));
            onStateChanged();
            return;
          case 'account_deletion_blocked': {
            const found = deletionBlockersFrom(err.details);
            if (found && hasDeletionBlockers(found)) setBlockers(found);
            else setError('Something on your account has to be settled before it can be deleted.');
            onStateChanged();
            return;
          }
          case 'refunds_pending':
            setError('A refund is still on its way to you. Try again once it has arrived.');
            return;
          case 'account_deletion_failed':
            setError('Nothing was deleted. Please try again.');
            return;
          default:
            break;
        }
      }
      setError(
        isClutchError(err)
          ? clutchErrorMessage(err, 'We could not delete your account. Please try again.')
          : authErrorMessage(err, 'We could not confirm it is you. Please try again.'),
      );
    },
  });

  if (blockers !== null) {
    return <BlockedView blockers={blockers} onCheckAgain={onStateChanged} />;
  }

  const busy = run.isPending;
  const clearError = () => {
    if (error) setError(null);
  };

  return (
    <View style={styles.form}>
      <Checkbox
        checked={understood}
        onChange={setUnderstood}
        accessibilityLabel="I understand this permanently deletes my account"
        label={<Text style={styles.checkLabel}>I understand this permanently deletes my account.</Text>}
      />

      <Text style={styles.muted}>
        {stepUpSatisfied
          ? 'You signed in recently, so your account is deleted as soon as you confirm.'
          : 'Confirm it is you. Your account is deleted as soon as you do.'}
      </Text>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {stepUpSatisfied ? (
        <PrimaryButton
          label="Delete my account"
          variant="danger"
          disabled={!understood}
          loading={busy}
          onPress={() => run.mutate(async () => undefined)}
        />
      ) : null}

      {!stepUpSatisfied && hasEmail && email ? (
        <View style={styles.box}>
          <FormField label="Password">
            <PasswordInput
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                clearError();
              }}
              autoComplete="current-password"
              textContentType="password"
              placeholder="Your password"
              accessibilityLabel="Password"
            />
          </FormField>
          <PrimaryButton
            label="Delete with password"
            variant="danger"
            disabled={!understood || !password}
            loading={busy}
            onPress={() => run.mutate(() => stepUpWithPassword(userId ?? '', email, password))}
          />
        </View>
      ) : null}

      {!stepUpSatisfied && hasEmail && email ? (
        <View style={styles.box}>
          <Text style={styles.muted}>
            {codeSent ? `We emailed a 6-digit code to ${email}.` : 'No password? We can email you a code instead.'}
          </Text>
          <PrimaryButton
            label={codeSent ? 'Send a new code' : 'Email me a code'}
            variant="secondary"
            disabled={!understood}
            loading={sendCode.isPending}
            onPress={() => sendCode.mutate()}
          />
          {codeSent ? (
            <>
              <FormField label="Code">
                <Input
                  value={code}
                  onChangeText={(text) => {
                    setCode(text);
                    clearError();
                  }}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  keyboardType="number-pad"
                  placeholder="123456"
                  accessibilityLabel="Code"
                />
              </FormField>
              <PrimaryButton
                label="Delete with code"
                variant="danger"
                disabled={!understood || code.trim().length < 6}
                loading={busy}
                onPress={() => run.mutate(() => stepUpWithCode(userId ?? '', email, code))}
              />
            </>
          ) : null}
        </View>
      ) : null}

      {(stepUpSatisfied ? [] : providers).map((provider) => {
        const label = provider === 'google' ? 'Google' : 'Apple';
        return (
          <PrimaryButton
            key={provider}
            label={`Delete with ${label}`}
            variant="danger"
            disabled={!understood}
            loading={busy}
            onPress={() => run.mutate(() => stepUpWithProvider(userId ?? '', provider))}
          />
        );
      })}

      <PrimaryButton
        label="Keep my account"
        variant="ghost"
        disabled={busy}
        onPress={() => router.replace('/account/preferences')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  blocked: { borderColor: colors.danger },
  title: { ...typography.h3, color: colors.text },
  strong: { ...typography.bodyStrong, color: colors.text },
  text: { ...typography.body, color: colors.text },
  muted: { ...typography.body, color: colors.textMuted },
  error: { ...typography.body, color: colors.danger },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: { marginTop: 7 },
  bulletText: { flex: 1, ...typography.body, color: colors.textMuted },
  form: { gap: spacing.lg },
  checkLabel: { flex: 1, ...typography.body, color: colors.text },
});
