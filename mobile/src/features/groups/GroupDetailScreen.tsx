import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  clutch,
  useMutationKey,
  type Group,
  type GroupId,
  type GroupSummary,
} from '../../lib/clutch';
import { groupQuery, queryKeys } from '../../lib/queries';
import {
  EmptyStateView,
  PrimaryButton,
  SegmentedControl,
  Sheet,
  Skeleton,
  useToast,
  type SegmentedOption,
} from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import {
  deleteGroupErrorMessage,
  inviteLinkErrorMessage,
  isGroupGone,
  leaveErrorMessage,
  memberCountLabel,
  roleLabel,
} from './groups-lib';
import { groupActivityQuery, invalidateGroups, useGroupInviteLink } from './groups-data';
import { GroupActivityRow } from './GroupActivityRow';
import { InviteToGroupSheet } from './InviteToGroupSheet';
import { EditGroupSheet } from './EditGroupSheet';

type ActivityFilter = 'upcoming' | 'past';

const ACTIVITY_FILTERS: readonly SegmentedOption<ActivityFilter>[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

/**
 * Group detail (Figma club-detail 99:5623 / 105:5927): the cover hero, the
 * Members / Invite / Share / Book action bar, and the group's bookings.
 * Actions render off Clutch's permission flags, never off the role. A group
 * the caller is not in looks exactly like one that does not exist, and so
 * does a group at another club (this build is bound to one club).
 */
export function GroupDetailScreen({ groupId }: { groupId: GroupId }) {
  const detail = useQuery(groupQuery(groupId));

  if (detail.isPending) {
    return (
      <DetailFrame>
        <View accessibilityLabel="Loading group" style={styles.loading}>
          <Skeleton height={240} borderRadius={radius.lg} />
          <Skeleton height={120} borderRadius={radius.lg} />
        </View>
      </DetailFrame>
    );
  }

  if (isGroupGone(detail.error) || (detail.data && detail.data.club_id !== clutch.clubId)) {
    return (
      <DetailFrame>
        <EmptyStateView
          title="Group not found"
          description="This group does not exist, was deleted, or you are not a member of it."
        />
        <BackToGroupsButton />
      </DetailFrame>
    );
  }

  if (detail.isError) {
    return (
      <DetailFrame>
        <View style={styles.banner} accessibilityRole="alert">
          <Text style={styles.bannerText}>We could not load this group.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void detail.refetch()} />
        </View>
      </DetailFrame>
    );
  }

  return <GroupDetailView group={detail.data} />;
}

/** A minimal framed shell for the loading / error / not-found states. */
function DetailFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/groups');
  };
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.frameContent} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to groups"
          onPress={goBack}
          hitSlop={8}
          style={styles.backLink}
        >
          <Ionicons name="chevron-back" size={18} color={colors.textLink} />
          <Text style={styles.backLinkText}>Back to groups</Text>
        </Pressable>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function BackToGroupsButton() {
  const router = useRouter();
  return (
    <View style={styles.emptyAction}>
      <PrimaryButton label="Back to groups" onPress={() => router.replace('/(tabs)/groups')} />
    </View>
  );
}

function GroupDetailView({ group }: { group: Group }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const leaveKey = useMutationKey();
  const deleteKey = useMutationKey();

  const [filter, setFilter] = useState<ActivityFilter>('upcoming');
  const activity = useQuery(groupActivityQuery(group.id, filter));
  const link = useGroupInviteLink(group.id);

  const [menuOpen, setMenuOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { can_edit: canEdit, can_delete: canDelete, can_invite: canInvite, can_leave: canLeave } =
    group.permissions;
  const hasMenu = canEdit || canDelete || canLeave;

  const goToGroups = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/groups');
  }, [router]);

  const share = useCallback(async () => {
    try {
      const url = await link.ensureUrl();
      await Share.share({ title: `Join ${group.name} on Club70`, message: url, url });
    } catch (error) {
      toast({ variant: 'error', message: inviteLinkErrorMessage(error, false) });
    }
  }, [link, group.name, toast]);

  const leave = useMutation({
    mutationFn: () =>
      leaveKey.run({ leave: group.id }, (k) => clutch.groups.leave(group.id, { idempotencyKey: k })),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.groups, exact: true });
      const previous = queryClient.getQueryData<GroupSummary[]>(queryKeys.groups);
      queryClient.setQueryData<GroupSummary[]>(queryKeys.groups, (rows) =>
        rows?.filter((row) => row.id !== group.id),
      );
      return { previous };
    },
    onSuccess: () => {
      setLeaveOpen(false);
      queryClient.removeQueries({ queryKey: queryKeys.group(group.id) });
      toast({ variant: 'success', message: `You left ${group.name}.` });
      goToGroups();
    },
    onError: (error, _vars, context) => {
      setLeaveOpen(false);
      if (context?.previous) queryClient.setQueryData(queryKeys.groups, context.previous);
      toast({ variant: 'error', message: leaveErrorMessage(error, group.name) });
    },
    onSettled: () => invalidateGroups(queryClient),
  });

  const remove = useMutation({
    mutationFn: () =>
      deleteKey.run({ delete: group.id }, (k) => clutch.groups.delete(group.id, { idempotencyKey: k })),
    onSuccess: () => {
      setDeleteOpen(false);
      queryClient.removeQueries({ queryKey: queryKeys.group(group.id) });
      invalidateGroups(queryClient);
      toast({ variant: 'success', message: `${group.name} was deleted.` });
      goToGroups();
    },
    onError: (error) => {
      setDeleteOpen(false);
      toast({ variant: 'error', message: deleteGroupErrorMessage(error) });
      invalidateGroups(queryClient);
    },
  });

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── Cover hero ── */}
        <View style={styles.hero}>
          {group.cover_image_url ? (
            <Image source={group.cover_image_url} style={styles.cover} contentFit="cover" />
          ) : (
            <View style={[styles.cover, styles.coverFallback]}>
              <Ionicons name="people" size={64} color={colors.surfaceMuted} />
            </View>
          )}
          <View style={styles.heroShade} />

          <View style={[styles.heroChrome, { paddingTop: insets.top + spacing.xs }]}>
            <HeroButton icon="chevron-back" label="Back to groups" onPress={goToGroups} />
            {hasMenu ? (
              <HeroButton icon="ellipsis-vertical" label="Group actions" onPress={() => setMenuOpen(true)} />
            ) : (
              <View style={styles.heroButtonSpacer} />
            )}
          </View>

          <View style={styles.heroText}>
            <Text style={styles.heroName} numberOfLines={2}>
              {group.name}
            </Text>
            <Text
              style={styles.heroMeta}
              accessibilityLabel={`${memberCountLabel(group.member_count)}, your role: ${roleLabel(group.my_role)}`}
            >
              {memberCountLabel(group.member_count)}
              <Text style={styles.heroMetaSep}>{'   |   '}</Text>
              {roleLabel(group.my_role)}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          {group.description ? <Text style={styles.description}>{group.description}</Text> : null}

          {/* ── Action bar ── */}
          <View style={styles.actionBar} accessibilityLabel="Group quick actions">
            <ActionButton icon="people-outline" label="Members" onPress={() => router.push(`/groups/${group.id}/members`)} />
            {canInvite ? (
              <ActionButton icon="person-add-outline" label="Invite" onPress={() => setInviteOpen(true)} />
            ) : null}
            <ActionButton icon="share-social-outline" label="Share" disabled={link.isPending} onPress={() => void share()} />
            <ActionButton
              icon="calendar-outline"
              label="Book"
              accessibilityLabel={`Book a court for ${group.name}`}
              onPress={() => router.push('/(tabs)/reserve')}
            />
          </View>

          {/* ── Group activity ── */}
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Group activity
          </Text>
          <SegmentedControl
            label="Group activity"
            options={ACTIVITY_FILTERS}
            value={filter}
            onChange={setFilter}
          />

          {activity.isPending ? (
            <View style={styles.list} accessibilityLabel="Loading group activity">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={64} borderRadius={radius.md} />
              ))}
            </View>
          ) : activity.isError ? (
            <View style={styles.banner} accessibilityRole="alert">
              <Text style={styles.bannerText}>We could not load the group activity.</Text>
              <PrimaryButton label="Try again" variant="secondary" onPress={() => void activity.refetch()} />
            </View>
          ) : activity.data.length === 0 ? (
            <View style={styles.emptyActivity}>
              <Text style={styles.emptyActivityText}>
                {filter === 'upcoming' ? 'No upcoming bookings with the group' : 'No past bookings with the group'}
              </Text>
              {filter === 'upcoming' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Book a court"
                  onPress={() => router.push('/(tabs)/reserve')}
                  hitSlop={8}
                >
                  <Text style={styles.emptyActivityLink}>Book a court</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.list}>
              {activity.data.map((item) => (
                <GroupActivityRow
                  key={item.booking_id}
                  item={item}
                  onPress={() => router.push(`/bookings/${item.booking_id}`)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Overflow menu ── */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={group.name}>
        <View style={styles.menu}>
          {canEdit ? (
            <PrimaryButton
              label="Edit group"
              variant="secondary"
              onPress={() => {
                setMenuOpen(false);
                setEditOpen(true);
              }}
            />
          ) : null}
          {canLeave ? (
            <PrimaryButton
              label="Leave group"
              variant="danger"
              onPress={() => {
                setMenuOpen(false);
                setLeaveOpen(true);
              }}
            />
          ) : null}
          {canDelete ? (
            <PrimaryButton
              label="Delete group"
              variant="danger"
              onPress={() => {
                setMenuOpen(false);
                setDeleteOpen(true);
              }}
            />
          ) : null}
          {!canLeave ? (
            <Text style={styles.menuHint}>
              As the owner you cannot leave this group while others are in it; transfer ownership to another member first
              (Members, then the member&apos;s menu).
            </Text>
          ) : null}
        </View>
      </Sheet>

      {/* ── Leave confirm ── */}
      <Sheet
        open={leaveOpen}
        onClose={() => {
          if (!leave.isPending) setLeaveOpen(false);
        }}
        title="Leave group"
      >
        <View style={styles.dialogBody}>
          <Text style={styles.dialogText}>
            Leave {group.name}? You will need a new invitation or invite link to rejoin.
          </Text>
          <View style={styles.dialogActions}>
            <PrimaryButton
              label="Leave group"
              variant="danger"
              loading={leave.isPending}
              onPress={() => leave.mutate()}
            />
            <PrimaryButton
              label="Stay in the group"
              variant="ghost"
              disabled={leave.isPending}
              onPress={() => setLeaveOpen(false)}
            />
          </View>
        </View>
      </Sheet>

      {/* ── Delete confirm ── */}
      <Sheet
        open={deleteOpen}
        onClose={() => {
          if (!remove.isPending) setDeleteOpen(false);
        }}
        title="Delete group"
      >
        <View style={styles.dialogBody}>
          <Text style={styles.dialogText}>
            Delete {group.name} for {memberCountLabel(group.member_count).toLowerCase()}? Pending
            invitations and invite links stop working. This cannot be undone.
          </Text>
          <View style={styles.dialogActions}>
            <PrimaryButton
              label="Delete group"
              variant="danger"
              loading={remove.isPending}
              onPress={() => remove.mutate()}
            />
            <PrimaryButton
              label="Keep the group"
              variant="ghost"
              disabled={remove.isPending}
              onPress={() => setDeleteOpen(false)}
            />
          </View>
        </View>
      </Sheet>

      {canEdit ? <EditGroupSheet group={group} open={editOpen} onClose={() => setEditOpen(false)} /> : null}
      {canInvite ? (
        <InviteToGroupSheet group={group} open={inviteOpen} onClose={() => setInviteOpen(false)} />
      ) : null}
    </View>
  );
}

function HeroButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.heroButton, pressed ? styles.pressed : null]}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

function ActionButton({
  icon,
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && !disabled ? styles.pressed : null]}
    >
      <View style={styles.actionCircle}>
        <Ionicons name={icon} size={20} color={colors.text} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  frameContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: -4,
  },
  backLinkText: {
    color: colors.textLink,
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
  },
  loading: {
    gap: spacing.md,
  },
  emptyAction: {
    alignSelf: 'stretch',
  },
  banner: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  bannerText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  hero: {
    height: 288,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceOverlay,
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 18, 13, 0.34)',
  },
  heroChrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  heroButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 18, 13, 0.5)',
  },
  heroButtonSpacer: {
    width: 40,
    height: 40,
  },
  heroText: {
    padding: spacing.md,
    gap: 2,
  },
  heroName: {
    color: colors.text,
    fontFamily: fonts.displayHeavy,
    fontSize: 34,
  },
  heroMeta: {
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
  },
  heroMetaSep: {
    color: colors.textMuted,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  description: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: spacing.sm,
  },
  action: {
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  actionCircle: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceOverlay,
  },
  actionLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  list: {
    gap: spacing.sm,
  },
  emptyActivity: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  emptyActivityText: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  emptyActivityLink: {
    color: colors.accent,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
  },
  pressed: {
    opacity: 0.75,
  },
  menu: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  menuHint: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  dialogBody: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  dialogText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
  },
  dialogActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
