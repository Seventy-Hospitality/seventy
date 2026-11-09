/**
 * Sign-in methods, through Clutch's /api/v1/me/identities:
 * - the identities on the account (GET): email, google, apple;
 * - link Google or Apple natively: the platform SDK issues an ID token for a
 *   fresh nonce (getFederatedCredential) and POST attaches it; Clutch answers
 *   the session that now carries the identity, which the app adopts. Needs
 *   manual linking on in Clutch's auth settings (identity_linking_disabled
 *   otherwise);
 * - unlink with DELETE /me/identities/{identityId}. Clutch refuses to remove
 *   the last one (last_identity).
 */
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { clutch, type Identity as AuthIdentity } from '../../lib/clutch';
import { sessionStore } from '../../lib/auth-session';
import { authErrorMessage } from '../../lib/auth-errors';
import { federatedAdapters, getFederatedCredential, OAuthCancelledError, type OAuthProvider } from '../../lib/oauth';
import { useSession } from '../../lib/session';
import { PrimaryButton, Skeleton, useToast } from '../../components';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import { AccountFrame } from './AccountFrame';
import { identitiesQuery } from './account-data';

const PROVIDERS: readonly { provider: OAuthProvider; label: string; icon: 'logo-google' | 'logo-apple' }[] = [
  { provider: 'google', label: 'Google', icon: 'logo-google' },
  { provider: 'apple', label: 'Apple', icon: 'logo-apple' },
];

function identityEmail(identity: AuthIdentity): string | null {
  return identity.email;
}

export function SignInMethodsScreen() {
  const identities = useQuery(identitiesQuery);

  return (
    <AccountFrame title="Sign-in methods" backLabel="Back to preferences" backTo="/account/preferences">
      {identities.isPending ? (
        <View accessibilityLabel="Loading sign-in methods" style={styles.loading}>
          <Skeleton height={64} borderRadius={radius.lg} />
          <Skeleton height={120} borderRadius={radius.lg} />
        </View>
      ) : identities.isError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{authErrorMessage(identities.error, 'We could not load your sign-in methods.')}</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void identities.refetch()} />
        </View>
      ) : (
        <SignInMethodsView identities={identities.data} />
      )}
    </AccountFrame>
  );
}

function SignInMethodsView({ identities }: { identities: AuthIdentity[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { email, oauth } = useSession();

  const refresh = () => queryClient.invalidateQueries({ queryKey: identitiesQuery.queryKey });

  const link = useMutation({
    mutationFn: async (provider: OAuthProvider) => {
      const credential = await getFederatedCredential(federatedAdapters[provider]);
      await sessionStore.set(
        await clutch.auth.linkIdentity({
          provider: credential.provider,
          id_token: credential.token,
          nonce: credential.nonce,
        }),
      );
    },
    onSuccess: (_data, provider) => {
      void refresh();
      toast({ variant: 'success', message: `${labelOf(provider)} linked.` });
    },
    onError: (err) => {
      if (err instanceof OAuthCancelledError) return;
      toast({ variant: 'error', message: authErrorMessage(err, 'We could not link that account. Please try again.') });
    },
  });

  const unlink = useMutation({
    mutationFn: async (identity: AuthIdentity) => {
      await clutch.auth.unlinkIdentity(identity.identity_id);
    },
    onSuccess: (_data, identity) => {
      void refresh();
      toast({ variant: 'success', message: `${labelOf(identity.provider)} unlinked.` });
    },
    onError: (err) =>
      toast({ variant: 'error', message: authErrorMessage(err, 'We could not unlink that account. Please try again.') }),
  });

  const confirmUnlink = (identity: AuthIdentity) => {
    const label = labelOf(identity.provider);
    Alert.alert(`Unlink ${label}?`, `You will no longer be able to sign in with ${label}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlink', style: 'destructive', onPress: () => unlink.mutate(identity) },
    ]);
  };

  const emailIdentity = identities.find((identity) => identity.provider === 'email') ?? null;
  // A hint only: Clutch is the one that refuses removing the last identity.
  const onlyOne = identities.length <= 1;
  const busyProvider = link.isPending ? link.variables : unlink.isPending ? unlink.variables?.provider : null;

  return (
    <>
      <View style={styles.emailCard}>
        <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
        <Text style={styles.emailText}>
          {emailIdentity
            ? `Email: ${identityEmail(emailIdentity) ?? email ?? 'your address'}. Sign in with your password or an emailed code.`
            : 'You sign in with a linked account below.'}
        </Text>
      </View>

      <View style={styles.providers}>
        {PROVIDERS.map(({ provider, label, icon }, index) => {
          const linked = identities.find((identity) => identity.provider === provider) ?? null;
          const configured = provider === 'google' ? oauth.googleConfigured : oauth.appleConfigured;
          const linkedEmail = linked ? identityEmail(linked) : null;
          return (
            <View key={provider} style={[styles.providerRow, index > 0 ? styles.rowDivider : null]}>
              <Ionicons name={icon} size={22} color={colors.text} />
              <View style={styles.providerText}>
                <Text style={styles.providerName}>{label}</Text>
                <Text style={styles.providerStatus}>
                  {linked ? (linkedEmail ? `Linked · ${linkedEmail}` : 'Linked') : 'Not linked'}
                </Text>
              </View>
              {linked ? (
                <ActionButton
                  label="Unlink"
                  accessibilityLabel={`Unlink ${label}`}
                  destructive
                  disabled={onlyOne}
                  loading={busyProvider === provider}
                  onPress={() => confirmUnlink(linked)}
                />
              ) : configured ? (
                <ActionButton
                  label="Link"
                  accessibilityLabel={`Link ${label}`}
                  loading={busyProvider === provider}
                  onPress={() => link.mutate(provider)}
                />
              ) : (
                <Text style={styles.notConfigured}>Not available</Text>
              )}
            </View>
          );
        })}
      </View>
      {onlyOne && !emailIdentity ? <Text style={styles.hint}>Add another way to sign in before removing this one.</Text> : null}
    </>
  );
}

function labelOf(provider: string): string {
  return PROVIDERS.find((p) => p.provider === provider)?.label ?? provider;
}

function ActionButton({
  label,
  accessibilityLabel,
  onPress,
  loading,
  disabled,
  destructive,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const blocked = Boolean(loading || disabled);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: Boolean(loading), disabled: blocked }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        destructive ? styles.actionDestructive : styles.actionDefault,
        pressed || disabled ? styles.actionDim : null,
      ]}
    >
      <Text style={[styles.actionLabel, destructive ? styles.actionLabelDestructive : null]}>
        {loading ? '...' : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.md },
  errorBox: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  errorText: { ...typography.body, color: colors.text },
  emailCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  emailText: { ...typography.body, color: colors.textMuted, flex: 1 },
  providers: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
  },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  providerText: { flex: 1, gap: 2 },
  providerName: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 15 },
  providerStatus: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13 },
  notConfigured: { color: colors.textSubtle, fontFamily: fonts.body, fontSize: 13 },
  hint: { ...typography.caption, color: colors.textSubtle },
  actionButton: {
    minWidth: 76,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
  },
  actionDefault: { borderColor: colors.borderActive, backgroundColor: 'transparent' },
  actionDestructive: { borderColor: colors.danger, backgroundColor: 'transparent' },
  actionDim: { opacity: 0.6 },
  actionLabel: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 14 },
  actionLabelDestructive: { color: colors.danger },
});
