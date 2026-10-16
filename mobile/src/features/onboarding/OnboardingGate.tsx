/**
 * The onboarding gate. Applies the resolved step (useOnboardingResume) in
 * both directions:
 *
 * - OnboardingEntry is the signed-in landing (app/index.tsx): a member who
 *   is done goes to the tabs, anyone else into their step.
 * - OnboardingLayoutGate wraps the /onboarding/* stack: a done member is sent
 *   out, and a step cannot be skipped.
 *
 * 'join' and 'inactive' render in place (no route): joining is automatic,
 * and an inactive standing is support UI that must never redirect-loop.
 */
import { useEffect, useRef } from 'react';
import { Redirect, Stack, usePathname } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clutch, useMutationKey } from '../../lib/clutch';
import { meQuery } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { useSignOut } from '../account/useSignOut';
import {
  canVisitOnboardingPath,
  membershipAt,
  onboardingPathForStep,
  type OnboardingStep,
} from './onboarding';
import { useOnboardingResume } from './useOnboardingResume';
import { GateError, GateLoading, InactiveMembershipScreen } from './components/GateStates';

/** app/index.tsx (signed in): route to the tabs or the resume step. */
export function OnboardingEntry() {
  const resume = useOnboardingResume();

  if (resume.phase === 'loading') return <GateLoading />;
  if (resume.phase === 'error') return <GateError onRetry={resume.retry} />;
  return <StepOutlet step={resume.step} />;
}

/** app/onboarding/_layout.tsx: gate + render the onboarding stack. */
export function OnboardingLayoutGate() {
  const { status } = useSession();
  const pathname = usePathname();
  const resume = useOnboardingResume();

  if (status === 'anonymous') return <Redirect href="/auth/sign-in" />;
  if (resume.phase === 'loading') return <GateLoading label="Loading your session" />;
  if (resume.phase === 'error') return <GateError onRetry={resume.retry} />;

  const { step } = resume;
  if ((step === 'plan' || step === 'checkout') && canVisitOnboardingPath(step, pathname)) {
    return (
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
    );
  }
  return <StepOutlet step={step} />;
}

function StepOutlet({ step }: { step: OnboardingStep }) {
  switch (step) {
    case 'join':
      return <JoinClubStep />;
    case 'inactive':
      return <InactiveStep />;
    case 'plan':
    case 'checkout':
    case 'done': {
      const path = onboardingPathForStep(step);
      return path ? <Redirect href={path as never} /> : null;
    }
  }
}

/**
 * Joins the club once, then re-reads GET /me. The join answer is never taken
 * as proof of membership (on main it says joined:false for an existing row, a
 * suspended row and a swallowed insert error alike). If /me still lists no
 * membership after joining, that is an error with a retry, never the tier
 * step: until Clutch P3, /me turns a failed sub-read into [].
 */
function JoinClubStep() {
  const queryClient = useQueryClient();
  const key = useMutationKey();
  const signOut = useSignOut();

  const join = useMutation({
    mutationFn: async () => {
      await key.run('join', (k) => clutch.club.join({ idempotencyKey: k }));
      // Refetch into the shared cache: the gate re-resolves from this read.
      const me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
      return membershipAt(me, clutch.clubId) !== null;
    },
  });

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    join.mutate();
  }, [join]);

  if (join.isError || join.data === false) {
    return (
      <GateError
        title="We could not set up your membership"
        body="Your account is ready, but Club70 has not added you as a member yet. Try again in a moment."
        retrying={join.isPending}
        onRetry={() => join.mutate()}
        onSignOut={signOut}
      />
    );
  }
  return <GateLoading label="Setting up your membership" />;
}

function InactiveStep() {
  const me = useQuery(meQuery);
  const signOut = useSignOut();
  const status = me.data ? (membershipAt(me.data, clutch.clubId)?.status ?? null) : null;
  return <InactiveMembershipScreen status={status} onRefresh={() => me.refetch()} onSignOut={signOut} />;
}
