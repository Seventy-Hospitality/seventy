/**
 * Delete account: what deletion does, an "I understand" gate, then a fresh
 * sign-in by the member's own method (password, an emailed code, or Google /
 * Apple) immediately followed by DELETE /me/account (PENDING P5).
 *
 * Clutch's answers:
 * - 403 step_up_required: the sign-in was not recent enough; ask again.
 * - 409 deletion_blocked: `details.blockers` (DeletionBlockerSchema) say what
 *   stands in the way (an open dispute, a refund in flight, owning a club);
 *   each is shown in plain words.
 * - success ('deleted' or 'scheduled'): sign out locally.
 * The password and code never leave this screen except to GoTrue.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { authErrorMessage } from '../../lib/auth-errors';
import { clutch, hasCode, isClutchError, useMutationKey, type DeletionBlocker } from '../../lib/clutch';
import { OAuthCancelledError } from '../../lib/oauth';
import { useSession } from '../../lib/session';
import { Checkbox, FormField, Input, PasswordInput, PrimaryButton, Skeleton } from '../../components';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { AccountFrame } from './AccountFrame';
import { identitiesQuery } from './account-data';
import { blockerSentence, clutchErrorMessage, deletionBlockers } from './account-lib';
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

export function DeleteAccountScreen() {
  const identities = useQuery(identitiesQuery);

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

      {identities.isPending ? (
        <Skeleton height={160} borderRadius={radius.lg} />
      ) : identities.isError ? (
        <View style={styles.box} accessibilityRole="alert">
          <Text style={styles.text}>We could not load your sign-in options.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void identities.refetch()} />
        </View>
      ) : (
        <DeleteFlow methods={stepUpMethods(identities.data)} />
      )}
    </AccountFrame>
  );
}

/** Thrown when the step-up worked but Clutch refused; carries what to show. */
class DeleteRefused extends Error {
  constructor(readonly blockers: DeletionBlocker[] | null, message: string) {
    super(message);
  }
}

function DeleteFlow({ methods }: { methods: StepUpMethod[] }) {
  const router = useRouter();
  const { userId, email, signOut } = useSession();
  const deleteKey = useMutationKey();

  const [understood, setUnderstood] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<DeletionBlocker[] | null>(null);

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
      try {
        return await deleteKey.run('delete-account', (k) => clutch.me.deleteAccount({ idempotencyKey: k }));
      } catch (err) {
        if (hasCode(err, 'deletion_blocked')) {
          throw new DeleteRefused(deletionBlockers(err.details), err.message);
        }
        throw err;
      }
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
      if (err instanceof DeleteRefused) {
        setBlockers(err.blockers ?? []);
        return;
      }
      if (err instanceof OAuthCancelledError) return;
      if (err instanceof StepUpWrongAccountError) {
        // The session now belongs to that other login: leave it rather than act as it.
        await signOut();
        router.replace('/auth/sign-in');
        return;
      }
      if (hasCode(err, 'step_up_required')) {
        setError('For your security, confirm it is you again, then delete straight away.');
        return;
      }
      setError(
        isClutchError(err)
          ? clutchErrorMessage(err, 'We could not delete your account. Please try again.')
          : authErrorMessage(err, 'We could not confirm it is you. Please try again.'),
      );
    },
  });

  if (blockers !== null) {
    return (
      <View style={[styles.box, styles.blocked]} accessibilityRole="alert">
        <Text style={styles.title}>We cannot delete your account yet.</Text>
        {blockers.length > 0 ? (
          blockers.map((blocker, i) => (
            <View key={`${blocker.code}-${i}`} style={styles.bulletRow}>
              <Ionicons name="ellipse" size={5} color={colors.textMuted} style={styles.bullet} />
              <Text style={styles.bulletText}>{blockerSentence(blocker)}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>Something on your account has to be settled first.</Text>
        )}
        <Text style={styles.muted}>Once that is resolved you can try again. Contact the club if you need help.</Text>
        <PrimaryButton
          label="Back to preferences"
          variant="secondary"
          onPress={() => router.replace('/account/preferences')}
        />
      </View>
    );
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

      <Text style={styles.muted}>Confirm it is you. Your account is deleted as soon as you do.</Text>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {hasEmail && email ? (
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

      {hasEmail && email ? (
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

      {providers.map((provider) => {
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
