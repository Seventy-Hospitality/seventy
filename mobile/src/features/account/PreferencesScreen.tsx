/**
 * App preferences (Figma app-preferences 107:9789): notification switches
 * per category and channel, the push registration that follows them, and
 * the Data & privacy / Help & support / About rows.
 *
 * Each switch updates the cached matrix at once and PUTs the WHOLE matrix
 * (Clutch replaces it), built from the cache at send time so quick taps
 * compose. A failed save rolls back only that switch.
 */
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import {
  clutch,
  useMutationKey,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferences,
} from '../../lib/clutch';
import { preferencesQuery } from '../../lib/queries';
import { PrimaryButton, Skeleton, useToast } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { AccountFrame } from './AccountFrame';
import { SHOWN_CATEGORIES, SHOWN_CHANNELS, withToggle } from './preferences';
import { SettingsGroup, SettingsRow } from './SettingsList';
import { usePushRegistration } from './usePushRegistration';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const SAVE_KEY = ['preferences-save'];

interface Toggle {
  category: NotificationCategory;
  channel: NotificationChannel;
  value: boolean;
}

export function PreferencesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const preferences = useQuery(preferencesQuery);
  const push = usePushRegistration();
  const key = useMutationKey();

  const save = useMutation({
    mutationKey: SAVE_KEY,
    onMutate: async ({ category, channel, value }: Toggle) => {
      await queryClient.cancelQueries({ queryKey: preferencesQuery.queryKey });
      const previous = queryClient.getQueryData<NotificationPreferences>(preferencesQuery.queryKey);
      if (!previous) return { previousValue: !value };
      const next = withToggle(previous, category, channel, value);
      queryClient.setQueryData(preferencesQuery.queryKey, next);
      // Turning push on is the one moment the OS prompt may show.
      if (channel === 'push') void push.syncWith(next, { prompt: value });
      return { previousValue: previous[category][channel] };
    },
    mutationFn: async () => {
      const body = queryClient.getQueryData<NotificationPreferences>(preferencesQuery.queryKey);
      if (!body) throw new Error('Preferences are not loaded.');
      await key.run(body, (k) => clutch.me.putPreferences(body, { idempotencyKey: k }));
    },
    onError: (_err, { category, channel }, context) => {
      if (context) {
        queryClient.setQueryData<NotificationPreferences>(preferencesQuery.queryKey, (prev) =>
          prev ? withToggle(prev, category, channel, context.previousValue) : prev,
        );
        const restored = queryClient.getQueryData<NotificationPreferences>(preferencesQuery.queryKey);
        if (channel === 'push' && restored) void push.syncWith(restored, { prompt: false });
      }
      toast({ variant: 'error', message: 'We could not save that setting. Please try again.' });
    },
    onSettled: () => {
      // Converge once, after the last in-flight save.
      if (queryClient.isMutating({ mutationKey: SAVE_KEY }) === 1) {
        void queryClient.invalidateQueries({ queryKey: preferencesQuery.queryKey });
      }
    },
  });

  return (
    <AccountFrame title="App preferences" backLabel="Back to account" backTo="/(tabs)/account">
      {preferences.isPending ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Notifications</Text>
          <Skeleton height={220} borderRadius={radius.lg} />
        </View>
      ) : preferences.isError ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Notifications</Text>
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>We could not load your preferences.</Text>
            <PrimaryButton label="Try again" variant="secondary" onPress={() => void preferences.refetch()} />
          </View>
        </View>
      ) : (
        SHOWN_CHANNELS.map(({ channel, label: channelLabel }) => (
          <SettingsGroup key={channel} label={`${channelLabel} notifications`}>
            {SHOWN_CATEGORIES.map(({ category, label }) => (
              <SettingsRow
                key={category}
                label={label}
                trailing={
                  <Switch
                    value={preferences.data[category][channel]}
                    onValueChange={(value) => save.mutate({ category, channel, value })}
                    accessibilityLabel={`${label} ${channelLabel.toLowerCase()} notifications`}
                    trackColor={{ false: colors.surfaceOverlay, true: colors.accent }}
                    thumbColor={colors.text}
                    ios_backgroundColor={colors.surfaceOverlay}
                  />
                }
              />
            ))}
          </SettingsGroup>
        ))
      )}

      <SettingsGroup label="Data & privacy">
        <SettingsRow label="Privacy policy" comingSoon />
        <SettingsRow icon="key-outline" label="Sign-in methods" onPress={() => router.push('/account/sign-in-methods')} />
        <SettingsRow label="Delete my account" accent onPress={() => router.push('/account/delete')} />
      </SettingsGroup>

      <SettingsGroup label="Help & support">
        <SettingsRow label="Contact us" comingSoon />
        <SettingsRow label="Rate the app" comingSoon />
      </SettingsGroup>

      <SettingsGroup label="About">
        <SettingsRow label="Version" value={APP_VERSION} />
        <SettingsRow label="Terms of Service" comingSoon />
      </SettingsGroup>
    </AccountFrame>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  groupLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginLeft: spacing.xs,
  },
  errorBox: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  errorText: { color: colors.text, fontFamily: fonts.body, fontSize: 15 },
});
