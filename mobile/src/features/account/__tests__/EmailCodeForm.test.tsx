import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { EmailCodeForm, RESEND_COOLDOWN_SECONDS } from '../EmailCodeForm';

afterEach(() => {
  jest.useRealTimers();
});

function renderForm(onSubmitCode = jest.fn(async () => undefined), onResend = jest.fn(async () => undefined)) {
  render(
    <EmailCodeForm email="alex@example.com" intro="Enter the code we sent to" onSubmitCode={onSubmitCode} onResend={onResend} />,
  );
  return { onSubmitCode, onResend };
}

describe('EmailCodeForm', () => {
  it('keeps only the digits of a pasted code, up to six', async () => {
    const { onSubmitCode } = renderForm();
    fireEvent.changeText(screen.getByLabelText('6-digit code'), '123 456 7');
    expect(screen.getByLabelText('6-digit code').props.value).toBe('123456');

    // The return key submits.
    fireEvent(screen.getByLabelText('6-digit code'), 'submitEditing');
    await waitFor(() => expect(onSubmitCode).toHaveBeenCalledWith('123456'));
  });

  it('waits out a cooldown, then sends a new code and says so', async () => {
    jest.useFakeTimers();
    const { onResend } = renderForm();

    const button = screen.getByLabelText('Send a new code');
    expect(button.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(screen.getByText(`Send a new code in ${RESEND_COOLDOWN_SECONDS}s`)).toBeTruthy();
    fireEvent.press(button);
    expect(onResend).not.toHaveBeenCalled();

    for (let i = 0; i < RESEND_COOLDOWN_SECONDS; i += 1) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    fireEvent.press(screen.getByLabelText('Send a new code'));
    await act(async () => undefined);

    expect(onResend).toHaveBeenCalledTimes(1);
    expect(screen.getByText('New code sent to alex@example.com.')).toBeTruthy();
    // And the cooldown starts again.
    expect(screen.getByText(`Send a new code in ${RESEND_COOLDOWN_SECONDS}s`)).toBeTruthy();
  });
});
