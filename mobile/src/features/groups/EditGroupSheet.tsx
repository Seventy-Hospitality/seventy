import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { clutch, useMutationKey, type GroupDetail } from '../../lib/clutch';
import { FormField, Input, PrimaryButton, Sheet, useToast } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { invalidateGroups } from './groups-data';
import {
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  coverUploadErrorMessage,
  groupFormErrorMessage,
  isValidGroupName,
} from './groups-lib';
import { useCoverPhoto } from './useCoverPhoto';

/** The edits saved but the new cover did not go up; carries the copy to show. */
class CoverUploadFailed extends Error {}

interface EditGroupSheetProps {
  group: GroupDetail;
  open: boolean;
  onClose: () => void;
}

interface GroupPatch {
  name?: string;
  description?: string | null;
  clear_cover?: boolean;
}

/**
 * Edit a group (shown when permissions.can_edit). Sends a PATCH with only what
 * changed (name, description, clear_cover to drop the cover); a NEW cover
 * always goes through the owner-only upload, never the PATCH.
 */
export function EditGroupSheet({ group, open, onClose }: EditGroupSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const patchKey = useMutationKey();
  const coverKey = useMutationKey();

  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [removeCover, setRemoveCover] = useState(false);
  const cover = useCoverPhoto();

  // Re-seed from the current group each time the sheet opens (no stale drafts).
  useEffect(() => {
    if (open) {
      setName(group.name);
      setDescription(group.description ?? '');
      setRemoveCover(false);
      cover.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group.id]);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const nameChanged = trimmedName !== group.name;
  const descriptionChanged = trimmedDescription !== (group.description ?? '');
  const coverRemoved = removeCover && group.cover_image_url !== null && cover.image === null;
  const dirty = nameChanged || descriptionChanged || coverRemoved || cover.image !== null;

  const save = useMutation({
    mutationFn: async () => {
      const patch: GroupPatch = {};
      if (nameChanged) patch.name = trimmedName;
      if (descriptionChanged) patch.description = trimmedDescription || null;
      if (coverRemoved) patch.clear_cover = true;
      if (Object.keys(patch).length > 0) {
        await patchKey.run({ id: group.id, patch }, (k) =>
          clutch.groups.update(group.id, patch, { idempotencyKey: k }),
        );
      }
      const image = cover.image;
      if (image) {
        try {
          const file = { uri: image.uri, name: image.name, type: image.type };
          await coverKey.run({ id: group.id, uri: image.uri }, (k) =>
            clutch.groups.uploadCover(group.id, file, { idempotencyKey: k }),
          );
        } catch (error) {
          throw new CoverUploadFailed(coverUploadErrorMessage(error));
        }
      }
    },
    onSuccess: () => {
      invalidateGroups(queryClient);
      toast({ variant: 'success', message: 'Group updated.' });
      onClose();
    },
    onError: (error) => {
      if (error instanceof CoverUploadFailed) {
        invalidateGroups(queryClient);
        toast({ variant: 'error', message: `Your changes were saved, but: ${error.message}` });
        onClose();
        return;
      }
      toast({
        variant: 'error',
        message: groupFormErrorMessage(error, 'We could not save your changes. Try again.'),
      });
    },
  });

  const showExistingCover = group.cover_image_url !== null && !removeCover && cover.image === null;
  const previewUri = cover.image?.uri ?? (showExistingCover ? group.cover_image_url : null);

  const requestClose = () => {
    if (!save.isPending) onClose();
  };

  return (
    <Sheet open={open} onClose={requestClose} title="Edit group">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.coverField}>
          {previewUri ? (
            <View style={styles.coverPreviewWrap}>
              <Image source={previewUri} style={styles.coverPreview} contentFit="cover" />
              <View style={styles.coverButtons}>
                <View style={styles.coverButton}>
                  <PrimaryButton label="Replace photo" variant="secondary" onPress={cover.choose} />
                </View>
                <View style={styles.coverButton}>
                  <PrimaryButton
                    label="Remove photo"
                    variant="ghost"
                    onPress={() => {
                      cover.clear();
                      setRemoveCover(true);
                    }}
                  />
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
                <Ionicons name="camera-outline" size={26} color={colors.textMuted} />
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

        <FormField label="Group name" error={trimmedName.length === 0 ? 'Enter a group name' : undefined}>
          <Input
            value={name}
            onChangeText={setName}
            maxLength={GROUP_NAME_MAX}
            autoCapitalize="words"
            hasError={trimmedName.length === 0}
          />
        </FormField>

        <FormField label="Description" hint="Optional">
          <Input
            value={description}
            onChangeText={setDescription}
            maxLength={GROUP_DESCRIPTION_MAX}
            multiline
            style={styles.textArea}
          />
        </FormField>

        <View style={styles.actions}>
          <PrimaryButton
            label="Save changes"
            loading={save.isPending}
            disabled={!(dirty && isValidGroupName(name))}
            onPress={() => save.mutate()}
          />
          <PrimaryButton label="Cancel" variant="ghost" disabled={save.isPending} onPress={requestClose} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    maxHeight: 520,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  coverField: {
    gap: spacing.sm,
  },
  coverTile: {
    minHeight: 148,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
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
    width: 52,
    height: 52,
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
    height: 148,
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
    minHeight: 88,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  formError: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
});
