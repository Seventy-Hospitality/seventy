import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { clutch, useMutationKey, type GroupDetail, type UserId } from '../../lib/clutch';
import { useSession } from '../../lib/session';
import { PrimaryButton, QRCode, Sheet, useToast } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { MemberPicker } from './MemberPicker';
import { invalidateGroups, useGroupInviteLink } from './groups-data';
import { EMPTY_SELECTION, inviteErrorMessage, inviteeIds, type InviteeSelection } from './groups-lib';

interface InviteToGroupSheetProps {
  group: GroupDetail;
  open: boolean;
  onClose: () => void;
}

/**
 * The invite-to-group modal (Figma invite modal 195:17988): Copy Link / QR
 * Code / Share over the group's invite link, plus the member picker and an
 * "Add" that sends the invitations. The link is the app's own deep link (see
 * groupJoinUrl): Clutch has no web page for group links yet, so the QR only
 * works for someone who already has the app.
 */
export function InviteToGroupSheet({ group, open, onClose }: InviteToGroupSheetProps) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inviteKey = useMutationKey();

  const link = useGroupInviteLink(group.id);
  const [selection, setSelection] = useState<InviteeSelection>(EMPTY_SELECTION);
  const [qrOpen, setQrOpen] = useState(false);
  // Rotating revokes every shared link: Clutch lets only the owner do it.
  const canRotate = group.my_role === 'owner';

  // Reset the picker and the QR panel each time the sheet opens.
  useEffect(() => {
    if (open) {
      setSelection(EMPTY_SELECTION);
      setQrOpen(false);
    }
  }, [open]);

  const excludeUserIds = useMemo<UserId[]>(
    () => [...(userId ? [userId] : []), ...group.members.map((m) => m.user_id)],
    [userId, group.members],
  );

  const invite = useMutation({
    mutationFn: (userIds: UserId[]) =>
      inviteKey.run({ id: group.id, userIds }, (k) =>
        clutch.groups.invite(group.id, userIds, { idempotencyKey: k }),
      ),
    onSuccess: (result) => {
      setSelection(EMPTY_SELECTION);
      toast({
        variant: 'success',
        message:
          result.invited.length === 0
            ? 'Those players are already in the group or already invited.'
            : `${
                result.invited.length === 1 ? '1 invite' : `${result.invited.length} invites`
              } sent, pending acceptance.`,
      });
      invalidateGroups(queryClient);
      onClose();
    },
    onError: (error) => {
      toast({ variant: 'error', message: inviteErrorMessage(error) });
    },
  });

  const rotate = useMutation({
    mutationFn: () => link.rotate(),
    onSuccess: () => {
      setQrOpen(true);
      toast({ variant: 'success', message: 'New invite link created. Older links no longer work.' });
    },
    onError: () => {
      toast({ variant: 'error', message: 'We could not reset the invite link. Try again.' });
    },
  });

  async function withLink(action: (url: string) => Promise<void>) {
    try {
      const url = await link.ensureUrl();
      await action(url);
    } catch {
      toast({ variant: 'error', message: 'We could not create an invite link. Try again.' });
    }
  }

  const copyUrl = async (url: string) => {
    try {
      await Clipboard.setStringAsync(url);
      toast({ variant: 'success', message: 'Invite link copied.' });
    } catch {
      setQrOpen(true);
      toast({ variant: 'error', message: 'Copying failed. The link is shown below instead.' });
    }
  };

  const shareUrl = async (url: string) => {
    await Share.share({ title: `Join ${group.name} on Club70`, message: url, url });
  };

  const selectedCount = selection.length;

  const requestClose = () => {
    if (!invite.isPending) onClose();
  };

  return (
    <Sheet open={open} onClose={requestClose}>
      {/* ── Header: Close / title / Add ── */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={requestClose}
          disabled={invite.isPending}
          hitSlop={8}
        >
          <Text style={styles.headerSide}>Close</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Invite to Group</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            selectedCount > 0
              ? `Add ${selectedCount === 1 ? '1 player' : `${selectedCount} players`}`
              : 'Add players'
          }
          accessibilityState={{ disabled: selectedCount === 0 || invite.isPending }}
          onPress={() => invite.mutate(inviteeIds(selection))}
          disabled={selectedCount === 0 || invite.isPending}
          hitSlop={8}
        >
          <Text style={[styles.headerAdd, selectedCount === 0 ? styles.headerAddDisabled : null]}>
            {invite.isPending ? 'Adding…' : 'Add'}
          </Text>
        </Pressable>
      </View>

      {open ? (
        <>
          {/* ── Link actions ── */}
          <View style={styles.linkActions}>
            <LinkAction
              icon="link-outline"
              label="Copy Link"
              disabled={link.isPending}
              onPress={() => void withLink(copyUrl)}
            />
            <LinkAction
              icon="qr-code-outline"
              label="QR Code"
              disabled={link.isPending}
              expanded={qrOpen}
              onPress={() => {
                if (qrOpen) setQrOpen(false);
                else void withLink(async () => setQrOpen(true));
              }}
            />
            <LinkAction
              icon="share-social-outline"
              label="Share"
              disabled={link.isPending}
              onPress={() => void withLink(shareUrl)}
            />
          </View>

          {qrOpen && link.url ? (
            <View
              style={styles.qrPanel}
              accessibilityLabel={`Invite QR code for ${group.name}. The link is shown below the code.`}
            >
              <QRCode value={link.url} size={180} />
              <Text style={styles.qrUrl} selectable numberOfLines={2}>
                {link.url}
              </Text>
              <View style={styles.qrActions}>
                <PrimaryButton label="Copy link" variant="secondary" onPress={() => void withLink(copyUrl)} />
                {canRotate ? (
                  <PrimaryButton
                    label="Reset link"
                    variant="ghost"
                    loading={rotate.isPending}
                    onPress={() => rotate.mutate()}
                  />
                ) : null}
              </View>
              {canRotate ? (
                <Text style={styles.qrHint}>
                  Resetting creates a fresh link and revokes every previously shared one.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* ── Member picker ── */}
          <ScrollView
            style={styles.pickerScroll}
            contentContainerStyle={styles.pickerContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <MemberPicker
              selection={selection}
              onSelectionChange={setSelection}
              excludeUserIds={excludeUserIds}
            />
          </ScrollView>
        </>
      ) : null}
    </Sheet>
  );
}

function LinkAction({
  icon,
  label,
  disabled,
  expanded,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  expanded?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), expanded }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.linkAction, pressed && !disabled ? styles.pressed : null]}
    >
      <View style={styles.linkCircle}>
        <Ionicons name={icon} size={20} color={colors.text} />
      </View>
      <Text style={styles.linkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
  },
  headerSide: {
    color: colors.accent,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    minWidth: 48,
  },
  headerTitle: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 17,
  },
  headerAdd: {
    color: colors.accent,
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    minWidth: 48,
    textAlign: 'right',
  },
  headerAddDisabled: {
    color: colors.textSubtle,
  },
  linkActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
  },
  linkAction: {
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  linkCircle: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceOverlay,
  },
  linkLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
  },
  pressed: {
    opacity: 0.75,
  },
  qrPanel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
  },
  qrUrl: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
    textAlign: 'center',
  },
  qrActions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  qrHint: {
    color: colors.textSubtle,
    fontFamily: fonts.body,
    fontSize: 12,
    textAlign: 'center',
  },
  pickerScroll: {
    maxHeight: 360,
  },
  pickerContent: {
    paddingBottom: spacing.sm,
  },
});
