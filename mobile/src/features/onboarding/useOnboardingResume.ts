/**
 * One resolved onboarding step for both gates (app entry and the onboarding
 * stack), read from Clutch: GET /me always, GET /me/membership once /me shows
 * a named profile with a membership at this club.
 */
import { useQuery } from '@tanstack/react-query';
import { clutch, type MembershipView } from '../../lib/clutch';
import { meQuery, membershipQuery } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { needsMembershipView, resolveOnboardingStep, type OnboardingStep } from './onboarding';

export type ResumePhase =
  | { phase: 'loading' }
  | { phase: 'error'; retry: () => void }
  | { phase: 'ready'; step: OnboardingStep; view: MembershipView | null };

export function useOnboardingResume(): ResumePhase {
  const { status } = useSession();
  const authenticated = status === 'authenticated';
  const me = useQuery({ ...meQuery, enabled: authenticated });
  const wantsView = me.data ? needsMembershipView(me.data, clutch.clubId) : false;
  const membership = useQuery({ ...membershipQuery, enabled: authenticated && wantsView });

  // Signed out (or still restoring): nothing to resolve; callers redirect.
  if (!authenticated) return { phase: 'loading' };

  if (me.isPending) return { phase: 'loading' };
  if (me.isError) return { phase: 'error', retry: () => void me.refetch() };

  if (wantsView) {
    if (membership.isPending) return { phase: 'loading' };
    if (membership.isError) return { phase: 'error', retry: () => void membership.refetch() };
  }

  const view = wantsView ? membership.data ?? null : null;
  const step = resolveOnboardingStep({ me: me.data, clubId: clutch.clubId, view });
  return { phase: 'ready', step, view };
}
