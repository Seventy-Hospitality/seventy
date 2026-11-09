/**
 * Proving this install holds its push token (Clutch P1, feat/expo-push).
 *
 * When a registration would move a token from another account and this
 * install cannot show the secret it was registered with (someone else used
 * this phone, or the app's data was cleared), Clutch answers
 * `202 verification_required` and pushes a DATA-ONLY message to the token:
 * `data: { type: "clutch.device_verification", code }`. Whoever holds the
 * token receives the code and posts it to POST /me/devices/verify
 * `{token, code}` within ten minutes. Nothing is shown to the user.
 *
 * The code can arrive three ways, all handled by `handlePushPayload`:
 * - in the foreground: the received-notification listener
 *   (PushRegistrationSync);
 * - in the background or with the app not running: the background task
 *   below (iOS: a content-available notification, which needs the
 *   "remote-notification" background mode in app.json; Android: an FCM data
 *   message). The task is defined at module scope and this module is
 *   imported by the root layout, so a headless start defines it too.
 * If it never arrives (iOS throttles background pushes), the next launch
 * registers again and Clutch pushes a new code (at most 5 per token an hour).
 * The pending token is kept in secure storage because a background task may
 * run in a fresh JS context with no in-memory state.
 */
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import {
  clutch,
  createMutationKey,
  DeviceVerificationPushSchema,
  hasCode,
  isTransient,
} from '../../lib/clutch';

export const VERIFICATION_TASK = 'club70.push-device-verification';

const PENDING_KEY = 'clutch.push.pending_verification';
/** Shared with usePushRegistration: the token this install last registered. */
export const REGISTERED_TOKEN_KEY = 'clutch.push.registered_token';

export interface PendingVerification {
  token: string;
  expiresAt: string;
}

export async function rememberPendingVerification(pending: PendingVerification | null): Promise<void> {
  try {
    if (pending) await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending));
    else await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch {
    // Without it a code that arrives is ignored; the next launch asks again.
  }
}

export async function pendingVerification(now: Date = new Date()): Promise<PendingVerification | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingVerification>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    if (Date.parse(parsed.expiresAt) <= now.getTime()) {
      await rememberPendingVerification(null);
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

/**
 * Find Clutch's verification payload in whatever shape the platform hands
 * over: a Notification (request.content.data), a background task payload
 * (`data` with a JSON `dataString`, or `data.body`), or the data itself.
 */
export function findVerificationCode(payload: unknown, depth = 0): string | null {
  if (depth > 6 || payload === null || payload === undefined) return null;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text.startsWith('{')) return null;
    try {
      return findVerificationCode(JSON.parse(text), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof payload !== 'object') return null;
  const direct = DeviceVerificationPushSchema.safeParse(payload);
  if (direct.success) return direct.data.code;
  for (const value of Object.values(payload as Record<string, unknown>)) {
    const found = findVerificationCode(value, depth + 1);
    if (found) return found;
  }
  return null;
}

export type VerificationOutcome =
  /** The device is proven and registered for the caller. */
  | 'registered'
  /** No registration is waiting for a code (or it expired). */
  | 'none'
  /** Wrong, spent or expired code: dropped; the next launch asks again. */
  | 'invalid'
  /** No answer (offline, 5xx): the pending registration is kept for another code. */
  | 'retry';

const verifyKey = createMutationKey();

export async function submitVerificationCode(code: string): Promise<VerificationOutcome> {
  const pending = await pendingVerification();
  if (!pending || !clutch.capabilities.pushDevices) return 'none';
  const input = { token: pending.token, code };
  try {
    await verifyKey.run(input, (k) => clutch.me.verifyDevice(input, { idempotencyKey: k }));
  } catch (err) {
    if (hasCode(err, 'device_verification_invalid')) {
      await rememberPendingVerification(null);
      return 'invalid';
    }
    if (isTransient(err)) return 'retry';
    await rememberPendingVerification(null);
    return 'invalid';
  }
  await rememberPendingVerification(null);
  try {
    await SecureStore.setItemAsync(REGISTERED_TOKEN_KEY, pending.token);
  } catch {
    // Only spares a token read at sign-out.
  }
  return 'registered';
}

/** Handle any received push payload; true when it was a verification code. */
export async function handlePushPayload(payload: unknown): Promise<boolean> {
  const code = findVerificationCode(payload);
  if (!code) return false;
  const outcome = await submitVerificationCode(code);
  if (outcome === 'invalid') console.warn('[push] the device verification code was refused; will ask again next launch');
  return true;
}

// Background / headless delivery. Defined at module scope (TaskManager
// requires it before the app finishes starting).
if (!TaskManager.isTaskDefined(VERIFICATION_TASK)) {
  TaskManager.defineTask(VERIFICATION_TASK, async ({ data, error }) => {
    if (error) return;
    await handlePushPayload(data);
  });
}

let taskRegistered = false;

/** Ask expo-notifications to run the task for pushes received in the background. Idempotent. */
export async function registerVerificationTask(): Promise<void> {
  if (taskRegistered) return;
  taskRegistered = true;
  try {
    await Notifications.registerTaskAsync(VERIFICATION_TASK);
  } catch {
    // Unsupported here (simulator, web): foreground delivery and the next launch still work.
    taskRegistered = false;
  }
}
