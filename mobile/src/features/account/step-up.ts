/**
 * Step-up for account deletion: a FRESH sign-in, by the member's own method,
 * made just before DELETE /me/account (PENDING P5), which requires a recent
 * GoTrue sign-in and answers 403 step_up_required otherwise.
 *
 * Methods come from the account's GoTrue identities: an email identity can
 * step up with its password or with an emailed 6-digit code (never creating
 * an account); a linked Google or Apple identity with that provider.
 *
 * Every step-up must land on the SAME user: a federated sign-in with a
 * provider account linked to a different login would switch the session to
 * that other account, and deleting it would delete the wrong person.
 */
import type { UserIdentity } from '@supabase/supabase-js';
import { federatedAdapters, getFederatedCredential, type OAuthProvider } from '../../lib/oauth';
import { getSupabase } from '../../lib/supabase';

export type StepUpMethod =
  | { kind: 'password' }
  | { kind: 'code' }
  | { kind: 'federated'; provider: OAuthProvider };

export function stepUpMethods(identities: Pick<UserIdentity, 'provider'>[]): StepUpMethod[] {
  const methods: StepUpMethod[] = [];
  if (identities.some((i) => i.provider === 'email')) {
    methods.push({ kind: 'password' }, { kind: 'code' });
  }
  for (const provider of ['google', 'apple'] as const) {
    if (identities.some((i) => i.provider === provider)) methods.push({ kind: 'federated', provider });
  }
  return methods;
}

/** The step-up landed on another account; nothing was deleted. */
export class StepUpWrongAccountError extends Error {
  constructor() {
    super('That sign-in belongs to a different account.');
    this.name = 'StepUpWrongAccountError';
  }
}

function sameUser(expectedUserId: string, actual: string | undefined): void {
  if (actual !== expectedUserId) throw new StepUpWrongAccountError();
}

export async function stepUpWithPassword(expectedUserId: string, email: string, password: string): Promise<void> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  sameUser(expectedUserId, data.user?.id);
}

/** Email a 6-digit code to an existing account (never creates one). */
export async function sendStepUpCode(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw error;
}

export async function stepUpWithCode(expectedUserId: string, email: string, code: string): Promise<void> {
  const { data, error } = await getSupabase().auth.verifyOtp({ email, token: code.trim(), type: 'email' });
  if (error) throw error;
  sameUser(expectedUserId, data.user?.id);
}

export async function stepUpWithProvider(expectedUserId: string, provider: OAuthProvider): Promise<void> {
  const credential = await getFederatedCredential(federatedAdapters[provider]);
  const { data, error } = await getSupabase().auth.signInWithIdToken({
    provider: credential.provider,
    token: credential.token,
    nonce: credential.nonce,
  });
  if (error) throw error;
  sameUser(expectedUserId, data.user?.id);
}
