import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { clutch, useMutationKey, type Group, type UserId } from '../../lib/clutch';
import { useSession } from '../../lib/session';
import { PrimaryButton, QRCode, Sheet, useToast } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { MemberPicker } from './MemberPicker';
import { invalidateGroups, useGroupInviteLink } from './groups-data';
import {
  EMPTY_SELECTION,
  inviteErrorMessage,
  inviteLinkErrorMessage,
  inviteeIds,
  type InviteeSelection,
} from './groups-lib';

interface InviteToGroupSheetProps {
  group: Group;
  open: boolean;
  onClose: () => void;
}

/**
 * The invite-to-group modal (Figma invite modal 195:17988): Copy Link / QR
 * Code / Share over the group's invite link, plus the member picker and an
 * "Add" that sends the invitations. Everything between the header and the
 * "Add" footer scrolls, so "Add" stays in reach with the keyboard up. The link is the app's own deep link (see
 * groupJoinUrl): Clutch has no web page for group links yet, so the QR only
 * works for someone who already has the app.
 *
 * Member search is P4 (bookingParity). Without it the picker explains that it
 * is coming and "Add" is not offered; the link, QR and share keep working
 * because minting a link needs nothing from P4.
 */
export function InviteToGroupSheet({ group, open, onClose }: InviteToGroupSheetProps) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inviteKey = useMutationKey();

  const link = useGroupInviteLink(group.id);
  const [selection, setSelection] = useState<InviteeSelection>(EMPTY_SELECTION);
  const [qrOpen, setQrOpen] = useState(false);
  // "Reset link" asks first: it revokes every link already shared.
  const [confirmReset, setConfirmReset] = useState(false);
  // Rotating revokes every shared link: Clutch lets only the owner do it.
  const canRotate = group.my_role === 'owner';
  const canSearchMembers = clutch.capabilities.bookingParity;

  // Reset the picker and the QR panel each time the sheet opens.
  useEffect(() => {
    if (open) {
      setSelection(EMPTY_SELECTION);
      setQrOpen(false);
      setConfirmReset(false);
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
      setConfirmReset(false);
      setQrOpen(true);
      toast({ variant: 'success', message: 'New invite link created. Older links no longer work.' });
    },
    onError: (error) => {
      setConfirmReset(false);
      toast({ variant: 'error', message: inviteLinkErrorMessage(error, true) });
    },
  });

  async function withLink(action: (url: string) => Promise<void>) {
    try {
      const url = await link.ensureUrl();
      await action(url);
    } catch (error) {
      toast({ variant: 'error', message: inviteLinkErrorMessage(error, false) });
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
  const addLabel =
    selectedCount > 0 ? `Add ${selectedCount === 1 ? '1 player' : `${selectedCount} players`}` : 'Add players';

  const requestClose = () => {
    if (!invite.isPending) onClose();
  };

  return (
    <Sheet open={open} onClose={requestClose}>
      {/* ── Header: Close / title ── */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={requestClose}
          disabled={invite.isPending}
          hitSlop={8}
          style={styles.headerButton}
        >
          <Text style={styles.headerSide}>Close</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Invite to Group</Text>
        <View style={styles.headerSpacer} />
      </View>

      {open ? (
        <>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
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
                {confirmReset ? (
                  <View style={styles.qrActions} accessibilityRole="alert">
                    <Text style={styles.resetQuestion}>
                      Reset the invite link? Every link you have already shared stops working, and people who have
                      not joined yet will need the new one.
                    </Text>
                    <PrimaryButton
                      label="Reset link"
                      variant="danger"
                      loading={rotate.isPending}
                      onPress={() => rotate.mutate()}
                    />
                    <PrimaryButton
                      label="Keep the current link"
                      variant="ghost"
                      disabled={rotate.isPending}
                      onPress={() => setConfirmReset(false)}
                    />
                  </View>
                ) : (
                  <>
                    <View style={styles.qrActions}>
                      <PrimaryButton label="Copy link" variant="secondary" onPress={() => void withLink(copyUrl)} />
                      {canRotate ? (
                        <PrimaryButton label="Reset link" variant="ghost" onPress={() => setConfirmReset(true)} />
                      ) : null}
                    </View>
                    {canRotate ? (
                      <Text style={styles.qrHint}>
                        Resetting creates a fresh link and revokes every previously shared one.
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}

            {/* ── Member picker ── */}
            <MemberPicker
              selection={selection}
              onSelectionChange={setSelection}
              excludeUserIds={excludeUserIds}
            />
          </ScrollView>

          {/* ── Add: pinned below the scroll ── */}
          {canSearchMembers ? (
            <PrimaryButton
              label={addLabel}
              loading={invite.isPending}
              disabled={selectedCount === 0}
              onPress={() => invite.mutate(inviteeIds(selection))}
            />
          ) : null}
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
  headerButton: {
    minHeight: 44,
    justifyContent: 'center',
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
  headerSpacer: {
    minWidth: 48,
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
  // Shrinks to fit a height-bounded sheet (and the keyboard) instead of a
  // fixed cap; the footer stays put.
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  resetQuestion: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
