/**
 * Session provider on Supabase GoTrue (supabase-js owns the session).
 *
 * What lives where:
 * - supabase-js persists the session in the chunked SecureStore adapter,
 *   refreshes it (auto refresh runs while the app is in the foreground:
 *   AppState start/stopAutoRefresh), and emits auth events.
 * - This provider mirrors those events into React state and owns the
 *   app-level reactions: SIGNED_OUT (or a different user signing in) clears
 *   the react-query cache so no member's data outlives their session;
 *   PASSWORD_RECOVERY raises `passwordRecovery` so the app asks for a new
 *   password before anything else.
 * - Clutch data (profile, club membership) is NOT session state; it is
 *   react-query data read through lib/clutch.
 *
 * Email links (magic link, signup confirmation, password reset) are PKCE:
 * they land on seventy://auth/callback?code=... and completeAuthRedirect
 * exchanges the code with the verifier only this device holds. Every email
 * also carries a 6-digit code (verifyEmailCode / verifyRecoveryCode) for when
 * the link opens on another device. The app never calls Clutch's
 * /api/v1/auth/* proxy.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { AUTH_CALLBACK_URL } from './env';
import { asUserId, type UserId } from './clutch/ids';
import {
  appleAdapter,
  getFederatedCredential,
  googleAdapter,
  type FederatedAdapter,
} from './oauth';
import { queryClient } from './query-client';
import { getSupabase, isSupabaseConfigured } from './supabase';

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

export interface OAuthConfig {
  googleConfigured: boolean;
  appleConfigured: boolean;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

export interface SessionContextValue {
  status: SessionStatus;
  session: Session | null;
  user: User | null;
  userId: UserId | null;
  email: string | null;
  /** A recovery link/code signed the user in: they must set a new password. */
  passwordRecovery: boolean;
  /** Supabase env is present; false shows a configuration notice. */
  configured: boolean;
  oauth: OAuthConfig;

  signInWithPassword(input: { email: string; password: string }): Promise<void>;
  /** `confirmationRequired`: GoTrue sent a confirmation email; no session yet. */
  signUpWithPassword(input: SignUpInput): Promise<{ confirmationRequired: boolean }>;
  /** Email a sign-in link plus a 6-digit code (creates the account if new). */
  sendEmailSignIn(email: string): Promise<void>;
  /** Complete an emailed sign-in or signup confirmation with its 6-digit code. */
  verifyEmailCode(email: string, code: string): Promise<void>;
  resendSignupConfirmation(email: string): Promise<void>;
  /** The deep-link callback: exchange the PKCE code (or surface the error). */
  completeAuthRedirect(params: { code?: string; error?: string; errorDescription?: string }): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signInWithApple(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** Complete a password reset with the emailed code (enters recovery). */
  verifyRecoveryCode(email: string, code: string): Promise<void>;
  /** Set a new password (ends recovery). */
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Thrown by the auth-callback exchange when GoTrue redirected with an error. */
export class AuthRedirectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthRedirectError';
  }
}

function raise(error: unknown): void {
  if (error) throw error;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [status, setStatus] = useState<SessionStatus>(configured ? 'loading' : 'anonymous');
  const [session, setSession] = useState<Session | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const lastUserId = useRef<string | null>(null);

  // Mirror supabase-js auth events into state; clear cached data on sign-out
  // or when a different user signs in.
  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabase();
    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, next: Session | null) => {
      const nextUserId = next?.user.id ?? null;
      if (event === 'SIGNED_OUT' || (nextUserId && lastUserId.current && nextUserId !== lastUserId.current)) {
        queryClient.clear();
      }
      lastUserId.current = nextUserId;
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setPasswordRecovery(false);
      setSession(next);
      setStatus(next ? 'authenticated' : 'anonymous');
    });
    return () => data.subscription.unsubscribe();
  }, [configured]);

  // Refresh tokens only while the app is in the foreground.
  useEffect(() => {
    if (!configured) return;
    const auth = getSupabase().auth;
    if (AppState.currentState === 'active') void auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void auth.startAutoRefresh();
      else void auth.stopAutoRefresh();
    });
    return () => {
      sub?.remove();
      void auth.stopAutoRefresh();
    };
  }, [configured]);

  const signInWithFederated = useCallback(async (adapter: FederatedAdapter) => {
    const credential = await getFederatedCredential(adapter);
    const auth = getSupabase().auth;
    const { error } = await auth.signInWithIdToken({
      provider: credential.provider,
      token: credential.token,
      nonce: credential.nonce,
    });
    raise(error);
    // Apple shares the name only on the first authorization; keep it.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ');
    if (name) await auth.updateUser({ data: { full_name: name } });
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const auth = () => getSupabase().auth;
    const user = session?.user ?? null;
    return {
      status,
      session,
      user,
      userId: user ? asUserId(user.id) : null,
      email: user?.email ?? null,
      passwordRecovery,
      configured,
      oauth: {
        googleConfigured: googleAdapter.isConfigured(),
        appleConfigured: appleAdapter.isConfigured(),
      },

      async signInWithPassword({ email, password }) {
        const { error } = await auth().signInWithPassword({ email: email.trim(), password });
        raise(error);
      },
      async signUpWithPassword({ name, email, password }) {
        const { data, error } = await auth().signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: AUTH_CALLBACK_URL, data: { full_name: name.trim() } },
        });
        raise(error);
        return { confirmationRequired: !data.session };
      },
      async sendEmailSignIn(email) {
        const { error } = await auth().signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: AUTH_CALLBACK_URL, shouldCreateUser: true },
        });
        raise(error);
      },
      async verifyEmailCode(email, code) {
        const { error } = await auth().verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
        raise(error);
      },
      async resendSignupConfirmation(email) {
        const { error } = await auth().resend({
          type: 'signup',
          email: email.trim(),
          options: { emailRedirectTo: AUTH_CALLBACK_URL },
        });
        raise(error);
      },
      async completeAuthRedirect({ code, error, errorDescription }) {
        if (error) throw new AuthRedirectError(error, errorDescription ?? error.replace(/_/g, ' '));
        if (!code) throw new AuthRedirectError('missing_code', 'This sign-in link is incomplete.');
        const result = await auth().exchangeCodeForSession(code);
        raise(result.error);
      },
      signInWithGoogle: () => signInWithFederated(googleAdapter),
      signInWithApple: () => signInWithFederated(appleAdapter),
      async requestPasswordReset(email) {
        const { error } = await auth().resetPasswordForEmail(email.trim(), {
          redirectTo: AUTH_CALLBACK_URL,
        });
        raise(error);
      },
      async verifyRecoveryCode(email, code) {
        const { error } = await auth().verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: 'recovery',
        });
        raise(error);
      },
      async updatePassword(password) {
        const { error } = await auth().updateUser({ password });
        raise(error);
        setPasswordRecovery(false);
      },
      async signOut() {
        // Removes the local session even when the revoke call fails offline;
        // SIGNED_OUT then clears the query cache.
        await auth().signOut({ scope: 'local' });
      },
    };
  }, [status, session, passwordRecovery, configured, signInWithFederated]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
