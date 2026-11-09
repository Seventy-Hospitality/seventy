/**
 * Inline profile editor for the account header: name and username, saved
 * together with PATCH /me/profile (Clutch writes both or neither). Only the
 * fields that changed are sent; Clutch's answer (the profile) replaces the
 * cached one.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clutch, hasCode, useMutationKey, type GetMeResponse, type Profile } from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import { FormField, Input, PrimaryButton } from '../../components';
import { colors, spacing } from '../../theme/tokens';
import { normalizeUsername, profileErrorMessage, USERNAME_PATTERN } from './account-lib';

interface ProfileEditorProps {
  profile: Profile;
  onDone: () => void;
}

type ProfilePatch = { full_name?: string; username?: string };

export function ProfileEditor({ profile, onDone }: ProfileEditorProps) {
  const queryClient = useQueryClient();
  const key = useMutationKey();
  const [name, setName] = useState(profile.full_name);
  const [username, setUsername] = useState(profile.username ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: ProfilePatch) =>
      key.run(patch, (k) => clutch.me.updateProfile(patch, { idempotencyKey: k })),
    onSuccess: (updated) => {
      queryClient.setQueryData<GetMeResponse['data']>(queryKeys.me, (prev) => (prev ? { ...prev, profile: updated } : prev));
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      onDone();
    },
    onError: (err) => {
      if (hasCode(err, 'username_taken', 'invalid_username')) setUsernameError(profileErrorMessage(err));
      else setNameError(profileErrorMessage(err));
    },
  });

  const submit = () => {
    if (save.isPending) return;
    const patch: ProfilePatch = {};
    const nextName = name.trim();
    const nextUsername = normalizeUsername(username);

    if (nextName !== profile.full_name.trim()) {
      if (!nextName) {
        setNameError('Enter your name.');
        return;
      }
      patch.full_name = nextName;
    }
    if (nextUsername !== (profile.username ?? '')) {
      if (!USERNAME_PATTERN.test(nextUsername)) {
        setUsernameError('Usernames are 3 to 20 letters, numbers or underscores.');
        return;
      }
      patch.username = nextUsername;
    }
    if (patch.full_name === undefined && patch.username === undefined) {
      onDone();
      return;
    }
    setNameError(null);
    setUsernameError(null);
    save.mutate(patch);
  };

  return (
    <View style={styles.form}>
      <FormField label="Name" error={nameError ?? undefined}>
        <Input
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (nameError) setNameError(null);
          }}
          placeholder="Your name"
          autoFocus
          maxLength={80}
          autoCapitalize="words"
          returnKeyType="next"
          hasError={Boolean(nameError)}
          accessibilityLabel="Name"
        />
      </FormField>
      <FormField label="Username" error={usernameError ?? undefined} hint="3 to 20 letters, numbers or underscores.">
        <Input
          value={username}
          onChangeText={(text) => {
            setUsername(text);
            if (usernameError) setUsernameError(null);
          }}
          placeholder="username"
          maxLength={21}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={submit}
          hasError={Boolean(usernameError)}
          accessibilityLabel="Username"
        />
      </FormField>
      <View style={styles.actions}>
        <PrimaryButton label="Save" loading={save.isPending} onPress={submit} />
        <PrimaryButton label="Cancel" variant="ghost" disabled={save.isPending} onPress={onDone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    alignSelf: 'stretch',
    gap: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  actions: { gap: spacing.sm },
});
