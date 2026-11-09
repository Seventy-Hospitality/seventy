import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useClub, isFatalClubError } from '../../lib/club';
import { colors, spacing, typography } from '../../theme/tokens';

/**
 * Startup check: this build is bound to one Clutch club (EXPO_PUBLIC_CLUB_ID)
 * and must not run against another. A definitive mismatch blocks the app with
 * a configuration error; a transient failure (offline) lets it through, and
 * the club query retries when screens need it.
 */
export function ClubCheck({ children }: { children: ReactNode }) {
  const club = useClub();
  if (club.isError && isFatalClubError(club.error)) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>This build is misconfigured</Text>
        <Text style={styles.body}>{club.error.message}</Text>
      </View>
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  title: { ...typography.h2, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
