/**
 * Sign out everywhere in the app the same way: remove this install's push
 * registration first (best effort, while the request can still authenticate,
 * and capped so a slow network never traps the member), then end the
 * supabase-js session, which clears the query cache.
 */
import { useCallback } from 'react';
import { useMutationKey } from '../../lib/clutch';
import { useSession } from '../../lib/session';
import { unregisterThisDevice } from './usePushRegistration';

const UNREGISTER_BUDGET_MS = 4_000;

export function useSignOut(): () => Promise<void> {
  const { signOut } = useSession();
  const key = useMutationKey();
  return useCallback(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      key.run('unregister-on-sign-out', (k) => unregisterThisDevice(k)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, UNREGISTER_BUDGET_MS);
      }),
    ]);
    clearTimeout(timer);
    await signOut();
  }, [signOut, key]);
}
