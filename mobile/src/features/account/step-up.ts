/**
 * Step-up for account deletion: a FRESH sign-in, by the member's own method,
 * made just before DELETE /me/account, which requires a recent sign-in and
 * answers 403 step_up_required otherwise.
 *
 * Methods come from the account's identities (GET /me/identities): an
 * email identity can step up with its password or with an emailed 6-digit
 * code (never creating an account); a linked Google or Apple identity with
 * that provider.
 *
 * Every step-up must land on the SAME user. Clutch answers the fresh session
 * first and the app adopts it only when it names the member who is signed
 * in: a sign-in that belongs to another account is dropped, so the session
 * (and what DELETE /me/account would delete) never switches person.
 */
import type { AuthSession } from '../../lib/clutch';
import { clutch } from '../../lib/clutch';
import { sessionStore } from '../../lib/auth-session';
import { federatedAdapters, getFederatedCredential, type OAuthProvider } from '../../lib/oauth';

export type StepUpMethod =
  | { kind: 'password' }
  | { kind: 'code' }
  | { kind: 'federated'; provider: OAuthProvider };

export function stepUpMethods(identities: { provider: string }[]): StepUpMethod[] {
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

/** Adopt the fresh session only when it is the same member's. */
async function adoptIfSameUser(expectedUserId: string, session: AuthSession): Promise<void> {
  const userId = session.user?.id ?? null;
  if (userId !== expectedUserId) throw new StepUpWrongAccountError();
  await sessionStore.set(session);
}

export async function stepUpWithPassword(expectedUserId: string, email: string, password: string): Promise<void> {
  await adoptIfSameUser(expectedUserId, await clutch.auth.token(email, password));
}

/** Email a 6-digit code to an existing account (never creates one). */
export async function sendStepUpCode(email: string): Promise<void> {
  await clutch.auth.sendCode({ email, create_user: false });
}

export async function stepUpWithCode(expectedUserId: string, email: string, code: string): Promise<void> {
  await adoptIfSameUser(expectedUserId, await clutch.auth.verifyCode(email, code.trim()));
}

export async function stepUpWithProvider(expectedUserId: string, provider: OAuthProvider): Promise<void> {
  const credential = await getFederatedCredential(federatedAdapters[provider]);
  await adoptIfSameUser(
    expectedUserId,
    await clutch.auth.idToken({ provider: credential.provider, id_token: credential.token, nonce: credential.nonce }),
  );
}
