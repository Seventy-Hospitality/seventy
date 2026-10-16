import { createHash } from 'crypto';
import {
  createRawNonce,
  getFederatedCredential,
  googleAdapter,
  appleAdapter,
  reversedClientIdScheme,
  OAuthNotConfiguredError,
  sha256Hex,
  type FederatedAdapter,
} from '../oauth';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('sha256Hex', () => {
  it('produces the standard lowercase-hex SHA-256 digest', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await sha256Hex('a-raw-nonce')).toBe(sha256('a-raw-nonce'));
  });
});

describe('getFederatedCredential', () => {
  it('hands the SDK sha256(raw nonce) and returns the RAW nonce for GoTrue', async () => {
    const authenticate = jest.fn(async (hashedNonce: string) => {
      expect(hashedNonce).toBe(sha256('raw-nonce-123'));
      return { idToken: 'id-token-xyz', fullName: { givenName: 'Alex' } };
    });
    const adapter: FederatedAdapter = {
      provider: 'apple',
      isConfigured: () => true,
      isAvailable: async () => true,
      authenticate,
    };

    const credential = await getFederatedCredential(adapter, () => 'raw-nonce-123');

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(credential).toEqual({
      provider: 'apple',
      token: 'id-token-xyz',
      nonce: 'raw-nonce-123',
      fullName: { givenName: 'Alex' },
    });
  });

  it('refuses an unconfigured provider without touching its SDK', async () => {
    const adapter: FederatedAdapter = {
      provider: 'google',
      isConfigured: () => false,
      isAvailable: async () => false,
      authenticate: jest.fn(),
    };
    await expect(getFederatedCredential(adapter)).rejects.toBeInstanceOf(OAuthNotConfiguredError);
    expect(adapter.authenticate).not.toHaveBeenCalled();
  });
});

describe('createRawNonce', () => {
  it('mints a fresh long random value each time', () => {
    const a = createRawNonce();
    const b = createRawNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('adapter degradation', () => {
  it('reports Google as not configured when no client IDs are set', () => {
    expect(googleAdapter.isConfigured()).toBe(false);
  });
});

describe('native client wiring', () => {
  it('reverses a Google client id into its redirect scheme', () => {
    expect(reversedClientIdScheme('123-abc.apps.googleusercontent.com')).toBe('com.googleusercontent.apps.123-abc');
  });

  it('offers Apple only where it is native (not on the test platform unless iOS)', () => {
    const { Platform } = require('react-native');
    expect(appleAdapter.isConfigured()).toBe(Platform.OS === 'ios');
  });
});
