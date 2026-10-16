import { useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { Controller } from 'react-hook-form';
import { Text, View } from 'react-native';
import { useSession } from '../../lib/session';
import { authErrorMessage } from '../../lib/auth-errors';
import { signInSchema, emailOnlySchema, useZodForm } from '../../lib/forms';
import { AppScreen } from '../../components/AppScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SectionCard } from '../../components/SectionCard';
import { FormField, Input, PasswordInput } from '../../components/FormField';
import { SegmentedControl } from '../../components/SegmentedControl';
import { OAuthButtons } from './OAuthButtons';
import { EmailCodeForm } from './EmailCodeForm';
import { authStyles as styles } from './auth-styles';

type Mode = 'password' | 'email';

export function SignInScreen() {
  const { status, configured, signInWithPassword, sendEmailSignIn, verifyEmailCode } = useSession();
  const [mode, setMode] = useState<Mode>('password');
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  const passwordForm = useZodForm(signInSchema, { defaultValues: { email: '', password: '' } });
  const emailForm = useZodForm(emailOnlySchema, { defaultValues: { email: '' } });

  if (status === 'authenticated') {
    // '/' funnels through the onboarding gate (join club, tier, then tabs).
    return <Redirect href="/" />;
  }

  const onPassword = passwordForm.handleSubmit(async (values) => {
    try {
      await signInWithPassword(values);
    } catch (err) {
      passwordForm.setError('password', { message: authErrorMessage(err, 'Unable to sign in right now.') });
    }
  });

  const onEmail = emailForm.handleSubmit(async ({ email }) => {
    try {
      await sendEmailSignIn(email);
      setEmailSentTo(email.trim());
    } catch (err) {
      emailForm.setError('email', { message: authErrorMessage(err, 'Unable to send the email right now.') });
    }
  });

  return (
    <AppScreen contentStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Club70</Text>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to book courts, see your groups, and manage your membership.</Text>
      </View>

      {!configured ? (
        <SectionCard>
          <Text style={styles.subtitle}>Sign-in is not configured for this build.</Text>
        </SectionCard>
      ) : null}

      <SectionCard>
        <SegmentedControl
          label="Sign-in method"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setEmailSentTo(null);
          }}
          options={[
            { value: 'password', label: 'Password' },
            { value: 'email', label: 'Email me a code' },
          ]}
        />

        {mode === 'password' ? (
          <View style={styles.form}>
            <Controller
              control={passwordForm.control}
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
            <Controller
              control={passwordForm.control}
              name="password"
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <FormField label="Password" error={fieldState.error?.message}>
                  <PasswordInput
                    autoComplete="password"
                    placeholder="Your password"
                    hasError={Boolean(fieldState.error)}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                  />
                </FormField>
              )}
            />
            <PrimaryButton
              label="Sign In"
              loading={passwordForm.formState.isSubmitting}
              onPress={() => void onPassword()}
            />
            <Link href="/auth/forgot-password" style={styles.link}>
              Forgot password?
            </Link>
          </View>
        ) : emailSentTo ? (
          <EmailCodeForm
            email={emailSentTo}
            intro="Tap the link in the email on this phone, or enter the code we sent to"
            submitLabel="Sign In"
            onSubmitCode={(code) => verifyEmailCode(emailSentTo, code)}
            onResend={() => sendEmailSignIn(emailSentTo)}
          />
        ) : (
          <View style={styles.form}>
            <Controller
              control={emailForm.control}
              name="email"
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <FormField
                  label="Email"
                  error={fieldState.error?.message}
                  hint="We email a sign-in link and a 6-digit code."
                >
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
              label="Email Me"
              loading={emailForm.formState.isSubmitting}
              onPress={() => void onEmail()}
            />
          </View>
        )}
      </SectionCard>

      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerLabel}>or</Text>
        <View style={styles.divider} />
      </View>

      <OAuthButtons />

      <View style={styles.footer}>
        <Text style={styles.footerText}>New to Club70?</Text>
        <Link href="/auth/sign-up" style={styles.link}>
          Create an account
        </Link>
      </View>
    </AppScreen>
  );
}
