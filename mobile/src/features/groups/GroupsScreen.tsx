import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppScreen, FormField, Input, PrimaryButton, Sheet, Skeleton } from '../../components';
import { groupInvitationsQuery, groupsQuery } from '../../lib/queries';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { GroupCard } from './GroupCard';
import { GroupInvitationCard, useGroupInvitationResponder } from './GroupInvitationCard';
import { parseInviteToken } from './groups-lib';

/**
 * The Groups tab (Figma your-clubs 91:3774 / 91:3935): the member's groups at
 * this club as cover cards, a create CTA, a join-by-link entry, and pending
 * group invitations with inline Accept / Decline.
 */
export function GroupsScreen() {
  const router = useRouter();
  const groups = useQuery(groupsQuery);
  const invitations = useQuery(groupInvitationsQuery);
  const responder = useGroupInvitationResponder((invitation) =>
    router.push(`/groups/${invitation.group_id}`),
  );
  const [joinOpen, setJoinOpen] = useState(false);

  const goCreate = () => router.push('/groups/new');

  const refreshing = groups.isRefetching || invitations.isRefetching;
  const onRefresh = () => {
    void groups.refetch();
    void invitations.refetch();
  };

  const groupList = groups.data ?? [];
  const invitationList = invitations.data ?? [];
  const hasInvitations = invitationList.length > 0;

  return (
    <AppScreen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={styles.title}>
            Your groups
          </Text>
          <Text style={styles.subtitle}>Groups of players to book with at the club</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a new group"
          onPress={goCreate}
          style={({ pressed }) => [styles.addButton, pressed ? styles.pressed : null]}
        >
          <Ionicons name="add" size={24} color={colors.textOnAccent} />
        </Pressable>
      </View>

      {groups.isPending ? (
        <View style={styles.list} accessibilityLabel="Loading your groups">
          <Skeleton height={176} borderRadius={radius.lg} />
          <Skeleton height={72} borderRadius={radius.lg} />
        </View>
      ) : groups.isError ? (
        <View style={styles.box} accessibilityRole="alert">
          <Text style={styles.boxText}>We could not load your groups.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void groups.refetch()} />
        </View>
      ) : groupList.length > 0 ? (
        <View style={styles.list}>
          {groupList.map((group) => (
            <GroupCard key={group.id} group={group} onPress={() => router.push(`/groups/${group.id}`)} />
          ))}
          <DashedAction icon="add" label="Create a new group" onPress={goCreate} />
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>You are not in a group yet</Text>
          <Text style={styles.emptyBody}>
            {hasInvitations
              ? 'You have invitations waiting below, or create your own group to book together.'
              : 'Create one to book courts together with your crew.'}
          </Text>
          <PrimaryButton label="Create a new group" onPress={goCreate} />
        </View>
      )}

      <DashedAction icon="link-outline" label="Join with an invite link" onPress={() => setJoinOpen(true)} />

      {invitations.isError ? (
        <View style={styles.box} accessibilityRole="alert">
          <Text style={styles.boxText}>We could not load your group invitations.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void invitations.refetch()} />
        </View>
      ) : hasInvitations ? (
        <View style={styles.list}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Invitations
          </Text>
          {invitationList.map((invitation) => (
            <GroupInvitationCard key={invitation.id} {...responder.cardProps(invitation)} />
          ))}
        </View>
      ) : null}

      <JoinByLinkSheet open={joinOpen} onClose={() => setJoinOpen(false)} />
    </AppScreen>
  );
}

function DashedAction({
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
      style={({ pressed }) => [styles.dashed, pressed ? styles.pressed : null]}
    >
      <Ionicons name={icon} size={20} color={colors.textMuted} />
      <Text style={styles.dashedLabel}>{label}</Text>
    </Pressable>
  );
}

/** Paste a shared invite link (or its code) and go to the join screen. */
function JoinByLinkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const token = parseInviteToken(text);
    if (!token) {
      setError('Paste the whole invite link a group member shared with you.');
      return;
    }
    setText('');
    setError(null);
    onClose();
    router.push({ pathname: '/groups/join', params: { token } });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Join a group">
      <View style={styles.sheetBody}>
        <FormField label="Invite link" error={error ?? undefined}>
          <Input
            placeholder="Paste the link"
            value={text}
            onChangeText={(value) => {
              setText(value);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            hasError={error !== null}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </FormField>
        <PrimaryButton label="Continue" disabled={!text.trim()} onPress={submit} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.displayHeavy,
    fontSize: 30,
  },
  subtitle: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  pressed: {
    opacity: 0.9,
  },
  list: {
    gap: spacing.md,
  },
  dashed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 64,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  dashedLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
  },
  emptyState: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 18,
  },
  emptyBody: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  box: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  boxText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 20,
  },
  sheetBody: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
});
