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
 * Every step-up must land on the SAME user (lib/same-member.ts): a sign-in
 * that belongs to another account is dropped and best-effort signed out on
 * Clutch, so the session (and what DELETE /me/account would delete) never
 * switches person and no stray session is left running.
 *
 * A refused step-up (`invalid_credentials`) becomes a StepUpRejectedError
 * whose message fits the method: a password, a code, or Google / Apple.
 */
import { clutch, type AuthSession } from '../../lib/clutch';
import { authErrorCode, codeErrorMessage, federatedErrorMessage } from '../../lib/auth-errors';
import { federatedAdapters, getFederatedCredential, type OAuthProvider } from '../../lib/oauth';
import { adoptSameMemberSession, WrongAccountError } from '../../lib/same-member';

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
export { WrongAccountError as StepUpWrongAccountError };

/** The step-up sign-in was refused; `message` says so for its method. */
export class StepUpRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepUpRejectedError';
  }
}

/** Run the step-up's sign-in, naming a refusal for its method. */
async function signInFor(method: StepUpMethod, run: () => Promise<AuthSession>): Promise<AuthSession> {
  try {
    return await run();
  } catch (err) {
    if (authErrorCode(err) !== 'invalid_credentials') throw err;
    switch (method.kind) {
      case 'password':
        throw new StepUpRejectedError('Incorrect password.');
      case 'code':
        throw new StepUpRejectedError(codeErrorMessage(err));
      case 'federated':
        throw new StepUpRejectedError(federatedErrorMessage(err, method.provider));
    }
  }
}

export async function stepUpWithPassword(expectedUserId: string, email: string, password: string): Promise<void> {
  await adoptSameMemberSession(
    expectedUserId,
    await signInFor({ kind: 'password' }, () => clutch.auth.token(email, password)),
  );
}

/** Email a 6-digit code to an existing account (never creates one). */
export async function sendStepUpCode(email: string): Promise<void> {
  await clutch.auth.sendCode({ email, create_user: false });
}

export async function stepUpWithCode(expectedUserId: string, email: string, code: string): Promise<void> {
  await adoptSameMemberSession(
    expectedUserId,
    await signInFor({ kind: 'code' }, () => clutch.auth.verifyCode(email, code.trim())),
  );
}

export async function stepUpWithProvider(expectedUserId: string, provider: OAuthProvider): Promise<void> {
  const credential = await getFederatedCredential(federatedAdapters[provider]);
  await adoptSameMemberSession(
    expectedUserId,
    await signInFor({ kind: 'federated', provider }, () =>
      clutch.auth.idToken({ provider: credential.provider, id_token: credential.token, nonce: credential.nonce }),
    ),
  );
}
