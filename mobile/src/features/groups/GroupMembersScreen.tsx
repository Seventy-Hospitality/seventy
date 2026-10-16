import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  clutch,
  useMutationKey,
  type Group,
  type GroupId,
  type GroupMember,
} from '../../lib/clutch';
import { groupQuery, queryKeys } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { Avatar, Badge, EmptyStateView, PrimaryButton, Sheet, Skeleton, useToast } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { invalidateGroups } from './groups-data';
import {
  isGroupGone,
  personHandle,
  personName,
  removeMemberErrorMessage,
  transferErrorMessage,
} from './groups-lib';
import { InviteToGroupSheet } from './InviteToGroupSheet';

/**
 * The group roster (Figma members 105:6876): a row per member with the Owner
 * badge, an owner-only per-row menu (transfer ownership, remove) and a "+"
 * that opens the invite sheet. Transferring ownership is the only role change
 * Clutch has. Actions render off Clutch's permission flags.
 */
export function GroupMembersScreen({ groupId }: { groupId: GroupId }) {
  const detail = useQuery(groupQuery(groupId));

  if (detail.isPending) {
    return (
      <MembersFrame>
        <View accessibilityLabel="Loading members" style={styles.list}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={60} borderRadius={radius.md} />
          ))}
        </View>
      </MembersFrame>
    );
  }

  if (isGroupGone(detail.error) || (detail.data && detail.data.club_id !== clutch.clubId)) {
    return (
      <MembersFrame>
        <EmptyStateView
          title="Group not found"
          description="This group does not exist, was deleted, or you are not a member of it."
        />
      </MembersFrame>
    );
  }

  if (detail.isError) {
    return (
      <MembersFrame>
        <View style={styles.banner} accessibilityRole="alert">
          <Text style={styles.bannerText}>We could not load the members.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void detail.refetch()} />
        </View>
      </MembersFrame>
    );
  }

  return <MembersView group={detail.data} />;
}

function MembersFrame({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  const router = useRouter();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/groups');
  };
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to group"
          onPress={goBack}
          hitSlop={8}
          style={styles.backLink}
        >
          <Ionicons name="chevron-back" size={18} color={colors.textLink} />
          <Text style={styles.backLinkText}>Back to group</Text>
        </Pressable>
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" style={styles.title}>
            Members
          </Text>
          {action}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function MembersView({ group }: { group: Group }) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const transferKey = useMutationKey();
  const removeKey = useMutationKey();

  const [memberMenu, setMemberMenu] = useState<GroupMember | null>(null);
  const [confirm, setConfirm] = useState<{ action: 'transfer' | 'remove'; entry: GroupMember } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const canManage = group.permissions.can_manage_members;
  const canInvite = group.permissions.can_invite;

  const transfer = useMutation({
    mutationFn: (entry: GroupMember) =>
      transferKey.run({ id: group.id, to: entry.user_id }, (k) =>
        clutch.groups.transferOwnership(group.id, entry.user_id, { idempotencyKey: k }),
      ),
    onSuccess: (_result, entry) => {
      setConfirm(null);
      toast({ variant: 'success', message: `${personName(entry)} is now the group owner.` });
    },
    onError: (error) => {
      setConfirm(null);
      toast({
        variant: 'error',
        message: transferErrorMessage(error),
      });
    },
    onSettled: () => invalidateGroups(queryClient),
  });

  const remove = useMutation({
    mutationFn: (entry: GroupMember) =>
      removeKey.run({ id: group.id, remove: entry.user_id }, (k) =>
        clutch.groups.removeMember(group.id, entry.user_id, { idempotencyKey: k }),
      ),
    onSuccess: (_result, entry) => {
      setConfirm(null);
      queryClient.setQueryData<Group>(queryKeys.group(group.id), (current) =>
        current
          ? {
              ...current,
              members: current.members.filter((m) => m.user_id !== entry.user_id),
              member_count: Math.max(0, current.member_count - 1),
            }
          : current,
      );
      toast({ variant: 'success', message: `${personName(entry)} was removed from the group.` });
    },
    onError: (error) => {
      setConfirm(null);
      toast({
        variant: 'error',
        message: removeMemberErrorMessage(error),
      });
    },
    onSettled: () => invalidateGroups(queryClient),
  });

  const busy = transfer.isPending || remove.isPending;

  return (
    <MembersFrame
      action={
        canInvite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Invite to group"
            onPress={() => setInviteOpen(true)}
            style={({ pressed }) => [styles.addButton, pressed ? styles.pressedLight : null]}
          >
            <Ionicons name="add" size={22} color={colors.textOnAccent} />
          </Pressable>
        ) : undefined
      }
    >
      <View style={styles.roster} accessibilityLabel={`Members of ${group.name}`}>
        {group.members.map((entry) => {
          const isSelf = entry.user_id === userId;
          const name = personName(entry);
          const handle = personHandle(entry);
          const showMenu = canManage && !isSelf && entry.role !== 'owner';
          return (
            <View key={entry.user_id} style={styles.row}>
              <Avatar name={name} src={entry.avatar_url} size="md" />
              <View style={styles.rowText}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {name}
                    {isSelf ? <Text style={styles.rowYou}> (you)</Text> : null}
                  </Text>
                  {entry.role === 'owner' ? (
                    <Badge label="Owner" variant="neutral" style={styles.ownerBadge} />
                  ) : null}
                </View>
                {handle ? <Text style={styles.rowSubtitle}>{handle}</Text> : null}
              </View>
              {showMenu ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Actions for ${name}`}
                  hitSlop={8}
                  onPress={() => setMemberMenu(entry)}
                  style={({ pressed }) => [styles.menuButton, pressed ? styles.pressed : null]}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* ── Per-member action menu ── */}
      <Sheet
        open={memberMenu !== null}
        onClose={() => setMemberMenu(null)}
        title={memberMenu ? personName(memberMenu) : 'Member'}
      >
        {memberMenu ? (
          <View style={styles.dialogBody}>
            <Text style={styles.dialogHint}>
              Transferring makes {personName(memberMenu)} the owner and you a regular member;
              removing takes them out of the group.
            </Text>
            <View style={styles.dialogActions}>
              <PrimaryButton
                label="Transfer ownership"
                variant="secondary"
                onPress={() => {
                  const entry = memberMenu;
                  setMemberMenu(null);
                  setConfirm({ action: 'transfer', entry });
                }}
              />
              <PrimaryButton
                label="Remove from group"
                variant="danger"
                onPress={() => {
                  const entry = memberMenu;
                  setMemberMenu(null);
                  setConfirm({ action: 'remove', entry });
                }}
              />
            </View>
          </View>
        ) : null}
      </Sheet>

      {/* ── Transfer ownership confirm ── */}
      <Sheet
        open={confirm?.action === 'transfer'}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        title="Transfer ownership"
      >
        {confirm?.action === 'transfer' ? (
          <View style={styles.dialogBody}>
            <Text style={styles.dialogText}>
              Make {personName(confirm.entry)} the owner of {group.name}?
            </Text>
            <Text style={styles.dialogHint}>
              You become a regular member and lose owner controls (editing the group, managing
              members, deleting it). Only the new owner can transfer it back.
            </Text>
            <View style={styles.dialogActions}>
              <PrimaryButton
                label={`Make ${personName(confirm.entry)} the owner`}
                loading={transfer.isPending}
                onPress={() => transfer.mutate(confirm.entry)}
              />
              <PrimaryButton
                label="Cancel"
                variant="ghost"
                disabled={busy}
                onPress={() => setConfirm(null)}
              />
            </View>
          </View>
        ) : null}
      </Sheet>

      {/* ── Remove member confirm ── */}
      <Sheet
        open={confirm?.action === 'remove'}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        title="Remove member"
      >
        {confirm?.action === 'remove' ? (
          <View style={styles.dialogBody}>
            <Text style={styles.dialogText}>
              Remove {personName(confirm.entry)} from {group.name}? They can be invited again
              later.
            </Text>
            <View style={styles.dialogActions}>
              <PrimaryButton
                label="Remove from group"
                variant="danger"
                loading={remove.isPending}
                onPress={() => remove.mutate(confirm.entry)}
              />
              <PrimaryButton
                label="Cancel"
                variant="ghost"
                disabled={busy}
                onPress={() => setConfirm(null)}
              />
            </View>
          </View>
        ) : null}
      </Sheet>

      {canInvite ? (
        <InviteToGroupSheet group={group} open={inviteOpen} onClose={() => setInviteOpen(false)} />
      ) : null}
    </MembersFrame>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontFamily: fonts.displayHeavy,
    fontSize: 28,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  pressedLight: {
    opacity: 0.9,
  },
  pressed: {
    opacity: 0.7,
  },
  list: {
    gap: spacing.sm,
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
  roster: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowTitle: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 16,
  },
  rowYou: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  ownerBadge: {
    backgroundColor: 'rgba(190, 206, 133, 0.18)',
  },
  rowSubtitle: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  menuButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
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
  dialogHint: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  dialogActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
