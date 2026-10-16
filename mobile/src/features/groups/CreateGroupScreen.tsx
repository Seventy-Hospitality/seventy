import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { clutch, useMutationKey, type GroupId, type UserId } from '../../lib/clutch';
import { useSession } from '../../lib/session';
import { FormField, Input, PrimaryButton, useToast } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { StepShell } from '../reserve/StepShell';
import { WizardFrame } from '../reserve/WizardFrame';
import { MemberPicker } from './MemberPicker';
import { useCoverPhoto, type CoverImage } from './useCoverPhoto';
import { invalidateGroups } from './groups-data';
import {
  EMPTY_SELECTION,
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  coverUploadErrorMessage,
  groupFormErrorMessage,
  inviteeIds,
  isValidGroupName,
  type InviteeSelection,
} from './groups-lib';

interface CreateInput {
  name: string;
  description: string | null;
  invitee_user_ids: UserId[];
}

/**
 * The two-step create-group wizard (Figma create-club 95:4384 / invite-players
 * 95:4294): step 1 collects an optional cover photo, the required name and an
 * optional description; step 2 picks the first invitees. Create posts the
 * name, description and invitees in one call; the cover then goes up on its
 * own (Clutch takes covers only as an owner upload after the group exists), so
 * a failed cover never loses the group. Lands on the new group.
 */
export function CreateGroupScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { userId } = useSession();
  const createKey = useMutationKey();
  const coverKey = useMutationKey();

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selection, setSelection] = useState<InviteeSelection>(EMPTY_SELECTION);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const cover = useCoverPhoto();

  const goToGroups = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/groups');
  }, [router]);

  const uploadCover = async (groupId: GroupId, image: CoverImage): Promise<string | null> => {
    try {
      const file = { uri: image.uri, name: image.name, type: image.type };
      await coverKey.run({ groupId, uri: image.uri }, (k) =>
        clutch.groups.uploadCover(groupId, file, { idempotencyKey: k }),
      );
      return null;
    } catch (error) {
      return coverUploadErrorMessage(error);
    }
  };

  const create = useMutation({
    mutationFn: async (input: CreateInput) => {
      const { group_id } = await createKey.run(input, (k) =>
        clutch.groups.create(input, { idempotencyKey: k }),
      );
      const coverError = cover.image ? await uploadCover(group_id, cover.image) : null;
      return { groupId: group_id, coverError };
    },
    onSuccess: ({ groupId, coverError }, input) => {
      invalidateGroups(queryClient);
      const invited = input.invitee_user_ids.length;
      toast({
        variant: 'success',
        message:
          invited > 0
            ? `${input.name} created. ${invited === 1 ? '1 invite' : `${invited} invites`} sent, pending acceptance.`
            : `${input.name} created.`,
      });
      if (coverError) {
        toast({ variant: 'error', message: `${coverError} You can add it from Edit group.` });
      }
      router.replace(`/groups/${groupId}`);
    },
    onError: (error) => {
      setSubmitError(groupFormErrorMessage(error, 'We could not create the group. Try again.'));
    },
  });

  const submit = () => {
    setSubmitError(null);
    create.mutate({
      name: name.trim(),
      description: description.trim() || null,
      invitee_user_ids: inviteeIds(selection),
    });
  };

  const onBack = () => {
    if (create.isPending) return;
    if (step === 2) setStep(1);
    else goToGroups();
  };

  const onClose = () => {
    if (create.isPending) return;
    goToGroups();
  };

  return (
    <WizardFrame
      onBack={onBack}
      onClose={onClose}
      step={step}
      steps={2}
      stepName={step === 1 ? 'Group details' : 'Invite players'}
      chromeDisabled={create.isPending}
    >
      {step === 1 ? (
        <StepShell
          title="Create a group"
          footer={
            <PrimaryButton
              label="Continue"
              variant={isValidGroupName(name) ? 'primary' : 'ghost'}
              disabled={!isValidGroupName(name)}
              onPress={() => setStep(2)}
            />
          }
        >
          <CoverPhotoField cover={cover} />

          <FormField label="Group name">
            <Input
              placeholder="Enter name"
              value={name}
              onChangeText={setName}
              maxLength={GROUP_NAME_MAX}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
            />
          </FormField>

          <FormField label="Description" hint="Optional">
            <Input
              placeholder="Description"
              value={description}
              onChangeText={setDescription}
              maxLength={GROUP_DESCRIPTION_MAX}
              multiline
              style={styles.textArea}
            />
          </FormField>
        </StepShell>
      ) : (
        <StepShell
          title="Invite players"
          subtitle={`Invited club members must accept before they join ${name.trim() || 'your group'}.`}
          footer={<PrimaryButton label="Create group" loading={create.isPending} onPress={submit} />}
        >
          <MemberPicker
            selection={selection}
            onSelectionChange={setSelection}
            excludeUserIds={userId ? [userId] : []}
          />
          {submitError ? (
            <Text accessibilityRole="alert" style={styles.formError}>
              {submitError}
            </Text>
          ) : null}
        </StepShell>
      )}
    </WizardFrame>
  );
}

function CoverPhotoField({ cover }: { cover: ReturnType<typeof useCoverPhoto> }) {
  return (
    <View style={styles.coverField}>
      {cover.image ? (
        <View style={styles.coverPreviewWrap}>
          <Image source={cover.image.uri} style={styles.coverPreview} contentFit="cover" />
          <View style={styles.coverButtons}>
            <View style={styles.coverButton}>
              <PrimaryButton label="Change photo" variant="secondary" onPress={cover.choose} />
            </View>
            <View style={styles.coverButton}>
              <PrimaryButton label="Remove" variant="ghost" onPress={cover.clear} />
            </View>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a cover photo"
          onPress={cover.choose}
          style={({ pressed }) => [styles.coverTile, pressed ? styles.pressed : null]}
        >
          <View style={styles.cameraCircle}>
            <Ionicons name="camera-outline" size={28} color={colors.textMuted} />
          </View>
          <Text style={styles.coverLabel}>Add Cover Photo</Text>
        </Pressable>
      )}
      {cover.error ? (
        <Text accessibilityRole="alert" style={styles.formError}>
          {cover.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  coverField: {
    gap: spacing.sm,
  },
  coverTile: {
    minHeight: 176,
    borderRadius: radius.lg,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.9,
  },
  cameraCircle: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
  },
  coverPreviewWrap: {
    gap: spacing.sm,
  },
  coverPreview: {
    width: '100%',
    height: 176,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
  },
  coverButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  coverButton: {
    flex: 1,
  },
  textArea: {
    minHeight: 96,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  formError: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
});
