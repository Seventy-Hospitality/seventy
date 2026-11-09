import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { clutch, currentTierName, type BookingInvitation } from '../../lib/clutch';
import {
  bookingInvitationsQuery,
  groupInvitationsQuery,
  homeQuery,
  membershipQuery,
} from '../../lib/queries';
import { useClub } from '../../lib/club';
import {
  AnnouncementCard,
  AppScreen,
  Avatar,
  BookingCard,
  MemberCardSheet,
  PrimaryButton,
  Skeleton,
  useToast,
} from '../../components';
import { PlayingBookingsSection, useRespondToBooking } from '../bookings';
import { GroupInvitationCard, useGroupInvitationResponder } from '../groups';
import { dateKeyToDate, sportsFrom } from '../reserve';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { orderAnnouncements, orderInvitations, respondFailure } from './home-data';
import { firstNameOf, greetingEyebrow, homeLayout, timeOfDay } from './home-sections';
import {
  BookingInvitationCard,
  BookSportRow,
  FirstSessionBanner,
  HomeSection,
  SectionError,
  type RespondResponse,
} from './HomeCards';

/** "October 20" for the accept toast (no year). */
function monthDayLabel(dateKey: string): string {
  return dateKeyToDate(dateKey).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/**
 * The home feed on Clutch: greeting + member card, pending booking
 * invitations, upcoming bookings, pending group invitations, and the club's
 * announcements. With nothing upcoming and no booking invitations it becomes
 * a "Book a court" prompt per sport.
 *
 * Answering a booking invitation is P4 (bookingParity). Until it is live the
 * invitation card says answering in the app is coming soon instead of
 * offering Accept / Decline buttons that could only fail.
 *
 * GET /me/home answers the profile, upcoming bookings and announcements; the
 * invitations are their own shared reads (their keys are what the respond
 * mutations invalidate). The home read gates the screen; a failed invitation
 * read shows an inline retry instead of taking the feed down.
 */
export function HomeScreen() {
  const home = useQuery(homeQuery);
  const bookingInvites = useQuery(bookingInvitationsQuery);
  const groupInvites = useQuery(groupInvitationsQuery);
  // Only the member card's tier line; never a reason to block or decide anything.
  const membership = useQuery(membershipQuery);
  const club = useClub();
  const router = useRouter();
  const { toast } = useToast();
  const [cardOpen, setCardOpen] = useState(false);
  const canRespond = clutch.capabilities.bookingParity;

  // At screen level: the answered card leaves the list on refetch, and a
  // card-level mutation would drop its outcome toast when it unmounts.
  const respond = useRespondToBooking();
  const groupResponder = useGroupInvitationResponder();

  const refreshAll = useCallback(() => {
    void home.refetch();
    void bookingInvites.refetch();
    void groupInvites.refetch();
  }, [home, bookingInvites, groupInvites]);

  const openInvitation = useCallback(
    (invitation: BookingInvitation) => router.push(`/bookings/${invitation.booking_id}`),
    [router],
  );

  const bookSport = useCallback(
    (sport: string) => router.push(`/reserve/${encodeURIComponent(sport)}`),
    [router],
  );

  const respondTo = useCallback(
    (invitation: BookingInvitation, response: RespondResponse) => {
      const accept = response === 'accept';
      respond.mutate(
        { bookingId: invitation.booking_id, accept },
        {
          onSuccess: () => {
            toast({
              variant: 'success',
              message: accept
                ? `Invite accepted! See you ${monthDayLabel(invitation.date)}.`
                : 'Invitation declined.',
            });
          },
          onError: (error) => {
            // A conflict needs no extra work here: useRespondToBooking
            // invalidates every booking read and home when it settles, so the
            // stale card is replaced by Clutch's truth.
            toast({ variant: 'error', message: respondFailure(error).message });
          },
        },
      );
    },
    [respond, toast],
  );

  if (home.isPending) {
    return <HomeSkeleton />;
  }

  if (home.isError) {
    return (
      <AppScreen onRefresh={refreshAll} refreshing={home.isRefetching}>
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>We could not load your home feed.</Text>
          <View style={styles.errorAction}>
            <PrimaryButton label="Try again" variant="secondary" onPress={() => void home.refetch()} />
          </View>
        </View>
      </AppScreen>
    );
  }

  const feed = home.data;
  const invitations = bookingInvites.data ? orderInvitations(bookingInvites.data) : undefined;
  // /me/home lists only bookings the member BOOKED; the ones they play in
  // (accepted invitations) render below from PlayingBookingsSection.
  const upcoming = feed.upcoming_bookings;
  const layout = homeLayout({ upcoming, bookingInvitations: invitations });
  const announcements = orderAnnouncements(feed.announcements);
  const groupInvitations = groupInvites.data ?? [];
  // full_name is always a string; an empty one means Clutch has no name yet.
  const fullName = feed.profile.full_name.trim() || null;
  const sports = sportsFrom(club.data?.courts ?? []);

  const pendingFor = (invitation: BookingInvitation): RespondResponse | null =>
    respond.isPending && respond.variables?.bookingId === invitation.booking_id
      ? respond.variables.accept
        ? 'accept'
        : 'decline'
      : null;

  return (
    <AppScreen
      onRefresh={refreshAll}
      refreshing={home.isRefetching || bookingInvites.isRefetching || groupInvites.isRefetching}
    >
      <GreetingHeader
        eyebrow={greetingEyebrow(timeOfDay(new Date()), layout.isEmpty)}
        name={firstNameOf(fullName) ?? 'Member'}
        fullName={fullName ?? 'Member'}
        avatarUrl={feed.profile.avatar_url ?? null}
        onOpenCard={() => setCardOpen(true)}
      />

      {bookingInvites.isError ? (
        <SectionError
          message="We could not load your booking invitations."
          onRetry={() => void bookingInvites.refetch()}
        />
      ) : null}

      {layout.showBookingInvitations && invitations ? (
        <HomeSection title="Invitations">
          <View style={styles.stack}>
            {invitations.map((invitation) => (
              <BookingInvitationCard
                key={invitation.booking_player_id}
                invitation={invitation}
                canRespond={canRespond}
                onRespond={respondTo}
                onOpen={openInvitation}
                pendingResponse={pendingFor(invitation)}
                disabled={respond.isPending}
              />
            ))}
          </View>
        </HomeSection>
      ) : null}

      {layout.showUpcoming ? (
        <HomeSection title="Upcoming bookings">
          <View style={styles.stack}>
            {upcoming.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </View>
        </HomeSection>
      ) : null}

      <PlayingBookingsSection />

      {layout.isEmpty ? (
        <>
          <FirstSessionBanner />
          <HomeSection title="Book a court">
            {club.isPending ? (
              <View style={styles.stack} accessibilityLabel="Loading sports">
                <Skeleton height={72} borderRadius={radius.lg} />
                <Skeleton height={72} borderRadius={radius.lg} />
              </View>
            ) : club.isError ? (
              <SectionError message="We could not load the club's courts." onRetry={() => void club.refetch()} />
            ) : sports.length === 0 ? (
              <Text style={styles.muted}>The club has not opened any courts for booking yet.</Text>
            ) : (
              <View style={styles.stack}>
                {sports.map((sport) => (
                  <BookSportRow key={sport} sport={sport} onBook={bookSport} />
                ))}
              </View>
            )}
          </HomeSection>
        </>
      ) : null}

      {groupInvites.isError ? (
        <SectionError
          message="We could not load your group invitations."
          onRetry={() => void groupInvites.refetch()}
        />
      ) : null}

      {groupInvitations.length > 0 ? (
        <HomeSection title="Group invitations">
          <View style={styles.stack}>
            {groupInvitations.map((invitation) => (
              <GroupInvitationCard key={invitation.id} {...groupResponder.cardProps(invitation)} />
            ))}
          </View>
        </HomeSection>
      ) : null}

      {announcements.length > 0 ? (
        <HomeSection title="Club news">
          <View style={styles.stack}>
            {announcements.map((announcement) => (
              <AnnouncementCard
                key={announcement.id}
                announcement={announcement}
                timeZone={club.data?.timezone}
              />
            ))}
          </View>
        </HomeSection>
      ) : null}

      <MemberCardSheet
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        memberName={fullName ?? 'Member'}
        detail={membership.data ? currentTierName(membership.data) : null}
      />
    </AppScreen>
  );
}

function GreetingHeader({
  eyebrow,
  name,
  fullName,
  avatarUrl,
  onOpenCard,
}: {
  eyebrow: string;
  name: string;
  fullName: string;
  avatarUrl: string | null;
  onOpenCard: () => void;
}) {
  return (
    <View style={styles.greeting}>
      <Avatar name={fullName} src={avatarUrl} size="md" />
      <View style={styles.greetingText}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.name} accessibilityRole="header" numberOfLines={1}>
          {name}
        </Text>
      </View>
      <Pressable
        onPress={onOpenCard}
        accessibilityRole="button"
        accessibilityLabel="Show membership card"
        style={({ pressed }) => [styles.qrButton, pressed ? styles.qrButtonPressed : null]}
      >
        <Ionicons name="qr-code" size={24} color={colors.textOnAccent} />
      </Pressable>
    </View>
  );
}

function HomeSkeleton() {
  return (
    <AppScreen>
      <View style={styles.greeting} accessibilityRole="progressbar" accessibilityLabel="Loading your home feed">
        <Skeleton width={44} height={44} borderRadius={22} />
        <View style={styles.greetingText}>
          <Skeleton width={96} height={16} />
          <Skeleton width={168} height={34} />
        </View>
        <Skeleton width={44} height={44} borderRadius={radius.md} />
      </View>
      <Skeleton height={120} borderRadius={radius.lg} />
      <Skeleton height={140} borderRadius={radius.lg} />
      <Skeleton height={140} borderRadius={radius.lg} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  greetingText: {
    flex: 1,
    gap: spacing.xs,
  },
  eyebrow: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  name: {
    color: colors.text,
    fontFamily: fonts.displayHeavy,
    fontSize: 30,
    lineHeight: 36,
  },
  qrButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrButtonPressed: {
    opacity: 0.9,
  },
  stack: {
    gap: spacing.md,
  },
  muted: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  errorBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  errorText: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    textAlign: 'center',
  },
  errorAction: {
    alignSelf: 'stretch',
  },
});
