/**
 * The payments this app session has started, per booking: one PaymentIntent
 * per (member, booking, purpose) for the life of the session, so a second tap,
 * a second screen or a second visit reuses the intent instead of opening a
 * new one (two intents for one due is how a member gets charged twice).
 *
 * Each entry also says where its money stands:
 * - ready: issued, nothing submitted (or the sheet was closed): Pay presents
 *   this same intent again.
 * - submitted: the sheet completed (or the simulated checkout was paid) and
 *   Clutch has not confirmed it yet: money may be moving. No screen offers
 *   Pay for it; only "check again", and nothing releases the hold.
 * - sheet_failed: the sheet reported a failure. Card networks can still
 *   settle such a payment late (a 3-D Secure step finishing after the sheet
 *   gave up), so the next Pay first asks Clutch about this intent before
 *   presenting anything, and nothing releases the hold meanwhile.
 *
 * In memory only: a new app session starts from what Clutch says.
 */
import { useSyncExternalStore } from 'react';
import type { BookingId, SheetIntent, UserId } from '../../lib/clutch';
import type { Charge } from './charge';

export type PaymentPurpose = 'booking' | 'share' | 'move';
export type LedgerState = 'ready' | 'submitted' | 'sheet_failed';

export interface LedgerEntry {
  userId: UserId;
  bookingId: BookingId;
  purpose: PaymentPurpose;
  /** Tells intents of one purpose apart (a move's target, a booker's share). */
  variant: string;
  sheet: SheetIntent;
  intentId: string;
  charge: Charge;
  /** A move order's expiry: past it the intent is not reused. */
  expiresAt: string | null;
  state: LedgerState;
}

export interface LedgerSlot {
  userId: UserId;
  bookingId: BookingId;
  purpose: PaymentPurpose;
  variant?: string;
}

const entries = new Map<string, LedgerEntry>();
const listeners = new Set<() => void>();
let version = 0;

function slotKey(slot: LedgerSlot): string {
  return `${slot.userId}|${slot.bookingId}|${slot.purpose}|${slot.variant ?? ''}`;
}

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

export const paymentLedger = {
  get(slot: LedgerSlot): LedgerEntry | null {
    const entry = entries.get(slotKey(slot));
    if (!entry) return null;
    if (entry.state === 'ready' && entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
      // An expired move order: nothing was paid on it, a new one is needed.
      entries.delete(slotKey(slot));
      return null;
    }
    return entry;
  },

  put(entry: LedgerEntry): void {
    entries.set(slotKey(entry), entry);
    changed();
  },

  setState(slot: LedgerSlot, state: LedgerState): void {
    const entry = entries.get(slotKey(slot));
    if (!entry || entry.state === state) return;
    entries.set(slotKey(slot), { ...entry, state });
    changed();
  },

  clear(slot: LedgerSlot): void {
    if (entries.delete(slotKey(slot))) changed();
  },

  /** Forget every intent for a booking (it was released or is gone). */
  clearBooking(userId: UserId, bookingId: BookingId): void {
    let any = false;
    for (const [key, entry] of entries) {
      if (entry.userId === userId && entry.bookingId === bookingId) {
        entries.delete(key);
        any = true;
      }
    }
    if (any) changed();
  },

  /**
   * Whether money may be moving for this booking: a submitted payment Clutch
   * has not confirmed, or a sheet that failed and was not asked about since.
   */
  inFlight(userId: UserId | null, bookingId: BookingId): boolean {
    if (!userId) return false;
    for (const entry of entries.values()) {
      if (entry.userId !== userId || entry.bookingId !== bookingId) continue;
      if (entry.state === 'submitted' || entry.state === 'sheet_failed') return true;
    }
    return false;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  version(): number {
    return version;
  },

  /** Tests only. */
  resetForTests(): void {
    entries.clear();
    changed();
  },
};

/** Re-render when the ledger changes (another screen submitted or settled a payment). */
export function usePaymentLedger(): number {
  return useSyncExternalStore(paymentLedger.subscribe, paymentLedger.version, paymentLedger.version);
}
