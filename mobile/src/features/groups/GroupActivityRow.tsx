import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GroupActivityItem } from '../../lib/clutch';
import { Badge } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import {
  activityBadge,
  activityDayLabel,
  isLinkableActivity,
  playersCountLabel,
  timeRangeLabel,
} from './groups-lib';

/**
 * One group-activity row (Figma club-detail 105:5927): a booking the group's
 * roster was invited to, with the day, the time range, "<court> · N players"
 * and a status badge. Only a row the viewer plays in opens the booking.
 */
export function GroupActivityRow({ item, onPress }: { item: GroupActivityItem; onPress: () => void }) {
  const badge = activityBadge(item);
  const day = activityDayLabel(item.date);
  const timeRange = timeRangeLabel(item.start_time, item.end_time);
  const meta = `${item.court_name ?? 'Court'} · ${playersCountLabel(item.participant_count)}`;
  const label = `${day}, ${timeRange}, ${meta}${badge ? `, ${badge.label}` : ''}`;

  const body = (
    <>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          <Text style={styles.day}>{day}</Text>
          {'  '}
          {timeRange}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {badge ? <Badge label={badge.label} variant={badge.variant} /> : null}
    </>
  );

  if (isLinkableActivity(item)) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View accessibilityLabel={label} style={styles.row}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.9,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
  },
  day: {
    fontFamily: fonts.bodyBold,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
});
