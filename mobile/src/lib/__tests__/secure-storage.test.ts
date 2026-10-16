import * as SecureStore from 'expo-secure-store';
import { CHUNK_SIZE, chunkedSecureStorage } from '../secure-storage';

const KEY = 'sb-test-auth-token';

beforeEach(async () => {
  await chunkedSecureStorage.removeItem(KEY);
});

describe('chunkedSecureStorage', () => {
  it('round-trips a value larger than one SecureStore entry', async () => {
    const value = 'x'.repeat(CHUNK_SIZE * 2 + 17);
    await chunkedSecureStorage.setItem(KEY, value);
    expect(await chunkedSecureStorage.getItem(KEY)).toBe(value);
    // Three chunks, none above the per-entry budget.
    const writes = (SecureStore.setItemAsync as jest.Mock).mock.calls.filter(([k]) =>
      String(k).startsWith(`${KEY}.`) && !String(k).endsWith('.chunks'),
    );
    for (const [, part] of writes) expect(String(part).length).toBeLessThanOrEqual(CHUNK_SIZE);
  });

  it('reads nothing for a key never written', async () => {
    expect(await chunkedSecureStorage.getItem('sb-never-written')).toBeNull();
  });

  it('drops leftover chunks when a shorter value replaces a longer one', async () => {
    await chunkedSecureStorage.setItem(KEY, 'a'.repeat(CHUNK_SIZE * 3));
    await chunkedSecureStorage.setItem(KEY, 'short');
    expect(await chunkedSecureStorage.getItem(KEY)).toBe('short');
    expect(await SecureStore.getItemAsync(`${KEY}.1`)).toBeNull();
    expect(await SecureStore.getItemAsync(`${KEY}.2`)).toBeNull();
  });

  it('treats a missing chunk as no value rather than a truncated session', async () => {
    await chunkedSecureStorage.setItem(KEY, 'b'.repeat(CHUNK_SIZE + 5));
    await SecureStore.deleteItemAsync(`${KEY}.1`);
    expect(await chunkedSecureStorage.getItem(KEY)).toBeNull();
  });

  it('removes every chunk and the header', async () => {
    await chunkedSecureStorage.setItem(KEY, 'c'.repeat(CHUNK_SIZE + 1));
    await chunkedSecureStorage.removeItem(KEY);
    expect(await chunkedSecureStorage.getItem(KEY)).toBeNull();
    expect(await SecureStore.getItemAsync(`${KEY}.0`)).toBeNull();
    expect(await SecureStore.getItemAsync(`${KEY}.chunks`)).toBeNull();
  });
});
