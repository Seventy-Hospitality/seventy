import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clutch, isClutchError } from '../lib/clutch';
import { queryKeys } from '../lib/queries';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { FeatureUnavailable } from './FeatureUnavailable';
import { PrimaryButton } from './PrimaryButton';
import { QRCode } from './QRCode';
import { Sheet } from './Sheet';
import { Skeleton } from './Skeleton';

export interface MemberCardSheetProps {
  open: boolean;
  onClose: () => void;
  /** Shown uppercase under the code, per the Figma member card. */
  memberName: string;
  /** A second line under the name, e.g. the member's tier. */
  detail?: string | null;
}

/** Refresh this long before the token expires. */
const REFRESH_MARGIN_MS = 10_000;
const MIN_REFRESH_DELAY_MS = 1_000;

/**
 * When to re-request a check-in token fetched at `fetchedAtMs`: shortly before
 * its TTL runs out. Anchored on the device's own fetch time plus Clutch's
 * ttlSeconds rather than expiresAt, so a phone clock that is off does not
 * show an expired (or needlessly churning) code.
 */
export function checkinRefreshDelay(fetchedAtMs: number, ttlSeconds: number, nowMs: number): number {
  const refreshAt = fetchedAtMs + ttlSeconds * 1000 - REFRESH_MARGIN_MS;
  return Math.max(refreshAt - nowMs, MIN_REFRESH_DELAY_MS);
}

/** Why the check-in code is missing, in words a member can act on. */
export function checkinErrorMessage(err: unknown): { message: string; retry: boolean } {
  if (isClutchError(err)) {
    switch (err.code) {
      case 'not_club_member':
        return { message: 'Your check-in code appears once your Club70 membership is active.', retry: false };
      case 'checkin_unavailable':
        return { message: 'Check-in codes are not available right now. Show your name at the desk.', retry: true };
      default:
        break;
    }
  }
  return { message: 'We could not load your check-in code.', retry: true };
}

/**
 * The membership QR card (Figma account/member-card 107:9461): brand mark,
 * the check-in QR, the member's name on a dark card. Opened from the home
 * header and from Account: reuse this, do not rebuild the card.
 *
 * The QR encodes Clutch's signed, short-lived check-in token
 * (GET /me/checkin-token, PENDING P5), never the raw user id. While open the
 * token is re-requested before its TTL runs out. It is never kept across
 * opens: the query mounts only while the sheet is open and its cache entry is
 * removed on close, so a reopened card shows the skeleton until a fresh token
 * lands and never flashes an expired code.
 */
export function MemberCardSheet({ open, onClose, memberName, detail }: MemberCardSheetProps) {
  const queryClient = useQueryClient();

  // Consumers keep the sheet mounted while closed, so garbage collection
  // alone would leave the old token cached. The observer lives in
  // <MemberCardQr>, which unmounts first, so this removal sees no observer.
  useEffect(() => {
    if (!open) queryClient.removeQueries({ queryKey: queryKeys.checkinToken });
  }, [open, queryClient]);

  return (
    <Sheet open={open} onClose={onClose} title="Membership card">
      <View style={styles.card}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>70</Text>
          </View>
          <Text style={styles.brandUrl}>CLUB70.COM</Text>
        </View>

        {open && clutch.capabilities.checkinToken ? <MemberCardQr memberName={memberName} /> : null}
        {open && !clutch.capabilities.checkinToken ? (
          <FeatureUnavailable
            capability="checkinToken"
            title="Check-in code"
            description="Check-in codes are not available in the app yet. Give your name at the desk."
            compact
          />
        ) : null}

        <Text style={styles.name}>{memberName.toUpperCase()}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
    </Sheet>
  );
}

function MemberCardQr({ memberName }: { memberName: string }) {
  const queryClient = useQueryClient();

  const token = useQuery({
    queryKey: queryKeys.checkinToken,
    queryFn: () => clutch.me.checkinToken(),
    staleTime: 0,
    gcTime: 0,
  });

  const ttlSeconds = token.data?.ttlSeconds ?? null;
  const fetchedAt = token.dataUpdatedAt;
  useEffect(() => {
    if (ttlSeconds === null) return;
    const timer = setTimeout(
      () => void queryClient.refetchQueries({ queryKey: queryKeys.checkinToken }),
      checkinRefreshDelay(fetchedAt, ttlSeconds, Date.now()),
    );
    return () => clearTimeout(timer);
  }, [ttlSeconds, fetchedAt, queryClient]);

  if (token.isPending) {
    return (
      <View style={styles.qrFrame} accessibilityRole="progressbar" accessibilityLabel="Loading your check-in code">
        <Skeleton width={180} height={180} borderRadius={radius.md} />
      </View>
    );
  }

  if (token.isError) {
    const { message, retry } = checkinErrorMessage(token.error);
    return (
      <View style={styles.qrFrame} accessibilityRole="alert">
        <Text style={styles.errorText}>{message}</Text>
        {retry ? (
          <View style={styles.errorAction}>
            <PrimaryButton label="Try again" variant="secondary" onPress={() => void token.refetch()} />
          </View>
        ) : null}
      </View>
    );
  }

  // White modules on the dark card, per the Figma. Clutch's scanner reads it.
  return (
    <View style={styles.qrFrame} accessibilityRole="image" accessibilityLabel={`Check-in QR code for ${memberName}`}>
      <QRCode value={token.data.token} size={180} color={colors.text} backgroundColor="transparent" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.backgroundDeep,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  brand: { alignItems: 'center', gap: spacing.sm },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: { color: colors.accent, fontFamily: fonts.displayHeavy, fontSize: 18 },
  brandUrl: { color: colors.textMuted, fontFamily: fonts.bodySemibold, fontSize: 11, letterSpacing: 3 },
  qrFrame: {
    minHeight: 212,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
  },
  name: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 18,
    letterSpacing: 1,
    textAlign: 'center',
  },
  detail: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, letterSpacing: 1 },
  errorText: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 220,
  },
  errorAction: { alignSelf: 'stretch', paddingHorizontal: spacing.md },
});
