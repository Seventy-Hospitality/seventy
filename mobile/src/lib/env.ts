/**
 * Typed access to build-time (public) configuration. Only EXPO_PUBLIC_* vars
 * are inlined into the bundle at build time; see .env.example for the list.
 *
 * The app talks to ONE service: the Clutch HTTP API (EXPO_PUBLIC_CLUTCH_API_URL,
 * ending in /api/v1), for sign-in (/auth/*) and all data. Clutch's identity
 * provider and its keys stay behind that API; so does the Stripe publishable
 * key, which arrives with each payment intent.
 *
 * EXPO_PUBLIC_CLUB_ID binds the app to ONE Clutch club (Club 70). The startup
 * check reads GET /clubs/{id} and refuses to run against a club whose slug is
 * not EXPO_PUBLIC_CLUB_SLUG (default "770"), so a build pointed at the wrong
 * club fails loudly instead of showing another club's data.
 *
 * Optional values (OAuth client ids) degrade their feature when absent: the
 * buttons render a "not configured" note and load no SDK.
 */

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Clutch API base, including the version segment (e.g. https://host/api/v1). */
export const CLUTCH_API_URL = (
  optional(process.env.EXPO_PUBLIC_CLUTCH_API_URL) ?? 'http://localhost:3000/api/v1'
).replace(/\/+$/, '');

/** The one Clutch club this app serves (Club 70 in production). */
export const CLUB_ID =
  optional(process.env.EXPO_PUBLIC_CLUB_ID) ?? '15e24f5f-ee39-4154-8ad6-06942d06cb8a';

/** The slug CLUB_ID must resolve to; checked once at startup. */
export const CLUB_SLUG = optional(process.env.EXPO_PUBLIC_CLUB_SLUG) ?? '770';

/** Apple merchant identifier for Apple Pay in PaymentSheet (optional). */
export const STRIPE_MERCHANT_ID = optional(process.env.EXPO_PUBLIC_STRIPE_MERCHANT_ID);

/**
 * Google OAuth client ids of the iOS and Android apps. Each one's reversed
 * id is registered as a URL scheme by app.config.js, and each must be an
 * authorized client id of Clutch's Google sign-in provider. Absent: the
 * Google button on that platform shows "not configured".
 */
export const GOOGLE_IOS_CLIENT_ID = optional(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
export const GOOGLE_ANDROID_CLIENT_ID = optional(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID);
