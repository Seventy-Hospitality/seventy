import { createMutationKey } from '../mutation-key';
import { clutchError, networkError } from '../testing';

function minter() {
  let n = 0;
  return () => `key-${++n}`;
}

describe('createMutationKey', () => {
  it('reuses the key for the same input until the mutation is decided', async () => {
    const key = createMutationKey(minter());
    const seen: string[] = [];
    await expect(
      key.run({ slot: 1 }, async (k) => {
        seen.push(k);
        throw networkError();
      }),
    ).rejects.toBeTruthy();
    await key.run({ slot: 1 }, async (k) => {
      seen.push(k);
    });
    // Same logical mutation: the retry after a network blip replays, not repeats.
    expect(seen).toEqual(['key-1', 'key-1']);
    // Success ended it; the next mutation gets a new key.
    expect(key.keyFor({ slot: 1 })).toBe('key-2');
  });

  it('starts a new key after a definitive refusal (Clutch caches 4xx under the key)', async () => {
    const key = createMutationKey(minter());
    await expect(
      key.run({ a: 1 }, async () => {
        throw clutchError('payment_not_verified', 402);
      }),
    ).rejects.toBeTruthy();
    expect(key.keyFor({ a: 1 })).toBe('key-2');
  });

  it('keeps the key while the first attempt is still in flight server-side', async () => {
    const key = createMutationKey(minter());
    await expect(
      key.run({ a: 1 }, async () => {
        throw clutchError('request_in_flight', 409);
      }),
    ).rejects.toBeTruthy();
    expect(key.keyFor({ a: 1 })).toBe('key-1');
  });

  it('mints a new key when the input changes', () => {
    const key = createMutationKey(minter());
    expect(key.keyFor({ slot: 1 })).toBe('key-1');
    expect(key.keyFor({ slot: 2 })).toBe('key-2');
  });
});
