import { useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { Controller } from 'react-hook-form';
import { Pressable, Text, View, type TextInput } from 'react-native';
import { useSession } from '../../lib/session';
import { authErrorCode, authErrorMessage } from '../../lib/auth-errors';
import { signUpSchema, useZodForm } from '../../lib/forms';
import { AppScreen } from '../../components/AppScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SectionCard } from '../../components/SectionCard';
import { FormField, Input, PasswordInput } from '../../components/FormField';
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
  const [pending, setPending] = useState<{ name: string; email: string; password: string } | null>(null);
  /** A failure that is not about one field (no network, Clutch down), shown above the button. */
  const [submitError, setSubmitError] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const form = useZodForm(signUpSchema, { defaultValues: { name: '', email: '', password: '' } });

  if (status === 'authenticated') return <Redirect href="/" />;

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await sendSignUpCode({ name: values.name, email: values.email });
      setPending({ name: values.name, email: values.email.trim(), password: values.password });
    } catch (err) {
      if (authErrorCode(err) === 'invalid_field') {
        form.setError('email', { message: authErrorMessage(err) });
        return;
      }
      setSubmitError(authErrorMessage(err, 'Unable to create your account right now.'));
    }
  });
  const confirmEmail = pending?.email ?? null;

  // Sign-up is pushed from sign-in: go back to it rather than stacking another.
  const toSignIn = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/auth/sign-in');
  };

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
          <View style={styles.form}>
            <EmailCodeForm
              email={confirmEmail}
              intro="Enter the code we sent to"
              submitLabel="Confirm"
              onSubmitCode={(code) => confirmSignUp({ email: confirmEmail, code, password: pending!.password })}
              onResend={() => sendSignUpCode({ name: pending!.name, email: confirmEmail })}
            />
            <PrimaryButton label="Use a different email" variant="ghost" onPress={() => setPending(null)} />
          </View>
        ) : (
          <View style={styles.form}>
            <Controller
              control={form.control}
              name="name"
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <FormField label="Full name" error={fieldState.error?.message}>
                  <Input
                    accessibilityLabel="Full name"
                    autoComplete="name"
                    textContentType="name"
                    autoCapitalize="words"
                    placeholder="Alex Morgan"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => emailRef.current?.focus()}
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
                    ref={emailRef}
                    accessibilityLabel="Email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="username"
                    keyboardType="email-address"
                    placeholder="you@club70.com"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => passwordRef.current?.focus()}
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
                    ref={passwordRef}
                    accessibilityLabel="Password"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    placeholder="Create a password"
                    returnKeyType="go"
                    onSubmitEditing={() => void onSubmit()}
                    hasError={Boolean(fieldState.error)}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                  />
                </FormField>
              )}
            />
            {submitError ? (
              <Text style={styles.formError} accessibilityRole="alert">
                {submitError}
              </Text>
            ) : null}
            <PrimaryButton
              label="Create Account"
              loading={form.formState.isSubmitting}
              onPress={() => void onSubmit()}
            />
          </View>
        )}
      </SectionCard>

      {confirmEmail ? null : <OAuthButtons />}

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already a member?</Text>
        <Pressable accessibilityRole="link" onPress={toSignIn} style={styles.linkButton}>
          <Text style={styles.link}>Sign in</Text>
        </Pressable>
      </View>
    </AppScreen>
  );
}
