import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../../lib/session';
import { OAuthCancelledError } from '../../lib/oauth';
import { federatedErrorMessage } from '../../lib/auth-errors';
import { useToast } from '../../components/toast-context';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { authStyles } from './auth-styles';

/**
 * "or" + "Continue with Google / Apple". A provider without a client ID for
 * this platform is not offered at all (no SDK is touched), like Apple off
 * iOS; with neither, nothing renders. One sign-in at a time: both buttons are
 * disabled while either is running. On success the session is established
 * and the auth guard redirects into the app.
 */
export function OAuthButtons() {
  const { oauth, signInWithGoogle, signInWithApple } = useSession();
  const { toast } = useToast();
  const [pending, setPending] = useState<'google' | 'apple' | null>(null);

  const run = async (provider: 'google' | 'apple', fn: () => Promise<unknown>) => {
    if (pending) return;
    setPending(provider);
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof OAuthCancelledError)) {
        toast({
          variant: 'error',
          message: federatedErrorMessage(err, provider),
        });
      }
    } finally {
      setPending(null);
    }
  };

  if (!oauth.googleConfigured && !oauth.appleConfigured) return null;

  return (
    <>
      <View style={authStyles.dividerRow}>
        <View style={authStyles.divider} />
        <Text style={authStyles.dividerLabel}>or</Text>
        <View style={authStyles.divider} />
      </View>
      <View style={styles.stack}>
        {oauth.googleConfigured ? (
          <ProviderButton
            icon="logo-google"
            label="Continue with Google"
            disabled={pending !== null}
            loading={pending === 'google'}
            onPress={() => run('google', signInWithGoogle)}
          />
        ) : null}
        {/* Apple sign-in is native to iOS; elsewhere it is not offered at all. */}
        {oauth.appleConfigured ? (
          <ProviderButton
            icon="logo-apple"
            label="Continue with Apple"
            disabled={pending !== null}
            loading={pending === 'apple'}
            onPress={() => run('apple', signInWithApple)}
          />
        ) : null}
      </View>
    </>
  );
}

function ProviderButton({
  icon,
  label,
  disabled,
  loading,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && !loading ? styles.buttonDisabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Ionicons name={icon} size={18} color={disabled && !loading ? colors.textSubtle : colors.text} />
      <Text style={[styles.label, disabled && !loading ? styles.labelDisabled : null]}>
        {loading ? 'Please wait...' : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.sm,
  },
  button: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.9,
  },
  label: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
  },
  labelDisabled: {
    color: colors.textSubtle,
  },
});
