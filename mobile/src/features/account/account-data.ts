/**
 * Account-private reads and the one invalidation every billing action ends
 * with. Shared Clutch reads (me, membership, tiers, payment methods,
 * preferences, payments, check-in token) use the keys in lib/queries.ts.
 */
import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type { UserIdentity } from '@supabase/supabase-js';
import { clutch } from '../../lib/clutch';
import { membershipQuery, queryKeys } from '../../lib/queries';
import { getSupabase } from '../../lib/supabase';

/** Sign-in identities straight from Supabase GoTrue (email, google, apple). */
export const identitiesQuery = queryOptions({
  queryKey: ['account', 'identities'] as const,
  queryFn: async (): Promise<UserIdentity[]> => {
    const { data, error } = await getSupabase().auth.getUserIdentities();
    if (error) throw error;
    return data.identities;
  },
  staleTime: 30_000,
});

export const PAYMENTS_PAGE_SIZE = 20;

/** GET /me/payments at this club, paged by offset under the shared payments key. */
export const paymentsInfiniteQuery = infiniteQueryOptions({
  queryKey: queryKeys.payments,
  initialPageParam: 0,
  queryFn: ({ pageParam }) => clutch.me.payments({ limit: PAYMENTS_PAGE_SIZE, offset: pageParam }),
  getNextPageParam: (last, pages) => {
    const loaded = pages.reduce((n, page) => n + page.items.length, 0);
    return loaded < last.count && last.items.length > 0 ? loaded : undefined;
  },
});

/**
 * After any membership or payment action: re-read Clutch's state. Billing
 * never infers what an action did; the screens show this re-read.
 * Resolves once GET /me/membership has been read again.
 */
export async function refreshMembershipState(queryClient: QueryClient): Promise<void> {
  for (const queryKey of [
    queryKeys.me,
    queryKeys.home,
    queryKeys.tiers,
    queryKeys.eligibleTierChanges,
    queryKeys.paymentMethods,
    queryKeys.payments,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  await queryClient.invalidateQueries({ queryKey: membershipQuery.queryKey, exact: true });
}
