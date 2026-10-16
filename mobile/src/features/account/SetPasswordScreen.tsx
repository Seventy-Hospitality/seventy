import { useRouter } from 'expo-router';
import { Controller } from 'react-hook-form';
import { Text, View } from 'react-native';
import { useSession } from '../../lib/session';
import { authErrorMessage } from '../../lib/auth-errors';
import { newPasswordSchema, useZodForm } from '../../lib/forms';
import { AppScreen } from '../../components/AppScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SectionCard } from '../../components/SectionCard';
import { FormField, PasswordInput } from '../../components/FormField';
import { authStyles as styles } from './auth-styles';

/**
 * Set a new password after a recovery link or code (PASSWORD_RECOVERY). The
 * root layout keeps the user here until it is done or they sign out.
 */
export function SetPasswordScreen() {
  const router = useRouter();
  const { updatePassword, signOut } = useSession();
  const form = useZodForm(newPasswordSchema, { defaultValues: { password: '', confirm: '' } });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    try {
      await updatePassword(password);
      router.replace('/');
    } catch (err) {
      form.setError('password', { message: authErrorMessage(err, 'Unable to set your password.') });
    }
  });

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
          <PrimaryButton label="Sign out instead" variant="ghost" onPress={() => void signOut()} />
        </View>
      </SectionCard>
    </AppScreen>
  );
}
