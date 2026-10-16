/**
 * Full-screen states for the onboarding gate: loading, a retryable error,
 * joining the club, and the support screen for a membership whose standing is
 * not active (the member has to talk to the club; redirecting would loop).
 */
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  onSignOut?: () => Promise<unknown>;
}) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.muted}>{body}</Text>
      <View style={styles.action}>
        <PrimaryButton label="Try again" loading={retrying} onPress={onRetry} />
        {onSignOut ? <SignOutButton onSignOut={onSignOut} /> : null}
      </View>
    </View>
  );
}

export function InactiveMembershipScreen({
  status,
  onRefresh,
  onSignOut,
}: {
  status: string | null;
  onRefresh: () => Promise<unknown>;
  onSignOut: () => Promise<unknown>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const standing = status ? ` (${status.replace(/_/g, ' ')})` : '';
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Ionicons name="person-remove-outline" size={40} color={colors.textMuted} />
      <Text style={styles.title}>Your club membership is not active</Text>
      <Text style={styles.muted}>
        Your membership at Club70 is on hold{standing}. Contact the club to get it sorted, or sign
        out and use a different account.
      </Text>
      <View style={styles.action}>
        <PrimaryButton
          label="Check again"
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

function SignOutButton({ onSignOut }: { onSignOut: () => Promise<unknown> }) {
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
