import { useState } from 'react';
import { Link, Redirect, useRouter } from 'expo-router';
import { Controller } from 'react-hook-form';
import { Text, View } from 'react-native';
import { useSession } from '../../lib/session';
import { authErrorCode, authErrorMessage } from '../../lib/auth-errors';
import { signUpSchema, useZodForm } from '../../lib/forms';
import { AppScreen } from '../../components/AppScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SectionCard } from '../../components/SectionCard';
import { FormField, Input, PasswordInput } from '../../components/FormField';
import { useToast } from '../../components/toast-context';
import { OAuthButtons } from './OAuthButtons';
import { EmailCodeForm } from './EmailCodeForm';
import { authStyles as styles } from './auth-styles';

/**
 * Create a Club70 login through Clutch. Clutch emails a 6-digit code that
 * creates the account and confirms the address in one step; the chosen
 * password is set right after (if it does not save, the member is asked for
 * it again before anything else). Joining the club and choosing a tier happen
 * next, in onboarding.
 *
 * Clutch does not say whether the address already had an account (an existing
 * one simply gets a sign-in code), so neither does this screen.
 */
export function SignUpScreen() {
  const router = useRouter();
  const { status, sendSignUpCode, confirmSignUp } = useSession();
  const { toast } = useToast();
  const [pending, setPending] = useState<{ name: string; email: string; password: string } | null>(null);

  const form = useZodForm(signUpSchema, { defaultValues: { name: '', email: '', password: '' } });

  if (status === 'authenticated') return <Redirect href="/" />;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await sendSignUpCode({ name: values.name, email: values.email });
      setPending({ name: values.name, email: values.email.trim(), password: values.password });
    } catch (err) {
      if (authErrorCode(err) === 'invalid_field') {
        form.setError('email', { message: authErrorMessage(err) });
        return;
      }
      toast({ variant: 'error', message: authErrorMessage(err, 'Unable to create your account right now.') });
    }
  });
  const confirmEmail = pending?.email ?? null;

  return (
    <AppScreen contentStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Club70</Text>
        <Text style={styles.title}>{confirmEmail ? 'Confirm your email' : 'Create your account'}</Text>
        <Text style={styles.subtitle}>
          {confirmEmail ? 'One more step and you are in.' : 'A few details and you are in.'}
        </Text>
      </View>

      <SectionCard>
        {confirmEmail ? (
          <EmailCodeForm
            email={confirmEmail}
            intro="Enter the code we sent to"
            submitLabel="Confirm"
            onSubmitCode={(code) => confirmSignUp({ email: confirmEmail, code, password: pending!.password })}
            onResend={() => sendSignUpCode({ name: pending!.name, email: confirmEmail })}
          />
        ) : (
          <View style={styles.form}>
            <Controller
              control={form.control}
              name="name"
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <FormField label="Full name" error={fieldState.error?.message}>
                  <Input
                    autoComplete="name"
                    placeholder="Alex Morgan"
                    hasError={Boolean(fieldState.error)}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                  />
                </FormField>
              )}
            />
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
            <Controller
              control={form.control}
              name="password"
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <FormField label="Password" error={fieldState.error?.message} hint="At least 8 characters.">
                  <PasswordInput
                    autoComplete="new-password"
                    placeholder="Create a password"
                    hasError={Boolean(fieldState.error)}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                  />
                </FormField>
              )}
            />
            <PrimaryButton
              label="Create Account"
              loading={form.formState.isSubmitting}
              onPress={() => void onSubmit()}
            />
          </View>
        )}
      </SectionCard>

      {confirmEmail ? null : (
        <>
          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerLabel}>or</Text>
            <View style={styles.divider} />
          </View>
          <OAuthButtons />
        </>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already a member?</Text>
        <Link href="/auth/sign-in" style={styles.link} onPress={() => router.back()}>
          Sign in
        </Link>
      </View>
    </AppScreen>
  );
}
