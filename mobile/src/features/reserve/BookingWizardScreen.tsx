import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { clutch, entitlement, useMutationKey, type BookingId } from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { membershipQuery, queryKeys } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { PrimaryButton, useToast } from '../../components';
import { colors, fonts, spacing } from '../../theme/tokens';
import { formatDateHeading, formatTimeRangeCompact, sportLabel, todayDateKey } from './booking';
import type { Charge } from './charge';
import { usableTimezone, useSportRules } from './club-rules';
import { CheckoutStep } from './CheckoutStep';
import { ConfirmationSheet } from './ConfirmationSheet';
import { releaseHoldIfPending } from './hold-release';
import { createHoldSession, type HoldSession } from './hold-session';
import { InvitePlayersStep } from './InvitePlayersStep';
import { membershipGateCopy } from './membership-gate';
import { MembershipInactiveState } from './MembershipInactiveState';
import { SelectTimeStep, type TimePick } from './SelectTimeStep';
import type { BookingFacts } from './useBookingPayment';
import { WizardFrame, type WizardStep } from './WizardFrame';

/**
 * The booking wizard for one sport (court_type): choose a time, then
 * checkout (hold, pay, confirm), then the confirmation sheet with invites.
 * Full screen, outside the tab shell.
 *
 * Gates, in order: the club row, the member's entitlement (GET
 * /me/membership through entitlement(): only 'entitled' may book), and the
 * sport's rules (P4 may say this member cannot book this sport).
 *
 * Leaving releases a hold that is still pending, unless a payment is
 * settling; the release itself re-reads the booking first (hold-release.ts).
 */
export function BookingWizardScreen({ sport }: { sport: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const club = useClub();
  const membership = useQuery(membershipQuery);
  const sportRules = useSportRules(sport);
  const { userId } = useSession();
  const releaseKey = useMutationKey();

  const timezone = usableTimezone(club.data?.timezone);
  const todayKey = todayDateKey(timezone);

  const [step, setStep] = useState<WizardStep>(1);
  const [storedDate, setStoredDate] = useState(todayKey);
  // The club's midnight can pass mid-session: a date in the club's past is
  // unbookable, so clamp it forward to the club's today.
  const date = storedDate < todayKey ? todayKey : storedDate;
  const [slots, setSlots] = useState<string[]>([]);
  const [pick, setPick] = useState<TimePick | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ booking: BookingFacts; charge: Charge | null } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [paymentLocked, setPaymentLocked] = useState(false);

  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const [holdSession] = useState<HoldSession>(() =>
    createHoldSession({
      // Fire and forget: releasing early frees the court for others; the
      // hold's own expiry is the backstop, so a failed release is fine. It
      // never cancels a booking that may be confirmed (hold-release.ts: P4's
      // pending-only release, else read-then-cancel).
      cancel: (id: BookingId) =>
        void releaseHoldIfPending(id, userIdRef.current, {
          cancel: (bookingId) =>
            releaseKey.run({ cancel: bookingId }, (key) =>
              clutch.bookings.cancel(bookingId, { idempotencyKey: key }),
            ),
          release: (bookingId) =>
            releaseKey.run({ release: bookingId }, (key) =>
              clutch.bookings.release(bookingId, { idempotencyKey: key }),
            ),
        })
          .then(() => queryClient.invalidateQueries({ queryKey: ['availability'] }))
          .catch(() => undefined),
      onLockChange: setPaymentLocked,
    }),
  );

  useEffect(() => () => holdSession.release(), [holdSession]);

  // Android back is blocked while a payment is settling.
  useEffect(() => {
    if (!paymentLocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [paymentLocked]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/reserve');
  }, [router]);

  const closeWizard = useCallback(() => {
    if (holdSession.paymentLocked) return;
    holdSession.release();
    leave();
  }, [holdSession, leave]);

  const backToTimes = useCallback(
    (message: string | null) => {
      holdSession.release();
      void queryClient.invalidateQueries({ queryKey: queryKeys.availability(date) });
      setNotice(message);
      setSlots([]);
      setPick(null);
      setStep(1);
    },
    [holdSession, queryClient, date],
  );

  const handleConfirmed = useCallback(
    (booking: BookingFacts, charge: Charge | null) => {
      holdSession.settle();
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.availability(booking.date) });
      setConfirmed({ booking, charge });
    },
    [holdSession, queryClient],
  );

  const openBooking = useCallback(
    (bookingId: BookingId) => {
      // Leaving to the booking screen hands the hold over without releasing
      // it: a payment may be clearing, and the booking screen checks it.
      holdSession.settle();
      router.replace(`/bookings/${bookingId}`);
    },
    [holdSession, router],
  );

  if (club.isPending || membership.isPending || sportRules.isPending) {
    return (
      <WizardFrame onBack={leave} onClose={leave}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerText}>Loading booking</Text>
        </View>
      </WizardFrame>
    );
  }

  if (club.isError || membership.isError || !sportRules.rules) {
    return (
      <WizardFrame onBack={leave} onClose={leave}>
        <View style={styles.center}>
          <Text style={styles.centerTitle}>
            {membership.isError ? 'We could not check your membership.' : 'We could not load the club.'}
          </Text>
          <View style={styles.centerAction}>
            <PrimaryButton
              label="Try again"
              variant="secondary"
              onPress={() => {
                if (membership.isError) void membership.refetch();
                sportRules.refetch();
              }}
            />
          </View>
        </View>
      </WizardFrame>
    );
  }

  const access = entitlement(membership.data);
  if (access !== 'entitled') {
    const copy = membershipGateCopy(access);
    return (
      <WizardFrame onBack={leave} onClose={leave}>
        <View style={styles.center}>
          <MembershipInactiveState
            title={copy.title}
            description={copy.description}
            actionLabel={copy.actionLabel}
            href={copy.href}
          />
        </View>
      </WizardFrame>
    );
  }

  if (!club.data.courts.some((court) => court.court_type === sport)) {
    return (
      <WizardFrame onBack={leave} onClose={leave}>
        <View style={styles.center}>
          <View style={styles.gateGlyph}>
            <Ionicons name="search-outline" size={26} color={colors.accent} />
          </View>
          <Text style={styles.centerTitle}>No {sportLabel(sport).toLowerCase()} courts</Text>
          <Text style={styles.centerText}>The club has no courts of this sport open for booking.</Text>
          <View style={styles.centerAction}>
            <PrimaryButton label="Back to Reserve" onPress={leave} />
          </View>
        </View>
      </WizardFrame>
    );
  }

  const rules = sportRules.rules;
  if (rules.bookable === false) {
    const tier = rules.refusal === 'tier_required';
    return (
      <WizardFrame onBack={leave} onClose={leave}>
        <View style={styles.center}>
          <MembershipInactiveState
            title={tier ? 'Membership tier needed' : 'Club membership needed'}
            description={
              tier
                ? `${sportLabel(sport)} courts are kept for members of certain membership tiers.`
                : `${sportLabel(sport)} courts are for club members.`
            }
            actionLabel={tier ? 'See membership tiers' : 'Choose a membership'}
            href={tier ? '/account/billing' : '/onboarding/plan'}
          />
        </View>
      </WizardFrame>
    );
  }

  // ── Confirmed: the success sheet, then invites ──

  if (confirmed) {
    if (inviting) {
      return (
        <WizardFrame onBack={() => setInviting(false)} onClose={() => setInviting(false)}>
          <InvitePlayersStep
            bookingId={confirmed.booking.id}
            subtitle={`${formatDateHeading(confirmed.booking.date)} · ${formatTimeRangeCompact(
              confirmed.booking.start_time,
              confirmed.booking.end_time,
            )}`}
            onSent={() => {
              toast({ variant: 'success', message: 'Invites sent' });
              setInviting(false);
              openBooking(confirmed.booking.id);
            }}
          />
        </WizardFrame>
      );
    }
    return (
      <View style={styles.confirmedBackground}>
        <View style={styles.confirmedGlyph}>
          <Ionicons name="checkmark" size={44} color={colors.accent} />
        </View>
        <ConfirmationSheet
          booking={confirmed.booking}
          charge={confirmed.charge}
          sport={sport}
          courtName={pick?.court.court_name ?? null}
          onInvitePlayers={() => setInviting(true)}
          onViewBooking={() => openBooking(confirmed.booking.id)}
          onClose={leave}
        />
      </View>
    );
  }

  const goBack = () => {
    if (step === 1) {
      closeWizard();
      return;
    }
    if (holdSession.paymentLocked) return;
    // Leaving checkout gives the court back.
    holdSession.release();
    setStep(1);
  };

  return (
    <WizardFrame onBack={goBack} onClose={closeWizard} step={step} chromeDisabled={paymentLocked}>
      {step === 1 || !pick ? (
        <SelectTimeStep
          sport={sport}
          timezone={timezone}
          rules={rules}
          date={date}
          onDateChange={(next) => {
            setStoredDate(next);
            setSlots([]);
          }}
          slots={slots}
          onSlotsChange={setSlots}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
          onContinue={(next) => {
            setPick(next);
            setStep(2);
          }}
        />
      ) : (
        <CheckoutStep
          key={`${pick.court.court_id}:${pick.date}:${pick.range.start}:${pick.range.end}`}
          sport={sport}
          court={pick.court}
          date={pick.date}
          range={pick.range}
          holdSession={holdSession}
          onConfirmed={handleConfirmed}
          onPickAnotherTime={backToTimes}
          onLeaveToBooking={openBooking}
        />
      )}
    </WizardFrame>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  gateGlyph: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceOverlay,
    marginBottom: spacing.xs,
  },
  centerTitle: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 18,
    textAlign: 'center',
  },
  centerText: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  centerAction: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.md,
  },
  confirmedBackground: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  confirmedGlyph: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceOverlay,
  },
});
