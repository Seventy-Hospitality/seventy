/**
 * Formatting and grouping for Clutch's membership tiers. Formatting only:
 * every amount shown is a tier's own `price_cents` (or another number Clutch
 * sent) in its own currency. The app never derives a price (no per-month
 * equivalent of a yearly tier, no "total due" of its own making).
 */
import type { BillingInterval, MembershipTier } from '../../lib/clutch';

const INTERVAL_ORDER: readonly BillingInterval[] = ['monthly', 'quarterly', 'yearly'];

export const INTERVAL_LABELS: Record<BillingInterval, string> = {
  monthly: 'Pay monthly',
  quarterly: 'Pay quarterly',
  yearly: 'Pay yearly',
};

const INTERVAL_NOUNS: Record<BillingInterval, string> = {
  monthly: 'month',
  quarterly: 'quarter',
  yearly: 'year',
};

function isBillingInterval(value: string): value is BillingInterval {
  return (INTERVAL_ORDER as readonly string[]).includes(value);
}

/** "month" / "quarter" / "year"; an interval the app does not know is shown as sent. */
export function intervalNoun(interval: string): string {
  return isBillingInterval(interval) ? INTERVAL_NOUNS[interval] : interval;
}

/** "/ month" next to a headline price. */
export function intervalSuffix(interval: string): string {
  return `/ ${intervalNoun(interval)}`;
}

/** "Billed monthly." under a headline price. */
export function billingCadence(interval: string): string {
  return isBillingInterval(interval) ? `Billed ${interval}.` : `Billed every ${interval}.`;
}

/** "$99" for whole units, "$52.50" otherwise, in the tier's currency. */
export function formatCents(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Always two decimals ("$99.00"), for receipts and summaries. */
export function formatCentsExact(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** Billing intervals the club offers, in calendar order. Clutch lists only tiers on offer. */
export function intervalsOffered(tiers: MembershipTier[]): BillingInterval[] {
  const present = new Set(tiers.map((tier) => tier.interval));
  return INTERVAL_ORDER.filter((interval) => present.has(interval));
}

/** The toggle's starting position: yearly when offered (the Figma default). */
export function defaultInterval(tiers: MembershipTier[]): BillingInterval {
  const offered = intervalsOffered(tiers);
  return offered.includes('yearly') ? 'yearly' : (offered[0] ?? 'monthly');
}

/** Tiers billed at `interval`, in the club's own order. */
export function tiersForInterval(tiers: MembershipTier[], interval: BillingInterval): MembershipTier[] {
  return tiers.filter((tier) => tier.interval === interval).sort((a, b) => a.sort_order - b.sort_order);
}

/** What the tier gives, in Clutch's own numbers (booking window, booking discount). */
export function benefitLines(tier: Pick<MembershipTier, 'advance_booking_days' | 'discount_percent'>): string[] {
  const lines: string[] = [];
  if (tier.advance_booking_days > 0) {
    const days = tier.advance_booking_days === 1 ? '1 day' : `${tier.advance_booking_days} days`;
    lines.push(`Book courts up to ${days} ahead`);
  }
  if (tier.discount_percent > 0) lines.push(`${tier.discount_percent}% off court bookings`);
  return lines;
}
