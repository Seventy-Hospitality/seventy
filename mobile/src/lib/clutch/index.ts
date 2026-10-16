/**
 * The app's Clutch client instance, bound to the configured club and to the
 * supabase-js session. Feature code imports `clutch` from here; tests mock
 * this module (the client boundary) rather than fetch.
 */
import * as Crypto from 'expo-crypto';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { CLUB_ID, CLUB_SLUG, CLUTCH_API_URL } from '../env';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import { createClutchClient, type AuthPort } from './client';
import { asClubId } from './ids';

export * from './client';
export * from './contract.gen';
export * from './errors';
export * from './ids';
export { useMutationKey, type MutationKey } from './mutation-key';

/**
 * supabase-js owns the session. getSession() returns the stored session and
 * refreshes it first when it is about to expire; after a 401 we force one
 * refreshSession(). A refresh GoTrue rejects (revoked / reused refresh token)
 * makes supabase-js drop the session and emit SIGNED_OUT, which clears the
 * query cache (SessionProvider); a network failure leaves the session alone.
 */
const supabaseAuth: AuthPort = {
  async getAccessToken() {
    if (!isSupabaseConfigured()) return null;
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  },
  async refreshAccessToken() {
    const { data, error } = await getSupabase().auth.refreshSession();
    if (data.session) return data.session.access_token;
    if (error && isAuthRetryableFetchError(error)) throw error;
    return null;
  },
};

export const clutch = createClutchClient({
  baseUrl: CLUTCH_API_URL,
  clubId: asClubId(CLUB_ID),
  expectedClubSlug: CLUB_SLUG,
  auth: supabaseAuth,
  newIdempotencyKey: () => Crypto.randomUUID(),
});
