/**
 * Pure presentation helpers for the account surface, over Clutch's own
 * shapes. Formatting only: every amount is a number Clutch sent (a tier's
 * price_cents, a payment's amount_cents and refunded_amount_cents); nothing
 * here adds, nets or prorates money. Error copy branches on ClutchError.code.
 */
import {
  DeletionBlockersSchema,
  isClutchError,
  type DeletionBlockers,
  type PaymentHistoryItem,
  type Profile,
  type SavedPaymentMethod,
  type MySubscription,
} from '../../lib/clutch';
import { formatCentsExact } from '../onboarding/tier-format';

export {
  formatCents,
  formatCentsExact,
  intervalNoun,
  intervalSuffix,
} from '../onboarding/tier-format';

// ── Identity ──

/** The name to show: full name, else @username, else the email's local part. */
export function profileDisplayName(profile: Pick<Profile, 'full_name' | 'username' | 'email'>): string {
  const name = profile.full_name?.trim();
  if (name) return name;
  if (profile.username) return `@${profile.username}`;
  const local = profile.email?.split('@')[0];
  return local || 'Member';
}

/** Clutch's username rule (updateProfile): 3 to 20 of a-z, 0-9, underscore. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '');
}

// ── Dates and cards ──

/** "Mar 12, 2027" in the club's timezone (the device's while the club loads). */
export function instantDateLabel(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
  });
}

/** "09/27" from exp month + year. */
export function cardExpiryLabel(expMonth: number, expYear: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(expMonth)}/${pad(expYear % 100)}`;
}

/** "Visa •••• 4242 · exp 09/27", or the bank account for ACH. */
export function paymentMethodLabel(pm: SavedPaymentMethod): string {
  if (pm.card_last4) {
    const brand = pm.card_brand ? `${pm.card_brand.charAt(0).toUpperCase()}${pm.card_brand.slice(1)} ` : '';
    const expiry =
      pm.card_exp_month !== null && pm.card_exp_year !== null
        ? ` · exp ${cardExpiryLabel(pm.card_exp_month, pm.card_exp_year)}`
        : '';
    return `${brand}•••• ${pm.card_last4}${expiry}`;
  }
  if (pm.bank_last4) return `${pm.bank_name ?? 'Bank account'} •••• ${pm.bank_last4}`;
  return pm.type;
}

// ── Membership ──

/** The forward-looking line under the tier on the membership card. */
export function subscriptionStatusLine(sub: MySubscription, timezone?: string): string {
  const periodEnd = sub.current_period_end ? instantDateLabel(sub.current_period_end, timezone) : null;
  switch (sub.subscription_status ?? null) {
    case 'past_due':
    case 'unpaid':
      return 'Payment past due';
    case 'incomplete':
      return 'Payment incomplete';
    case 'incomplete_expired':
      return 'Payment expired';
    case 'paused':
      return 'Paused';
    case 'canceled':
      return periodEnd ? `Ended ${periodEnd}` : 'Ended';
    default:
      break;
  }
  if (sub.cancel_at_period_end) return periodEnd ? `Ends ${periodEnd}` : 'Ends at the end of this period';
  if (sub.pending_tier_name) {
    const when = sub.pending_effective_at
      ? instantDateLabel(sub.pending_effective_at, timezone)
      : periodEnd;
    return when ? `Switches to ${sub.pending_tier_name} on ${when}` : `Switches to ${sub.pending_tier_name}`;
  }
  if (sub.subscription_status === 'trialing') return periodEnd ? `Trial ends ${periodEnd}` : 'Trial';
  return periodEnd ? `Renews ${periodEnd}` : 'Active';
}

/** Whether Clutch would bill this subscription again (P2 billing state; main: yes). */
function isLive(sub: MySubscription): boolean {
  const status = sub.subscription_status ?? null;
  return status === null || status === 'active' || status === 'trialing';
}

/** Offer "change tier" (Clutch's eligible list and its answer decide the rest). */
export function canChangeTier(sub: MySubscription | null): boolean {
  return sub !== null && isLive(sub) && !sub.cancel_at_period_end;
}

/** Offer "cancel": anything not already over, so a member is never trapped. */
export function canCancel(sub: MySubscription | null): boolean {
  if (!sub) return false;
  const status = sub.subscription_status ?? null;
  return status !== 'canceled' && status !== 'incomplete_expired';
}

/** Offer "resume": a cancellation is scheduled and the period has not ended. */
export function canResume(sub: MySubscription | null): boolean {
  return sub !== null && sub.cancel_at_period_end === true && isLive(sub);
}

// ── Payment history ──

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  booking: 'Court booking',
  booking_share: 'Court booking (your share)',
  membership: 'Membership',
  package: 'Package',
  tournament: 'Tournament',
  academy: 'Academy',
  league: 'League',
  refund: 'Refund',
  pos: 'Pro shop',
  club_account: 'Club account',
  custom: 'Payment',
};

export function paymentTitle(item: PaymentHistoryItem): string {
  return item.description?.trim() || PAYMENT_TYPE_LABELS[item.payment_type] || 'Payment';
}

const PAYMENT_STATUS_LABELS: Record<string, string | null> = {
  succeeded: null,
  pending: 'Pending',
  processing: 'Processing',
  failed: 'Failed',
  refunded: 'Refunded',
};

export function paymentStatusLabel(status: string): string | null {
  return status in PAYMENT_STATUS_LABELS ? PAYMENT_STATUS_LABELS[status] : status.replace(/_/g, ' ');
}

/** The charged amount as Clutch recorded it. */
export function paymentAmountLabel(item: PaymentHistoryItem): string {
  return formatCentsExact(item.amount_cents, item.currency);
}

/** "Refunded $12.00" when Clutch recorded a refund against this payment. */
export function refundLabel(item: PaymentHistoryItem): string | null {
  const refunded = item.refunded_amount_cents ?? 0;
  return refunded > 0 ? `Refunded ${formatCentsExact(refunded, item.currency)}` : null;
}

// ── Errors ──

/** A refusal Clutch explained (4xx prose) or a generic line. Display only. */
export function clutchErrorMessage(err: unknown, fallback: string): string {
  if (!isClutchError(err)) return fallback;
  if (err.kind === 'network') return 'We could not reach Club70. Check your connection and try again.';
  if (err.code === 'rate_limit_exceeded') return 'Too many attempts. Wait a minute and try again.';
  if (err.kind === 'api' && err.status < 500 && err.message) return err.message;
  return fallback;
}

export function profileErrorMessage(err: unknown): string {
  if (isClutchError(err)) {
    switch (err.code) {
      case 'username_taken':
        return 'That username is taken. Try another.';
      case 'invalid_username':
        return 'Usernames are 3 to 20 letters, numbers or underscores.';
      case 'name_required':
        return 'Enter your name.';
      case 'field_too_long':
      case 'name_too_long':
        return 'That is too long.';
      default:
        break;
    }
  }
  return clutchErrorMessage(err, 'We could not save your profile. Please try again.');
}

export function avatarErrorMessage(err: unknown): string {
  if (isClutchError(err)) {
    switch (err.code) {
      case 'unsupported_image_type':
        return 'Profile photos must be JPG, PNG, WebP or GIF.';
      case 'file_too_large':
        return 'Profile photos must be 5 MB or smaller.';
      default:
        break;
    }
  }
  return clutchErrorMessage(err, 'We could not update your photo. Please try again.');
}

/** The blockers in a 409 account_deletion_blocked's details, or null when malformed. */
export function deletionBlockersFrom(details: Record<string, unknown> | undefined): DeletionBlockers | null {
  const parsed = DeletionBlockersSchema.safeParse(details);
  return parsed.success ? parsed.data : null;
}

export function hasDeletionBlockers(blockers: DeletionBlockers): boolean {
  return blockers.owned_clubs.length > 0 || blockers.managed_children.length > 0;
}

/** Each blocker as a plain sentence saying what to do about it. */
export function blockerSentences(blockers: DeletionBlockers): string[] {
  return [
    ...blockers.owned_clubs.map(
      (club) => `You own ${club.club_name}. Hand the club to another owner before deleting your account.`,
    ),
    ...blockers.managed_children.map(
      (child) =>
        `You are the only guardian of ${child.name}. Add another guardian or close their profile first.`,
    ),
  ];
}

// ── Tier changes ──

/**
 * Whether Clutch's subscription now shows the tier the member switched to.
 * Read after confirm; until it does, the switch is still settling (or waiting
 * on the payment), and the screen says so instead of claiming success.
 */
export function tierChangeApplied(
  sub: MySubscription | null,
  target: { id: string; name: string },
): boolean {
  if (!sub) return false;
  return sub.tier_id ? sub.tier_id === target.id : sub.tier_name === target.name;
}
