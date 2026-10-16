import { useState } from 'react';
import { Link } from 'expo-router';
import { Controller } from 'react-hook-form';
import { Text, View } from 'react-native';
import { useSession } from '../../lib/session';
import { emailOnlySchema, useZodForm } from '../../lib/forms';
import { AppScreen } from '../../components/AppScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SectionCard } from '../../components/SectionCard';
import { FormField, Input } from '../../components/FormField';
import { EmailCodeForm } from './EmailCodeForm';
import { authStyles as styles } from './auth-styles';

/**
 * Password reset. GoTrue emails a link (PKCE, back to this app) and a code;
 * either signs the user in in recovery mode, and the root layout then routes
 * to /auth/set-password before anything else.
 */
export function ForgotPasswordScreen() {
  const { requestPasswordReset, verifyRecoveryCode } = useSession();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useZodForm(emailOnlySchema, { defaultValues: { email: '' } });

  // GoTrue answers the same whether or not the address exists (no
  // enumeration), so the confirmation is shown either way.
  const onSubmit = form.handleSubmit(async ({ email }) => {
    await requestPasswordReset(email).catch(() => undefined);
    setSentTo(email.trim());
  });

  return (
    <AppScreen contentStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Club70</Text>
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>We will email you a link and a code to set a new password.</Text>
      </View>

      <SectionCard>
        {sentTo ? (
          <EmailCodeForm
            email={sentTo}
            intro="If an account exists, the email is on its way. Tap its link on this phone, or enter the code sent to"
            onSubmitCode={(code) => verifyRecoveryCode(sentTo, code)}
            onResend={() => requestPasswordReset(sentTo)}
          />
        ) : (
          <View style={styles.form}>
            <Controller
              control={form.control}
              name="email"
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <FormField label="Email" error={fieldState.error?.message}>
                  <Input
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    placeholder="you@club70.com"
                    hasError={Boolean(fieldState.error)}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                  />
                </FormField>
              )}
            />
            <PrimaryButton
              label="Send Reset Email"
              loading={form.formState.isSubmitting}
              onPress={() => void onSubmit()}
            />
          </View>
        )}
      </SectionCard>

      <Link href="/auth/sign-in" style={styles.link}>
        Back to sign in
      </Link>
    </AppScreen>
  );
}
