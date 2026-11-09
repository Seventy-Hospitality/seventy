import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { clutch, type ClubPlayer, type UserId } from '../../lib/clutch';
import { Avatar, Chip, EmptyStateView, FeatureUnavailable, PrimaryButton, Skeleton } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { playerSearchQuery } from './groups-data';
import {
  isSelected,
  personHandle,
  personName,
  removeInvitee,
  toggleInvitee,
  type InviteeSelection,
} from './groups-lib';

const SEARCH_DEBOUNCE_MS = 250;

interface MemberPickerProps {
  selection: InviteeSelection;
  onSelectionChange: (selection: InviteeSelection) => void;
  /** People already in the group (and the viewer) are not selectable. */
  excludeUserIds?: readonly UserId[];
}

/**
 * Pick fellow club members to invite to a group (Figma invite-players 95:4294 /
 * invite modal 195:17988): search by name, removable chips for the picks, and
 * a check-toggle per row. Results come from Clutch's member-facing player
 * search (P4 feat/member-booking-parity), which returns only fellow members of
 * this club and only what a member may see of them; the admin roster is never
 * used. Until P4 is live the picker says so instead of searching, and the
 * invite link (which needs no P4) stays the way to bring people in.
 */
export function MemberPicker(props: MemberPickerProps) {
  if (!clutch.capabilities.bookingParity) {
    return (
      <FeatureUnavailable
        capability="bookingParity"
        title="Member search is not available in the app yet"
        description="Searching for club members to invite is coming soon. For now, share the group's invite link from the group page."
      />
    );
  }
  return <MemberSearch {...props} />;
}

function MemberSearch({
  selection,
  onSelectionChange,
  excludeUserIds = [],
}: MemberPickerProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const searching = debouncedQuery.length > 0;

  const directory = useQuery(playerSearchQuery(debouncedQuery));

  const excluded = useMemo(() => new Set<UserId>(excludeUserIds), [excludeUserIds]);

  const players: ClubPlayer[] = useMemo(
    () => (directory.data ?? []).filter((player) => !excluded.has(player.user_id)),
    [directory.data, excluded],
  );

  return (
    <View style={styles.root}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search members by name"
          placeholderTextColor={colors.textSubtle}
          accessibilityLabel="Search members by name"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {selection.length > 0 ? (
        <View style={styles.chipRow} accessibilityLabel="Selected players">
          {selection.map((player) => (
            <Chip
              key={player.user_id}
              label={personName(player)}
              onRemove={() => onSelectionChange(removeInvitee(selection, player.user_id))}
            />
          ))}
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Players</Text>

      {directory.isPending ? (
        <View style={styles.list} accessibilityLabel="Loading players">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={58} borderRadius={radius.md} />
          ))}
        </View>
      ) : directory.isError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>We could not load members.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void directory.refetch()} />
        </View>
      ) : players.length === 0 ? (
        <EmptyStateView
          title={searching ? 'No members found' : 'No members to invite'}
          description={
            searching
              ? 'No club member matches that name.'
              : 'Search for club members by name to invite them.'
          }
        />
      ) : (
        <View style={styles.list}>
          {players.map((player) => (
            <PlayerRow
              key={player.user_id}
              player={player}
              selected={isSelected(selection, player.user_id)}
              onToggle={() => onSelectionChange(toggleInvitee(selection, player))}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function PlayerRow({
  player,
  selected,
  onToggle,
}: {
  player: ClubPlayer;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = personName(player);
  const handle = personHandle(player);
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
        {handle ? <Text style={styles.rowSubtitle}>{handle}</Text> : null}
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
  root: {
    gap: spacing.md,
  },
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
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderActive,
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
});
