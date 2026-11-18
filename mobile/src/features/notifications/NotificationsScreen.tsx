import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clutch, useMutationKey, type InboxNotification } from '../../lib/clutch';
import { EmptyStateView, PrimaryButton, Skeleton } from '../../components';
import { AccountFrame } from '../account/AccountFrame';
import { colors, fonts, radius, spacing } from '../../theme/tokens';

export const notificationsKey = ['notifications'] as const;

/** This club's notices, newest first (the inbox is per account, across clubs). */
export function clubNotices(rows: InboxNotification[], clubId: string): InboxNotification[] {
  return rows
    .filter((row) => row.club_id === clubId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * The in-app inbox (GET /me/notifications): every notice Clutch sent this
 * member at this club. A tapped push opens it with `focus` on its notice,
 * which is marked read; opening any row marks it read too.
 */
export function NotificationsScreen() {
  const params = useLocalSearchParams<{ focus?: string }>();
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const queryClient = useQueryClient();
  const inbox = useQuery({ queryKey: notificationsKey, queryFn: () => clutch.me.notifications({ limit: 50 }) });
  const readKey = useMutationKey();
  const markRead = useMutation({
    mutationFn: (input: { id: string } | { all: true }) =>
      readKey.run(input, (k) => clutch.me.markNotificationsRead(input, { idempotencyKey: k })),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: notificationsKey }),
  });

  const notices = inbox.data ? clubNotices(inbox.data.items, clutch.clubId) : [];
  const focused = focus ? notices.find((n) => n.id === focus) : undefined;

  useEffect(() => {
    if (focused && !focused.read) markRead.mutate({ id: focused.id });
    // Only when the focused notice first appears unread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.id, focused?.read]);

  const unread = notices.filter((n) => !n.read).length;

  return (
    <AccountFrame
      title="Notifications"
      backLabel="Account"
      backTo="/(tabs)/account"
      refreshing={inbox.isRefetching}
      onRefresh={() => void inbox.refetch()}
    >
      {inbox.isPending ? (
        <View style={styles.stack} accessibilityLabel="Loading notifications">
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : inbox.isError ? (
        <View style={styles.stack} accessibilityRole="alert">
          <Text style={styles.error}>We could not load your notifications.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void inbox.refetch()} />
        </View>
      ) : notices.length === 0 ? (
        <EmptyStateView title="No notifications" description="Booking, group and club notices show up here." />
      ) : (
        <View style={styles.stack}>
          {unread > 0 ? (
            <PrimaryButton
              label="Mark all as read"
              variant="ghost"
              loading={markRead.isPending}
              onPress={() => markRead.mutate({ all: true })}
            />
          ) : null}
          {notices.map((notice) => (
            <NoticeRow
              key={notice.id}
              notice={notice}
              focused={notice.id === focus}
              onRead={() => markRead.mutate({ id: notice.id })}
            />
          ))}
        </View>
      )}
    </AccountFrame>
  );
}

/**
 * One notice in full: the whole title and body (a notice is short, and the
 * body is the message), with the time on its own line. Tapping an unread
 * notice marks it read.
 */
function NoticeRow({
  notice,
  focused,
  onRead,
}: {
  notice: InboxNotification;
  focused: boolean;
  onRead: () => void;
}) {
  const time = when(notice.created_at);
  const content = (
    <>
      <View style={styles.noticeText}>
        <Text style={styles.noticeTitle}>{notice.title}</Text>
        {notice.body ? <Text style={styles.noticeBody}>{notice.body}</Text> : null}
        {time ? <Text style={styles.noticeTime}>{time}</Text> : null}
      </View>
      {notice.read ? null : <View style={styles.dot} accessibilityLabel="Unread" />}
    </>
  );
  const label = `${notice.read ? '' : 'Unread. '}${notice.title}. ${notice.body}${time ? `. ${time}` : ''}`;
  return notice.read ? (
    <View
      style={[styles.card, focused ? styles.focused : null]}
      testID={`notice-${notice.id}`}
      accessible
      accessibilityLabel={label}
    >
      {content}
    </View>
  ) : (
    <Pressable
      style={({ pressed }) => [styles.card, focused ? styles.focused : null, pressed ? styles.pressed : null]}
      testID={`notice-${notice.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Marks it as read"
      onPress={onRead}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  error: { color: colors.text, fontFamily: fonts.body, fontSize: 15 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  focused: { borderColor: colors.accent },
  pressed: { opacity: 0.9 },
  noticeText: { flex: 1, gap: 4 },
  noticeTitle: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 15 },
  noticeBody: { color: colors.text, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  noticeTime: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: colors.accent },
});
