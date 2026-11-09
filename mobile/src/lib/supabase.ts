/**
 * The one supabase-js client. It owns the session: GoTrue issues and refreshes
 * the tokens, the chunked SecureStore adapter persists them, and every Clutch
 * API call reads the current access token from here (see lib/clutch).
 *
 * - flowType 'pkce': email links (magic link, signup confirmation, password
 *   recovery) come back to seventy://auth/callback?code=..., and only this
 *   device holds the code verifier, so a link opened elsewhere (or a forged
 *   deep link) cannot complete a sign-in here.
 * - detectSessionInUrl false: there is no browser URL; the callback screen
 *   calls exchangeCodeForSession itself, with the link's `sb_flow_id`.
 * - autoRefreshToken is driven by AppState (SessionProvider starts it in the
 *   foreground and stops it in the background), as supabase-js recommends for
 *   React Native.
 *
 * The client is created lazily so a build without Supabase config still boots
 * and can show a configuration notice instead of crashing at import time.
 */
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';
import { chunkedSecureStorage } from './secure-storage';

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Sign-in is not configured for this build (EXPO_PUBLIC_SUPABASE_URL / ANON_KEY).');
    this.name = 'SupabaseNotConfiguredError';
  }
}

/**
 * Where supabase-js keeps the session (and, suffixed, the PKCE verifiers).
 * Fixed so a sign-out that cannot reach GoTrue can still forget it locally.
 */
export const AUTH_STORAGE_KEY = 'club70-auth';

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new SupabaseNotConfiguredError();
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',
      storage: chunkedSecureStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
      // Each emailed link carries `sb_flow_id`, naming the verifier its flow
      // stored, so asking for a second email does not orphan the first link.
      experimental: { appendPkceFlowIdToRedirects: true },
    },
  });
  return client;
}
