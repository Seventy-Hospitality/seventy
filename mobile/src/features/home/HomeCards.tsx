import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BookingInvitation } from '../../lib/clutch';
import { FeatureUnavailable, ListRow, PrimaryButton } from '../../components';
import { formatDateHeading, formatTimeRangeCompact, sportLabel, SportTile } from '../reserve';
import { colors, fonts, radius, spacing } from '../../theme/tokens';

export type RespondResponse = 'accept' | 'decline';

// ── Section heading ──

export function HomeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

// ── Inline notice for a secondary read that failed ──

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.sectionError} accessibilityRole="alert">
      <Text style={styles.sectionErrorText}>{message}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel={`${message} Try again`}>
        <Text style={styles.retry}>Try again</Text>
      </Pressable>
    </View>
  );
}

// ── Booking invitation ──

/**
 * Someone else's booking the member is invited to. Clutch's invitation row
 * carries the inviter, the court and the time (no sport, no roster), so the
 * card shows those; tapping through to the booking shows the rest. Accept /
 * Decline appear only when answering is live (`canRespond`, P4
 * bookingParity); until then the card says so honestly.
 */
export function BookingInvitationCard({
  invitation,
  canRespond,
  onRespond,
  onOpen,
  pendingResponse,
  disabled,
}: {
  invitation: BookingInvitation;
  /** Clutch can take the answer (P4 bookingParity). */
  canRespond: boolean;
  onRespond: (invitation: BookingInvitation, response: RespondResponse) => void;
  onOpen: (invitation: BookingInvitation) => void;
  /** Which response is in flight for THIS card (drives the spinner). */
  pendingResponse: RespondResponse | null;
  /** Any invitation answer is in flight. */
  disabled: boolean;
}) {
  const when = `${formatDateHeading(invitation.date)} · ${formatTimeRangeCompact(
    invitation.start_time,
    invitation.end_time,
  )}`;
  const court = invitation.court_name ?? 'Court';
  return (
    <View style={styles.inviteCard}>
      <Pressable
        onPress={() => onOpen(invitation)}
        accessibilityRole="button"
        accessibilityLabel={`${invitation.inviter_name} invited you to ${court}, ${when}`}
        style={({ pressed }) => [styles.inviteBody, pressed ? styles.pressed : null]}
      >
        <View style={styles.inviterLine}>
          <Ionicons name="person-outline" size={13} color={colors.accent} />
          <Text style={styles.inviterName} numberOfLines={1}>
            {invitation.inviter_name.toUpperCase()}
          </Text>
          <Text style={styles.inviterSuffix}>invited you</Text>
        </View>
        <Text style={styles.inviteCourt} numberOfLines={1}>
          {court}
        </Text>
        <Text style={styles.inviteMeta}>{when}</Text>
      </Pressable>
      {canRespond ? (
      <View style={styles.respondRow}>
        <View style={styles.respondButton}>
          <PrimaryButton
            label="Accept"
            accessibilityLabel={`Accept the invitation from ${invitation.inviter_name}`}
            variant="primary"
            loading={pendingResponse === 'accept'}
            disabled={disabled && pendingResponse !== 'accept'}
            onPress={() => onRespond(invitation, 'accept')}
          />
        </View>
        <View style={styles.respondButton}>
          <PrimaryButton
            label="Decline"
            accessibilityLabel={`Decline the invitation from ${invitation.inviter_name}`}
            variant="ghost"
            loading={pendingResponse === 'decline'}
            disabled={disabled && pendingResponse !== 'decline'}
            onPress={() => onRespond(invitation, 'decline')}
          />
        </View>
      </View>
      ) : (
        <FeatureUnavailable
          capability="bookingParity"
          compact
          title="Answering invitations in the app is coming soon"
          description="For now, let the person who invited you know directly. Tap the invitation to see the booking."
        />
      )}
    </View>
  );
}

// ── Empty state ──

export function FirstSessionBanner() {
  return (
    <View style={styles.banner}>
      <View style={styles.bannerTitleRow}>
        <Ionicons name="calendar-outline" size={16} color={colors.accent} />
        <Text style={styles.bannerTitle}>BOOK YOUR FIRST SESSION</Text>
      </View>
      <Text style={styles.bannerCopy}>Nothing on your schedule yet. Pick a sport and book a court.</Text>
    </View>
  );
}

/** "Book a court" for one sport (a court_type the club has courts for). */
export function BookSportRow({ sport, onBook }: { sport: string; onBook: (sport: string) => void }) {
  const label = sportLabel(sport);
  return (
    <ListRow
      leading={<SportTile sport={sport} size={44} />}
      title={label}
      subtitle="Book a court"
      trailing={
        <Pressable
          onPress={() => onBook(sport)}
          accessibilityRole="button"
          accessibilityLabel={`Book a ${label} court`}
          style={({ pressed }) => [styles.bookPill, pressed ? styles.pressed : null]}
        >
          <Text style={styles.bookPillText}>Book</Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 20,
  },
  sectionError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  sectionErrorText: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  retry: {
    color: colors.accent,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
  },
  // ── Invitation ──
  inviteCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  inviteBody: {
    gap: spacing.xs,
  },
  inviterLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  inviterName: {
    flexShrink: 1,
    color: colors.accent,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  inviterSuffix: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  inviteCourt: {
    color: colors.text,
    fontFamily: fonts.displaySemibold,
    fontSize: 17,
  },
  inviteMeta: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  respondRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  respondButton: {
    flex: 1,
  },
  // ── Empty state ──
  banner: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  bannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bannerTitle: {
    color: colors.accent,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  bannerCopy: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  bookPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  bookPillText: {
    color: colors.textOnAccent,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.9,
  },
});
