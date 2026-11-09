import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Controller } from 'react-hook-form';
import { Text, View } from 'react-native';
import { useSession } from '../../lib/session';
import { WrongAccountError } from '../../lib/same-member';
import { authErrorMessage, isStepUpRequired, passwordErrorMessage } from '../../lib/auth-errors';
import { newPasswordSchema, useZodForm } from '../../lib/forms';
import { AppScreen } from '../../components/AppScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SectionCard } from '../../components/SectionCard';
import { FormField, PasswordInput } from '../../components/FormField';
import { authStyles as styles } from './auth-styles';
import { EmailCodeForm } from './EmailCodeForm';
import { unregisterPushForSignOut } from './usePushRegistration';

/**
 * Set a new password after a reset code (or when a sign-up's password did not
 * save). The root layout keeps the member here until it is done or they sign
 * out.
 *
 * Clutch only lets a recent sign-in set a password (step_up_required after
 * about ten minutes, or after the app was closed and reopened later). Then the
 * screen emails a fresh code to the signed-in address; the code signs the
 * same member in again and the password they already typed is saved. A code
 * that signs in a different account (the address has moved since) is not
 * adopted: the member stays as they were and is told to sign out.
 */
export function SetPasswordScreen() {
  const router = useRouter();
  const { email, updatePassword, signOut, sendExistingAccountCode, reconfirmWithCode } = useSession();
  const form = useZodForm(newPasswordSchema, { defaultValues: { password: '', confirm: '' } });
  /** The password waiting for a fresh code, while the code form shows. */
  const [pending, setPending] = useState<string | null>(null);

  const finish = async (password: string) => {
    await updatePassword(password);
    router.replace('/');
  };

  const askForCode = async (password: string) => {
    if (!email) {
      form.setError('password', { message: 'Sign out, then sign in with a code to set your password.' });
      return;
    }
    try {
      await sendExistingAccountCode(email);
      setPending(password);
    } catch (err) {
      form.setError('password', { message: authErrorMessage(err, 'We could not send a code. Please try again.') });
    }
  };

  const onSubmit = form.handleSubmit(async ({ password }) => {
    try {
      await finish(password);
    } catch (err) {
      if (isStepUpRequired(err)) await askForCode(password);
      else form.setError('password', { message: passwordErrorMessage(err) });
    }
  });

  if (pending !== null && email) {
    return (
      <AppScreen contentStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Club70</Text>
          <Text style={styles.title}>Confirm it is you</Text>
        </View>
        <SectionCard>
          <View style={styles.form}>
            <EmailCodeForm
              email={email}
              intro="For your security, enter the code we just sent to"
              submitLabel="Save Password"
              onSubmitCode={async (code) => {
                try {
                  await reconfirmWithCode(email, code);
                } catch (err) {
                  if (!(err instanceof WrongAccountError)) throw err;
                  setPending(null);
                  form.setError('password', {
                    message: 'That code signed in a different account. Sign out, then sign in again.',
                  });
                  return;
                }
                try {
                  await finish(pending);
                } catch (err) {
                  // The code worked; the password itself was refused.
                  setPending(null);
                  form.setError('password', { message: passwordErrorMessage(err) });
                }
              }}
              onResend={() => sendExistingAccountCode(email)}
            />
            <PrimaryButton label="Back" variant="ghost" onPress={() => setPending(null)} />
          </View>
        </SectionCard>
      </AppScreen>
    );
  }

  return (
    <AppScreen contentStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Club70</Text>
        <Text style={styles.title}>Choose a new password</Text>
      </View>
      <SectionCard>
        <View style={styles.form}>
          <Controller
            control={form.control}
            name="password"
            render={({ field: { onBlur, onChange, value }, fieldState }) => (
              <FormField label="New password" error={fieldState.error?.message} hint="At least 8 characters.">
                <PasswordInput
                  accessibilityLabel="New password"
                  autoComplete="new-password"
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
            name="confirm"
            render={({ field: { onBlur, onChange, value }, fieldState }) => (
              <FormField label="Confirm password" error={fieldState.error?.message}>
                <PasswordInput
                  accessibilityLabel="Confirm password"
                  autoComplete="new-password"
                  hasError={Boolean(fieldState.error)}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
              </FormField>
            )}
          />
          <PrimaryButton label="Save Password" loading={form.formState.isSubmitting} onPress={() => void onSubmit()} />
          <PrimaryButton
            label="Sign out instead"
            variant="ghost"
            onPress={() => void unregisterPushForSignOut().then(() => signOut())}
          />
        </View>
      </SectionCard>
    </AppScreen>
  );
}
