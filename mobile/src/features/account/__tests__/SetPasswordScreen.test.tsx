import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import { WrongAccountError } from '../../../lib/same-member';
import { SetPasswordScreen } from '../SetPasswordScreen';
import { renderWithProviders } from './render-account';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('./../usePushRegistration', () => ({ unregisterPushForSignOut: jest.fn(async () => undefined) }));

const mockSession = {
  email: 'alex@example.com',
  updatePassword: jest.fn(async (_password: string) => undefined),
  signOut: jest.fn(async () => undefined),
  sendExistingAccountCode: jest.fn(async (_email: string) => undefined),
  reconfirmWithCode: jest.fn(async (_email: string, _code: string) => undefined),
};
jest.mock('../../../lib/session', () => ({ useSession: () => mockSession }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.updatePassword.mockResolvedValue(undefined);
});

function typePassword(password = 'new-password-1') {
  fireEvent.changeText(screen.getByLabelText('New password'), password);
  fireEvent.changeText(screen.getByLabelText('Confirm password'), password);
  fireEvent.press(screen.getByText('Save Password'));
}

describe('SetPasswordScreen', () => {
  it('saves the password and goes home', async () => {
    renderWithProviders(<SetPasswordScreen />);
    typePassword();
    await waitFor(() => expect(mockSession.updatePassword).toHaveBeenCalledWith('new-password-1'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('asks for a fresh code when the session is too old, then saves the password already typed', async () => {
    mockSession.updatePassword.mockRejectedValueOnce(clutchError('step_up_required', 403));
    renderWithProviders(<SetPasswordScreen />);
    typePassword();

    expect(await screen.findByText('Confirm it is you')).toBeTruthy();
    expect(mockSession.sendExistingAccountCode).toHaveBeenCalledWith('alex@example.com');

    fireEvent.changeText(screen.getByLabelText('6-digit code'), '123456');
    fireEvent.press(screen.getByText('Save Password'));

    await waitFor(() => expect(mockSession.reconfirmWithCode).toHaveBeenCalledWith('alex@example.com', '123456'));
    await waitFor(() => expect(mockSession.updatePassword).toHaveBeenCalledTimes(2));
    expect(mockSession.updatePassword).toHaveBeenLastCalledWith('new-password-1');
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('keeps the member on the code step when the code is wrong', async () => {
    mockSession.updatePassword.mockRejectedValueOnce(clutchError('step_up_required', 403));
    mockSession.reconfirmWithCode.mockRejectedValueOnce(clutchError('invalid_credentials', 401));
    renderWithProviders(<SetPasswordScreen />);
    typePassword();
    fireEvent.changeText(await screen.findByLabelText('6-digit code'), '000000');
    fireEvent.press(screen.getByText('Save Password'));
    expect(await screen.findByText('That code is wrong, expired or already used. Ask for a new one.')).toBeTruthy();
    expect(mockSession.updatePassword).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not save the password when the code signs in a different account', async () => {
    mockSession.updatePassword.mockRejectedValueOnce(clutchError('step_up_required', 403));
    mockSession.reconfirmWithCode.mockRejectedValueOnce(new WrongAccountError());
    renderWithProviders(<SetPasswordScreen />);
    typePassword();
    fireEvent.changeText(await screen.findByLabelText('6-digit code'), '123456');
    fireEvent.press(screen.getByText('Save Password'));
    expect(
      await screen.findByText('That code signed in a different account. Sign out, then sign in again.'),
    ).toBeTruthy();
    expect(screen.getByText('Choose a new password')).toBeTruthy();
    expect(mockSession.updatePassword).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it.each([
    [clutchError('mfa_required', 401), 'Your account uses an authenticator app, which this app does not support yet. Use the Club70 website for this.'],
    [clutchError('invalid_field', 400), 'That is already your password. Choose a different one.'],
    [clutchError('upstream_error', 502), 'Club70 could not finish that just now. Please try again.'],
    [clutchError('rate_limit_exceeded', 429), 'Too many attempts. Wait a minute and try again.'],
    [networkError(), 'Could not reach Club70. Check your connection.'],
  ])('explains %s without leaving the screen', async (err, message) => {
    mockSession.updatePassword.mockRejectedValueOnce(err);
    renderWithProviders(<SetPasswordScreen />);
    typePassword();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(mockSession.sendExistingAccountCode).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
