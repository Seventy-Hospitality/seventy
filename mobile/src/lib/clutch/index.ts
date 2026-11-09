/**
 * The app's Clutch client instance, bound to the configured club and to the
 * member's session (lib/auth-session.ts). Feature code imports `clutch` from
 * here; tests mock this module (the client boundary) rather than fetch.
 */
import * as Crypto from 'expo-crypto';
import { CLUB_ID, CLUB_SLUG, CLUTCH_API_URL } from '../env';
import { sessionStore } from '../auth-session';
import { createClutchClient, type AuthPort } from './client';
import { asClubId } from './ids';

export * from './client';
export * from './contract.gen';
export * from './contract.pending';
export * from './capabilities';
export * from './membership-view';
export * from './errors';
export * from './ids';
export { createMutationKey, useMutationKey, type MutationKey } from './mutation-key';

/**
 * The session store owns the tokens: getAccessToken() refreshes first when
 * the token is about to expire, and after a 401 the client forces one
 * refresh(staleToken) for the member the request was sent as. A refresh
 * Clutch refuses ends the session (SIGNED_OUT clears the query cache in
 * SessionProvider); a network failure keeps it and throws.
 */
const sessionAuth: AuthPort = {
  getAccessToken: () => sessionStore.getAccessToken(),
  refreshAccessToken: (staleToken) => sessionStore.refresh(staleToken),
};

export const clutch = createClutchClient({
  baseUrl: CLUTCH_API_URL,
  clubId: asClubId(CLUB_ID),
  expectedClubSlug: CLUB_SLUG,
  auth: sessionAuth,
  newIdempotencyKey: () => Crypto.randomUUID(),
});

sessionStore.setRefresher((refreshToken) => clutch.auth.refresh(refreshToken));
