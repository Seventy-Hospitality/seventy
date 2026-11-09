import { Alert } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { makeAuthIdentity, makeAuthSession } from '../../../lib/clutch/fixtures';
import { SignInMethodsScreen } from '../SignInMethodsScreen';
import { renderWithProviders } from './render-account';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('../../../lib/session', () => ({
  useSession: () => ({ email: 'alex@example.com', oauth: { googleConfigured: true, appleConfigured: false } }),
}));

const mockSetSession = jest.fn(async () => undefined);
jest.mock('../../../lib/auth-session', () => ({
  sessionStore: { set: (...args: unknown[]) => mockSetSession(...(args as [])), setRefresher: jest.fn() },
}));

jest.mock('../../../lib/oauth', () => {
  const actual = jest.requireActual('../../../lib/oauth');
  return {
    ...actual,
    getFederatedCredential: jest.fn(async () => ({ provider: 'google', token: 'google-id-token', nonce: 'raw-nonce' })),
  };
});

const GOOGLE = makeAuthIdentity({ identity_id: 'identity-google', provider: 'google', email: 'alex@gmail.com' });

beforeEach(() => {
  jest.clearAllMocks();
  mockClutch.auth.identities.mockResolvedValue([makeAuthIdentity()]);
});

describe('SignInMethodsScreen', () => {
  it('links Google through Clutch and adopts the session that carries it', async () => {
    const session = makeAuthSession({ access_token: 'linked' });
    mockClutch.auth.linkIdentity.mockResolvedValue(session);
    renderWithProviders(<SignInMethodsScreen />);
    fireEvent.press(await screen.findByLabelText('Link Google'));

    await waitFor(() =>
      expect(mockClutch.auth.linkIdentity).toHaveBeenCalledWith({
        provider: 'google',
        id_token: 'google-id-token',
        nonce: 'raw-nonce',
      }),
    );
    await waitFor(() => expect(mockSetSession).toHaveBeenCalledWith(session));
  });

  it('says so when that Google account is already linked', async () => {
    mockClutch.auth.linkIdentity.mockRejectedValue(clutchError('identity_already_linked', 409));
    renderWithProviders(<SignInMethodsScreen />);
    fireEvent.press(await screen.findByLabelText('Link Google'));
    expect(await screen.findByText('That sign-in method is already linked to an account.')).toBeTruthy();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('unlinks by identity id after confirming', async () => {
    mockClutch.auth.identities.mockResolvedValue([makeAuthIdentity(), GOOGLE]);
    mockClutch.auth.unlinkIdentity.mockResolvedValue({ ok: true });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    renderWithProviders(<SignInMethodsScreen />);
    expect(await screen.findByText('Linked · alex@gmail.com')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Unlink Google'));
    await waitFor(() => expect(mockClutch.auth.unlinkIdentity).toHaveBeenCalledWith('identity-google'));
    alert.mockRestore();
  });

  it('re-reads the list when the method was already unlinked elsewhere', async () => {
    mockClutch.auth.identities.mockResolvedValue([makeAuthIdentity(), GOOGLE]);
    mockClutch.auth.unlinkIdentity.mockRejectedValue(clutchError('identity_not_found', 404));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    renderWithProviders(<SignInMethodsScreen />);
    expect(await screen.findByText('Linked · alex@gmail.com')).toBeTruthy();
    const reads = mockClutch.auth.identities.mock.calls.length;
    fireEvent.press(screen.getByLabelText('Unlink Google'));
    expect(await screen.findByText('That sign-in method is no longer linked.')).toBeTruthy();
    await waitFor(() => expect(mockClutch.auth.identities.mock.calls.length).toBeGreaterThan(reads));
    alert.mockRestore();
  });
});
