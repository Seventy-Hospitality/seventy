/**
 * What a payment will charge, exactly as Clutch stated it. The app never adds
 * a tax to a subtotal or applies a discount: each figure here is one Clutch
 * sent, and when Clutch sent a subtotal and a tax but no total, they are shown
 * as two lines, never summed.
 *
 * - quoted: a P4 booking quote (list price, discount, price, tax, total).
 * - checkout: a P4 share or move checkout (subtotal, tax, total).
 * - split: a booking payment intent on main / P2 (subtotal and tax only).
 * - unknown: nothing priced the tax yet (bookingParity off, before the
 *   intent): the court price, and the total is shown at payment.
 */
import {
  checkoutAmounts,
  type BookingCheckout,
  type BookingQuote,
  type LegacyBookingCheckout,
  type MoveCheckout,
  type ShareCheckout,
} from '../../lib/clutch';
import { formatMoney } from './booking';

export type Charge =
  | {
      kind: 'quoted';
      currency: string;
      list_price_cents: number;
      discount_amount_cents: number;
      price_cents: number;
      tax_cents: number;
      total_cents: number;
      tax_status: BookingQuote['tax_status'];
    }
  | { kind: 'checkout'; currency: string; subtotal_cents: number; tax_cents: number; total_cents: number }
  | { kind: 'split'; currency: string; subtotal_cents: number | null; tax_cents: number | null }
  | { kind: 'unknown'; currency: string; price_cents: number };

export function chargeFromQuote(quote: BookingQuote): Charge {
  return {
    kind: 'quoted',
    currency: quote.currency,
    list_price_cents: quote.list_price_cents,
    discount_amount_cents: quote.discount_amount_cents,
    price_cents: quote.price_cents,
    tax_cents: quote.tax_cents,
    total_cents: quote.total_cents,
    tax_status: quote.tax_status,
  };
}

/** A booking payment intent: Clutch states subtotal and tax, not a total. */
export function chargeFromBookingCheckout(
  checkout: BookingCheckout | LegacyBookingCheckout,
  currency: string,
): Charge {
  const { subtotal_cents, tax_cents } = checkoutAmounts(checkout);
  return { kind: 'split', currency, subtotal_cents, tax_cents };
}

export function chargeFromSnakeCheckout(checkout: ShareCheckout | MoveCheckout, currency: string): Charge {
  return {
    kind: 'checkout',
    currency: 'currency' in checkout ? checkout.currency : currency,
    subtotal_cents: checkout.subtotal_cents,
    tax_cents: checkout.tax_cents,
    total_cents: checkout.total_cents,
  };
}

export interface ChargeLine {
  label: string;
  value: string;
  /** The line that is the amount charged. */
  total?: boolean;
}

/** The order-summary lines for a charge; only Clutch's own figures. */
export function chargeLines(charge: Charge): ChargeLine[] {
  const money = (cents: number) => formatMoney(cents, charge.currency);
  switch (charge.kind) {
    case 'quoted': {
      const lines: ChargeLine[] = [];
      if (charge.discount_amount_cents > 0) {
        lines.push({ label: 'Court fee', value: money(charge.list_price_cents) });
        lines.push({ label: 'Discount', value: `-${money(charge.discount_amount_cents)}` });
      }
      lines.push({ label: 'Court price', value: money(charge.price_cents) });
      if (charge.tax_status === 'calculated' || charge.tax_cents > 0) {
        lines.push({ label: 'Tax', value: money(charge.tax_cents) });
      }
      lines.push({ label: 'Total due today', value: money(charge.total_cents), total: true });
      return lines;
    }
    case 'checkout':
      return [
        { label: 'Amount', value: money(charge.subtotal_cents) },
        { label: 'Tax', value: money(charge.tax_cents) },
        { label: 'Total due today', value: money(charge.total_cents), total: true },
      ];
    case 'split': {
      const lines: ChargeLine[] = [];
      if (charge.subtotal_cents !== null) lines.push({ label: 'Amount', value: money(charge.subtotal_cents) });
      if (charge.tax_cents !== null) lines.push({ label: 'Tax', value: money(charge.tax_cents) });
      if (lines.length === 0) lines.push({ label: 'Total', value: 'Shown at payment', total: true });
      return lines;
    }
    case 'unknown':
      return [
        { label: 'Court price', value: money(charge.price_cents) },
        { label: 'Total', value: 'Shown at payment', total: true },
      ];
  }
}

/** The one figure a Pay button may name: a total Clutch stated, else none. */
export function chargeTotal(charge: Charge | null): string | null {
  if (!charge) return null;
  if (charge.kind === 'quoted' || charge.kind === 'checkout') {
    return formatMoney(charge.total_cents, charge.currency);
  }
  return null;
}
