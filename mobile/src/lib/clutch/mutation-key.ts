/**
 * One Idempotency-Key per LOGICAL mutation.
 *
 * A user who taps "Pay" again after a network blip is retrying the same
 * logical mutation, and must send the same key so Clutch replays the first
 * attempt instead of acting twice. A key ends when the mutation is decided:
 * success, or a definitive failure (a 4xx, which Clutch caches under the key,
 * so retrying it would only replay the refusal). It also ends when the input
 * changes (a different slot is a different mutation; reusing the key with a
 * different body is refused as idempotency_key_reused).
 *
 *   const key = useMutationKey();
 *   useMutation({ mutationFn: (input) => key.run(input, (k) =>
 *     clutch.bookings.create(input, { idempotencyKey: k })) });
 */
import { useMemo, useRef } from 'react';
import * as Crypto from 'expo-crypto';
import { ClutchError, isTransient } from './errors';

export interface MutationKey {
  /** The key for `input`, minting a new one when the input changed. */
  keyFor(input: unknown): string;
  /**
   * Run `fn` under the key for `input`; the key ends unless the failure was
   * transient. `rerunnable` (confirm-style calls that only ask the server to
   * re-check): a 5xx also ends the key, so the next attempt is a fresh ask.
   */
  run<T>(input: unknown, fn: (key: string) => Promise<T>, opts?: { rerunnable?: boolean }): Promise<T>;
  /** Forget the current key (the logical mutation is over). */
  reset(): void;
}

function fingerprint(input: unknown): string {
  try {
    return JSON.stringify(input ?? null);
  } catch {
    return String(Date.now());
  }
}

export function createMutationKey(mint: () => string = () => Crypto.randomUUID()): MutationKey {
  let current: { key: string; print: string } | null = null;
  const api: MutationKey = {
    keyFor(input) {
      const print = fingerprint(input);
      if (!current || current.print !== print) current = { key: mint(), print };
      return current.key;
    },
    async run(input, fn, opts) {
      const key = api.keyFor(input);
      try {
        const result = await fn(key);
        current = null;
        return result;
      } catch (err) {
        const serverFailed = err instanceof ClutchError && err.kind === 'api' && err.status >= 500;
        if (!isTransient(err) || (opts?.rerunnable && serverFailed)) current = null;
        throw err;
      }
    },
    reset() {
      current = null;
    },
  };
  return api;
}

export function useMutationKey(): MutationKey {
  const ref = useRef<MutationKey | null>(null);
  ref.current ??= createMutationKey();
  return useMemo(() => ref.current as MutationKey, []);
}
