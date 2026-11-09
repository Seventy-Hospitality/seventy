/**
 * Session provider on Clutch's /api/v1/auth routes. The app talks to Clutch
 * only: no identity-provider SDK, no key, no email links.
 *
 * What lives where:
 * - lib/auth-session.ts owns the tokens: persists them, refreshes them
 *   (single-flight, rotated) and emits SIGNED_IN / REFRESHED / SIGNED_OUT.
 * - This provider mirrors the store into React state, refreshes ahead of
 *   expiry while the app is in the foreground, and owns the app-level
 *   reactions: SIGNED_OUT (or a different user signing in) clears the
 *   react-query cache so no member's data outlives their session; a password
 *   reset (or a sign-up whose password did not save) raises
 *   `passwordRecovery`, and the root layout holds the member on
 *   /auth/set-password until a password is saved.
 * - Clutch data (profile, club membership) is NOT session state; it is
 *   react-query data read through lib/clutch.
 *
 * Every emailed step is a 6-digit code typed into the app: sign-in by email,
 * sign-up (the code confirms the address, then the chosen password is set),
 * confirming an address before a password sign-in, and password reset (a
 * code signs in, then a new password is set).
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
import * as SecureStore from 'expo-secure-store';
import { asUserId, type UserId } from './clutch/ids';
import { sessionStore, type StoredSession } from './auth-session';
import {
  appleAdapter,
  getFederatedCredential,
  googleAdapter,
  type FederatedAdapter,
} from './oauth';
import { queryClient } from './query-client';
import { clutch } from './clutch';
import { adoptSameMemberSession } from './same-member';

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

export interface OAuthConfig {
  googleConfigured: boolean;
  appleConfigured: boolean;
}

export interface SignUpInput {
  name: string;
  email: string;
}

export interface SessionContextValue {
  status: SessionStatus;
  session: StoredSession | null;
  userId: UserId | null;
  email: string | null;
  /** The member must set a password before anything else (reset, or sign-up). */
  passwordRecovery: boolean;
  oauth: OAuthConfig;

  signInWithPassword(input: { email: string; password: string }): Promise<void>;
  /** Email a 6-digit code that creates the account (an existing one just gets a code). */
  sendSignUpCode(input: SignUpInput): Promise<void>;
  /** Confirm the sign-up code, then set the chosen password. */
  confirmSignUp(input: { email: string; code: string; password: string }): Promise<void>;
  /** Email a 6-digit sign-in code (creates the account if new). */
  sendEmailSignIn(email: string): Promise<void>;
  /** Sign in with an emailed code (also confirms an unconfirmed address). */
  verifyEmailCode(email: string, code: string): Promise<void>;
  /** Email a code to an existing account only (confirming it, or stepping up). */
  sendExistingAccountCode(email: string): Promise<void>;
  /**
   * Confirm the signed-in member again with an emailed code (a step-up). The
   * fresh session is adopted only when it is the same member's; otherwise it
   * is ended on Clutch and WrongAccountError (lib/same-member.ts) is thrown.
   */
  reconfirmWithCode(email: string, code: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signInWithApple(): Promise<void>;
  /** Email a reset code (same answer whether or not the address has an account). */
  requestPasswordReset(email: string): Promise<void>;
  /** Sign in with the reset code; the member is then held until a new password is set. */
  verifyRecoveryCode(email: string, code: string): Promise<void>;
  /** Set a new password (ends recovery). */
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** How long sign-out waits for Clutch before forgetting the session anyway. */
export const SIGN_OUT_SERVER_TIMEOUT_MS = 4000;

/**
 * Recovery mode outlives an app kill: the session is persisted, so without
 * this flag a restart would drop the member straight into the app with no
 * new password set. Keyed by user id.
 */
const RECOVERY_KEY = 'club70.passwordRecovery';

async function rememberRecovery(userId: string | null): Promise<void> {
  try {
    if (userId) await SecureStore.setItemAsync(RECOVERY_KEY, userId);
    else await SecureStore.deleteItemAsync(RECOVERY_KEY);
  } catch {
    // Best effort: the in-memory flag still holds for this run.
  }
}

async function recoveryPendingFor(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(RECOVERY_KEY)) === userId;
  } catch {
    return false;
  }
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<StoredSession | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const lastUserId = useRef<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Mirror the store into state; clear cached data on sign-out or when a
  // different user signs in.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = sessionStore.subscribe((event, next) => {
      const nextUserId = next?.user.id ?? null;
      if (event === 'SIGNED_OUT' || (nextUserId && lastUserId.current && nextUserId !== lastUserId.current)) {
        queryClient.clear();
      }
      lastUserId.current = nextUserId;
      if (event === 'SIGNED_OUT') {
        setPasswordRecovery(false);
        void rememberRecovery(null);
      }
      if (event === 'INITIAL' && next) {
        // The first read failed and the session turned up later: hold a
        // pending password recovery before the app shows as signed in.
        void recoveryPendingFor(next.user.id).then((pending) => {
          if (cancelled) return;
          if (pending && sessionStore.current()?.user.id === next.user.id) setPasswordRecovery(true);
          const now = sessionStore.current();
          setSession(now);
          setStatus(now ? 'authenticated' : 'anonymous');
          setRefreshTick((t) => t + 1);
        });
        return;
      }
      setSession(next);
      setStatus(next ? 'authenticated' : 'anonymous');
      setRefreshTick((t) => t + 1);
    });
    void sessionStore.load().then(async (initial) => {
      if (cancelled) return;
      const userId = initial?.user.id ?? null;
      if (userId && (await recoveryPendingFor(userId)) && !cancelled) setPasswordRecovery(true);
      if (cancelled) return;
      // A sign-in may have landed while storage was read: the store is current.
      const now = sessionStore.current();
      lastUserId.current = now?.user.id ?? null;
      setSession(now);
      setStatus(now ? 'authenticated' : 'anonymous');
      setRefreshTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // A launch in the background (a data push on a locked iPhone) may not read
  // the Keychain: read it again when the app comes to the foreground. The
  // store announces a session it finds then as INITIAL.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sessionStore.load();
    });
    return () => sub?.remove();
  }, []);

  // Refresh ahead of expiry, only while the app is in the foreground.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (AppState.currentState !== 'active') return;
      const wait = sessionStore.secondsUntilRefresh();
      if (wait === null) return;
      timer = setTimeout(() => {
        // Failures keep the session (offline); the next foreground retries.
        sessionStore.refresh().catch(() => undefined);
      }, wait * 1000);
    };
    schedule();
    const sub = AppState.addEventListener('change', schedule);
    return () => {
      sub?.remove();
      if (timer) clearTimeout(timer);
    };
  }, [refreshTick]);

  const signInWithFederated = useCallback(async (adapter: FederatedAdapter) => {
    const credential = await getFederatedCredential(adapter);
    await sessionStore.set(
      await clutch.auth.idToken({ provider: credential.provider, id_token: credential.token, nonce: credential.nonce }),
    );
    // Apple shares the name only on the first authorization: put it on the
    // Clutch profile (which Clutch created empty). The sign-in already
    // succeeded; failing to save the name must not undo it (onboarding asks
    // for a name whenever the profile has none).
    const name = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) await Promise.allSettled([clutch.me.updateProfile({ full_name: name })]);
  }, []);

  const enterRecovery = useCallback(async () => {
    const userId = sessionStore.current()?.user.id ?? null;
    setPasswordRecovery(true);
    await rememberRecovery(userId);
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    return {
      status,
      session,
      userId: session ? asUserId(session.user.id) : null,
      email: session?.user.email ?? null,
      passwordRecovery,
      oauth: {
        googleConfigured: googleAdapter.isConfigured(),
        appleConfigured: appleAdapter.isConfigured(),
      },

      async signInWithPassword({ email, password }) {
        await sessionStore.set(await clutch.auth.token(email.trim(), password));
      },
      async sendSignUpCode({ name, email }) {
        await clutch.auth.sendCode({ email: email.trim(), create_user: true, full_name: name.trim() || null });
      },
      async confirmSignUp({ email, code, password }) {
        await sessionStore.set(await clutch.auth.verifyCode(email.trim(), code.trim()));
        try {
          await clutch.auth.setPassword(password);
        } catch {
          // Signed in, but the password did not save: ask for it again
          // before anything else rather than leave an account without one.
          await enterRecovery();
        }
      },
      async sendEmailSignIn(email) {
        await clutch.auth.sendCode({ email: email.trim(), create_user: true });
      },
      async verifyEmailCode(email, code) {
        await sessionStore.set(await clutch.auth.verifyCode(email.trim(), code.trim()));
      },
      async sendExistingAccountCode(email) {
        await clutch.auth.sendCode({ email: email.trim(), create_user: false });
      },
      async reconfirmWithCode(email, code) {
        const expected = sessionStore.current()?.user.id ?? null;
        await adoptSameMemberSession(expected, await clutch.auth.verifyCode(email.trim(), code.trim()));
      },
      signInWithGoogle: () => signInWithFederated(googleAdapter),
      signInWithApple: () => signInWithFederated(appleAdapter),
      async requestPasswordReset(email) {
        await clutch.auth.sendCode({ email: email.trim(), create_user: false });
      },
      async verifyRecoveryCode(email, code) {
        await sessionStore.set(await clutch.auth.verifyCode(email.trim(), code.trim()));
        await enterRecovery();
      },
      async updatePassword(password) {
        await clutch.auth.setPassword(password);
        setPasswordRecovery(false);
        await rememberRecovery(null);
      },
      async signOut() {
        // End the session on Clutch when it answers in time; forget it here
        // regardless (an expired token offline must still sign out).
        if (sessionStore.current()) {
          await within(
            clutch.auth.signOut('local').catch(() => undefined),
            SIGN_OUT_SERVER_TIMEOUT_MS,
          );
        }
        await rememberRecovery(null);
        await sessionStore.clear();
        setPasswordRecovery(false);
      },
    };
  }, [status, session, passwordRecovery, signInWithFederated, enterRecovery]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
