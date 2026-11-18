import type { ReactNode } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { clutchError } from '../../../lib/clutch/testing';
import { ForgotPasswordScreen } from '../ForgotPasswordScreen';
import { OAuthButtons } from '../OAuthButtons';
import { SignInScreen } from '../SignInScreen';
import { SignUpScreen } from '../SignUpScreen';
import { renderWithProviders } from './render-account';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack }),
  Redirect: ({ href }: { href: string }) => {
    const { Text: RNText } = jest.requireActual('react-native');
    return <RNText>{`redirect:${href}`}</RNText>;
  },
  Link: ({ children }: { children: ReactNode }) => {
    const { Text: RNText } = jest.requireActual('react-native');
    return <RNText>{children}</RNText>;
  },
}));

const mockSession = {
  status: 'anonymous',
  oauth: { googleConfigured: true, appleConfigured: true },
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
  signInWithPassword: jest.fn(),
  sendEmailSignIn: jest.fn(async () => undefined),
  verifyEmailCode: jest.fn(),
  sendExistingAccountCode: jest.fn(),
  sendSignUpCode: jest.fn(async () => undefined),
  confirmSignUp: jest.fn(),
  requestPasswordReset: jest.fn(),
  verifyRecoveryCode: jest.fn(),
};
jest.mock('../../../lib/session', () => ({ useSession: () => mockSession }));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockSession.oauth = { googleConfigured: true, appleConfigured: true };
});

describe('OAuthButtons', () => {
  it('hides Google when it has no client id here, with no "not configured" note', () => {
    mockSession.oauth = { googleConfigured: false, appleConfigured: true };
    renderWithProviders(<OAuthButtons />);
    expect(screen.queryByLabelText('Continue with Google')).toBeNull();
    expect(screen.getByLabelText('Continue with Apple')).toBeTruthy();
    expect(screen.queryByText(/not configured/)).toBeNull();
  });

  it('renders nothing, not even the "or", with no provider', () => {
    mockSession.oauth = { googleConfigured: false, appleConfigured: false };
    renderWithProviders(<OAuthButtons />);
    expect(screen.queryByText('or')).toBeNull();
  });

  it('disables both providers while either is signing in', async () => {
    let finish: () => void = () => undefined;
    mockSession.signInWithGoogle.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    renderWithProviders(<OAuthButtons />);

    fireEvent.press(screen.getByLabelText('Continue with Google'));
    await waitFor(() =>
      expect(screen.getByLabelText('Continue with Apple').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      ),
    );
    fireEvent.press(screen.getByLabelText('Continue with Apple'));
    expect(mockSession.signInWithApple).not.toHaveBeenCalled();

    await act(async () => finish());
    expect(screen.getByLabelText('Continue with Apple').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
  });
});

describe('SignInScreen', () => {
  it('moves from email to password on the return key', () => {
    renderWithProviders(<SignInScreen />);
    expect(screen.getByLabelText('Email').props.returnKeyType).toBe('next');
    expect(screen.getByLabelText('Password').props.returnKeyType).toBe('go');
  });

  it('goes back to the email form from the code step', async () => {
    renderWithProviders(<SignInScreen />);
    fireEvent.press(screen.getByText('Email me a code'));
    fireEvent.changeText(screen.getByLabelText('Email'), 'alex@example.com');
    fireEvent.press(screen.getByLabelText('Email Me'));

    expect(await screen.findByLabelText('6-digit code')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Use a different email'));
    expect(screen.getByLabelText('Email Me')).toBeTruthy();
  });
});

describe('SignUpScreen', () => {
  async function fillAndSubmit() {
    fireEvent.changeText(screen.getByLabelText('Full name'), 'Alex Morgan');
    fireEvent.changeText(screen.getByLabelText('Email'), 'alex@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'long-enough-password');
    fireEvent.press(screen.getByLabelText('Create Account'));
  }

  it('shows a server failure above the button and stays there', async () => {
    mockSession.sendSignUpCode.mockRejectedValueOnce(clutchError('internal_error', 500));
    renderWithProviders(<SignUpScreen />);
    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Create Account')).toBeTruthy();
  });

  it('goes back to the form from the code step', async () => {
    renderWithProviders(<SignUpScreen />);
    await fillAndSubmit();

    expect(await screen.findByLabelText('6-digit code')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Use a different email'));
    expect(screen.getByLabelText('Create Account')).toBeTruthy();
  });

  it('"Sign in" goes back once, or replaces with no history', () => {
    const view = renderWithProviders(<SignUpScreen />);
    fireEvent.press(screen.getByText('Sign in'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    view.unmount();
    mockCanGoBack = false;
    renderWithProviders(<SignUpScreen />);
    fireEvent.press(screen.getByText('Sign in'));
    expect(mockReplace).toHaveBeenCalledWith('/auth/sign-in');
  });
});

describe('ForgotPasswordScreen', () => {
  it('"Back to sign in" goes back instead of stacking another sign-in', () => {
    renderWithProviders(<ForgotPasswordScreen />);
    fireEvent.press(screen.getByText('Back to sign in'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
