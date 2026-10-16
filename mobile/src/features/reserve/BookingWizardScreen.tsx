import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { clutch, useMutationKey, type Booking, type BookingId } from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { queryKeys } from '../../lib/queries';
import { PrimaryButton, useToast } from '../../components';
import { colors, fonts, spacing } from '../../theme/tokens';
import { formatDateHeading, formatTimeRangeCompact, sportLabel, todayDateKey } from './booking';
import { bookingRulesOf, usableTimezone } from './club-rules';
import { CheckoutStep } from './CheckoutStep';
import { ConfirmationSheet } from './ConfirmationSheet';
import { createHoldSession, type HoldSession } from './hold-session';
import { InvitePlayersStep } from './InvitePlayersStep';
import { SelectTimeStep, type TimePick } from './SelectTimeStep';
import { WizardFrame, type WizardStep } from './WizardFrame';

/**
 * The booking wizard for one sport (court_type): choose a time, then
 * checkout (hold, pay, confirm), then the confirmation sheet with invites.
 * Full screen, outside the tab shell. Leaving releases a hold that is still
 * pending, unless a payment is settling (see hold-session.ts).
 */
export function BookingWizardScreen({ sport }: { sport: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const club = useClub();
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
  const [confirmed, setConfirmed] = useState<Booking | null>(null);
  const [inviting, setInviting] = useState(false);
  const [paymentLocked, setPaymentLocked] = useState(false);

  const [holdSession] = useState<HoldSession>(() =>
    createHoldSession({
      // Fire and forget: releasing early frees the court for others; the
      // hold's own expiry is the backstop, so a failed cancel is fine.
      cancel: (id: BookingId) =>
        void releaseKey
          .run({ release: id }, (key) => clutch.bookings.cancel(id, { idempotencyKey: key }))
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
    (booking: Booking) => {
      holdSession.settle();
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.availability(booking.date) });
      setConfirmed(booking);
    },
    [holdSession, queryClient],
  );

  const openBooking = useCallback(
    (booking: Booking) => {
      holdSession.settle();
      router.replace(`/bookings/${booking.id}`);
    },
    [holdSession, router],
  );

  if (club.isPending) {
    return (
      <WizardFrame onBack={leave} onClose={leave}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerText}>Loading booking</Text>
        </View>
      </WizardFrame>
    );
  }

  if (club.isError) {
    return (
      <WizardFrame onBack={leave} onClose={leave}>
        <View style={styles.center}>
          <Text style={styles.centerTitle}>We could not load the club.</Text>
          <View style={styles.centerAction}>
            <PrimaryButton label="Try again" variant="secondary" onPress={() => void club.refetch()} />
          </View>
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

  const rules = bookingRulesOf(club.data);

  // ── Confirmed: the success sheet, then invites ──

  if (confirmed) {
    if (inviting) {
      return (
        <WizardFrame onBack={() => setInviting(false)} onClose={() => setInviting(false)}>
          <InvitePlayersStep
            bookingId={confirmed.id}
            subtitle={`${formatDateHeading(confirmed.date)} · ${formatTimeRangeCompact(
              confirmed.start_time,
              confirmed.end_time,
            )}`}
            onSent={() => {
              toast({ variant: 'success', message: 'Invites sent' });
              setInviting(false);
              openBooking(confirmed);
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
          booking={confirmed}
          sport={sport}
          courtName={pick?.court.court_name ?? null}
          onInvitePlayers={() => setInviting(true)}
          onViewBooking={() => openBooking(confirmed)}
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
