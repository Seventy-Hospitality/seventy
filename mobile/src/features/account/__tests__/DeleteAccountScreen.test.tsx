import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError } from '../../../lib/clutch/testing';
import { DeleteAccountScreen } from '../DeleteAccountScreen';
import { stepUpMethods } from '../step-up';
import { renderWithProviders } from './render-account';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
}));

const mockSignOut = jest.fn(async () => undefined);
jest.mock('../../../lib/session', () => ({
  useSession: () => ({ status: 'authenticated', userId: 'user-1', email: 'alex@example.com', signOut: mockSignOut }),
}));

const mockAuth = {
  getUserIdentities: jest.fn(),
  signInWithPassword: jest.fn(),
  signInWithOtp: jest.fn(),
  verifyOtp: jest.fn(),
  signInWithIdToken: jest.fn(),
};
jest.mock('../../../lib/supabase', () => ({
  getSupabase: () => ({ auth: mockAuth }),
  isSupabaseConfigured: () => true,
  SupabaseNotConfiguredError: class extends Error {},
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.getUserIdentities.mockResolvedValue({ data: { identities: [{ provider: 'email' }] }, error: null });
  mockAuth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mockAuth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  mockAuth.verifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mockClutch.me.deleteAccount.mockResolvedValue({ status: 'deleted' });
});

async function confirmWithPassword() {
  fireEvent.press(await screen.findByLabelText('I understand this permanently deletes my account'));
  fireEvent.changeText(screen.getByLabelText('Password'), 'hunter2');
  fireEvent.press(screen.getByLabelText('Delete with password'));
}

describe('DeleteAccountScreen', () => {
  it('signs in afresh with the password, then deletes, then signs out locally', async () => {
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: 'alex@example.com', password: 'hunter2' });
    expect(mockClutch.me.deleteAccount).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(mockAuth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
      mockClutch.me.deleteAccount.mock.invocationCallOrder[0],
    );
    expect(mockReplace).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('steps up with an emailed code that never creates an account', async () => {
    renderWithProviders(<DeleteAccountScreen />);
    fireEvent.press(await screen.findByLabelText('I understand this permanently deletes my account'));
    fireEvent.press(screen.getByLabelText('Email me a code'));
    await waitFor(() =>
      expect(mockAuth.signInWithOtp).toHaveBeenCalledWith({
        email: 'alex@example.com',
        options: { shouldCreateUser: false },
      }),
    );
    fireEvent.changeText(await screen.findByLabelText('Code'), '123456');
    fireEvent.press(screen.getByLabelText('Delete with code'));

    await waitFor(() => expect(mockClutch.me.deleteAccount).toHaveBeenCalled());
    expect(mockAuth.verifyOtp).toHaveBeenCalledWith({ email: 'alex@example.com', token: '123456', type: 'email' });
  });

  it('lists the blockers Clutch returns and does not sign out', async () => {
    mockClutch.me.deleteAccount.mockRejectedValue(
      clutchError('deletion_blocked', 409, {
        blockers: [{ code: 'open_dispute', message: 'A payment dispute is still open.' }],
      }),
    );
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    expect(await screen.findByText('A payment dispute is still open.')).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('asks for a fresh sign-in again on step_up_required', async () => {
    mockClutch.me.deleteAccount.mockRejectedValue(clutchError('step_up_required', 403));
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    expect(await screen.findByText(/confirm it is you again/)).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('never deletes when the sign-in lands on another account', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'someone-else' } }, error: null });
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockClutch.me.deleteAccount).not.toHaveBeenCalled();
  });
});

describe('stepUpMethods', () => {
  it('offers password and code for an email identity, and each linked provider', () => {
    expect(stepUpMethods([{ provider: 'email' }, { provider: 'apple' }])).toEqual([
      { kind: 'password' },
      { kind: 'code' },
      { kind: 'federated', provider: 'apple' },
    ]);
    expect(stepUpMethods([{ provider: 'google' }])).toEqual([{ kind: 'federated', provider: 'google' }]);
  });
});
