import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clutch, type BookingId, type GroupSummary, type PlayerSearchResult } from '../../lib/clutch';
import { groupsQuery } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { Avatar, Chip, EmptyStateView, PrimaryButton, Skeleton } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { describeBookingFailure } from './booking-failures';
import {
  addGroup,
  EMPTY_INVITE_SELECTION,
  groupChipLabel,
  inviteCount,
  invitablePlayers,
  isGroupSelected,
  isPlayerSelected,
  playerName,
  removeGroup,
  removePlayer,
  togglePlayer,
  type InviteSelection,
} from './invites';
import { StepShell } from './StepShell';
import { useSendInvites } from './useSendInvites';

const SEARCH_DEBOUNCE_MS = 250;

export interface InvitePlayersStepProps {
  bookingId: BookingId;
  /** "Mon, Jul 6 · 9:30-11:30PM" under the title. */
  subtitle: string;
  /** People already on the booking. */
  excludeUserIds?: readonly string[];
  /** Every pick was sent. */
  onSent: () => void;
}

/**
 * Invite players to a confirmed booking: search fellow members of the club
 * (GET /clubs/{club}/players, PENDING P4) and pick them, or add a whole group
 * of yours ("Add all" makes a removable group chip). Used from the
 * confirmation sheet and from "Invite more" on the booking screen.
 */
export function InvitePlayersStep({ bookingId, subtitle, excludeUserIds = [], onSent }: InvitePlayersStepProps) {
  const { userId } = useSession();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const searching = debounced.length > 0;
  const [selection, setSelection] = useState<InviteSelection>(EMPTY_INVITE_SELECTION);

  const groups = useQuery(groupsQuery);
  const search = useQuery({
    queryKey: ['reserve', 'player-search', debounced],
    queryFn: () => clutch.club.searchPlayers(debounced),
    staleTime: 30_000,
  });

  const exclude = useMemo(
    () => new Set([userId, ...excludeUserIds].filter((id): id is NonNullable<typeof id> => !!id)),
    [userId, excludeUserIds],
  );
  const players = useMemo(() => invitablePlayers(search.data ?? [], exclude), [search.data, exclude]);

  const send = useSendInvites(bookingId, (progress) => {
    // Drop what was sent, so a retry sends only what is left.
    setSelection((current) => {
      let next = current;
      if (progress.playersSent) next = { ...next, players: [] };
      if (progress.groupSent) next = removeGroup(next, progress.groupSent);
      return next;
    });
  });

  const hasChips = inviteCount(selection) > 0;
  const failure = send.isError ? describeBookingFailure(send.error) : null;

  return (
    <StepShell
      title="Invite players"
      subtitle={subtitle}
      footer={
        <PrimaryButton
          label="Send invites"
          loading={send.isPending}
          variant={hasChips ? 'primary' : 'ghost'}
          onPress={
            hasChips
              ? () =>
                  send.mutate(selection, {
                    onSuccess: onSent,
                  })
              : undefined
          }
        />
      }
    >
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search club members by name"
          placeholderTextColor={colors.textSubtle}
          accessibilityLabel="Search club members by name"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {hasChips ? (
        <View style={styles.chipRow} accessibilityLabel="Selected invites">
          {selection.groups.map((group) => (
            <Chip
              key={group.id}
              label={groupChipLabel(group)}
              onRemove={() => setSelection(removeGroup(selection, group.id))}
            />
          ))}
          {selection.players.map((player) => (
            <Chip
              key={player.user_id}
              label={playerName(player)}
              onRemove={() => setSelection(removePlayer(selection, player.user_id))}
            />
          ))}
        </View>
      ) : null}

      {groups.isSuccess && groups.data.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Your groups</Text>
          <View style={styles.list}>
            {groups.data.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                added={isGroupSelected(selection, group.id)}
                onAdd={() => setSelection(addGroup(selection, group))}
              />
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.sectionLabel}>Players</Text>

      {search.isPending ? (
        <View style={styles.list} accessibilityLabel="Loading players">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={58} borderRadius={radius.md} />
          ))}
        </View>
      ) : search.isError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>We could not search members.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void search.refetch()} />
        </View>
      ) : players.length === 0 ? (
        <EmptyStateView
          title={searching ? 'No members found' : 'Find your crew'}
          description={
            searching ? 'No club member matches that name.' : 'Search club members by name to invite them.'
          }
        />
      ) : (
        <View style={styles.list}>
          {players.map((player) => (
            <PlayerRow
              key={player.user_id}
              player={player}
              selected={isPlayerSelected(selection, player.user_id)}
              onToggle={() => setSelection(togglePlayer(selection, player))}
            />
          ))}
        </View>
      )}

      {failure ? (
        <Text accessibilityRole="alert" style={styles.formError}>
          {failure.title}. {failure.message}
        </Text>
      ) : null}
    </StepShell>
  );
}

function GroupRow({ group, added, onAdd }: { group: GroupSummary; added: boolean; onAdd: () => void }) {
  return (
    <View style={styles.row}>
      <Avatar name={group.name} src={group.cover_image_url} size="md" />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={styles.rowSubtitle}>
          {group.member_count === 1 ? '1 member' : `${group.member_count} members`}
        </Text>
      </View>
      {added ? (
        <Text style={styles.addedLabel}>Added</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add all members of ${group.name}`}
          onPress={onAdd}
          style={({ pressed }) => [styles.addAll, pressed ? styles.addAllPressed : null]}
        >
          <Text style={styles.addAllLabel}>Add all</Text>
        </Pressable>
      )}
    </View>
  );
}

function PlayerRow({
  player,
  selected,
  onToggle,
}: {
  player: PlayerSearchResult;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = playerName(player);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={selected ? `Remove ${name}` : `Invite ${name}`}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <Avatar name={name} src={player.avatar_url} size="md" />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {name}
        </Text>
        {player.username ? <Text style={styles.rowSubtitle}>@{player.username}</Text> : null}
      </View>
      <View style={[styles.check, selected ? styles.checkSelected : null]}>
        {selected ? <Ionicons name="checkmark" size={16} color={colors.textOnAccent} /> : null}
      </View>
    </Pressable>
  );
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
  },
  rowSubtitle: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
  },
  addedLabel: {
    color: colors.textSubtle,
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
  },
  addAll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  addAllPressed: {
    opacity: 0.9,
  },
  addAllLabel: {
    color: colors.textOnAccent,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  errorBox: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  errorText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  formError: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
});
