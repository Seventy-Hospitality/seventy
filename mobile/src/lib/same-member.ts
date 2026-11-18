/**
 * Adopting a fresh sign-in only when it is the member already signed in.
 *
 * Step-ups (account deletion, and a fresh code on the set-password screen)
 * sign in again just before a sensitive call. Clutch answers the new session
 * first, and the app adopts it only when it names the same member (its user,
 * else the token's subject, as the session store reads it). A session that
 * belongs to another account is never adopted: it is best-effort signed out on
 * Clutch with its own token, so no stray session is left running, and the
 * caller gets a WrongAccountError.
 */
import { clutch, type AuthSession } from './clutch';
import { sessionStore, sessionUserId } from './auth-session';

/** The fresh sign-in landed on another account; it was not adopted. */
export class WrongAccountError extends Error {
  constructor() {
    super('That sign-in belongs to a different account.');
    this.name = 'WrongAccountError';
  }
}

/** Adopt `session` only when it is `expectedUserId`'s; otherwise end it and throw. */
export async function adoptSameMemberSession(expectedUserId: string | null, session: AuthSession): Promise<void> {
  if (!expectedUserId || sessionUserId(session) !== expectedUserId) {
    // Not adopted; end it on Clutch so it does not linger (best effort).
    await clutch.auth.signOut('local', { accessToken: session.access_token }).catch(() => undefined);
    throw new WrongAccountError();
  }
  await sessionStore.set(session);
}
