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
  type MembershipView,
  type MyMembershipBilling,
  type Payment,
  type Profile,
  type SavedCard,
  type TierId,
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
  // Clutch sends '' for "no name" and for "no email".
  const name = profile.full_name.trim();
  if (name) return name;
  if (profile.username) return `@${profile.username}`;
  const local = profile.email.split('@')[0];
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
export function paymentMethodLabel(pm: SavedCard): string {
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

/**
 * What the account screens show about the member's plan, from either shape
 * of GET /me/membership. Display only: access is decided by entitlement().
 */
export interface PlanSummary {
  tierId: TierId | null;
  name: string;
  /** Clutch's price per interval; null when Clutch sent no price (a tier without a subscription). */
  price: { cents: number; currency: string; interval: string } | null;
  statusLine: string;
}

export function planSummary(view: MembershipView, timezone?: string): PlanSummary | null {
  if (view.kind === 'billing') {
    const { tier } = view.data;
    if (!tier) return null;
    return {
      tierId: tier.id,
      name: tier.name,
      price: { cents: tier.price_cents, currency: tier.currency, interval: tier.interval },
      statusLine: billingStatusLine(view.data, timezone),
    };
  }
  const { membership, subscription } = view.data;
  if (subscription) {
    return {
      tierId: membership?.tier?.id ?? null,
      name: subscription.tier_name,
      price: { cents: subscription.price_cents, currency: subscription.currency, interval: subscription.interval },
      statusLine: standingStatusLine(subscription.status, subscription.current_period_end, timezone),
    };
  }
  if (membership?.tier) {
    return {
      tierId: membership.tier.id,
      name: membership.tier.name,
      price: null,
      statusLine: standingStatusLine(membership.status, null, timezone),
    };
  }
  return null;
}

const STANDING_LABELS: Record<string, string> = {
  inactive: 'Membership inactive',
  suspended: 'Membership suspended',
  expired: 'Membership expired',
};

function standingStatusLine(status: string, periodEnd: string | null, timezone?: string): string {
  if (status !== 'active') return STANDING_LABELS[status] ?? `Membership ${status.replace(/_/g, ' ')}`;
  return periodEnd ? `Renews ${instantDateLabel(periodEnd, timezone)}` : 'Active';
}

/** The forward-looking line under the tier (P2 billing view). */
export function billingStatusLine(data: MyMembershipBilling, timezone?: string): string {
  const { billing, membership } = data;
  if (membership && membership.status !== 'active') return standingStatusLine(membership.status, null, timezone);
  const periodEnd = billing.current_period_end ? instantDateLabel(billing.current_period_end, timezone) : null;
  switch (billing.subscription_status) {
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
    case 'trialing':
    case 'active':
    case null:
      break;
  }
  if (billing.cancel_at_period_end) return periodEnd ? `Ends ${periodEnd}` : 'Ends at the end of this period';
  if (billing.pending_tier) {
    const at = billing.pending_tier_effective_at;
    const when = at ? instantDateLabel(at, timezone) : periodEnd;
    return when ? `Switches to ${billing.pending_tier.name} on ${when}` : `Switches to ${billing.pending_tier.name}`;
  }
  if (billing.subscription_status === 'trialing') return periodEnd ? `Trial ends ${periodEnd}` : 'Trial';
  return periodEnd ? `Renews ${periodEnd}` : 'Active';
}

/** Whether Stripe will bill this subscription again. */
function isLive(data: MyMembershipBilling): boolean {
  const status = data.billing.subscription_status;
  return data.billing.has_subscription && (status === 'active' || status === 'trialing');
}

/** Offer "change tier" (Clutch's eligible list and its answer decide the rest). */
export function canChangeTier(data: MyMembershipBilling): boolean {
  return data.membership?.status === 'active' && isLive(data) && !data.billing.cancel_at_period_end;
}

/** Offer "cancel": anything not already over or ending, so a member is never trapped. */
export function canCancel(data: MyMembershipBilling): boolean {
  const status = data.billing.subscription_status;
  return (
    data.billing.has_subscription &&
    status !== 'canceled' &&
    status !== 'incomplete_expired' &&
    !data.billing.cancel_at_period_end
  );
}

/** Offer "resume": a cancellation is scheduled and the period has not ended. */
export function canResume(data: MyMembershipBilling): boolean {
  return data.billing.cancel_at_period_end && isLive(data);
}

/** Offer "keep my tier": a downgrade is booked (POST change with the current tier cancels it). */
export function canCancelDowngrade(data: MyMembershipBilling): boolean {
  return data.billing.pending_tier !== null && data.tier !== null;
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

export function paymentTitle(item: Payment): string {
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
export function paymentAmountLabel(item: Payment): string {
  return formatCentsExact(item.amount_cents, item.currency);
}

/** "Refunded $12.00" when Clutch recorded a refund against this payment. */
export function refundLabel(item: Payment): string | null {
  const refunded = item.refunded_amount_cents;
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

/** A P2 membership or card refusal, in words the member can act on. */
export function billingErrorMessage(err: unknown, fallback: string): string {
  if (isClutchError(err)) {
    switch (err.code) {
      case 'already_on_tier':
        return 'You are already on that membership.';
      case 'tier_interval_mismatch':
        return 'You can only switch to a membership billed on the same schedule as yours.';
      case 'subscription_ending':
        return 'Your membership is set to end. Resume it first, then switch.';
      case 'not_cancelling':
        return 'Your membership is not set to end, so there is nothing to resume.';
      case 'no_active_subscription':
        return 'You have no active membership subscription to change.';
      case 'membership_not_active':
        return 'Your club membership is on hold. Contact the club front desk.';
      case 'membership_unconfirmed':
        return 'The club has not confirmed your membership yet. Contact the club front desk.';
      case 'already_subscribed':
        return 'You already have a membership subscription.';
      case 'setup_incomplete':
        return 'Your card was not confirmed yet. Try again in a moment.';
      case 'card_in_use_by_subscription':
        return 'This card pays your membership. Add another card and make it the default first.';
      case 'card_not_found':
      case 'payment_method_not_found':
        return 'That card is no longer on file.';
      default:
        break;
    }
  }
  return clutchErrorMessage(err, fallback);
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
 * Whether Clutch's membership now shows the tier the member switched to.
 * Read after confirm; until it does, the switch is still settling (or waiting
 * on the payment), and the screen says so instead of claiming success.
 */
export function tierChangeApplied(view: MembershipView | null, targetId: TierId): boolean {
  if (!view || view.kind !== 'billing') return false;
  return view.data.tier?.id === targetId;
}
