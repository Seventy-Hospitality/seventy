/**
 * Typed access to build-time (public) configuration. Only EXPO_PUBLIC_* vars
 * are inlined into the bundle at build time; see .env.example for the list.
 *
 * The app talks to two services, both owned by Clutch:
 *  - Supabase GoTrue (EXPO_PUBLIC_SUPABASE_URL + anon key) for every auth flow,
 *    driven by supabase-js on the device;
 *  - the Clutch HTTP API (EXPO_PUBLIC_CLUTCH_API_URL, ending in /api/v1) for
 *    all data, authenticated with the Supabase access token.
 *
 * EXPO_PUBLIC_CLUB_ID binds the app to ONE Clutch club (Club 70). The startup
 * check reads GET /clubs/{id} and refuses to run against a club whose slug is
 * not EXPO_PUBLIC_CLUB_SLUG (default "770"), so a build pointed at the wrong
 * club fails loudly instead of showing another club's data.
 *
 * Optional values (OAuth client ids, Stripe key) degrade their feature when
 * absent: the buttons render a "not configured" note and load no SDK.
 */

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Supabase project URL (GoTrue lives at `${SUPABASE_URL}/auth/v1`). */
export const SUPABASE_URL = optional(process.env.EXPO_PUBLIC_SUPABASE_URL);

/** Supabase anon (publishable) key. Public by design; RLS protects data. */
export const SUPABASE_ANON_KEY = optional(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

/** Clutch API base, including the version segment (e.g. https://host/api/v1). */
export const CLUTCH_API_URL = (
  optional(process.env.EXPO_PUBLIC_CLUTCH_API_URL) ?? 'http://localhost:3000/api/v1'
).replace(/\/+$/, '');

/** The one Clutch club this app serves (Club 70 in production). */
export const CLUB_ID =
  optional(process.env.EXPO_PUBLIC_CLUB_ID) ?? '15e24f5f-ee39-4154-8ad6-06942d06cb8a';

/** The slug CLUB_ID must resolve to; checked once at startup. */
export const CLUB_SLUG = optional(process.env.EXPO_PUBLIC_CLUB_SLUG) ?? '770';

/**
 * Stripe publishable key of the CLUTCH PLATFORM account (pk_...). Club charges
 * are direct charges on the club's connected account, so the SDK is
 * re-initialised with that account id per sheet (presentConnectedSheet).
 * Null disables PaymentSheet.
 */
export const STRIPE_PUBLISHABLE_KEY = optional(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY);

/** Apple merchant identifier for Apple Pay in PaymentSheet (optional). */
export const STRIPE_MERCHANT_ID = optional(process.env.EXPO_PUBLIC_STRIPE_MERCHANT_ID);

/**
 * Google OAuth client ids of the iOS and Android apps. Each one's reversed
 * id is registered as a URL scheme by app.config.js, and each must be listed
 * as an authorized client id on the Supabase Google provider. Absent: the
 * Google button on that platform shows "not configured".
 */
export const GOOGLE_IOS_CLIENT_ID = optional(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
export const GOOGLE_ANDROID_CLIENT_ID = optional(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID);

/** The deep link GoTrue redirects auth emails to (magic link, signup, recovery). */
export const AUTH_CALLBACK_URL = 'seventy://auth/callback';
