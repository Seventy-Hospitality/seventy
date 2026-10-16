/**
 * Expo push: this install's token registered with Clutch (POST /me/devices,
 * PENDING P1 feat/expo-push) whenever the member wants any push, removed
 * (DELETE /me/devices/{token}) on sign-out and when every push channel is off.
 *
 * Rules:
 * - Never prompt for permission when push is off. Only an explicit "turn push
 *   on" (a switch the member flipped) may show the OS prompt; the launch sync
 *   registers only when permission was already granted.
 * - Everything degrades silently: simulator, web, no permission, no EAS
 *   projectId all make the token unavailable and the helpers no-op. The
 *   preference itself is saved independently, so a registration miss never
 *   blocks a toggle.
 * - Clutch says to register on every launch (re-registering is harmless and a
 *   token another account held moves to the caller).
 */
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQuery } from '@tanstack/react-query';
import {
  clutch,
  NOTIFICATION_CATEGORIES,
  useMutationKey,
  type NotificationPreferences,
} from '../../lib/clutch';
import { preferencesQuery } from '../../lib/queries';
import { useSession } from '../../lib/session';

type DevicePlatform = 'ios' | 'android';

function devicePlatform(): DevicePlatform | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return Platform.OS;
  return null;
}

/** True when the member wants push for any category (shown or not). */
export function anyPushOn(prefs: NotificationPreferences): boolean {
  return NOTIFICATION_CATEGORIES.some((category) => prefs[category].push);
}

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

/**
 * Remove this install's registration, best effort. Used on sign-out (before
 * the session goes, while the request can still authenticate) and when every
 * push channel is turned off. Never prompts.
 */
export async function unregisterThisDevice(idempotencyKey?: string): Promise<void> {
  const token = await readPushToken(false);
  if (!token) return;
  try {
    await clutch.me.unregisterDevice(token, { idempotencyKey });
  } catch {
    // Best effort: Clutch prunes tokens Expo reports as unregistered.
  }
}

export interface PushRegistrationController {
  /** Register this device. `prompt` only for an explicit "turn push on". */
  register: (options: { prompt: boolean }) => Promise<boolean>;
  unregister: () => Promise<void>;
  /** Register or unregister to match the matrix after a change. */
  syncWith: (prefs: NotificationPreferences, options: { prompt: boolean }) => Promise<void>;
}

export function usePushRegistration(): PushRegistrationController {
  const registerKey = useMutationKey();
  const unregisterKey = useMutationKey();

  const register = useCallback(
    async ({ prompt }: { prompt: boolean }): Promise<boolean> => {
      const platform = devicePlatform();
      const token = await readPushToken(prompt);
      if (!token || !platform) return false;
      const input = { token, platform };
      try {
        await registerKey.run(input, (k) => clutch.me.registerDevice(input, { idempotencyKey: k }));
        return true;
      } catch {
        return false;
      }
    },
    [registerKey],
  );

  const unregister = useCallback(
    () => unregisterKey.run('unregister', (k) => unregisterThisDevice(k)),
    [unregisterKey],
  );

  const syncWith = useCallback(
    async (prefs: NotificationPreferences, { prompt }: { prompt: boolean }) => {
      if (anyPushOn(prefs)) await register({ prompt });
      else await unregister();
    },
    [register, unregister],
  );

  return { register, unregister, syncWith };
}

/**
 * Registers this install once per signed-in session when the member wants any
 * push and permission is already granted (no prompt). Mount it once inside
 * the signed-in shell (the tabs layout).
 */
export function PushRegistrationSync() {
  const { status, userId } = useSession();
  const prefs = useQuery({ ...preferencesQuery, enabled: status === 'authenticated' });
  const push = usePushRegistration();
  const doneFor = useRef<string | null>(null);

  const wanted = prefs.data ? anyPushOn(prefs.data) : false;
  useEffect(() => {
    if (!userId || !wanted || doneFor.current === userId) return;
    doneFor.current = userId;
    void push.register({ prompt: false });
  }, [userId, wanted, push]);

  return null;
}
