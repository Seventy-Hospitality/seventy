/**
 * The one way the app pays for a booking: a new hold at checkout, a hold
 * resumed from the booking screen, the booker's balance on a confirmed
 * booking, a player's share, and (Clutch P4) the difference on a dearer move.
 *
 *   intent  POST /bookings/{id}/payment-intent  (Clutch issues it; the app
 *           never picks the amount: share_cents is only Clutch's own due echoed
 *           back as a check that the figure shown is still the one owed)
 *   pay     stripe:    presentConnectedSheet(intent) on the club's account
 *           simulated: POST /bookings/{id}/payment-intent/pay (no sheet)
 *   settle  'confirm': POST /bookings/{id}/confirm with the COMPLETED intent
 *                      id; Clutch asks the provider and records the payment.
 *                      A free booking confirms with no intent.
 *           'refetch': a player's share. Clutch records it from the provider
 *                      (webhook); /api/v1 has no confirm for a player's share
 *                      yet, so the app reloads the booking and shows its dues.
 *
 * A completed sheet is never shown as success on its own: success is what
 * confirm (or the reloaded booking) says.
 *
 * Keys: one per logical mutation. The intent key is per booking and share; the
 * confirm key per booking and intent. A 4xx ends a key (Clutch caches it), so
 * "Check again" after payment_not_verified sends a NEW key and Clutch asks the
 * provider afresh; a network failure keeps the key so the retry replays.
 */
import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  bookingIntentToSheet,
  clutch,
  useMutationKey,
  type Booking,
  type BookingId,
  type BookingPaymentIntent,
} from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import { usePresentConnectedSheet, type SheetResult } from '../../lib/stripe';
import { describeBookingFailure, type BookingFailure } from './booking-failures';

export type PaymentStage =
  /** Nothing in flight; the member can pay. */
  | 'idle'
  /** Asking Clutch for the payment intent. */
  | 'preparing'
  /** The sheet is up, or the simulated checkout is being paid. */
  | 'paying'
  /** Handing the completed intent to Clutch. */
  | 'confirming'
  /**
   * Money moved but Clutch has not confirmed: the payment is clearing, or the
   * confirm did not get an answer. The only way forward is checkAgain(),
   * never a second payment.
   */
  | 'unconfirmed'
  /** A share was paid; Clutch records it and the booking reloads. */
  | 'submitted';

export interface PayRequest {
  /** What Clutch says is owed now (a hold's price_cents, or a due). */
  amountCents: number;
  /** Pay only this share: Clutch's own due_cents for the caller. */
  shareCents?: number;
  /** An intent Clutch already issued (the difference on a dearer move). */
  intent?: BookingPaymentIntent;
  settle: 'confirm' | 'refetch';
}

export interface UseBookingPaymentOptions {
  onConfirmed?: (booking: Booking) => void;
  onSubmitted?: () => void;
  /** True from submitting a payment until Clutch has answered. */
  onLockChange?: (locked: boolean) => void;
  merchantDisplayName?: string;
}

const UNCONFIGURED: BookingFailure = {
  action: 'none',
  title: 'Card payments unavailable',
  message: 'Card payments are not set up in this build of the app.',
};

export function useBookingPayment(bookingId: BookingId | null, options: UseBookingPaymentOptions = {}) {
  const queryClient = useQueryClient();
  const presentSheet = usePresentConnectedSheet();
  const intentKey = useMutationKey();
  const simulatedKey = useMutationKey();
  const confirmKey = useMutationKey();

  const [stage, setStage] = useState<PaymentStage>('idle');
  const [failure, setFailure] = useState<BookingFailure | null>(null);
  /** The member closed the sheet without paying; the hold is kept. */
  const [canceled, setCanceled] = useState(false);
  /** The completed intent awaiting Clutch's confirm (for checkAgain). */
  const pendingIntent = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const lock = useCallback((locked: boolean) => optionsRef.current.onLockChange?.(locked), []);

  const invalidate = useCallback(
    (id: BookingId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
    [queryClient],
  );

  const confirmWith = useCallback(
    async (id: BookingId, intentId: string | null) => {
      pendingIntent.current = intentId;
      setStage('confirming');
      try {
        const booking = await confirmKey.run({ id, intentId }, (key) =>
          clutch.bookings.confirm(id, intentId, { idempotencyKey: key }),
        );
        pendingIntent.current = null;
        queryClient.setQueryData(queryKeys.booking(id), (old: unknown) =>
          old && typeof old === 'object' ? { ...old, ...booking } : old,
        );
        invalidate(id);
        setStage('idle');
        optionsRef.current.onConfirmed?.(booking);
        lock(false);
      } catch (err) {
        const described = describeBookingFailure(err);
        setFailure(described);
        if (intentId && (described.action === 'check-again' || described.action === 'retry')) {
          // Money may have moved: stay locked and only ever ask Clutch again.
          setStage('unconfirmed');
          return;
        }
        if (!intentId && described.action === 'retry') {
          // A free booking: nothing was paid, the member can simply try again.
          setStage('idle');
          lock(false);
          return;
        }
        pendingIntent.current = null;
        setStage('idle');
        lock(false);
        invalidate(id);
      }
    },
    [confirmKey, invalidate, lock, queryClient],
  );

  const pay = useCallback(
    async (request: PayRequest) => {
      if (!bookingId) return;
      if (stage !== 'idle' && stage !== 'submitted') return;
      setFailure(null);
      setCanceled(false);

      if (request.amountCents <= 0 && request.settle === 'confirm' && !request.intent) {
        lock(true);
        await confirmWith(bookingId, null);
        return;
      }

      let intent = request.intent;
      if (!intent) {
        setStage('preparing');
        try {
          intent = await intentKey.run({ bookingId, share: request.shareCents ?? null }, (key) =>
            clutch.bookings.paymentIntent(bookingId, {
              idempotencyKey: key,
              shareCents: request.shareCents,
            }),
          );
        } catch (err) {
          // The intent step failed: the hold is KEPT (it has its own expiry)
          // so the member can try again; nothing was charged.
          setFailure(describeBookingFailure(err));
          setStage('idle');
          return;
        }
      }

      const sheet = bookingIntentToSheet(intent);
      lock(true);
      setStage('paying');

      let completedId: string;
      if (sheet.mode === 'simulated') {
        const intentId = intent.paymentIntentId;
        try {
          await simulatedKey.run({ bookingId, intentId }, (key) =>
            clutch.bookings.paySimulated(bookingId, intentId, { idempotencyKey: key }),
          );
        } catch (err) {
          setFailure(describeBookingFailure(err));
          setStage('idle');
          lock(false);
          return;
        }
        completedId = intentId;
      } else {
        let result: SheetResult;
        try {
          result = await presentSheet(sheet, {
            merchantDisplayName: optionsRef.current.merchantDisplayName,
          });
        } catch {
          result = { status: 'failed', message: 'The payment sheet could not open.' };
        }
        switch (result.status) {
          case 'completed':
            completedId = result.intentId;
            break;
          case 'canceled':
            // Closed before paying: nothing was charged and the hold is kept
            // for another try until it expires.
            setCanceled(true);
            setStage('idle');
            lock(false);
            return;
          case 'failed':
            // The sheet reports a decline or an error it showed the member.
            // Unlocking is safe: should the charge have gone through after
            // all, Clutch returns money held by a hold that is released.
            setFailure({
              action: 'retry-payment',
              title: 'Payment did not go through',
              message: result.message || 'Your payment could not be completed. Try again.',
            });
            setStage('idle');
            lock(false);
            return;
          case 'unconfigured':
            setFailure(UNCONFIGURED);
            setStage('idle');
            lock(false);
            return;
        }
      }

      if (request.settle === 'refetch') {
        invalidate(bookingId);
        setStage('submitted');
        lock(false);
        optionsRef.current.onSubmitted?.();
        return;
      }
      await confirmWith(bookingId, completedId);
    },
    [bookingId, confirmWith, intentKey, invalidate, lock, presentSheet, simulatedKey, stage],
  );

  /** Ask Clutch again whether the submitted payment settled (new key after a 4xx). */
  const checkAgain = useCallback(async () => {
    if (!bookingId || stage !== 'unconfirmed') return;
    setFailure(null);
    await confirmWith(bookingId, pendingIntent.current);
  }, [bookingId, confirmWith, stage]);

  const clearFailure = useCallback(() => {
    setFailure(null);
    setCanceled(false);
  }, []);

  return { stage, failure, canceled, pay, checkAgain, clearFailure };
}

export type BookingPayment = ReturnType<typeof useBookingPayment>;
