import { Controller } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { emailCodeSchema, useZodForm } from '../../lib/forms';
import { authErrorMessage } from '../../lib/auth-errors';
import { FormField, Input } from '../../components/FormField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { colors, spacing, typography } from '../../theme/tokens';

/**
 * The 6-digit code every GoTrue email carries, for when the link opens on a
 * different device (the PKCE link only completes on the phone that asked).
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

  const submit = form.handleSubmit(async ({ code }) => {
    try {
      await onSubmitCode(code);
    } catch (err) {
      form.setError('code', { message: authErrorMessage(err, 'That code did not work.') });
    }
  });

  const resend = async () => {
    if (!onResend) return;
    try {
      await onResend();
      form.clearErrors('code');
    } catch (err) {
      form.setError('code', { message: authErrorMessage(err) });
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
          <FormField label="6-digit code" error={fieldState.error?.message}>
            <Input
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              keyboardType="number-pad"
              maxLength={6}
              placeholder="123456"
              hasError={Boolean(fieldState.error)}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
            />
          </FormField>
        )}
      />
      <PrimaryButton label={submitLabel} loading={form.formState.isSubmitting} onPress={() => void submit()} />
      {onResend ? (
        <PrimaryButton label="Send a new email" variant="ghost" onPress={() => void resend()} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  intro: { ...typography.body, color: colors.textMuted },
  email: { ...typography.bodyStrong, color: colors.text },
});
