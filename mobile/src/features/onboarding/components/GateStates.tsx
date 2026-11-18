/**
 * Full-screen states for the onboarding gate: loading, a retryable error, the
 * "your name" step, and the lapsed-membership screen. Every state a member
 * can be stuck on offers sign-out (a wrong account must never be a trap).
 */
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FormField, Input } from '../../../components/FormField';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { colors, spacing, typography } from '../../../theme/tokens';
import { lapsedReasonSentence } from '../onboarding';

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

/**
 * Centred when it fits, scrollable when it does not (a small phone, large
 * text, the keyboard up), inside the safe area.
 */
function GateScroll({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
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
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <GateScroll>
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
      </GateScroll>
    </KeyboardAvoidingView>
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
  return (
    <GateScroll>
      <View style={styles.stack} accessibilityRole="alert">
        <Ionicons name="person-remove-outline" size={40} color={colors.textMuted} />
        <Text style={styles.title}>Your club membership is not active</Text>
        <Text style={styles.muted}>
          {lapsedReasonSentence(reason)}{' '}
          {renew
            ? 'Choose a membership to renew it.'
            : 'Contact the club front desk to get it sorted, or sign out and use a different account.'}
        </Text>
        <View style={styles.action}>
          {renew ? <PrimaryButton label="Renew membership" onPress={renew} /> : null}
          {/* Hidden until nativePayments ships on Clutch.
          {!renew && !paymentsAvailable ? (
            <FeatureUnavailable
              capability="nativePayments"
              title="Renewing in the app"
              description="Paying for a membership is not available in the app yet. Renew at the club front desk, then check again."
            />
          ) : null}
          */}
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
    </GateScroll>
  );
}

export function SignOutButton({ onSignOut }: { onSignOut: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <PrimaryButton
        label="Sign out"
        variant="ghost"
        loading={busy}
        onPress={() => {
          setBusy(true);
          setFailed(false);
          void onSignOut()
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
      />
      {failed ? (
        <Text style={styles.error} accessibilityRole="alert">
          Could not sign out, try again.
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1, backgroundColor: colors.bg },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  stack: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.md },
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
  error: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
  action: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
