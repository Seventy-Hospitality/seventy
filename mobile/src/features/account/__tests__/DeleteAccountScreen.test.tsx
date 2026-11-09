import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, TEST_CLUB_ID } from '../../../lib/clutch/testing';
import { makeAuthIdentity, makeAuthSession, makeDeletionPreview } from '../../../lib/clutch/fixtures';
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

const mockSetSession = jest.fn(async () => undefined);
jest.mock('../../../lib/auth-session', () => ({
  sessionStore: { set: (...args: unknown[]) => mockSetSession(...(args as [])), setRefresher: jest.fn() },
}));

const mockAuth = mockClutch.auth;
const session = (userId: string) => makeAuthSession({ user: { id: userId, email: 'alex@example.com' } });

const STALE = makeDeletionPreview().step_up;

function stepUp(satisfied: boolean, over: Partial<typeof STALE> = {}) {
  return { ...STALE, satisfied, reason: satisfied ? null : 'stale_sign_in', ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.identities.mockResolvedValue([makeAuthIdentity()]);
  mockAuth.token.mockResolvedValue(session('user-1'));
  mockAuth.sendCode.mockResolvedValue({ ok: true, message: 'sent' });
  mockAuth.verifyCode.mockResolvedValue(session('user-1'));
  mockClutch.me.deleteAccount.mockResolvedValue({ deleted: true });
  mockClutch.me.accountDeletion.mockResolvedValue(makeDeletionPreview());
  mockClutch.me.unregisterDevice.mockResolvedValue({ removed: true });
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
    expect(mockAuth.token).toHaveBeenCalledWith('alex@example.com', 'hunter2');
    expect(mockSetSession).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'user-1' }) }));
    expect(mockClutch.me.deleteAccount).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(mockAuth.token.mock.invocationCallOrder[0]).toBeLessThan(
      mockClutch.me.deleteAccount.mock.invocationCallOrder[0],
    );
    expect(mockReplace).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('steps up with an emailed code that never creates an account', async () => {
    renderWithProviders(<DeleteAccountScreen />);
    fireEvent.press(await screen.findByLabelText('I understand this permanently deletes my account'));
    fireEvent.press(screen.getByLabelText('Email me a code'));
    await waitFor(() =>
      expect(mockAuth.sendCode).toHaveBeenCalledWith({ email: 'alex@example.com', create_user: false }),
    );
    fireEvent.changeText(await screen.findByLabelText('Code'), '123456');
    fireEvent.press(screen.getByLabelText('Delete with code'));

    await waitFor(() => expect(mockClutch.me.deleteAccount).toHaveBeenCalled());
    expect(mockAuth.verifyCode).toHaveBeenCalledWith('alex@example.com', '123456');
  });

  it('shows blockers up front, before asking anyone to sign in again', async () => {
    mockClutch.me.accountDeletion.mockResolvedValue(
      makeDeletionPreview({
        blockers: { owned_clubs: [{ club_id: TEST_CLUB_ID, club_name: 'Seventy' }], managed_children: [] },
      }),
    );
    renderWithProviders(<DeleteAccountScreen />);

    expect(await screen.findByText(/You own Seventy/)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(mockClutch.me.deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes without a new sign-in when the session is fresh enough', async () => {
    mockClutch.me.accountDeletion.mockResolvedValue(makeDeletionPreview({ step_up: stepUp(true) }));
    renderWithProviders(<DeleteAccountScreen />);

    fireEvent.press(await screen.findByLabelText('I understand this permanently deletes my account'));
    fireEvent.press(screen.getByLabelText('Delete my account'));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockAuth.token).not.toHaveBeenCalled();
    expect(mockClutch.me.deleteAccount).toHaveBeenCalled();
  });

  it('lists the blockers a 409 account_deletion_blocked carries and does not sign out', async () => {
    mockClutch.me.deleteAccount.mockRejectedValue(
      clutchError('account_deletion_blocked', 409, {
        owned_clubs: [],
        managed_children: [{ link_id: 'l1', name: 'Sam' }],
      }),
    );
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    expect(await screen.findByText(/only guardian of Sam/)).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('says a refund is still on its way on refunds_pending', async () => {
    mockClutch.me.deleteAccount.mockRejectedValue(clutchError('refunds_pending', 409));
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    expect(await screen.findByText(/refund is still on its way/)).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('asks for a fresh sign-in again on step_up_required', async () => {
    mockClutch.me.deleteAccount.mockRejectedValue(clutchError('step_up_required', 403, stepUp(false)));
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    expect(await screen.findByText(/confirm it is you again/)).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('never deletes, nor adopts the session, when the sign-in is another account', async () => {
    mockAuth.token.mockResolvedValue(session('someone-else'));
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    expect(await screen.findByText(/belongs to a different account/)).toBeTruthy();
    expect(mockClutch.me.deleteAccount).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe('DeleteAccountScreen push and second factor', () => {
  it('stops push to this install before the delete, while the session still authenticates', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true, canAskAgain: true });
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockClutch.me.unregisterDevice).toHaveBeenCalledWith('ExponentPushToken[test]', expect.anything());
    expect(mockClutch.me.unregisterDevice.mock.invocationCallOrder[0]).toBeLessThan(
      mockClutch.me.deleteAccount.mock.invocationCallOrder[0],
    );
  });

  it('offers no step-up that cannot pass for a second-factor account, and points to the website', async () => {
    mockClutch.me.accountDeletion.mockResolvedValue(
      makeDeletionPreview({ step_up: stepUp(false, { second_factor_required: true }) }),
    );
    mockAuth.identities.mockResolvedValue([
      makeAuthIdentity(),
      makeAuthIdentity({ identity_id: 'identity-google', provider: 'google' }),
    ]);
    renderWithProviders(<DeleteAccountScreen />);

    expect(await screen.findByText(/Club70 website/)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByLabelText('Email me a code')).toBeNull();
    expect(screen.queryByLabelText('Delete with Google')).toBeNull();
  });

  it('drops the methods when a delete reveals a second factor', async () => {
    mockClutch.me.deleteAccount.mockRejectedValue(
      clutchError('step_up_required', 403, stepUp(false, { second_factor_required: true })),
    );
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();

    expect(await screen.findByText(/Club70 website/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull());
  });

  it('Check again clears the refused delete and shows what Clutch says now', async () => {
    mockClutch.me.deleteAccount.mockRejectedValueOnce(
      clutchError('account_deletion_blocked', 409, { owned_clubs: [], managed_children: [{ link_id: 'l1', name: 'Sam' }] }),
    );
    renderWithProviders(<DeleteAccountScreen />);
    await confirmWithPassword();
    expect(await screen.findByText(/only guardian of Sam/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Check again'));

    expect(await screen.findByLabelText('I understand this permanently deletes my account')).toBeTruthy();
    expect(screen.queryByText(/only guardian of Sam/)).toBeNull();
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
