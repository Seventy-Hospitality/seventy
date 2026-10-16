/**
 * The onboarding gate. Applies the resolved step (useOnboardingResume) in
 * both directions:
 *
 * - OnboardingEntry is the signed-in landing (app/index.tsx): a member who
 *   is done goes to the tabs, anyone else into their step.
 * - OnboardingLayoutGate wraps the /onboarding/* stack: a done member is sent
 *   out, and a step cannot be skipped.
 *
 * 'name', 'join' and 'lapsed' render in place (no route): naming and joining
 * are one action each, and a lapsed membership must never redirect-loop.
 */
import { useEffect, useRef } from 'react';
import { Redirect, Stack, usePathname, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clutch, entitlement, useMutationKey, type MembershipView } from '../../lib/clutch';
import { meQuery, membershipQuery, queryKeys } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { profileErrorMessage } from '../account/account-lib';
import { useSignOut } from '../account/useSignOut';
import {
  canRenewInApp,
  canVisitOnboardingPath,
  lapsedReason,
  membershipAt,
  onboardingPathForStep,
  type Me,
  type OnboardingStep,
} from './onboarding';
import { useOnboardingResume } from './useOnboardingResume';
import { GateError, GateLoading, LapsedMembershipScreen, NameForm } from './components/GateStates';

/** app/index.tsx (signed in): route to the tabs or the resume step. */
export function OnboardingEntry() {
  const resume = useOnboardingResume();
  const signOut = useSignOut();

  if (resume.phase === 'loading') return <GateLoading />;
  if (resume.phase === 'error') return <GateError onRetry={resume.retry} onSignOut={signOut} />;
  return <StepOutlet step={resume.step} view={resume.view} />;
}

/** app/onboarding/_layout.tsx: gate + render the onboarding stack. */
export function OnboardingLayoutGate() {
  const { status } = useSession();
  const pathname = usePathname();
  const resume = useOnboardingResume();
  const signOut = useSignOut();

  if (status === 'anonymous') return <Redirect href="/auth/sign-in" />;
  if (resume.phase === 'loading') return <GateLoading label="Loading your session" />;
  if (resume.phase === 'error') return <GateError onRetry={resume.retry} onSignOut={signOut} />;

  const { step, view } = resume;
  const renewInApp = view !== null && canRenewInApp(view, clutch.capabilities.nativePayments);
  if (canVisitOnboardingPath(step, pathname, { renewInApp })) {
    return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />;
  }
  return <StepOutlet step={step} view={view} />;
}

function StepOutlet({ step, view }: { step: OnboardingStep; view: MembershipView | null }) {
  switch (step) {
    case 'name':
      return <NameStep />;
    case 'join':
      return <JoinClubStep />;
    case 'lapsed':
      return view ? <LapsedStep view={view} /> : <JoinClubStep />;
    case 'plan':
    case 'checkout':
    case 'done': {
      const path = onboardingPathForStep(step);
      return path ? <Redirect href={path as never} /> : null;
    }
  }
}

/** PATCH /me/profile {full_name}, then re-read /me (the gate re-resolves from it). */
function NameStep() {
  const queryClient = useQueryClient();
  const key = useMutationKey();
  const signOut = useSignOut();

  const save = useMutation({
    mutationFn: async (fullName: string) => {
      const input = { full_name: fullName };
      await key.run(input, (k) => clutch.me.updateProfile(input, { idempotencyKey: k }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    },
  });

  return (
    <NameForm
      saving={save.isPending}
      error={save.isError ? profileErrorMessage(save.error) : null}
      onSave={(fullName) => save.mutate(fullName)}
      onSignOut={signOut}
    />
  );
}

/**
 * Joins the club once, then re-reads GET /me and GET /me/membership. The join
 * answer is never taken as proof of membership. If the re-reads still show no
 * membership, that is an error with a retry (and sign-out), never the tier
 * step, and never a second automatic join (no loop).
 */
function JoinClubStep() {
  const queryClient = useQueryClient();
  const key = useMutationKey();
  const signOut = useSignOut();

  const join = useMutation({
    mutationFn: async () => {
      await key.run('join', (k) => clutch.club.join({ idempotencyKey: k }));
      // Refetch into the shared cache: the gate re-resolves from these reads.
      const me: Me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
      if (membershipAt(me, clutch.clubId) === null) return false;
      const view = await queryClient.fetchQuery({ ...membershipQuery, staleTime: 0 });
      return entitlement(view) !== 'no_membership';
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

function LapsedStep({ view }: { view: MembershipView }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useSignOut();
  const paymentsAvailable = clutch.capabilities.nativePayments;
  const renew = canRenewInApp(view, paymentsAvailable) ? () => router.push('/onboarding/plan') : null;

  return (
    <LapsedMembershipScreen
      reason={lapsedReason(view)}
      renew={renew}
      paymentsAvailable={paymentsAvailable}
      onRefresh={() =>
        Promise.all([
          queryClient.refetchQueries({ queryKey: queryKeys.me, exact: true }),
          queryClient.refetchQueries({ queryKey: queryKeys.membership, exact: true }),
        ])
      }
      onSignOut={signOut}
    />
  );
}
