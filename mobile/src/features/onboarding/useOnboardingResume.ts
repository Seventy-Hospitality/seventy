/**
 * One resolved onboarding step for both gates (app entry and the onboarding
 * stack), read from Clutch: GET /me always, GET /me/membership only once /me
 * shows a player's membership at this club.
 */
import { useQuery } from '@tanstack/react-query';
import { clutch } from '../../lib/clutch';
import { meQuery, membershipQuery } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { needsSubscription, resolveOnboardingStep, type OnboardingStep } from './onboarding';

export type ResumePhase =
  | { phase: 'loading' }
  | { phase: 'error'; retry: () => void }
  | { phase: 'ready'; step: OnboardingStep };

export function useOnboardingResume(): ResumePhase {
  const { status } = useSession();
  const authenticated = status === 'authenticated';
  const me = useQuery({ ...meQuery, enabled: authenticated });
  const wantsSubscription = me.data ? needsSubscription(me.data, clutch.clubId) : false;
  const membership = useQuery({ ...membershipQuery, enabled: authenticated && wantsSubscription });

  // Signed out (or still restoring): nothing to resolve; callers redirect.
  if (!authenticated) return { phase: 'loading' };

  if (me.isPending) return { phase: 'loading' };
  if (me.isError) return { phase: 'error', retry: () => void me.refetch() };

  if (wantsSubscription) {
    if (membership.isPending) return { phase: 'loading' };
    if (membership.isError) return { phase: 'error', retry: () => void membership.refetch() };
  }

  const step = resolveOnboardingStep({
    me: me.data,
    clubId: clutch.clubId,
    subscription: wantsSubscription ? (membership.data?.subscription ?? null) : null,
  });
  return { phase: 'ready', step };
}
