import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../../lib/club';
import { AppScreen, EmptyStateView, PrimaryButton, Skeleton } from '../../components';
import { colors, fonts, spacing } from '../../theme/tokens';
import { sportLabel } from './booking';
import { courtCountFor, sportsFrom } from './court-picker';
import { SportTile } from './SportIcon';

/**
 * The Reserve tab: the club's sports (distinct court types, in court order)
 * with how many courts each has. Picking a sport opens the booking wizard for
 * that court_type. Whether the member may book is Clutch's answer at hold
 * time, not a guess made here.
 */
export function ReserveScreen() {
  const club = useClub();
  const courts = club.data?.courts ?? [];
  const sports = sportsFrom(courts);

  return (
    <AppScreen refreshing={club.isRefetching} onRefresh={() => void club.refetch()}>
      <View style={styles.header}>
        <Text style={styles.title}>Reserve</Text>
        <Text style={styles.subtitle}>Book a court in advance</Text>
      </View>

      {club.isPending ? (
        <View style={styles.list} accessibilityLabel="Loading sports">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={78} borderRadius={16} />
          ))}
        </View>
      ) : club.isError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>We could not load the club's courts.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void club.refetch()} />
        </View>
      ) : sports.length === 0 ? (
        <EmptyStateView title="Nothing to book yet" description="The club has not opened any courts for booking." />
      ) : (
        <View style={styles.list}>
          {sports.map((sport) => (
            <SportRow key={sport} sport={sport} courtCount={courtCountFor(courts, sport)} />
          ))}
        </View>
      )}
    </AppScreen>
  );
}

function SportRow({ sport, courtCount }: { sport: string; courtCount: number }) {
  const router = useRouter();
  const courtsLabel = courtCount === 1 ? '1 court' : `${courtCount} courts`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Book ${sportLabel(sport)}, ${courtsLabel}`}
      onPress={() => router.push(`/reserve/${encodeURIComponent(sport)}`)}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <SportTile sport={sport} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {sportLabel(sport)}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {courtsLabel}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
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
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 16,
  },
  rowSubtitle: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  errorBox: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
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
