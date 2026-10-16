import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PrimaryButton } from '../../components';
import { colors, fonts, spacing } from '../../theme/tokens';

/**
 * Shown when Clutch refuses a booking for membership reasons
 * (not_club_member, members_only, tier_required). Only ever in answer to a
 * refusal: the app does not pre-judge membership from /me, which cannot yet
 * tell "no membership" from a failed read.
 */
export function MembershipInactiveState({
  title = 'Membership needed',
  description = 'This booking needs an active club membership. Check your membership in your account.',
}: {
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <View style={styles.glyph}>
        <Ionicons name="card-outline" size={24} color={colors.accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <View style={styles.action}>
        <PrimaryButton label="Go to account" onPress={() => router.replace('/(tabs)/account')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  glyph: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceOverlay,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 17,
    textAlign: 'center',
  },
  description: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },
  action: {
    marginTop: spacing.sm,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.xl,
  },
});
