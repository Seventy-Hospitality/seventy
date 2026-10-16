/**
 * The storage adapter supabase-js persists its session (and the PKCE code
 * verifier) through, backed by expo-secure-store (Keychain / Keystore).
 *
 * SecureStore values are capped around 2 KB, and a Supabase session (two
 * tokens plus the user record with its identities) is routinely larger, so a
 * value is split into numbered chunks with a small header recording how many
 * there are. Reads reassemble; a missing chunk reads as "no value" rather than
 * a truncated JSON string, so supabase-js treats it as signed out instead of
 * crashing on a parse error. Writes clear any extra chunks left over from a
 * longer previous value. Tokens are never logged.
 */
import * as SecureStore from 'expo-secure-store';

/** Characters per chunk; well under SecureStore's per-value limit. */
export const CHUNK_SIZE = 1800;

/** SecureStore keys allow only [A-Za-z0-9._-]; supabase keys already fit. */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

function headerKey(key: string): string {
  return `${safeKey(key)}.chunks`;
}

function chunkKey(key: string, index: number): string {
  return `${safeKey(key)}.${index}`;
}

async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(headerKey(key));
  const count = raw === null ? 0 : Number(raw);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export const chunkedSecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await readCount(key);
    if (count === 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await readCount(key);
    const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
    for (let i = 0; i < count; i += 1) {
      await SecureStore.setItemAsync(
        chunkKey(key, i),
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
    await SecureStore.setItemAsync(headerKey(key), String(count));
    for (let i = count; i < previous; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  },

  async removeItem(key: string): Promise<void> {
    const count = await readCount(key);
    await SecureStore.deleteItemAsync(headerKey(key));
    for (let i = 0; i < count; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  },
};
