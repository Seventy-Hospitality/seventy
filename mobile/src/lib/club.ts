/**
 * The one Clutch club this app serves, read once and shared.
 *
 * clubQuery runs the startup check (club.verify(): GET /clubs/{CLUB_ID} must
 * have the expected slug) and caches the club row: timezone, currency, courts,
 * opening hours and booking rules every booking screen reads.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import { clutch, ClubMismatchError, ClutchError } from './clutch';

export const clubQuery = queryOptions({
  queryKey: ['club'],
  queryFn: () => clutch.club.verify(),
  staleTime: 10 * 60_000,
});

export function useClub() {
  return useQuery(clubQuery);
}

/** A misconfigured build (wrong id, or an id Clutch does not know): never retry. */
export function isFatalClubError(err: unknown): boolean {
  return (
    err instanceof ClubMismatchError ||
    (err instanceof ClutchError && err.code === 'club_not_found')
  );
}
