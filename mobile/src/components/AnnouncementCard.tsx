import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Announcement } from '../lib/clutch';
import { colors, fonts, radius, spacing } from '../theme/tokens';

interface AnnouncementCardProps {
  announcement: Announcement;
  /** The club's IANA zone, so the date is the club's calendar day. Device zone when absent. */
  timeZone?: string;
}

/**
 * "Oct 12" for a published-at instant, on the club's calendar when its zone
 * is known. No timestamp (Clutch sends null for an undated one) or an
 * unparseable one shows nothing rather than "Invalid Date".
 */
export function formatAnnouncementDate(publishedAt: string | null, timeZone?: string): string {
  if (!publishedAt) return '';
  const at = new Date(publishedAt);
  if (Number.isNaN(at.getTime())) return '';
  try {
    return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
  } catch {
    // An unknown zone string: fall back to the device calendar.
    return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/** One club announcement (title, body, when, pinned marker) as Clutch publishes it. */
export function AnnouncementCard({ announcement, timeZone }: AnnouncementCardProps) {
  const date = formatAnnouncementDate(announcement.published_at, timeZone);
  const author = announcement.author_name?.trim() || null;
  const meta = [date, author].filter(Boolean).join(' · ');
  return (
    <View
      style={styles.card}
      accessibilityLabel={`${announcement.is_pinned ? 'Pinned announcement' : 'Announcement'}: ${announcement.title}`}
    >
      <View style={styles.headRow}>
        {announcement.is_pinned ? (
          <View style={styles.pinned}>
            <Ionicons name="pin" size={12} color={colors.accent} />
            <Text style={styles.pinnedText}>PINNED</Text>
          </View>
        ) : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      <Text style={styles.title}>{announcement.title}</Text>
      <Text style={styles.body}>{announcement.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pinned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pinnedText: {
    color: colors.accent,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.displaySemibold,
    fontSize: 17,
  },
  body: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
});
