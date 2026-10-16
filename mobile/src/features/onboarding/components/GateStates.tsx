/**
 * Full-screen states for the onboarding gate: loading, a retryable error, the
 * "your name" step, and the lapsed-membership screen. Every state a member
 * can be stuck on offers sign-out (a wrong account must never be a trap).
 */
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FeatureUnavailable } from '../../../components/FeatureUnavailable';
import { FormField, Input } from '../../../components/FormField';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { colors, spacing, typography } from '../../../theme/tokens';

export function GateLoading({ label = 'Loading your membership' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function GateError({
  title = 'We could not load your membership',
  body = 'Check your connection and try again.',
  onRetry,
  retrying = false,
  onSignOut,
}: {
  title?: string;
  body?: string;
  onRetry: () => void;
  retrying?: boolean;
  onSignOut: () => Promise<unknown>;
}) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.muted}>{body}</Text>
      <View style={styles.action}>
        <PrimaryButton label="Try again" loading={retrying} onPress={onRetry} />
        <SignOutButton onSignOut={onSignOut} />
      </View>
    </View>
  );
}

/** Accounts made from an emailed code or link have no name on Clutch yet. */
export function NameForm({
  saving,
  error,
  onSave,
  onSignOut,
}: {
  saving: boolean;
  error: string | null;
  onSave: (fullName: string) => void;
  onSignOut: () => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('Enter your name.');
      return;
    }
    setLocalError(null);
    onSave(trimmed);
  };
  const shown = localError ?? error;
  return (
    <View style={styles.center}>
      <Text style={styles.title}>What is your name?</Text>
      <Text style={styles.muted}>This is the name the club and other members see.</Text>
      <View style={styles.action}>
        <FormField label="Your name" error={shown ?? undefined}>
          <Input
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (localError) setLocalError(null);
            }}
            placeholder="Your name"
            autoFocus
            maxLength={80}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="done"
            onSubmitEditing={submit}
            hasError={Boolean(shown)}
            accessibilityLabel="Your name"
          />
        </FormField>
        <PrimaryButton label="Continue" loading={saving} onPress={submit} />
        <SignOutButton onSignOut={onSignOut} />
      </View>
    </View>
  );
}

/**
 * A membership that was active and lapsed (billing or club standing). With
 * `renew` the member can choose a tier again; otherwise the copy says how to
 * sort it out (the club, or the website while paying in the app is not live).
 */
export function LapsedMembershipScreen({
  reason,
  renew,
  paymentsAvailable,
  onRefresh,
  onSignOut,
}: {
  reason: string | null;
  renew: (() => void) | null;
  paymentsAvailable: boolean;
  onRefresh: () => Promise<unknown>;
  onSignOut: () => Promise<unknown>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const standing = reason ? ` (${reason.replace(/_/g, ' ')})` : '';
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Ionicons name="person-remove-outline" size={40} color={colors.textMuted} />
      <Text style={styles.title}>Your club membership is not active</Text>
      <Text style={styles.muted}>
        Your membership at Club70 has lapsed{standing}.{' '}
        {renew
          ? 'Choose a membership to renew it.'
          : 'Contact the club front desk to get it sorted, or sign out and use a different account.'}
      </Text>
      <View style={styles.action}>
        {renew ? <PrimaryButton label="Renew membership" onPress={renew} /> : null}
        {!renew && !paymentsAvailable ? (
          <FeatureUnavailable
            capability="nativePayments"
            title="Renewing in the app"
            description="Paying for a membership is not available in the app yet. Renew at the club front desk, then check again."
          />
        ) : null}
        <PrimaryButton
          label="Check again"
          variant={renew ? 'secondary' : 'primary'}
          loading={refreshing}
          onPress={() => {
            setRefreshing(true);
            void onRefresh().finally(() => setRefreshing(false));
          }}
        />
        <SignOutButton onSignOut={onSignOut} />
      </View>
    </View>
  );
}

export function SignOutButton({ onSignOut }: { onSignOut: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <PrimaryButton
      label="Sign out"
      variant="ghost"
      loading={busy}
      onPress={() => {
        setBusy(true);
        void onSignOut().finally(() => setBusy(false));
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
  },
  muted: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  action: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
