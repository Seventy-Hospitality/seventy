import { useEffect, useRef, useState } from 'react';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSession } from '../../lib/session';
import { authErrorMessage } from '../../lib/auth-errors';
import { AppScreen } from '../../components/AppScreen';
import { colors } from '../../theme/tokens';
import { authStyles as styles } from './auth-styles';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * seventy://auth/callback: where every GoTrue email link lands (magic link,
 * signup confirmation, password reset). The link carries a PKCE `code` that
 * only completes with the verifier this device stored when it asked, so a
 * link opened on another phone, or a forged deep link, cannot sign anyone in
 * here; the user is pointed at the 6-digit code instead. A recovery link
 * signs in in recovery mode, and the root layout routes to set-password.
 */
export function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_code?: string;
    error_description?: string;
  }>();
  const { completeAuthRedirect } = useSession();
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(false);

  const code = single(params.code);
  const error = single(params.error_code) ?? single(params.error);
  const errorDescription = single(params.error_description);

  useEffect(() => {
    // A code is single-use: never exchange it twice (re-render, remount).
    if (started.current) return;
    started.current = true;
    completeAuthRedirect({ code, error, errorDescription })
      .then(() => router.replace('/'))
      .catch((err: unknown) => setFailure(authErrorMessage(err, 'This link could not sign you in.')));
  }, [code, completeAuthRedirect, error, errorDescription, router]);

  return (
    <AppScreen scroll={false}>
      <View style={styles.center}>
        {failure ? (
          <>
            <Text style={styles.message}>{failure}</Text>
            <Link href="/auth/sign-in" style={styles.link}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.message}>Signing you in...</Text>
          </>
        )}
      </View>
    </AppScreen>
  );
}
