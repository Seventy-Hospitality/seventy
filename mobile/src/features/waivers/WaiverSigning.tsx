/**
 * Read and sign the club's required waivers, one at a time, in the app.
 *
 * Clutch refuses every booking (waiver_required) until each required waiver
 * is signed, and an `every_time` waiver must be signed again per visit. Used
 * by onboarding (a waiver never signed) and by app/waivers.tsx (a booking
 * that came back waiver_required). POST /waivers/{id}/sign keeps the text as
 * it reads now with the signature, so the member signs exactly what is shown.
 */
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '../../components/Checkbox';
import { PrimaryButton } from '../../components/PrimaryButton';
import { clutch, useMutationKey, type WaiverStatus } from '../../lib/clutch';
import { queryKeys, waiversQuery } from '../../lib/queries';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { clutchErrorMessage } from '../account/account-lib';
import { unsignedRequiredWaivers, waiversToSign } from '../onboarding/onboarding';

export interface WaiverSigningProps {
  /**
   * `onboarding` asks only for waivers never signed; `renew` also offers
   * every_time waivers signed before (a booking was refused for one).
   */
  mode: 'onboarding' | 'renew';
  /** All due waivers are signed (the waivers query is fresh by then). */
  onDone: () => void;
  /** The way out under the form: sign out in onboarding, back elsewhere. */
  secondary: { label: string; onPress: () => void | Promise<unknown> };
}

export function WaiverSigning({ mode, onDone, secondary }: WaiverSigningProps) {
  const queryClient = useQueryClient();
  const waivers = useQuery(waiversQuery);
  // Signed in this visit: an every_time waiver stays "due" in renew mode
  // after signing, so the screen remembers what it already took.
  const [signedNow, setSignedNow] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const key = useMutationKey();

  const due = (waivers.data ? (mode === 'renew' ? waiversToSign : unsignedRequiredWaivers)(waivers.data) : []).filter(
    (w) => !signedNow.includes(w.id),
  );
  const current: WaiverStatus | undefined = due[0];

  const sign = useMutation({
    mutationFn: async (waiver: WaiverStatus) => {
      await key.run(waiver.id, (k) => clutch.me.signWaiver(waiver.id, { idempotencyKey: k }));
      return waiver;
    },
    onSuccess: async (waiver) => {
      setAgreed(false);
      setSignedNow((ids) => [...ids, waiver.id]);
      const fresh = await queryClient.fetchQuery({ ...waiversQuery, staleTime: 0 });
      const remaining = (mode === 'renew' ? waiversToSign : unsignedRequiredWaivers)(fresh).filter(
        (w) => w.id !== waiver.id && !signedNow.includes(w.id),
      );
      if (remaining.length === 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.waivers });
        onDone();
      }
    },
  });

  if (waivers.isPending) {
    return (
      <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel="Loading the club's waiver">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (waivers.isError || !current) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{waivers.isError ? 'We could not load the waiver' : 'Nothing to sign'}</Text>
        <Text style={styles.muted}>
          {waivers.isError ? 'Check your connection and try again.' : 'You have signed every waiver the club needs.'}
        </Text>
        <View style={styles.actions}>
          {waivers.isError ? (
            <PrimaryButton label="Try again" onPress={() => void waivers.refetch()} />
          ) : (
            <PrimaryButton label="Continue" onPress={onDone} />
          )}
          <PrimaryButton label={secondary.label} variant="ghost" onPress={() => void secondary.onPress()} />
        </View>
      </View>
    );
  }

  const step = due.length > 1 ? ` (1 of ${due.length})` : '';
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.kicker}>Before you book{step}</Text>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.muted}>Club70 needs your signature on this waiver before you can book a court.</Text>
        <View style={styles.document} accessibilityLabel={`${current.title} text`}>
          <Text style={styles.documentText}>{current.content}</Text>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Checkbox
          checked={agreed}
          onChange={setAgreed}
          label="I have read the waiver and agree to it"
          accessibilityLabel="I have read the waiver and agree to it"
        />
        {sign.isError ? (
          <Text style={styles.error} accessibilityRole="alert">
            {clutchErrorMessage(sign.error, 'We could not save your signature. Try again.')}
          </Text>
        ) : null}
        <PrimaryButton
          label="Sign waiver"
          disabled={!agreed}
          loading={sign.isPending}
          onPress={() => sign.mutate(current)}
        />
        <PrimaryButton label={secondary.label} variant="ghost" onPress={() => void secondary.onPress()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg,
  },
  kicker: { ...typography.label, color: colors.accent, textTransform: 'uppercase' },
  title: { ...typography.h2, color: colors.text },
  muted: { ...typography.body, color: colors.textMuted },
  document: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  documentText: { ...typography.body, color: colors.text },
  footer: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  error: { ...typography.body, color: colors.danger },
});
