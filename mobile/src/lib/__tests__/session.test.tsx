import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import type { MockClutch } from '../clutch/testing';
import { clutchError, networkError } from '../clutch/testing';
import { makeAuthSession, ME_ID } from '../clutch/fixtures';

jest.mock('../clutch', () => {
  const actual = jest.requireActual('../clutch');
  const { createMockClutch } = jest.requireActual('../clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../clutch') as { clutch: MockClutch }).clutch;

import { SessionProvider, useSession } from '../session';
import { sessionStore } from '../auth-session';
import { queryClient } from '../query-client';
import { WrongAccountError } from '../same-member';

function wrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

async function renderSession() {
  const hook = renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(hook.result.current.status).not.toBe('loading'));
  return hook;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await sessionStore.clear();
  await SecureStore.deleteItemAsync('club70.passwordRecovery');
  mockClutch.auth.signOut.mockResolvedValue({ ok: true });
  mockClutch.auth.setPassword.mockResolvedValue({ ok: true });
  mockClutch.auth.sendCode.mockResolvedValue({ ok: true, message: 'sent' });
  mockClutch.me.updateProfile.mockResolvedValue({} as never);
});

describe('SessionProvider', () => {
  it('is anonymous with no stored session', async () => {
    const { result } = await renderSession();
    expect(result.current.status).toBe('anonymous');
    expect(result.current.userId).toBeNull();
  });

  it('signs in with a password through Clutch and mirrors the session', async () => {
    mockClutch.auth.token.mockResolvedValue(makeAuthSession());
    const { result } = await renderSession();
    await act(() => result.current.signInWithPassword({ email: ' alex@example.com ', password: 'pw' }));
    expect(mockClutch.auth.token).toHaveBeenCalledWith('alex@example.com', 'pw');
    expect(result.current.status).toBe('authenticated');
    expect(result.current.userId).toBe(ME_ID);
    expect(result.current.email).toBe('alex@example.com');
  });

  it('clears the query cache when a different user signs in', async () => {
    const clear = jest.spyOn(queryClient, 'clear');
    mockClutch.auth.token.mockResolvedValueOnce(makeAuthSession());
    mockClutch.auth.token.mockResolvedValueOnce(makeAuthSession({ user: { id: 'someone-else', email: null } }));
    const { result } = await renderSession();
    await act(() => result.current.signInWithPassword({ email: 'a@b.com', password: 'pw' }));
    expect(clear).not.toHaveBeenCalled();
    await act(() => result.current.signInWithPassword({ email: 'c@d.com', password: 'pw' }));
    expect(clear).toHaveBeenCalledTimes(1);
    clear.mockRestore();
  });

  it('signs up by code: the code creates the account, then the password is set', async () => {
    mockClutch.auth.verifyCode.mockResolvedValue(makeAuthSession());
    const { result } = await renderSession();
    await act(() => result.current.sendSignUpCode({ name: ' Alex Morgan ', email: ' a@b.com ' }));
    expect(mockClutch.auth.sendCode).toHaveBeenCalledWith({ email: 'a@b.com', create_user: true, full_name: 'Alex Morgan' });
    await act(() => result.current.confirmSignUp({ email: 'a@b.com', code: ' 123456 ', password: 'long-password' }));
    expect(mockClutch.auth.verifyCode).toHaveBeenCalledWith('a@b.com', '123456');
    expect(mockClutch.auth.setPassword).toHaveBeenCalledWith('long-password');
    expect(result.current.status).toBe('authenticated');
    expect(result.current.passwordRecovery).toBe(false);
  });

  it('holds a new member on set-password when the sign-up password did not save', async () => {
    mockClutch.auth.verifyCode.mockResolvedValue(makeAuthSession());
    mockClutch.auth.setPassword.mockRejectedValueOnce(clutchError('weak_password', 400));
    const { result } = await renderSession();
    await act(() => result.current.confirmSignUp({ email: 'a@b.com', code: '123456', password: 'password' }));
    expect(result.current.status).toBe('authenticated');
    expect(result.current.passwordRecovery).toBe(true);
  });

  it('resets a password: the code signs in in recovery until a new password is saved', async () => {
    mockClutch.auth.verifyCode.mockResolvedValue(makeAuthSession());
    const { result } = await renderSession();
    await act(() => result.current.requestPasswordReset(' a@b.com '));
    expect(mockClutch.auth.sendCode).toHaveBeenCalledWith({ email: 'a@b.com', create_user: false });
    await act(() => result.current.verifyRecoveryCode('a@b.com', '654321'));
    expect(result.current.passwordRecovery).toBe(true);
    expect(await SecureStore.getItemAsync('club70.passwordRecovery')).toBe(ME_ID);
    await act(() => result.current.updatePassword('new-password-1'));
    expect(mockClutch.auth.setPassword).toHaveBeenCalledWith('new-password-1');
    expect(result.current.passwordRecovery).toBe(false);
  });

  it('re-confirms the same member with a code and adopts the fresh session', async () => {
    await sessionStore.set(makeAuthSession({ access_token: 'old-token' }));
    mockClutch.auth.verifyCode.mockResolvedValue(makeAuthSession({ access_token: 'fresh-token' }));
    const { result } = await renderSession();
    await act(() => result.current.reconfirmWithCode(' a@b.com ', ' 123456 '));
    expect(mockClutch.auth.verifyCode).toHaveBeenCalledWith('a@b.com', '123456');
    expect(sessionStore.current()?.access_token).toBe('fresh-token');
    expect(mockClutch.auth.signOut).not.toHaveBeenCalled();
  });

  it('never adopts a re-confirming code that signs in another account, and ends that session', async () => {
    await sessionStore.set(makeAuthSession({ access_token: 'old-token' }));
    mockClutch.auth.verifyCode.mockResolvedValue(
      makeAuthSession({ access_token: 'stray-token', user: { id: 'someone-else', email: 'a@b.com' } }),
    );
    const { result } = await renderSession();
    await expect(result.current.reconfirmWithCode('a@b.com', '123456')).rejects.toBeInstanceOf(WrongAccountError);
    expect(sessionStore.current()?.access_token).toBe('old-token');
    expect(result.current.userId).toBe(ME_ID);
    expect(mockClutch.auth.signOut).toHaveBeenCalledWith('local', { accessToken: 'stray-token' });
  });

  it('restores recovery mode after an app restart', async () => {
    await sessionStore.set(makeAuthSession());
    await SecureStore.setItemAsync('club70.passwordRecovery', ME_ID);
    const { result } = await renderSession();
    await waitFor(() => expect(result.current.passwordRecovery).toBe(true));
  });

  it('keeps the set-password hold when the session is only found after a failed first read', async () => {
    // A launch in the background on a locked iPhone cannot read the Keychain;
    // the session turns up on the next read, with a recovery still pending.
    // A fresh module registry gives a store whose first read has not run yet.
    const React = jest.requireActual('react');
    let isolated!: {
      SessionProvider: typeof SessionProvider;
      useSession: typeof useSession;
      store: typeof sessionStore;
      secureStore: typeof SecureStore;
      storage: { setItem(k: string, v: string): Promise<void> };
    };
    jest.isolateModules(() => {
      jest.doMock('react', () => React);
      isolated = {
        ...(require('../session') as { SessionProvider: typeof SessionProvider; useSession: typeof useSession }),
        store: (require('../auth-session') as { sessionStore: typeof sessionStore }).sessionStore,
        secureStore: require('expo-secure-store'),
        storage: (require('../secure-storage') as { chunkedSecureStorage: { setItem(k: string, v: string): Promise<void> } })
          .chunkedSecureStorage,
      };
    });
    const session = makeAuthSession();
    await isolated.storage.setItem(
      'club70-session',
      JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: ME_ID, email: null } }),
    );
    await isolated.secureStore.setItemAsync('club70.passwordRecovery', ME_ID);
    (isolated.secureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Keychain locked'));
    const IsolatedProvider = isolated.SessionProvider;
    const { result } = renderHook(() => isolated.useSession(), {
      wrapper: ({ children }: { children: ReactNode }) => <IsolatedProvider>{children}</IsolatedProvider>,
    });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    await act(async () => {
      await isolated.store.load();
    });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.passwordRecovery).toBe(true);
  });

  it('signs in with Apple through Clutch and saves the first-sign-in name to the profile', async () => {
    const oauth = jest.requireActual('../oauth');
    jest.spyOn(oauth.appleAdapter, 'isConfigured').mockReturnValue(true);
    jest
      .spyOn(oauth.appleAdapter, 'authenticate')
      .mockResolvedValue({ idToken: 'apple-id-token', fullName: { givenName: 'Alex', familyName: 'Morgan' } });
    mockClutch.auth.idToken.mockResolvedValue(makeAuthSession());
    const { result } = await renderSession();
    await act(() => result.current.signInWithApple());
    expect(mockClutch.auth.idToken).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'apple', id_token: 'apple-id-token', nonce: expect.any(String) }),
    );
    expect(mockClutch.me.updateProfile).toHaveBeenCalledWith({ full_name: 'Alex Morgan' });
    expect(result.current.status).toBe('authenticated');
  });

  it('signs out on Clutch, clears the cache and forgets the session', async () => {
    const clear = jest.spyOn(queryClient, 'clear');
    mockClutch.auth.token.mockResolvedValue(makeAuthSession());
    const { result } = await renderSession();
    await act(() => result.current.signInWithPassword({ email: 'a@b.com', password: 'pw' }));
    await act(() => result.current.signOut());
    expect(mockClutch.auth.signOut).toHaveBeenCalledWith('local');
    expect(result.current.status).toBe('anonymous');
    expect(sessionStore.current()).toBeNull();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it('still signs out when Clutch cannot be reached', async () => {
    mockClutch.auth.token.mockResolvedValue(makeAuthSession());
    mockClutch.auth.signOut.mockRejectedValue(networkError());
    const { result } = await renderSession();
    await act(() => result.current.signInWithPassword({ email: 'a@b.com', password: 'pw' }));
    await act(() => result.current.signOut());
    expect(result.current.status).toBe('anonymous');
  });

  it('signs out once, without retrying, when Clutch says the session already ended', async () => {
    mockClutch.auth.token.mockResolvedValue(makeAuthSession());
    mockClutch.auth.signOut.mockRejectedValue(clutchError('session_expired', 401));
    const { result } = await renderSession();
    await act(() => result.current.signInWithPassword({ email: 'a@b.com', password: 'pw' }));
    await act(() => result.current.signOut());
    expect(mockClutch.auth.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('anonymous');
    expect(sessionStore.current()).toBeNull();
  });

  it('goes anonymous when the store ends the session (a refused refresh)', async () => {
    mockClutch.auth.token.mockResolvedValue(makeAuthSession());
    const { result } = await renderSession();
    await act(() => result.current.signInWithPassword({ email: 'a@b.com', password: 'pw' }));
    await act(() => sessionStore.clear());
    expect(result.current.status).toBe('anonymous');
  });
});
