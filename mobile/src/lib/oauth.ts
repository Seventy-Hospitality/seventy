/**
 * Native federated sign-in (Google + Apple) for Supabase GoTrue.
 *
 * Nonce contract (GoTrue's signInWithIdToken): the app mints a random RAW
 * nonce, hands the platform SDK `sha256(raw)` as hex (so the ID token's
 * `nonce` claim carries the hash), and gives GoTrue the ID token plus the RAW
 * nonce. GoTrue hashes the raw nonce and compares it with the claim, so a
 * token minted for another sign-in cannot be replayed here.
 *
 * Degradation: each adapter reports `isConfigured()` from the env client IDs
 * (Apple is also available natively on iOS). When not configured the sign-in
 * buttons render disabled and `authenticate()` is never called, so no SDK is
 * initialized. The provider SDKs are imported lazily inside `authenticate()`.
 *
 * The Supabase dashboard must list these client ids as authorized for the
 * Google provider (iOS, Android and web client ids, comma separated) and the
 * bundle id / services id for Apple, or GoTrue rejects the token audience.
 */
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
} from './env';

/** Lowercase-hex SHA-256 (the form GoTrue compares the nonce claim against). */
export async function sha256Hex(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

export type OAuthProvider = 'google' | 'apple';

export class OAuthCancelledError extends Error {
  constructor() {
    super('The sign-in was cancelled');
    this.name = 'OAuthCancelledError';
  }
}

export class OAuthNotConfiguredError extends Error {
  constructor(provider: OAuthProvider) {
    super(`${provider} sign-in is not configured in this environment`);
    this.name = 'OAuthNotConfiguredError';
  }
}

/** What an adapter returns after the platform SDK issues an ID token. */
export interface ProviderAssertion {
  idToken: string;
  /** Apple only, and only on the user's first authorization. */
  fullName?: { givenName?: string; familyName?: string };
}

export interface FederatedAdapter {
  readonly provider: OAuthProvider;
  /** Client IDs (or native availability) are present for this provider. */
  isConfigured(): boolean;
  /** Runtime check that the provider can actually be presented on this device. */
  isAvailable(): Promise<boolean>;
  /** Drive the SDK with the hashed nonce and return the raw ID token. */
  authenticate(hashedNonce: string): Promise<ProviderAssertion>;
}

/**
 * Google on a phone: the iOS or Android OAuth client of the platform (never
 * the web client, whose redirect must be https). Google only redirects an
 * installed app to its reversed client id scheme
 * (`com.googleusercontent.apps.<id>:/oauthredirect`), which app.config.js
 * registers from the same env values; the flow is authorization code + PKCE,
 * and the code is exchanged on the device (installed-app clients have no
 * secret). The ID token carries the nonce we sent, so GoTrue's nonce check
 * stays on. On Android the client must have "custom URI scheme" enabled in
 * the Google Cloud console.
 */
function googleClientId(): string | null {
  return Platform.select({ ios: GOOGLE_IOS_CLIENT_ID, android: GOOGLE_ANDROID_CLIENT_ID, default: null }) ?? null;
}

/** `123-abc.apps.googleusercontent.com` -> `com.googleusercontent.apps.123-abc`. */
export function reversedClientIdScheme(clientId: string): string {
  return clientId.split('.').reverse().join('.');
}

// Google's OpenID endpoints (static; avoids a discovery round-trip).
const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
} as const;

export const googleAdapter: FederatedAdapter = {
  provider: 'google',
  isConfigured: () => Boolean(googleClientId()),
  isAvailable: async () => Boolean(googleClientId()),
  async authenticate(hashedNonce) {
    const clientId = googleClientId();
    if (!clientId) throw new OAuthNotConfiguredError('google');

    const AuthSession = await import('expo-auth-session');
    const redirectUri = `${reversedClientIdScheme(clientId)}:/oauthredirect`;
    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ['openid', 'profile', 'email'],
      usePKCE: true,
      // Google copies this into the ID token's `nonce` claim verbatim.
      extraParams: { nonce: hashedNonce },
    });

    const result = await request.promptAsync(GOOGLE_DISCOVERY);
    if (result.type === 'cancel' || result.type === 'dismiss') throw new OAuthCancelledError();
    if (result.type !== 'success' || !result.params.code) {
      throw new Error(result.type === 'error' ? (result.error?.message ?? 'Google sign-in failed') : 'Google sign-in failed');
    }
    const tokens = await AuthSession.exchangeCodeAsync(
      {
        clientId,
        code: result.params.code,
        redirectUri,
        extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
      },
      GOOGLE_DISCOVERY,
    );
    if (!tokens.idToken) throw new Error('Google did not return an ID token');
    return { idToken: tokens.idToken };
  },
};

export const appleAdapter: FederatedAdapter = {
  provider: 'apple',
  // Native Sign in with Apple only (iOS; the bundle id is the audience).
  // Android would need the web flow with a services id, which the app does
  // not implement, so Apple is hidden there.
  isConfigured: () => Platform.OS === 'ios',
  async isAvailable() {
    if (Platform.OS !== 'ios') return false;
    const AppleAuthentication = await import('expo-apple-authentication');
    return AppleAuthentication.isAvailableAsync();
  },
  async authenticate(hashedNonce) {
    if (Platform.OS !== 'ios') throw new OAuthNotConfiguredError('apple');

    const AppleAuthentication = await import('expo-apple-authentication');
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        // Apple echoes this into the ID token's `nonce` claim verbatim.
        nonce: hashedNonce,
      });
      if (!credential.identityToken) throw new Error('Apple did not return an identity token');
      const fullName = credential.fullName
        ? {
            givenName: credential.fullName.givenName ?? undefined,
            familyName: credential.fullName.familyName ?? undefined,
          }
        : undefined;
      return { idToken: credential.identityToken, fullName };
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ERR_REQUEST_CANCELED') {
        throw new OAuthCancelledError();
      }
      throw err;
    }
  },
};

export const federatedAdapters: Record<OAuthProvider, FederatedAdapter> = {
  google: googleAdapter,
  apple: appleAdapter,
};

/** The raw ID token + raw nonce ready for supabase.auth.signInWithIdToken. */
export interface FederatedCredential {
  provider: OAuthProvider;
  /** OIDC ID token from the platform SDK. */
  token: string;
  /** The RAW nonce (GoTrue hashes it and compares with the token's claim). */
  nonce: string;
  fullName?: { givenName?: string; familyName?: string };
}

/** A fresh random raw nonce (two UUIDs: 244 random bits). */
export function createRawNonce(): string {
  return `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, '');
}

/**
 * Drive the platform SDK with sha256(raw nonce) and return the ID token with
 * the RAW nonce, ready for signInWithIdToken or linkIdentity.
 */
export async function getFederatedCredential(
  adapter: FederatedAdapter,
  mintNonce: () => string = createRawNonce,
): Promise<FederatedCredential> {
  if (!adapter.isConfigured()) throw new OAuthNotConfiguredError(adapter.provider);

  const rawNonce = mintNonce();
  const hashedNonce = await sha256Hex(rawNonce);
  const assertion = await adapter.authenticate(hashedNonce);

  return {
    provider: adapter.provider,
    token: assertion.idToken,
    nonce: rawNonce,
    fullName: assertion.fullName,
  };
}
