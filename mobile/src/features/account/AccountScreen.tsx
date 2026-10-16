/**
 * Account tab (Figma account main 168:15494): avatar with camera badge,
 * name + username edit, email, the membership summary, the member QR card,
 * and the settings menu (membership, billing, payment methods, preferences,
 * sign out).
 *
 * The old "lifetime stats" tiles (courts booked, hours per sport) are gone:
 * Clutch has no source for them on main, and the app does not tally them
 * itself. The member number line is gone too: Clutch has no member numbers
 * (the QR's signed check-in token identifies the member).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { Profile } from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { meQuery, membershipQuery } from '../../lib/queries';
import { AppScreen, Avatar, MemberCardSheet, PrimaryButton, Skeleton, useToast } from '../../components';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import { planSummary, profileDisplayName, type PlanSummary } from './account-lib';
import { ProfileEditor } from './ProfileEditor';
import { SettingsGroup, SettingsRow } from './SettingsList';
import { useAvatarUpload } from './useAvatarUpload';
import { useSignOut } from './useSignOut';

export function AccountScreen() {
  const me = useQuery(meQuery);

  return (
    <AppScreen
      contentStyle={styles.content}
      refreshing={me.isRefetching && !me.isPending}
      onRefresh={() => void me.refetch()}
    >
      {me.isPending ? (
        <View accessibilityLabel="Loading your account" style={styles.loading}>
          <Skeleton width={96} height={96} borderRadius={radius.pill} />
          <Skeleton width={180} height={26} borderRadius={radius.sm} />
          <Skeleton width={140} height={16} borderRadius={radius.sm} />
          <Skeleton height={260} borderRadius={radius.lg} />
        </View>
      ) : me.isError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>We could not load your account.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void me.refetch()} />
        </View>
      ) : (
        <AccountView profile={me.data.profile} />
      )}
    </AppScreen>
  );
}

function AccountView({ profile }: { profile: Profile }) {
  const router = useRouter();
  const { toast } = useToast();
  const signOut = useSignOut();
  const avatar = useAvatarUpload();
  const membership = useQuery(membershipQuery);
  const club = useClub();

  const [editing, setEditing] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  const name = profileDisplayName(profile);
  const plan = membership.data ? planSummary(membership.data, club.data?.timezone) : null;

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onError: () => toast({ variant: 'error', message: 'We could not sign you out. Please try again.' }),
  });

  return (
    <>
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          <Avatar name={name} src={profile.avatar_url ?? null} size="xl" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            accessibilityState={{ busy: avatar.isUploading }}
            onPress={avatar.choose}
            disabled={avatar.isUploading}
            hitSlop={8}
            style={styles.cameraBadge}
          >
            <Ionicons name={avatar.isUploading ? 'hourglass-outline' : 'camera'} size={16} color={colors.textOnAccent} />
          </Pressable>
        </View>

        {editing ? (
          <ProfileEditor profile={profile} onDone={() => setEditing(false)} />
        ) : (
          <>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                onPress={() => setEditing(true)}
                hitSlop={8}
              >
                <Ionicons name="pencil" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
            {profile.username ? <Text style={styles.subtle}>@{profile.username}</Text> : null}
            {profile.email ? <Text style={styles.subtle}>{profile.email}</Text> : null}
          </>
        )}
      </View>

      <MembershipSummary
        loading={membership.isPending}
        failed={membership.isError}
        plan={plan}
        onRetry={() => void membership.refetch()}
        onOpen={() => router.push('/account/change-membership')}
      />

      <SettingsGroup label="Account settings">
        <SettingsRow icon="qr-code-outline" label="View membership card" onPress={() => setCardOpen(true)} />
        <SettingsRow icon="calendar-outline" label="Billing history" onPress={() => router.push('/account/billing')} />
        <SettingsRow icon="card-outline" label="Payment methods" onPress={() => router.push('/account/payment-method')} />
        <SettingsRow icon="options-outline" label="App preferences" onPress={() => router.push('/account/preferences')} />
        <SettingsRow
          icon="log-out-outline"
          label="Sign out"
          accent
          loading={signOutMutation.isPending}
          onPress={() => signOutMutation.mutate()}
        />
      </SettingsGroup>

      <MemberCardSheet
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        memberName={name}
        detail={plan?.name ?? null}
      />
    </>
  );
}

function MembershipSummary({
  loading,
  failed,
  plan,
  onRetry,
  onOpen,
}: {
  loading: boolean;
  failed: boolean;
  plan: PlanSummary | null;
  onRetry: () => void;
  onOpen: () => void;
}) {
  if (loading) return <Skeleton height={72} borderRadius={radius.lg} />;
  if (failed) {
    return (
      <View style={styles.errorBox} accessibilityRole="alert">
        <Text style={styles.errorText}>We could not load your membership.</Text>
        <PrimaryButton label="Try again" variant="secondary" onPress={onRetry} />
      </View>
    );
  }
  if (!plan) {
    return (
      <View style={styles.membershipCard}>
        <Text style={styles.membershipTier}>No membership tier</Text>
        <Text style={styles.subtle}>Contact the club if this looks wrong.</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${plan.name} membership. Manage membership`}
      onPress={onOpen}
      style={({ pressed }) => [styles.membershipCard, pressed ? styles.pressed : null]}
    >
      <View style={styles.membershipText}>
        <Text style={styles.membershipTier}>{plan.name}</Text>
        <Text style={styles.subtle}>{plan.statusLine}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  loading: { alignItems: 'center', gap: spacing.md, alignSelf: 'stretch' },
  errorBox: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  errorText: { ...typography.body, color: colors.text },
  header: { alignItems: 'center', gap: spacing.xs },
  avatarWrap: { position: 'relative', marginBottom: spacing.xs },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subtle: { ...typography.body, color: colors.textMuted },
  membershipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  pressed: { backgroundColor: colors.surfaceOverlay },
  membershipText: { flex: 1, gap: 2 },
  membershipTier: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.text },
});
