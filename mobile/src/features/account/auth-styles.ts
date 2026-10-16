import { StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/tokens';

/** Shared layout for the sign-in, sign-up, reset and set-password screens. */
export const authStyles = StyleSheet.create({
  content: { gap: spacing.lg },
  hero: { gap: spacing.xs, marginTop: spacing.lg },
  kicker: { color: colors.accent, ...typography.label, textTransform: 'uppercase' },
  title: { ...typography.display, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  body: { ...typography.body, color: colors.text },
  form: { gap: spacing.md },
  link: { color: colors.accent, ...typography.bodyStrong, textAlign: 'center' },
  success: { color: colors.accent, ...typography.caption, textAlign: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerLabel: { color: colors.textSubtle, ...typography.caption },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs },
  footerText: { color: colors.textMuted, ...typography.body },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  message: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
