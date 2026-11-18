import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PrimaryButton } from '../../components';
import { colors, fonts, spacing } from '../../theme/tokens';

/**
 * Why the member cannot book, with the one place that fixes it: shown by the
 * entitlement gate (membership-gate.ts) before booking, and when Clutch
 * refuses a booking for membership reasons (not_club_member, tier_required).
 */
export function MembershipInactiveState({
  title = 'Membership needed',
  description = 'This booking needs an active club membership. Check your membership in your account.',
  actionLabel = 'Go to account',
  href = '/(tabs)/account',
}: {
  title?: string;
  description?: string;
  actionLabel?: string;
  href?: '/(tabs)/account' | '/onboarding/plan' | '/account/billing';
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
        <PrimaryButton label={actionLabel} onPress={() => router.push(href)} />
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
