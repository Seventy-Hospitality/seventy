import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { clutch, useMutationKey } from '../../lib/clutch';
import { EmptyStateView, PrimaryButton, Skeleton, useToast } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { invalidateGroups, invitePreviewQuery } from './groups-data';
import { isDeadInviteLink, memberCountLabel } from './groups-lib';

/**
 * Join a group from an invite link (/groups/join?token=...). Previews the
 * token, then joins and opens the group. A dead link (invite_link_invalid:
 * expired, revoked, used up or unknown) and a missing token get explicit "ask
 * for a fresh link" states; an existing member gets an "Open" shortcut.
 */
export function JoinGroupScreen({ token }: { token: string | null }) {
  const trimmed = token?.trim() || '';
  if (!trimmed) {
    return (
      <JoinFrame>
        <EmptyStateView
          title="Invite link not valid"
          description="This link is missing its invite code. Ask a group member to share the link again."
        />
        <BackToGroupsButton />
      </JoinFrame>
    );
  }
  return <JoinPreview token={trimmed} />;
}

function JoinPreview({ token }: { token: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const joinKey = useMutationKey();

  const preview = useQuery(invitePreviewQuery(token));

  const join = useMutation({
    mutationFn: () => joinKey.run({ token }, (k) => clutch.groups.join(token, { idempotencyKey: k })),
    onSuccess: ({ group_id }) => {
      invalidateGroups(queryClient);
      toast({ variant: 'success', message: `Welcome to ${preview.data?.group.name ?? 'the group'}!` });
      router.replace(`/groups/${group_id}`);
    },
    onError: (error) => {
      const dead = isDeadInviteLink(error);
      toast({
        variant: 'error',
        message: dead ? 'This invite link no longer works.' : 'We could not join the group. Try again.',
      });
      if (dead) void preview.refetch();
    },
  });

  if (preview.isPending) {
    return (
      <JoinFrame>
        <View accessibilityLabel="Checking your invite link">
          <Skeleton height={224} borderRadius={radius.lg} />
        </View>
      </JoinFrame>
    );
  }

  if (preview.isError) {
    if (isDeadInviteLink(preview.error)) {
      return (
        <JoinFrame>
          <View accessibilityRole="alert">
            <EmptyStateView
              title="Invite link not usable"
              description="This invite link has expired, was reset, or has been used up. Ask a group member for a fresh one."
            />
          </View>
          <BackToGroupsButton />
        </JoinFrame>
      );
    }
    return (
      <JoinFrame>
        <View style={styles.banner} accessibilityRole="alert">
          <Text style={styles.bannerText}>We could not check this invite link.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void preview.refetch()} />
        </View>
      </JoinFrame>
    );
  }

  const { group, already_member: alreadyMember } = preview.data;

  // This build is bound to one club; a group at another club cannot be used here.
  if (group.club_id !== clutch.clubId) {
    return (
      <JoinFrame>
        <View accessibilityRole="alert">
          <EmptyStateView
            title="Invite for another club"
            description={`${group.name} belongs to a different club, so it cannot be joined from this app.`}
          />
        </View>
        <BackToGroupsButton />
      </JoinFrame>
    );
  }

  return (
    <JoinFrame>
      <View style={styles.card}>
        {group.cover_image_url ? (
          <Image source={group.cover_image_url} style={styles.cover} contentFit="cover" />
        ) : null}
        <Text style={styles.invitedTo}>You are invited to join</Text>
        <View style={styles.groupRow}>
          <View style={styles.groupGlyph}>
            <Ionicons name="people" size={26} color={colors.accent} />
          </View>
          <View style={styles.groupText}>
            <Text style={styles.groupName} numberOfLines={2}>
              {group.name}
            </Text>
            <Text style={styles.groupMeta}>{memberCountLabel(group.member_count)}</Text>
          </View>
        </View>
        {group.description ? <Text style={styles.description}>{group.description}</Text> : null}

        {alreadyMember ? (
          <>
            <Text style={styles.alreadyHint}>You are already a member of this group.</Text>
            <PrimaryButton label={`Open ${group.name}`} onPress={() => router.replace(`/groups/${group.id}`)} />
          </>
        ) : (
          <PrimaryButton label="Join group" loading={join.isPending} onPress={() => join.mutate()} />
        )}
      </View>
    </JoinFrame>
  );
}

function JoinFrame({ children }: { children: React.ReactNode }) {
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
          accessibilityLabel="Back to groups"
          onPress={goBack}
          hitSlop={8}
          style={styles.backLink}
        >
          <Ionicons name="chevron-back" size={18} color={colors.textLink} />
          <Text style={styles.backLinkText}>Back to groups</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>
          Join group
        </Text>
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
  title: {
    color: colors.text,
    fontFamily: fonts.displayHeavy,
    fontSize: 28,
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
  emptyAction: {
    alignSelf: 'stretch',
  },
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  cover: {
    width: '100%',
    height: 150,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundMuted,
  },
  invitedTo: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  groupGlyph: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceOverlay,
  },
  groupText: {
    flex: 1,
    gap: 2,
  },
  groupName: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 22,
  },
  groupMeta: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  description: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  alreadyHint: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
});
