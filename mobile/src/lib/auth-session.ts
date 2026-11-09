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
 * - A refresh answers a token only for the member it was asked for: the
 *   client passes the token that got the 401, and a request sent as one
 *   member is never retried as another (a sign-out then a sign-in as someone
 *   else while it was in flight answers null).
 * - Expiry is kept on this device's clock (receipt time + `expires_in`), so a
 *   phone whose clock is wrong neither refreshes in a loop nor too late, and
 *   nothing refreshes again within MIN_REFRESH_INTERVAL_S of a refresh.
 * - A failed read of the stored session (the Keychain is locked while the app
 *   runs in the background) is retried on the next read, and a session found
 *   then is announced as INITIAL.
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

/** Never refresh again sooner than this after a refresh. */
export const MIN_REFRESH_INTERVAL_S = 30;

/** How many recent access tokens remember whose they were. */
const TOKEN_OWNERS_KEPT = 16;

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

/** The member a session Clutch issued belongs to (its user, else the token's `sub`). */
export function sessionUserId(session: AuthSession): string | null {
  if (session.user) return session.user.id;
  const sub = jwtClaims(session.access_token).sub;
  return typeof sub === 'string' ? sub : null;
}

/**
 * Clutch's AuthSession as the stored shape (expiry absolute on this device's
 * clock; the user named). Clutch's own `expires_at` is its clock's, so it is
 * not used.
 */
export function toStoredSession(session: AuthSession, nowSeconds: number): StoredSession {
  const claims = session.user ? {} : jwtClaims(session.access_token);
  const id = sessionUserId(session);
  if (!id) throw new Error('Clutch answered a session that names no user.');
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: nowSeconds + session.expires_in,
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
  let readFailed = false;
  let refresher: ((refreshToken: string) => Promise<AuthSession>) | null = null;
  let inFlight: Promise<void> | null = null;
  /** The refresh token the in-flight rotation spent. */
  let inFlightSpent: string | null = null;
  let lastRefreshAt: number | null = null;
  const listeners = new Set<SessionListener>();
  /** Access token -> the user it was issued to (tokens this store handed out). */
  const tokenOwners = new Map<string, string>();

  function remember(session: StoredSession): void {
    tokenOwners.set(session.access_token, session.user.id);
    while (tokenOwners.size > TOKEN_OWNERS_KEPT) {
      tokenOwners.delete(tokenOwners.keys().next().value as string);
    }
  }

  function refreshedRecently(): boolean {
    return lastRefreshAt !== null && now() - lastRefreshAt < MIN_REFRESH_INTERVAL_S;
  }

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

  /**
   * Read the stored session (once, unless the read failed: then again on the
   * next call). Resolves the session as it is now.
   */
  function load(): Promise<StoredSession | null> {
    const reading = (loading ??= storage.getItem(SESSION_STORAGE_KEY).then(
      (raw) => {
        const retried = readFailed;
        readFailed = false;
        // A sign-in that landed while storage was being read wins.
        if (current) return;
        current = parseStored(raw);
        if (current) {
          remember(current);
          // The first read failed and the app showed signed out: say so now.
          if (retried) emit('INITIAL');
        }
      },
      () => {
        readFailed = true;
        loading = null;
      },
    ));
    return reading.then(() => current);
  }

  /**
   * One rotation of the refresh token; concurrent callers share it. A rotation
   * already running for a session that has since been replaced (a sign-in, a
   * step-up) is waited out, then the current session gets its own.
   */
  async function rotate(): Promise<void> {
    if (!refresher) throw new Error('No session refresher is installed.');
    if (inFlight && inFlightSpent !== current?.refresh_token) {
      await inFlight.catch(() => undefined);
      if (!current) return;
    }
    const doRefresh = refresher;
    if (!inFlight) {
      const spent = current!.refresh_token;
      inFlightSpent = spent;
      inFlight = (async () => {
        try {
          const next = toStoredSession(await doRefresh(spent), now());
          // A sign-in replaced the session meanwhile: keep that one.
          if (current?.refresh_token !== spent) return;
          current = next;
          remember(next);
          lastRefreshAt = now();
          await persist();
          emit('REFRESHED');
        } catch (err) {
          // The session was replaced meanwhile: its token stands, whatever
          // happened to the one this rotation spent.
          if (current?.refresh_token !== spent) return;
          if (!isRefusal(err)) throw err;
          current = null;
          await persist();
          emit('SIGNED_OUT');
        }
      })().finally(() => {
        inFlight = null;
        inFlightSpent = null;
      });
    }
    await inFlight;
  }

  /** The current token if it is still `owner`'s, else null. */
  function tokenFor(owner: string): string | null {
    return current?.user.id === owner ? current.access_token : null;
  }

  /**
   * Refresh for `owner` and answer their new token, or null when the session
   * ended or now belongs to someone else. With `staleToken`, the token that
   * got the 401: when it is no longer current, the member's newer token is
   * answered without refreshing again.
   */
  async function refreshFor(owner: string, staleToken?: string): Promise<string | null> {
    if (!current || current.user.id !== owner) return null;
    if (staleToken !== undefined && current.access_token !== staleToken) return current.access_token;
    await rotate();
    return tokenFor(owner);
  }

  async function refresh(staleToken?: string): Promise<string | null> {
    await load();
    const owner = staleToken !== undefined ? (tokenOwners.get(staleToken) ?? null) : (current?.user.id ?? null);
    if (!owner) return null;
    return refreshFor(owner, staleToken);
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
      const owner = current.user.id;
      if (current.expires_at - now() > REFRESH_MARGIN_S || refreshedRecently()) return current.access_token;
      try {
        return await refreshFor(owner);
      } catch {
        // Could not refresh now: send what we have and let a 401 decide.
        return tokenFor(owner);
      }
    },
    /**
     * Refresh now. `staleToken` is the token a request was refused with: the
     * answer is that member's new token, or null (signed out, or the session
     * is someone else's now). Without it, the current member's.
     */
    refresh,
    /** Seconds until the access token should be refreshed (0 when due). */
    secondsUntilRefresh(): number | null {
      if (!current) return null;
      const due = Math.max(0, current.expires_at - now() - REFRESH_MARGIN_S);
      if (lastRefreshAt === null) return due;
      return Math.max(due, MIN_REFRESH_INTERVAL_S - (now() - lastRefreshAt));
    },
    /** Adopt a session Clutch just issued (sign-in, step-up, linking). */
    async set(session: AuthSession): Promise<StoredSession> {
      await load();
      current = toStoredSession(session, now());
      remember(current);
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
