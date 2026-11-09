/**
 * The one way the app takes a payment for a booking, whatever it pays for
 * (the booker's hold or balance, a player's share, the difference on a dearer
 * move). The specific flows (useBookingPayment.ts) say how to issue the intent
 * and how to confirm it; this hook owns everything that keeps money safe:
 *
 *   intent  issued by Clutch once per (member, booking, purpose) and kept in
 *           the payment ledger for the session: every Pay reuses it.
 *   pay     stripe:    presentConnectedSheet(intent) on the club's account.
 *           simulated: POST /bookings/{id}/payment-intent/pay (no sheet).
 *   confirm hand the COMPLETED intent id to Clutch (key.run with
 *           rerunnable: a 5xx starts a fresh ask next time). A completed sheet
 *           is never success on its own: success is what Clutch says.
 *
 * Every confirm failure ends somewhere real:
 * - pay again (payment_failed, payment_incomplete, payment_requires_action):
 *   the same intent is presented again; nothing new is issued.
 * - clearing (payment_processing, payment_not_verified): stay locked and
 *   offer only "check again".
 * - anything else (network, 5xx, timeout, a contract mismatch, an unknown
 *   code, a definite refusal): re-read the booking (GET /bookings/{id}) and
 *   let it decide: settled is success, ended is the end of this payment, and
 *   still open is "check again" (when the answer was unclear) or the refusal
 *   (when Clutch said no).
 *
 * Double taps: a ref guard is set synchronously before anything awaits, so a
 * second tap in the same frame cannot pass it; the sheet itself answers
 * `busy` if one is already up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  clutch,
  ClutchError,
  hasCode,
  useMutationKey,
  type BookingDetail,
  type BookingId,
  type SheetIntent,
  type UserId,
} from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import { usePresentConnectedSheet, type SheetResult } from '../../lib/stripe';
import { describeBookingFailure, type BookingFailure } from './booking-failures';
import type { Charge } from './charge';
import { paymentLedger, usePaymentLedger, type LedgerSlot, type PaymentPurpose } from './payment-ledger';

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
   * Money may have moved and Clutch has not confirmed it: the only way
   * forward is checkAgain(), never a second payment.
   */
  | 'unconfirmed';

/** What the fresh booking says about this payment. */
export type Verdict = 'settled' | 'open' | 'ended';

export type Settled<R> = { via: 'confirm'; result: R } | { via: 'read'; booking: BookingDetail };

export interface PreparedIntent {
  sheet: SheetIntent;
  intentId: string;
  charge: Charge;
  expiresAt?: string | null;
}

export interface PaymentFlowSpec<R> {
  bookingId: BookingId | null;
  userId: UserId | null;
  purpose: PaymentPurpose;
  variant?: string;
  /** Ask Clutch for the intent (under the flow's key). */
  createIntent: (bookingId: BookingId, idempotencyKey: string) => Promise<PreparedIntent>;
  /** Hand the completed intent to Clutch; null only for a free booking. */
  confirm: (bookingId: BookingId, intentId: string | null, idempotencyKey: string) => Promise<R>;
  /** What a freshly read booking says about this payment. */
  judge: (booking: BookingDetail) => Verdict;
  /** `charge`: what the paid intent charged (Clutch's lines); null for a free booking. */
  onSettled: (outcome: Settled<R>, charge: Charge | null) => void;
  /** The failure to show when the booking says this payment can no longer complete. */
  ended: BookingFailure;
  /** Locked from the moment money may move until Clutch has answered. */
  onLockChange?: (locked: boolean) => void;
  merchantDisplayName?: string;
}

const UNCONFIGURED: BookingFailure = {
  action: 'none',
  title: 'Card payments unavailable',
  message: 'Card payments are not set up in this build of the app.',
};

const SHEET_BUSY: BookingFailure = {
  action: 'none',
  title: 'A payment is already open',
  message: 'Finish or close the payment that is open, then try again.',
};

const CLEARING: BookingFailure = {
  action: 'check-again',
  title: 'Your payment is clearing',
  message:
    'The club has not confirmed your payment yet. Check again in a moment; you will not be charged twice.',
};

type ConfirmClass = 'pay-again' | 'clearing' | 'unclear' | 'refused';

function classify(err: unknown): ConfirmClass {
  if (!(err instanceof ClutchError)) return 'unclear';
  if (err.kind !== 'api') return 'unclear';
  switch (err.code) {
    case 'payment_failed':
    case 'payment_incomplete':
    case 'payment_requires_action':
      return 'pay-again';
    case 'payment_processing':
    case 'payment_not_verified':
    case 'request_in_flight':
      return 'clearing';
    default:
      // 5xx (internal_error, upstream_error), a timeout, a rate limit or a
      // code this build does not know: nothing Clutch said can be trusted
      // as a refusal.
      if (err.code === 'unknown' || err.status >= 500 || err.status === 408 || err.status === 429) {
        return 'unclear';
      }
      return 'refused';
  }
}

/** How a confirm attempt ended, for the caller that probes a failed sheet. */
type ConfirmEnd = 'settled' | 'pay-again' | 'stopped';

export function usePaymentFlow<R>(spec: PaymentFlowSpec<R>) {
  const queryClient = useQueryClient();
  const presentSheet = usePresentConnectedSheet();
  const intentKey = useMutationKey();
  const simulatedKey = useMutationKey();
  const confirmKey = useMutationKey();
  usePaymentLedger();

  const specRef = useRef(spec);
  specRef.current = spec;

  const [stage, setStage] = useState<PaymentStage>('idle');
  const [failure, setFailure] = useState<BookingFailure | null>(null);
  /** The member closed the sheet without paying; nothing was charged. */
  const [canceled, setCanceled] = useState(false);
  /** Set before the first await of pay / checkAgain: a second tap is ignored. */
  const busyRef = useRef(false);

  const slot: LedgerSlot | null =
    spec.bookingId && spec.userId
      ? { userId: spec.userId, bookingId: spec.bookingId, purpose: spec.purpose, variant: spec.variant }
      : null;
  const entry = slot ? paymentLedger.get(slot) : null;

  // A payment submitted elsewhere (the wizard, before the member left it) is
  // still clearing here: offer only "check again".
  const effectiveStage: PaymentStage = stage === 'idle' && entry?.state === 'submitted' ? 'unconfirmed' : stage;
  const locked = effectiveStage === 'paying' || effectiveStage === 'confirming' || effectiveStage === 'unconfirmed';

  useEffect(() => {
    specRef.current.onLockChange?.(locked);
  }, [locked]);

  const slotNow = useCallback((): LedgerSlot | null => {
    const s = specRef.current;
    return s.bookingId && s.userId
      ? { userId: s.userId, bookingId: s.bookingId, purpose: s.purpose, variant: s.variant }
      : null;
  }, []);

  const invalidate = useCallback(
    (id: BookingId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
    [queryClient],
  );

  /** GET the booking and let it decide; null when it could not be read. */
  const reread = useCallback(
    async (id: BookingId): Promise<{ verdict: Verdict; booking: BookingDetail | null } | null> => {
      try {
        const booking = await clutch.bookings.get(id);
        queryClient.setQueryData(queryKeys.booking(id), booking);
        return { verdict: specRef.current.judge(booking), booking };
      } catch (err) {
        if (hasCode(err, 'booking_not_found', 'not_found')) return { verdict: 'ended', booking: null };
        return null;
      }
    },
    [queryClient],
  );

  const settle = useCallback(
    (id: BookingId, outcome: Settled<R>) => {
      const s = slotNow();
      // What the settled payment charged, as Clutch stated it, before the
      // ledger forgets the intent.
      const charge = s ? (paymentLedger.get(s)?.charge ?? null) : null;
      if (s) paymentLedger.clear(s);
      invalidate(id);
      setFailure(null);
      setStage('idle');
      specRef.current.onSettled(outcome, charge);
    },
    [invalidate, slotNow],
  );

  const confirmWith = useCallback(
    async (id: BookingId, intentId: string | null, opts: { probe?: boolean } = {}): Promise<ConfirmEnd> => {
      setStage('confirming');
      let error: unknown;
      try {
        const result = await confirmKey.run(
          { id, purpose: specRef.current.purpose, intentId },
          (key) => specRef.current.confirm(id, intentId, key),
          { rerunnable: true },
        );
        settle(id, { via: 'confirm', result });
        return 'settled';
      } catch (err) {
        error = err;
      }

      const s = slotNow();
      const kind = classify(error);
      const described = describeBookingFailure(error, { bookingParity: clutch.capabilities.bookingParity });

      if (kind === 'pay-again' && intentId) {
        // Clutch still has this intent and it is not paid: present it again.
        if (s) paymentLedger.setState(s, 'ready');
        setStage('idle');
        if (!opts.probe) setFailure(described);
        return 'pay-again';
      }

      if (kind === 'clearing') {
        if (s && intentId) paymentLedger.setState(s, 'submitted');
        setFailure(CLEARING);
        setStage('unconfirmed');
        return 'stopped';
      }

      // Unclear or refused: the booking itself says where this payment stands.
      const read = await reread(id);
      if (read?.verdict === 'settled' && read.booking) {
        settle(id, { via: 'read', booking: read.booking });
        return 'settled';
      }
      if (read?.verdict === 'ended') {
        if (s) paymentLedger.clear(s);
        invalidate(id);
        setFailure(specRef.current.ended);
        setStage('idle');
        return 'stopped';
      }
      if (kind === 'unclear' || !read) {
        // Nothing decided, or we could not even read the booking: money may
        // have moved, so only ever ask again.
        if (s && intentId) paymentLedger.setState(s, 'submitted');
        setFailure(read ? CLEARING : described);
        setStage(intentId ? 'unconfirmed' : 'idle');
        return 'stopped';
      }
      // Clutch refused and the booking is still open: this intent is done
      // with (a mismatch, a returned payment); the next Pay starts afresh.
      if (s) paymentLedger.clear(s);
      invalidate(id);
      setFailure(described);
      setStage('idle');
      return 'stopped';
    },
    [confirmKey, invalidate, reread, settle, slotNow],
  );

  const present = useCallback(
    async (id: BookingId, prepared: PreparedIntent) => {
      const s = slotNow();
      setStage('paying');
      if (prepared.sheet.mode === 'simulated') {
        try {
          await simulatedKey.run({ id, intentId: prepared.intentId }, (key) =>
            clutch.bookings.paySimulated(id, prepared.intentId, { idempotencyKey: key }),
          );
        } catch (err) {
          setFailure(describeBookingFailure(err, { bookingParity: clutch.capabilities.bookingParity }));
          setStage('idle');
          return;
        }
        if (s) paymentLedger.setState(s, 'submitted');
        await confirmWith(id, prepared.intentId);
        return;
      }

      let result: SheetResult;
      try {
        result = await presentSheet(prepared.sheet, { merchantDisplayName: specRef.current.merchantDisplayName });
      } catch {
        result = { status: 'failed', message: 'The payment sheet could not open.' };
      }
      switch (result.status) {
        case 'completed':
          if (s) paymentLedger.setState(s, 'submitted');
          await confirmWith(id, result.intentId);
          return;
        case 'canceled':
          // Closed before paying: nothing was charged; the same intent is
          // presented on the next Pay.
          setCanceled(true);
          setStage('idle');
          return;
        case 'busy':
          setFailure(SHEET_BUSY);
          setStage('idle');
          return;
        case 'failed':
          // The sheet gave up, but a late 3-D Secure step can still settle
          // it: the next Pay asks Clutch about this intent first.
          if (s) paymentLedger.setState(s, 'sheet_failed');
          setFailure({
            action: 'retry-payment',
            title: 'Payment did not go through',
            message: result.message || 'Your payment could not be completed. Try again.',
          });
          setStage('idle');
          return;
        case 'unconfigured':
          setFailure(UNCONFIGURED);
          setStage('idle');
          return;
      }
    },
    [confirmWith, presentSheet, simulatedKey, slotNow],
  );

  /** Pay (or, for a free booking, confirm). Ignored while anything is in flight. */
  const pay = useCallback(
    async (opts: { free?: boolean } = {}) => {
      const id = specRef.current.bookingId;
      const s = slotNow();
      if (!id || !s || busyRef.current) return;
      busyRef.current = true;
      try {
        setFailure(null);
        setCanceled(false);

        if (opts.free) {
          await confirmWith(id, null);
          return;
        }

        let current = paymentLedger.get(s);
        if (current?.state === 'submitted') {
          // Money is moving for this booking: never pay again, ask again.
          await confirmWith(id, current.intentId);
          return;
        }
        if (current?.state === 'sheet_failed') {
          const end = await confirmWith(id, current.intentId, { probe: true });
          if (end !== 'pay-again') return;
          current = paymentLedger.get(s);
        }

        if (!current) {
          setStage('preparing');
          let prepared: PreparedIntent;
          try {
            prepared = await intentKey.run({ id, purpose: s.purpose, variant: s.variant ?? '' }, (key) =>
              specRef.current.createIntent(id, key),
            );
          } catch (err) {
            // The intent step failed: nothing was charged; the hold (if any)
            // is KEPT with its own expiry so the member can try again.
            setFailure(describeBookingFailure(err, { bookingParity: clutch.capabilities.bookingParity }));
            setStage('idle');
            return;
          }
          current = {
            ...s,
            variant: s.variant ?? '',
            sheet: prepared.sheet,
            intentId: prepared.intentId,
            charge: prepared.charge,
            expiresAt: prepared.expiresAt ?? null,
            state: 'ready',
          };
          paymentLedger.put(current);
        }

        await present(id, current);
      } finally {
        busyRef.current = false;
      }
    },
    [confirmWith, intentKey, present, slotNow],
  );

  /** Ask Clutch again whether the submitted payment settled (a fresh key each time). */
  const checkAgain = useCallback(async () => {
    const id = specRef.current.bookingId;
    const s = slotNow();
    if (!id || busyRef.current) return;
    busyRef.current = true;
    try {
      setFailure(null);
      const current = s ? paymentLedger.get(s) : null;
      await confirmWith(id, current?.intentId ?? null);
    } finally {
      busyRef.current = false;
    }
  }, [confirmWith, slotNow]);

  const clearFailure = useCallback(() => {
    setFailure(null);
    setCanceled(false);
  }, []);

  return {
    stage: effectiveStage,
    failure,
    canceled,
    /** What the issued intent charges, once Clutch issued one. */
    charge: entry?.charge ?? null,
    locked,
    pay,
    checkAgain,
    clearFailure,
  };
}

export type PaymentFlow = ReturnType<typeof usePaymentFlow>;
