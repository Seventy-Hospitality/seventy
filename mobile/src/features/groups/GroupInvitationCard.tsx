import { StyleSheet, Text, View } from 'react-native';
import type { GroupInvitation } from '../../lib/clutch';
import { Avatar, PrimaryButton, useToast } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import { useRespondToGroupInvitation } from './groups-data';
import { respondErrorMessage } from './groups-lib';

interface GroupInvitationCardProps {
  invitation: GroupInvitation;
  onAccept: () => void;
  onDecline: () => void;
  /** This card's response is in flight. */
  pending: boolean;
  /** Any response (this or another card) is in flight. */
  disabled: boolean;
}

/**
 * A pending group invitation: the group and Accept / Decline. Clutch's
 * invitation row carries the group name only (no inviter, cover or size), so
 * that is all the card shows. Rendered by the Groups tab and the home screen;
 * pair it with useGroupInvitationResponder for the response wiring.
 */
export function GroupInvitationCard({
  invitation,
  onAccept,
  onDecline,
  pending,
  disabled,
}: GroupInvitationCardProps) {
  const name = invitation.group_name;
  return (
    <View style={styles.card}>
      <Text style={styles.lead}>You are invited to join</Text>
      <View style={styles.groupRow}>
        <Avatar name={name} size="md" />
        <Text style={styles.groupName} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <View style={styles.actions} accessibilityLabel={`Respond to the ${name} invitation`}>
        <View style={styles.actionButton}>
          <PrimaryButton
            label="Accept"
            accessibilityLabel={`Accept the ${name} invitation`}
            loading={pending}
            disabled={disabled && !pending}
            onPress={onAccept}
          />
        </View>
        <View style={styles.actionButton}>
          <PrimaryButton
            label="Decline"
            variant="ghost"
            accessibilityLabel={`Decline the ${name} invitation`}
            disabled={disabled}
            onPress={onDecline}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * The response wiring every invitation list shares: the mutation, which card
 * is in flight, and the toasts. `onAccepted` lets the caller open the group.
 */
export function useGroupInvitationResponder(onAccepted?: (invitation: GroupInvitation) => void) {
  const respond = useRespondToGroupInvitation();
  const { toast } = useToast();

  const respondTo = (invitation: GroupInvitation, accept: boolean) => {
    respond.mutate(
      { invitation, accept },
      {
        onSuccess: () => {
          toast({
            variant: 'success',
            message: accept ? `You joined ${invitation.group_name}.` : 'Group invitation declined.',
          });
          if (accept) onAccepted?.(invitation);
        },
        onError: (error) => toast({ variant: 'error', message: respondErrorMessage(error) }),
      },
    );
  };

  const cardProps = (invitation: GroupInvitation) => ({
    invitation,
    pending: respond.isPending && respond.variables?.invitation.id === invitation.id,
    disabled: respond.isPending,
    onAccept: () => respondTo(invitation, true),
    onDecline: () => respondTo(invitation, false),
  });

  return { cardProps, isPending: respond.isPending };
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  lead: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  groupName: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
