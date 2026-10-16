import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

// A controllable stand-in for supabase-js's auth client.
type Listener = (event: string, session: unknown) => void;
const mockListeners: Listener[] = [];
const mockAuth = {
  onAuthStateChange: jest.fn((cb: Listener) => {
    mockListeners.push(cb);
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  }),
  startAutoRefresh: jest.fn(async () => undefined),
  stopAutoRefresh: jest.fn(async () => undefined),
  signInWithPassword: jest.fn(async () => ({ data: {}, error: null })),
  signUp: jest.fn(async () => ({ data: { session: null }, error: null })),
  signInWithOtp: jest.fn(async () => ({ data: {}, error: null })),
  verifyOtp: jest.fn(async () => ({ data: {}, error: null })),
  exchangeCodeForSession: jest.fn(async () => ({ data: {}, error: null })),
  resetPasswordForEmail: jest.fn(async () => ({ data: {}, error: null })),
  updateUser: jest.fn(async () => ({ data: {}, error: null })),
  signOut: jest.fn(async () => ({ error: null })),
};
jest.mock('../supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({ auth: mockAuth }),
  SupabaseNotConfiguredError: class extends Error {},
}));

import { SessionProvider, useSession, AuthRedirectError } from '../session';
import { queryClient } from '../query-client';
import { AUTH_CALLBACK_URL } from '../env';

function wrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

function session(userId: string) {
  return { access_token: 'at', refresh_token: 'rt', user: { id: userId, email: `${userId}@x.com` } };
}

function emit(event: string, value: unknown) {
  act(() => {
    for (const cb of mockListeners) cb(event, value);
  });
}

beforeEach(() => {
  mockListeners.length = 0;
  jest.clearAllMocks();
});

describe('SessionProvider', () => {
  it('mirrors the initial session from supabase-js', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.status).toBe('loading');
    emit('INITIAL_SESSION', session('u1'));
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.userId).toBe('u1');
    expect(result.current.email).toBe('u1@x.com');
  });

  it('is anonymous when supabase-js has no session', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    emit('INITIAL_SESSION', null);
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
  });

  it('clears the query cache on SIGNED_OUT', async () => {
    const clear = jest.spyOn(queryClient, 'clear');
    const { result } = renderHook(() => useSession(), { wrapper });
    emit('INITIAL_SESSION', session('u1'));
    emit('SIGNED_OUT', null);
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it('clears the query cache when a different user signs in', async () => {
    const clear = jest.spyOn(queryClient, 'clear');
    renderHook(() => useSession(), { wrapper });
    emit('INITIAL_SESSION', session('u1'));
    expect(clear).not.toHaveBeenCalled();
    emit('TOKEN_REFRESHED', session('u1'));
    expect(clear).not.toHaveBeenCalled();
    emit('SIGNED_IN', session('u2'));
    expect(clear).toHaveBeenCalledTimes(1);
    clear.mockRestore();
  });

  it('raises passwordRecovery on PASSWORD_RECOVERY until a new password is saved', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    emit('PASSWORD_RECOVERY', session('u1'));
    await waitFor(() => expect(result.current.passwordRecovery).toBe(true));
    await act(() => result.current.updatePassword('new-password-1'));
    expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: 'new-password-1' });
    expect(result.current.passwordRecovery).toBe(false);
  });

  it('runs token auto refresh only in the foreground', () => {
    const listeners: ((s: string) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      cb: (s: string) => void,
    ) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener);
    renderHook(() => useSession(), { wrapper });
    act(() => listeners.forEach((cb) => cb('background')));
    expect(mockAuth.stopAutoRefresh).toHaveBeenCalled();
    act(() => listeners.forEach((cb) => cb('active')));
    expect(mockAuth.startAutoRefresh).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('auth actions', () => {
  it('sends email links back to the app callback (PKCE)', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(() => result.current.sendEmailSignIn(' a@b.com '));
    expect(mockAuth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      options: { emailRedirectTo: AUTH_CALLBACK_URL, shouldCreateUser: true },
    });
    await act(() => result.current.requestPasswordReset('a@b.com'));
    expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.com', {
      redirectTo: AUTH_CALLBACK_URL,
    });
  });

  it('reports a signup that needs email confirmation', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    let outcome: { confirmationRequired: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.signUpWithPassword({ name: 'Alex', email: 'a@b.com', password: 'pw-12345678' });
    });
    expect(outcome).toEqual({ confirmationRequired: true });
    expect(mockAuth.signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw-12345678',
      options: { emailRedirectTo: AUTH_CALLBACK_URL, data: { full_name: 'Alex' } },
    });
  });

  it('exchanges the callback code, and surfaces an error redirect without exchanging', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(() => result.current.completeAuthRedirect({ code: 'pkce-code' }));
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');

    mockAuth.exchangeCodeForSession.mockClear();
    await expect(
      result.current.completeAuthRedirect({ error: 'otp_expired', errorDescription: 'Link expired' }),
    ).rejects.toBeInstanceOf(AuthRedirectError);
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('verifies typed codes with the right OTP type', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(() => result.current.verifyEmailCode('a@b.com', ' 123456 '));
    expect(mockAuth.verifyOtp).toHaveBeenLastCalledWith({ email: 'a@b.com', token: '123456', type: 'email' });
    await act(() => result.current.verifyRecoveryCode('a@b.com', '654321'));
    expect(mockAuth.verifyOtp).toHaveBeenLastCalledWith({ email: 'a@b.com', token: '654321', type: 'recovery' });
  });

  it('throws GoTrue errors to the caller', async () => {
    const failure = Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' });
    mockAuth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: failure } as never);
    const { result } = renderHook(() => useSession(), { wrapper });
    await expect(result.current.signInWithPassword({ email: 'a@b.com', password: 'x' })).rejects.toBe(failure);
  });

  it('signs out this device only', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(() => result.current.signOut());
    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
