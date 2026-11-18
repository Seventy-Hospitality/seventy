/**
 * Avatar picker + upload for the account header. expo-image-picker (camera or
 * library), a pre-check that mirrors Clutch's own (uploadAvatar: JPG, PNG,
 * WebP or GIF, 5 MB) so the member gets an instant message, then
 * POST /me/avatar with an RN file part (the client keys each send itself). Clutch's verdict (unsupported_image_type,
 * file_too_large) is still what counts; the profile is re-read afterwards.
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clutch, type GetMeResponse, type UploadFile } from '../../lib/clutch';
import { queryKeys } from '../../lib/queries';
import { useToast } from '../../components';
import { avatarErrorMessage } from './account-lib';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const MAX_BYTES = 5 * 1024 * 1024;

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function inferType(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType) return asset.mimeType;
  const ext = (asset.fileName ?? asset.uri).split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TYPES[ext] ?? 'image/jpeg';
}

/** The local pre-check; returns a message or null. */
export function avatarImageError(image: { type: string; size?: number | null }): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(image.type)) {
    return 'Profile photos must be JPG, PNG, WebP or GIF.';
  }
  if (image.size != null && image.size > MAX_BYTES) return 'Profile photos must be 5 MB or smaller.';
  return null;
}

export interface AvatarUploadController {
  choose: () => void;
  isUploading: boolean;
}

export function useAvatarUpload(): AvatarUploadController {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const upload = useMutation({
    // A multipart body differs on every send, so the client mints a fresh key per send.
    mutationFn: (file: UploadFile) => clutch.me.uploadAvatar(file),
    onSuccess: (avatarUrl) => {
      // Show the new photo at once; the re-read below is the source of truth.
      queryClient.setQueryData<GetMeResponse['data']>(queryKeys.me, (prev) =>
        prev ? { ...prev, profile: { ...prev.profile, avatar_url: avatarUrl } } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      toast({ variant: 'success', message: 'Profile photo updated.' });
    },
    onError: (error) => toast({ variant: 'error', message: avatarErrorMessage(error) }),
  });

  const pickFrom = useCallback(
    async (source: 'camera' | 'library') => {
      try {
        const permission =
          source === 'camera'
            ? await ImagePicker.requestCameraPermissionsAsync()
            : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          toast({
            variant: 'error',
            message:
              source === 'camera'
                ? 'Camera access is needed to take a profile photo.'
                : 'Photo library access is needed to choose a profile photo.',
          });
          return;
        }
        const options: ImagePicker.ImagePickerOptions = {
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        };
        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync(options)
            : await ImagePicker.launchImageLibraryAsync(options);
        if (result.canceled || result.assets.length === 0) return;

        const asset = result.assets[0];
        const type = inferType(asset);
        const invalid = avatarImageError({ type, size: asset.fileSize ?? null });
        if (invalid) {
          toast({ variant: 'error', message: invalid });
          return;
        }
        const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'avatar.jpg';
        upload.mutate({ uri: asset.uri, name, type });
      } catch {
        toast({ variant: 'error', message: 'We could not open the photo picker. Please try again.' });
      }
    },
    [toast, upload],
  );

  const choose = useCallback(() => {
    Alert.alert('Update profile photo', undefined, [
      { text: 'Take photo', onPress: () => void pickFrom('camera') },
      { text: 'Choose from library', onPress: () => void pickFrom('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [pickFrom]);

  return { choose, isUploading: upload.isPending };
}
