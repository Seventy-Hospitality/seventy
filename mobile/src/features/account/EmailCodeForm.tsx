import { useEffect, useState } from 'react';
import { Controller } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { emailCodeSchema, useZodForm } from '../../lib/forms';
import { authErrorMessage, codeErrorMessage } from '../../lib/auth-errors';
import { FormField, Input } from '../../components/FormField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { colors, spacing, typography } from '../../theme/tokens';
import { codeDigits } from './account-lib';

/** Seconds between "Send a new code" taps (a code was just sent on arrival too). */
export const RESEND_COOLDOWN_SECONDS = 30;

/**
 * The 6-digit code every Club70 sign-in email carries: typed here, sent to
 * Clutch, which answers a session. There are no links to tap.
 */
export function EmailCodeForm({
  email,
  intro,
  submitLabel = 'Continue',
  onSubmitCode,
  onResend,
}: {
  email: string;
  intro: string;
  submitLabel?: string;
  onSubmitCode: (code: string) => Promise<void>;
  onResend?: () => Promise<void>;
}) {
  const form = useZodForm(emailCodeSchema, { defaultValues: { code: '' } });
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = form.handleSubmit(async ({ code }) => {
    try {
      await onSubmitCode(code);
    } catch (err) {
      form.setError('code', { message: codeErrorMessage(err) });
    }
  });

  const resend = async () => {
    if (!onResend || resending || cooldown > 0) return;
    setResending(true);
    try {
      await onResend();
      form.clearErrors('code');
      setResent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setResent(false);
      form.setError('code', { message: authErrorMessage(err) });
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={styles.stack}>
      <Text style={styles.intro}>
        {intro} <Text style={styles.email}>{email}</Text>
      </Text>
      <Controller
        control={form.control}
        name="code"
        render={({ field: { onBlur, onChange, value }, fieldState }) => (
          <FormField
            label="6-digit code"
            error={fieldState.error?.message}
            hint={resent ? `New code sent to ${email}.` : undefined}
          >
            <Input
              accessibilityLabel="6-digit code"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              keyboardType="number-pad"
              returnKeyType="go"
              placeholder="123456"
              hasError={Boolean(fieldState.error)}
              onBlur={onBlur}
              onChangeText={(text) => onChange(codeDigits(text))}
              onSubmitEditing={() => void submit()}
              value={value}
            />
          </FormField>
        )}
      />
      <PrimaryButton label={submitLabel} loading={form.formState.isSubmitting} onPress={() => void submit()} />
      {onResend ? (
        <PrimaryButton
          label={cooldown > 0 && !resending ? `Send a new code in ${cooldown}s` : 'Send a new code'}
          accessibilityLabel="Send a new code"
          variant="ghost"
          loading={resending}
          disabled={cooldown > 0}
          onPress={() => void resend()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  intro: { ...typography.body, color: colors.textMuted },
  email: { ...typography.bodyStrong, color: colors.text },
});
