/**
 * Sign out everywhere in the app the same way: remove this install's push
 * registration first (best effort, while the request can still authenticate,
 * capped so a slow network never traps the member), then end the supabase-js
 * session, which clears the query cache.
 *
 * Any sign-out that does not go through this hook (SetPasswordScreen's "Sign
 * out instead", account deletion) calls unregisterPushForSignOut() itself.
 */
import { useCallback } from 'react';
import { useSession } from '../../lib/session';
import { unregisterPushForSignOut } from './usePushRegistration';

export function useSignOut(): () => Promise<void> {
  const { signOut } = useSession();
  return useCallback(async () => {
    await unregisterPushForSignOut();
    await signOut();
  }, [signOut]);
}
