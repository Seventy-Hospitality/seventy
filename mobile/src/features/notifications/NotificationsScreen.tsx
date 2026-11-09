import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clutch, useMutationKey, type InboxNotification } from '../../lib/clutch';
import { EmptyStateView, ListRow, PrimaryButton, Skeleton } from '../../components';
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
            <View
              key={notice.id}
              style={[styles.card, notice.id === focus ? styles.focused : null]}
              testID={`notice-${notice.id}`}
            >
              <ListRow
                title={notice.title}
                subtitle={`${notice.body}${when(notice.created_at) ? `\n${when(notice.created_at)}` : ''}`}
                trailing={notice.read ? null : <View style={styles.dot} accessibilityLabel="Unread" />}
                onPress={notice.read ? undefined : () => markRead.mutate({ id: notice.id })}
              />
            </View>
          ))}
        </View>
      )}
    </AccountFrame>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  error: { color: colors.text, fontFamily: fonts.body, fontSize: 15 },
  card: { borderRadius: radius.md, overflow: 'hidden' },
  focused: { borderWidth: 1, borderColor: colors.accent },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
});
