import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CAPABILITY_SOURCE, type Capability } from '../lib/clutch/capabilities';
import { colors, fonts, radius, spacing } from '../theme/tokens';

/**
 * The honest answer for an action whose Clutch route is not live yet
 * (capabilities.ts): say what is coming instead of failing or dead-ending.
 * `compact` renders an inline note for a row or a button's place.
 */
export function FeatureUnavailable({
  capability,
  title,
  description,
  compact = false,
}: {
  capability: Capability;
  title: string;
  description?: string;
  compact?: boolean;
}) {
  const body = description ?? 'This is not available in the app yet. It is coming soon.';
  return (
    <View
      style={[styles.box, compact ? styles.compact : null]}
      accessibilityRole="text"
      accessibilityLabel={`${title}. ${body}`}
      testID={`unavailable-${capability}`}
    >
      <Ionicons name="time-outline" size={compact ? 16 : 22} color={colors.textMuted} />
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
    </View>
  );
}

/** For logs and tests: which Clutch branch a capability waits on. */
export function capabilitySource(capability: Capability): string {
  return CAPABILITY_SOURCE[capability];
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  compact: { padding: spacing.sm },
  text: { flex: 1, gap: 2 },
  title: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 14 },
  body: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
});
