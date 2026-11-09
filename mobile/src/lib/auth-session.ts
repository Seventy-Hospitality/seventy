/**
 * The member's session: tokens Clutch's /api/v1/auth routes issue, kept on
 * this device and refreshed through POST /auth/refresh. Nothing else in the
 * app holds a token; the Clutch client reads it through `getAccessToken()`.
 *
 * - Persisted as one JSON value in the chunked SecureStore adapter, under a
 *   fixed key, so a sign-out that cannot reach Clutch still forgets it.
 * - `getAccessToken()` refreshes first when the token expires within
 *   REFRESH_MARGIN_S; the Clutch client also forces one `refresh()` after a
 *   401. Refreshes are single-flight: refresh tokens rotate, and two
 *   concurrent refreshes with the same token would burn it.
 * - A refresh Clutch refuses (4xx: revoked, reused or expired refresh token)
 *   ends the session: the store clears and emits SIGNED_OUT. A refresh that
 *   could not be attempted (no network, 5xx, rate limit) throws and keeps the
 *   session for the next try.
 * - A session replaced while a refresh was in flight (a sign-in, a step-up)
 *   is never overwritten or cleared by that stale refresh.
 */
import type { AuthSession } from './clutch/contract.gen';
import { ClutchError } from './clutch/errors';
import { chunkedSecureStorage } from './secure-storage';

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at: number;
  user: { id: string; email: string | null };
}

export type SessionEvent = 'INITIAL' | 'SIGNED_IN' | 'REFRESHED' | 'SIGNED_OUT';
export type SessionListener = (event: SessionEvent, session: StoredSession | null) => void;

/** Where the session is persisted. */
export const SESSION_STORAGE_KEY = 'club70-session';

/** Refresh when the access token has less than this left. */
export const REFRESH_MARGIN_S = 60;

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Decode a JWT payload (base64url JSON) without verifying it: only to name the user. */
function jwtClaims(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) return {};
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(globalThis.atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Clutch's AuthSession as the stored shape (expiry absolute; the user named). */
export function toStoredSession(session: AuthSession, nowSeconds: number): StoredSession {
  const claims = session.user ? {} : jwtClaims(session.access_token);
  const id = session.user?.id ?? (typeof claims.sub === 'string' ? claims.sub : null);
  if (!id) throw new Error('Clutch answered a session that names no user.');
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? nowSeconds + session.expires_in,
    user: {
      id,
      email: session.user ? session.user.email : typeof claims.email === 'string' ? claims.email : null,
    },
  };
}

function parseStored(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof value.access_token === 'string' &&
      typeof value.refresh_token === 'string' &&
      typeof value.expires_at === 'number' &&
      value.user &&
      typeof value.user.id === 'string'
    ) {
      return value as StoredSession;
    }
  } catch {
    // A corrupt value reads as signed out.
  }
  return null;
}

/** A refresh Clutch answered and refused: the refresh token is spent. */
function isRefusal(err: unknown): boolean {
  return err instanceof ClutchError && err.kind === 'api' && err.status >= 400 && err.status < 500 && err.status !== 429;
}

export function createSessionStore(deps: {
  storage?: Storage;
  now?: () => number;
} = {}) {
  const storage = deps.storage ?? chunkedSecureStorage;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  let current: StoredSession | null = null;
  let loading: Promise<void> | null = null;
  let refresher: ((refreshToken: string) => Promise<AuthSession>) | null = null;
  let inFlight: Promise<string | null> | null = null;
  const listeners = new Set<SessionListener>();

  function emit(event: SessionEvent): void {
    for (const listener of listeners) listener(event, current);
  }

  async function persist(): Promise<void> {
    try {
      if (current) await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(current));
      else await storage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // The in-memory session still holds for this run.
    }
  }

  /** Read the stored session once; resolves the session as it is now. */
  function load(): Promise<StoredSession | null> {
    loading ??= storage
      .getItem(SESSION_STORAGE_KEY)
      .catch(() => null)
      .then((raw) => {
        // A sign-in that landed while storage was being read wins.
        current ??= parseStored(raw);
      });
    return loading.then(() => current);
  }

  async function refresh(): Promise<string | null> {
    await load();
    if (!current) return null;
    if (!refresher) throw new Error('No session refresher is installed.');
    const doRefresh = refresher;
    inFlight ??= (async () => {
      const spent = current!.refresh_token;
      try {
        const next = toStoredSession(await doRefresh(spent), now());
        // A sign-in replaced the session meanwhile: keep that one.
        if (current?.refresh_token !== spent) return current?.access_token ?? null;
        current = next;
        await persist();
        emit('REFRESHED');
        return current.access_token;
      } catch (err) {
        if (!isRefusal(err)) throw err;
        if (current?.refresh_token === spent) {
          current = null;
          await persist();
          emit('SIGNED_OUT');
        }
        return current?.access_token ?? null;
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    load,
    /** The installed refresh call (lib/clutch/index.ts wires clutch.auth.refresh). */
    setRefresher(fn: (refreshToken: string) => Promise<AuthSession>): void {
      refresher = fn;
    },
    current: (): StoredSession | null => current,
    async getAccessToken(): Promise<string | null> {
      await load();
      if (!current) return null;
      if (current.expires_at - now() > REFRESH_MARGIN_S) return current.access_token;
      try {
        return await refresh();
      } catch {
        // Could not refresh now: send what we have and let a 401 decide.
        return current?.access_token ?? null;
      }
    },
    refresh,
    /** Seconds until the access token should be refreshed (0 when due). */
    secondsUntilRefresh(): number | null {
      if (!current) return null;
      return Math.max(0, current.expires_at - now() - REFRESH_MARGIN_S);
    },
    /** Adopt a session Clutch just issued (sign-in, step-up, linking). */
    async set(session: AuthSession): Promise<StoredSession> {
      await load();
      current = toStoredSession(session, now());
      await persist();
      emit('SIGNED_IN');
      return current;
    },
    /** Forget the session on this device (never asks Clutch). */
    async clear(): Promise<void> {
      await load();
      const had = current !== null;
      current = null;
      await persist();
      if (had) emit('SIGNED_OUT');
    },
    subscribe(listener: SessionListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;

/** The app's one session. */
export const sessionStore = createSessionStore();
