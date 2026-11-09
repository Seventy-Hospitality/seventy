/**
 * Plain-English messages for Supabase GoTrue failures. Screens branch on the
 * GoTrue error `code` (stable), never on its message text.
 */
import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { OAuthCancelledError, OAuthNotConfiguredError } from './oauth';
import { SupabaseNotConfiguredError } from './supabase';
import { AuthRedirectError, EmailAlreadyRegisteredError } from './session';

export function authErrorCode(err: unknown): string | null {
  if (err instanceof EmailAlreadyRegisteredError) return err.code;
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    // AuthApiError and AuthPKCECodeVerifierMissingError both carry `code`.
    if (isAuthApiError(err) || (err as { name?: string }).name?.startsWith('Auth')) {
      return (err as { code: string }).code;
    }
  }
  if (err instanceof AuthRedirectError) return err.code;
  return null;
}

export function authErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof SupabaseNotConfiguredError) return err.message;
  if (err instanceof OAuthNotConfiguredError) return err.message;
  if (err instanceof OAuthCancelledError) return 'Sign-in was cancelled.';
  if (isAuthRetryableFetchError(err)) return 'Could not reach the sign-in service. Check your connection.';
  switch (authErrorCode(err)) {
    case 'invalid_credentials':
      return 'Incorrect email or password.';
    case 'email_not_confirmed':
      return 'Confirm your email first: use the link or code we sent you.';
    case 'user_already_exists':
    case 'email_exists':
      return 'That email already has an account. Sign in instead.';
    case 'otp_expired':
      return 'That code or link has expired, or was already used. Ask for a new one.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute and try again.';
    case 'weak_password':
      return 'Choose a stronger password.';
    case 'same_password':
      return 'Choose a password different from your current one.';
    case 'signup_disabled':
      return 'New accounts are not open right now.';
    case 'pkce_code_verifier_not_found':
    case 'bad_code_verifier':
    case 'flow_state_not_found':
    case 'flow_state_expired':
      return 'Open the link on the phone you requested it from, or enter the 6-digit code from the email.';
    case 'reauthentication_needed':
      return 'For your security, sign in again first.';
    case 'identity_already_exists':
      return 'That account is already linked to another Club70 login.';
    case 'single_identity_not_deletable':
      return 'You cannot remove your only way to sign in.';
    default:
      return err instanceof AuthRedirectError ? err.message : fallback;
  }
}
