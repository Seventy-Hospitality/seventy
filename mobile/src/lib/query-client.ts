import { AppState } from 'react-native';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { ClutchError } from './clutch/errors';

// React Native has no window focus: the app counts as focused while it is in
// the foreground, so coming back to it refetches stale queries.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (status) => handleFocus(status === 'active'));
  return () => sub.remove();
});

/**
 * Shared react-query client:
 * - queries retry once, but never on a 4xx or a contract mismatch (neither
 *   heals on retry);
 * - 30s staleTime keeps tab-switching cheap without going stale;
 * - returning to the app (AppState `active`) refetches the mounted queries
 *   that are stale; fresh ones are left alone.
 *
 * Features read and write server state only through this client and the
 * typed `clutch` client (lib/clutch); no ad hoc fetch in components.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ClutchError) {
          if (error.kind === 'contract') return false;
          if (error.kind === 'api' && error.status < 500) return false;
        }
        return failureCount < 1;
      },
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});
