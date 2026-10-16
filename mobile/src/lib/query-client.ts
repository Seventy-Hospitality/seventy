import { QueryClient } from '@tanstack/react-query';
import { ClutchError } from './clutch/errors';

/**
 * Shared react-query client:
 * - queries retry once, but never on a 4xx or a contract mismatch (neither
 *   heals on retry);
 * - 30s staleTime keeps tab-switching cheap without going stale;
 * - no refetch-on-focus by default; opt in per query where freshness matters.
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
      refetchOnWindowFocus: false,
    },
  },
});
