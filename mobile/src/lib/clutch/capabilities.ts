/**
 * Which Clutch server capabilities this build may use. ONE map: flip an entry
 * when its branch is deployed to the Clutch the app talks to (and regenerate
 * the contract when its routes reach clutch/openapi.json).
 *
 * An action whose capability is off is not called at all: the screen shows
 * an honest "not available yet" (FeatureUnavailable) instead of a contract
 * error or a dead end. `clutch.*` refuses with ClutchUnavailableError if a
 * gated call slips through.
 *
 * Today (2026-10-16) every branch is pushed but none is deployed to the
 * Clutch the app talks to. P1 and P5 are on (their routes are final and
 * small); P2 and P4 stay off until they are merged behind P3's contract
 * (see MERGE-ORDER: P4 then P3 then P2) and the contract is regenerated,
 * because their payment fields are still being renamed.
 */
export const CAPABILITIES = {
  /** P1 feat/expo-push: POST/DELETE /me/devices with the install's device_secret. */
  pushDevices: true,
  /** P5 feat/account-deletion-and-checkin: GET /me/account/deletion, DELETE /me/account. */
  accountDeletion: true,
  /** P5: GET /me/checkin-token (signed member QR). */
  checkinToken: true,
  /**
   * P2 feat/native-payments: subscribe / confirm / change / cancel / resume,
   * the billing view of GET /me/membership, setup intent + save by
   * setup_intent_id, booking checkout with the customer and ephemeral key.
   */
  nativePayments: false,
  /**
   * P4 feat/member-booking-parity: quote, booking rules per court type,
   * accept/decline, removing a player, member player search, reschedule
   * quote/payment, players paying their share, and releasing a hold only
   * while it is still pending (POST /bookings/{id}/release).
   */
  bookingParity: false,
} as const;

export type Capability = keyof typeof CAPABILITIES;

export type Capabilities = Record<Capability, boolean>;

/** Which Clutch branch each capability waits on, for "not available yet" copy and logs. */
export const CAPABILITY_SOURCE: Record<Capability, string> = {
  pushDevices: 'feat/expo-push',
  accountDeletion: 'feat/account-deletion-and-checkin',
  checkinToken: 'feat/account-deletion-and-checkin',
  nativePayments: 'feat/native-payments',
  bookingParity: 'feat/member-booking-parity',
};

export class ClutchUnavailableError extends Error {
  constructor(readonly capability: Capability) {
    super(`This needs ${CAPABILITY_SOURCE[capability]} on Clutch, which is not available yet.`);
    this.name = 'ClutchUnavailableError';
  }
}
