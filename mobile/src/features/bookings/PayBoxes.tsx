import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { clutch, type BookingDetail, type BookingDue } from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import { FeatureUnavailable, PrimaryButton, useToast } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { formatMoney } from '../reserve/booking';
import { chargeTotal } from '../reserve/charge';
import { ChargeSummary } from '../reserve/ChargeSummary';
import type { PaymentFlow } from '../reserve/usePaymentFlow';
import { useBookingPayment, useSharePayment } from '../reserve/useBookingPayment';

/**
 * What the viewer owes on a booking and the one way to pay it.
 *
 * - BookerPayBox: the booker's hold or balance (POST /bookings/{id}/payment-intent,
 *   then /confirm).
 * - SharePayBox: a player's share (P4 shares/payment-intent, then
 *   shares/confirm), shown only with bookingParity on; otherwise an honest
 *   "not available in the app yet".
 *
 * Dues are Clutch's figures before tax. Once Clutch issues the intent, its
 * own lines (subtotal and tax, and a total when Clutch states one) replace
 * the hint. While a payment is clearing there is no Pay, only "Check payment
 * again".
 */
export function BookerPayBox({
  booking,
  due,
  mode,
}: {
  booking: BookingDetail;
  due: BookingDue;
  mode: 'hold' | 'balance';
}) {
  const { toast } = useToast();
  const payment = useBookingPayment(booking.id, {
    mode,
    currency: booking.currency,
    shareCents: mode === 'balance' ? due.due_cents : undefined,
    onConfirmed: () => toast({ variant: 'success', message: 'Payment received.' }),
  });
  return <DueBox booking={booking} due={due} payment={payment} />;
}

export function SharePayBox({ booking, due }: { booking: BookingDetail; due: BookingDue }) {
  if (!clutch.capabilities.bookingParity) {
    return (
      <View style={styles.box}>
        <DueRow booking={booking} due={due} />
        <FeatureUnavailable
          capability="bookingParity"
          title="Paying your share in the app is not available yet"
          description="Pay the member who booked, or at the club. Paying here is coming soon."
          compact
        />
      </View>
    );
  }
  return <ShareDueBox booking={booking} due={due} />;
}

function ShareDueBox({ booking, due }: { booking: BookingDetail; due: BookingDue }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const payment = useSharePayment(booking.id, {
    currency: booking.currency,
    onPaid: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(booking.id) });
      toast({ variant: 'success', message: 'Your share is paid.' });
    },
  });
  return <DueBox booking={booking} due={due} payment={payment} />;
}

/** The due line on its own (paid or owed). */
export function DueRow({ booking, due }: { booking: BookingDetail; due: BookingDue }) {
  const owes = due.due_cents > 0;
  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.label}>{owes ? 'You owe' : 'Your part'}</Text>
        <Text style={styles.amount}>
          {formatMoney(owes ? due.due_cents : due.paid_cents, booking.currency)}
        </Text>
      </View>
      {!owes && due.paid_cents > 0 ? <Text style={styles.hint}>Paid. Thank you.</Text> : null}
      {owes ? <Text style={styles.hint}>Before tax; any tax is shown when you pay.</Text> : null}
    </View>
  );
}

function DueBox({
  booking,
  due,
  payment,
}: {
  booking: BookingDetail;
  due: BookingDue;
  payment: PaymentFlow;
}) {
  const busy = payment.stage === 'preparing' || payment.stage === 'paying' || payment.stage === 'confirming';
  const total = chargeTotal(payment.charge);
  return (
    <View style={styles.box}>
      <DueRow booking={booking} due={due} />
      {payment.charge ? <ChargeSummary charge={payment.charge} title="Payment" /> : null}
      {payment.stage === 'unconfirmed' ? (
        <>
          <Text style={styles.hint}>
            Your payment is clearing. Check again in a moment; you will not be charged twice.
          </Text>
          <PrimaryButton
            label="Check payment again"
            variant="secondary"
            onPress={() => void payment.checkAgain()}
          />
        </>
      ) : due.due_cents > 0 ? (
        <PrimaryButton
          label={total ? `Pay ${total}` : 'Pay now'}
          loading={busy}
          onPress={() => void payment.pay()}
        />
      ) : null}
      {payment.failure ? (
        <Text style={styles.error} accessibilityRole="alert">
          {payment.failure.title}. {payment.failure.message}
        </Text>
      ) : null}
      {payment.canceled ? (
        <Text style={styles.hint}>Payment not completed. You can pay any time before the booking.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
  },
  amount: {
    color: colors.accent,
    fontFamily: fonts.displayBold,
    fontSize: 18,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
});
