/**
 * Plain-English messages for sign-in failures. Clutch answers every auth
 * route with its `{ error, message }` envelope, so screens branch on
 * `ClutchError.code` (stable), never on the message text. A code the app does
 * not know shows Clutch's own message, which is written for people.
 */
import { ClutchError } from './clutch/errors';
import { OAuthCancelledError, OAuthNotConfiguredError } from './oauth';

/** The auth error code (Clutch's, as sent), or null for anything else. */
export function authErrorCode(err: unknown): string | null {
  return err instanceof ClutchError && err.kind === 'api' ? err.rawCode : null;
}

/** For a 6-digit code: a refused code is wrong, expired or already used. */
export function codeErrorMessage(err: unknown): string {
  if (authErrorCode(err) === 'invalid_credentials') {
    return 'That code is wrong, expired or already used. Ask for a new one.';
  }
  return authErrorMessage(err, 'That code did not work.');
}

export function authErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof OAuthNotConfiguredError) return err.message;
  if (err instanceof OAuthCancelledError) return 'Sign-in was cancelled.';
  if (err instanceof ClutchError && err.kind === 'network') {
    return 'Could not reach Club70. Check your connection.';
  }
  switch (authErrorCode(err)) {
    case 'invalid_credentials':
      return 'Incorrect email or password.';
    case 'email_not_confirmed':
      return 'Confirm your email first with the code we sent you.';
    case 'email_in_use':
      return 'That email already has an account. Sign in instead.';
    case 'rate_limit_exceeded':
      return 'Too many attempts. Wait a minute and try again.';
    case 'password_too_short':
      return 'Use at least 8 characters.';
    case 'weak_password':
      return 'Choose a stronger password.';
    case 'step_up_required':
      return 'For your security, sign in again first.';
    case 'invalid_field':
      return 'Check the email address.';
    case 'identity_already_linked':
      return 'That account is already linked to another Club70 login.';
    case 'last_identity':
      return 'You cannot remove your only way to sign in.';
    case 'identity_linking_disabled':
      return 'Linking accounts is not available right now.';
    case 'session_expired':
    case 'auth_required':
      return 'Your session ended. Sign in again.';
    case null:
      return fallback;
    default:
      // A code the app has no copy for: Clutch's message says what happened.
      return err instanceof ClutchError && err.message ? err.message : fallback;
  }
}
