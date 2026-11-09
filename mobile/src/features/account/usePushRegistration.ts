/**
 * Expo push for this install, against Clutch P1 (feat/expo-push):
 * POST /me/devices {token, platform, device_secret} and DELETE /me/devices
 * {token}.
 *
 * - device_secret: 32 random bytes (base64url) made once per install and kept
 *   in secure storage. It proves to Clutch that a token another account
 *   registered from THIS install may move to the new account (a shared phone
 *   signing in as someone else). It survives sign-out on purpose.
 * - Register: at launch while signed in, after every sign-in (a new userId),
 *   when Expo rotates the token, and when the member turns push on. A failed
 *   registration that may succeed later (offline, 5xx) is retried with
 *   backoff and again on the next foreground.
 * - 202 verification_required: the token is another account's and this
 *   install cannot show its secret. Clutch pushes a code to the token;
 *   push-verification.ts catches it (foreground listener here, background
 *   task) and posts it to /me/devices/verify. No code: the next launch
 *   registers again for a new one.
 * - 503 device_verification_unavailable: the code could not be pushed; the
 *   next launch tries again with a freshly read token (no retry loop now:
 *   codes are limited per token per hour).
 * - Unregister on every sign-out path, BEFORE the session ends (the request
 *   must still authenticate): useSignOut, account deletion, and
 *   `unregisterPushForSignOut()` for any other caller.
 * - "Push wanted" counts every category's push flag, hidden ones included.
 * - Never prompt for permission except for an explicit "turn push on".
 *   Everything else degrades silently (simulator, no permission, no EAS
 *   projectId): the preference is saved independently of the registration.
 */
import { useCallback, useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useQuery } from '@tanstack/react-query';
import {
  clutch,
  createMutationKey,
  hasCode,
  isTransient,
  type NotificationPreferences,
} from '../../lib/clutch';
import { preferencesQuery } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { anyPushOn } from './preferences';
import {
  handlePushPayload,
  registerVerificationTask,
  rememberPendingVerification,
  REGISTERED_TOKEN_KEY,
} from './push-verification';

export { anyPushOn } from './preferences';

type DevicePlatform = 'ios' | 'android';

const DEVICE_SECRET_KEY = 'clutch.push.device_secret';

/** Backoff for a registration that failed transiently; the next foreground starts over. */
export const REGISTER_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
const SIGN_OUT_BUDGET_MS = 4_000;

function devicePlatform(): DevicePlatform | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return Platform.OS;
  return null;
}

// ── The install's secret ──

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** RFC 4648 base64url without padding (no Buffer / btoa dependency on device). */
export function base64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += BASE64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += BASE64URL[n & 63];
  }
  return out;
}

let secretPromise: Promise<string> | null = null;

/** This install's device_secret, made on first use and kept in secure storage. */
export function deviceSecret(): Promise<string> {
  secretPromise ??= (async () => {
    const stored = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);
    if (stored) return stored;
    const fresh = base64Url(Crypto.getRandomBytes(32));
    await SecureStore.setItemAsync(DEVICE_SECRET_KEY, fresh);
    return fresh;
  })().catch((err: unknown) => {
    secretPromise = null;
    throw err;
  });
  return secretPromise;
}

// ── Token ──

/**
 * This device's Expo push token, or null (never throws). `prompt` allows the
 * OS permission dialog; without it a token is read only when permission was
 * already granted.
 */
export async function readPushToken(prompt: boolean): Promise<string | null> {
  if (!devicePlatform()) return null;
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted) {
      if (!prompt || !current.canAskAgain) return null;
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return null;
    const token = await Notifications.getExpoPushTokenAsync();
    return token?.data ?? null;
  } catch {
    return null;
  }
}

async function storedToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REGISTERED_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function storeToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(REGISTERED_TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(REGISTERED_TOKEN_KEY);
  } catch {
    // The stored token only spares a permission read at sign-out.
  }
}

// ── Register / unregister ──

/**
 * - registered: Clutch pushes to this install for the caller.
 * - unavailable: nothing to register (no permission, simulator, capability off).
 * - verifying: 202, waiting for the pushed code (push-verification.ts).
 * - retry: no decision (offline, 5xx); worth trying again later.
 * - refused: another definitive refusal; trying again would get the same.
 */
export type RegisterOutcome = 'registered' | 'unavailable' | 'verifying' | 'retry' | 'refused';

const registerKey = createMutationKey();
const unregisterKey = createMutationKey();

/** Bumped by every sign-out, so a registration that lands after it is undone. */
let sessionEpoch = 0;

export async function registerThisDevice({ prompt }: { prompt: boolean }): Promise<RegisterOutcome> {
  if (!clutch.capabilities.pushDevices) return 'unavailable';
  const platform = devicePlatform();
  if (!platform) return 'unavailable';
  const token = await readPushToken(prompt);
  if (!token) return 'unavailable';
  let secret: string;
  try {
    secret = await deviceSecret();
  } catch {
    return 'unavailable';
  }

  const epoch = sessionEpoch;
  const input = { token, platform, device_secret: secret };
  let answer;
  try {
    answer = await registerKey.run(input, (k) => clutch.me.registerDevice(input, { idempotencyKey: k }));
  } catch (err) {
    if (hasCode(err, 'device_verification_unavailable')) {
      console.warn('[push] Clutch could not push the device verification code; trying again next launch');
      return 'refused';
    }
    return isTransient(err) ? 'retry' : 'refused';
  }
  if (answer.status === 'verification_required') {
    if (epoch !== sessionEpoch) return 'unavailable';
    await rememberPendingVerification({ token: answer.token, expiresAt: answer.expiresAt });
    void registerVerificationTask();
    return 'verifying';
  }
  if (epoch !== sessionEpoch) {
    // A sign-out started while this was in flight: take it back while the session may still answer.
    try {
      await clutch.me.unregisterDevice(token);
    } catch {
      // The registration ends with its session anyway.
    }
    return 'unavailable';
  }

  // Expo rotated the token: the old one no longer reaches this install.
  const previous = await storedToken();
  await storeToken(token);
  if (previous && previous !== token) {
    try {
      await clutch.me.unregisterDevice(previous);
    } catch {
      // Clutch prunes tokens Expo reports as dead.
    }
  }
  return 'registered';
}

/**
 * Remove this install's registration for the signed-in account, best effort
 * (never throws, never prompts). The stored token is preferred: permission
 * may have been revoked since it was registered.
 */
export async function unregisterThisDevice(): Promise<void> {
  if (!clutch.capabilities.pushDevices) return;
  const token = (await storedToken()) ?? (await readPushToken(false));
  if (!token) return;
  try {
    await unregisterKey.run(token, (k) => clutch.me.unregisterDevice(token, { idempotencyKey: k }));
    await storeToken(null);
  } catch {
    // Best effort: the registration also ends with the session it was made under.
  }
}

/**
 * Call on EVERY sign-out path, before the session ends: stops pending
 * registration retries and removes this install's registration, capped so a
 * slow network never traps the member. Never throws.
 */
export async function unregisterPushForSignOut(): Promise<void> {
  sessionEpoch += 1;
  await rememberPendingVerification(null);
  stopListeners.forEach((stop) => stop());
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    unregisterThisDevice(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SIGN_OUT_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
}

const resyncListeners = new Set<() => void>();
const stopListeners = new Set<() => void>();

/** Ask the mounted PushRegistrationSync to register again (e.g. a sign-out path was abandoned). */
export function requestPushResync(): void {
  resyncListeners.forEach((listener) => listener());
}

// ── Hooks ──

export interface PushRegistrationController {
  /** Register or unregister to match the matrix after a change. */
  syncWith: (prefs: NotificationPreferences, options: { prompt: boolean }) => Promise<void>;
}

export function usePushRegistration(): PushRegistrationController {
  const syncWith = useCallback(async (prefs: NotificationPreferences, { prompt }: { prompt: boolean }) => {
    if (!anyPushOn(prefs)) {
      await unregisterThisDevice();
      return;
    }
    const outcome = await registerThisDevice({ prompt });
    if (outcome === 'retry') requestPushResync();
  }, []);
  return { syncWith };
}

/**
 * Keeps this install registered while signed in and push is wanted. Mount it
 * once inside the signed-in shell (the tabs layout). Never prompts.
 */
export function PushRegistrationSync() {
  const { status, userId } = useSession();
  const prefs = useQuery({ ...preferencesQuery, enabled: status === 'authenticated' });
  const wanted = prefs.data ? anyPushOn(prefs.data) : false;

  useEffect(() => {
    if (status !== 'authenticated' || !userId || !wanted) return;
    let disposed = false;
    /** A sign-out began: no retries until a resync says the session goes on. */
    let halted = false;
    let running = false;
    let again = false;
    let failures = 0;
    let last: RegisterOutcome | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async (): Promise<void> => {
      if (disposed || halted) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      clearTimeout(timer);
      try {
        last = await registerThisDevice({ prompt: false });
      } finally {
        running = false;
      }
      if (disposed || halted) return;
      if (again) {
        again = false;
        void run();
        return;
      }
      if (last === 'retry' && failures < REGISTER_RETRY_DELAYS_MS.length) {
        timer = setTimeout(() => void run(), REGISTER_RETRY_DELAYS_MS[failures]);
        failures += 1;
      }
    };
    const restart = () => {
      halted = false;
      failures = 0;
      void run();
    };
    const halt = () => {
      halted = true;
      clearTimeout(timer);
    };

    void run();

    let tokenSub: { remove(): void } | null = null;
    try {
      // The listener hands over the native token; Clutch wants the Expo one, which run() re-reads.
      tokenSub = Notifications.addPushTokenListener(() => restart());
    } catch {
      tokenSub = null;
    }
    // The verification code arrives as a data-only push; in the foreground it
    // comes through here (in the background, through the task).
    let receivedSub: { remove(): void } | null = null;
    try {
      receivedSub = Notifications.addNotificationReceivedListener((notification) => {
        void handlePushPayload(notification);
      });
    } catch {
      receivedSub = null;
    }
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && last === 'retry') restart();
    });
    resyncListeners.add(restart);
    stopListeners.add(halt);

    return () => {
      disposed = true;
      clearTimeout(timer);
      tokenSub?.remove();
      receivedSub?.remove();
      appSub.remove();
      resyncListeners.delete(restart);
      stopListeners.delete(halt);
    };
  }, [status, userId, wanted]);

  return null;
}
