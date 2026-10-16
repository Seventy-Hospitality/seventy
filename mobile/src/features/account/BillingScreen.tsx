/**
 * Billing (Figma billing 107:10434): the membership card (tier, Clutch's
 * price, status line, default payment method, change/cancel entry) and the
 * payment history from GET /me/payments, newest first, paged. Every figure is
 * Clutch's: the amount charged, its status, and any refunded amount it
 * recorded against the payment.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { MySubscription, PaymentHistoryItem, SavedPaymentMethod } from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { membershipQuery, paymentMethodsQuery } from '../../lib/queries';
import { EmptyStateView, PrimaryButton, Skeleton } from '../../components';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import { AccountFrame } from './AccountFrame';
import { paymentsInfiniteQuery } from './account-data';
import {
  canCancel,
  canChangeTier,
  canResume,
  formatCents,
  instantDateLabel,
  intervalNoun,
  paymentAmountLabel,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentTitle,
  refundLabel,
  subscriptionStatusLine,
} from './account-lib';

export function BillingScreen() {
  const membership = useQuery(membershipQuery);
  const methods = useQuery(paymentMethodsQuery);
  const payments = useInfiniteQuery(paymentsInfiniteQuery);
  const timezone = useClub().data?.timezone;

  const refreshing =
    (membership.isRefetching || methods.isRefetching || payments.isRefetching) &&
    !membership.isPending;

  return (
    <AccountFrame
      title="Billing"
      backLabel="Back to account"
      backTo="/(tabs)/account"
      refreshing={refreshing}
      onRefresh={() => {
        void membership.refetch();
        void methods.refetch();
        void payments.refetch();
      }}
    >
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Membership</Text>
        {membership.isPending ? (
          <Skeleton height={150} borderRadius={radius.lg} />
        ) : membership.isError ? (
          <ErrorBox message="We could not load your membership." onRetry={() => void membership.refetch()} />
        ) : (
          <MembershipCard
            subscription={membership.data.subscription}
            defaultMethod={methods.data?.find((m) => m.is_default) ?? null}
            methodsLoading={methods.isPending}
            timezone={timezone}
          />
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Billing history</Text>
        {payments.isPending ? (
          <View accessibilityLabel="Loading your payments" style={styles.list}>
            <Skeleton height={64} borderRadius={radius.lg} />
            <Skeleton height={64} borderRadius={radius.lg} />
          </View>
        ) : payments.isError ? (
          <ErrorBox message="We could not load your payments." onRetry={() => void payments.refetch()} />
        ) : payments.data.pages[0]?.items.length ? (
          <View style={styles.historyCard}>
            {payments.data.pages
              .flatMap((page) => page.items)
              .map((item, index) => (
                <PaymentRow key={item.id} item={item} timezone={timezone} first={index === 0} />
              ))}
            {payments.hasNextPage ? (
              <View style={styles.more}>
                <PrimaryButton
                  label="Show more"
                  variant="ghost"
                  loading={payments.isFetchingNextPage}
                  onPress={() => void payments.fetchNextPage()}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <EmptyStateView
            title="No payments yet"
            description="Your membership and booking payments will show up here."
          />
        )}
      </View>
    </AccountFrame>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
      <PrimaryButton label="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}

function MembershipCard({
  subscription,
  defaultMethod,
  methodsLoading,
  timezone,
}: {
  subscription: MySubscription | null;
  defaultMethod: SavedPaymentMethod | null;
  methodsLoading: boolean;
  timezone?: string;
}) {
  const router = useRouter();

  if (!subscription) {
    // Uncertain until Clutch P3 (a failed read looks the same): describe only.
    return (
      <View style={styles.card}>
        <Text style={styles.noMembershipTitle}>No membership tier on file.</Text>
        <Text style={styles.noMembershipBody}>Contact the club if this looks wrong.</Text>
      </View>
    );
  }

  const manage = canChangeTier(subscription) || canCancel(subscription) || canResume(subscription);

  return (
    <View style={styles.card}>
      <View style={styles.planRow}>
        <Text style={styles.planName}>{subscription.tier_name}</Text>
        <Text style={styles.planPrice}>
          {formatCents(subscription.price_cents, subscription.currency)}
          <Text style={styles.planPeriod}> / {intervalNoun(subscription.interval)}</Text>
        </Text>
      </View>
      <Text style={styles.planStatus}>{subscriptionStatusLine(subscription, timezone)}</Text>

      <View style={styles.divider} />

      <View style={styles.paymentRow}>
        <Ionicons name="card-outline" size={18} color={colors.textMuted} />
        <Text style={styles.cardText} numberOfLines={1}>
          {methodsLoading ? 'Loading payment method' : defaultMethod ? paymentMethodLabel(defaultMethod) : 'No payment method on file'}
        </Text>
        <Text
          accessibilityRole="button"
          accessibilityLabel={defaultMethod ? 'Manage payment methods' : 'Add payment method'}
          onPress={() => router.push('/account/payment-method')}
          style={styles.paymentAction}
        >
          {defaultMethod ? 'Manage' : 'Add'}
        </Text>
      </View>

      {manage ? (
        <>
          <View style={styles.divider} />
          <Text
            accessibilityRole="button"
            accessibilityLabel="Manage membership"
            onPress={() => router.push('/account/change-membership')}
            style={styles.changeRow}
          >
            Manage membership{'  '}›
          </Text>
        </>
      ) : null}
    </View>
  );
}

function PaymentRow({ item, timezone, first }: { item: PaymentHistoryItem; timezone?: string; first: boolean }) {
  const status = paymentStatusLabel(item.status);
  const inactive = item.status === 'failed';
  const refund = refundLabel(item);
  const meta = [instantDateLabel(item.created_at, timezone), status].filter(Boolean).join(' · ');

  return (
    <View style={[styles.txn, first ? null : styles.txnDivider]}>
      <View style={styles.txnText}>
        <Text style={[styles.txnTitle, inactive ? styles.txnMuted : null]} numberOfLines={2}>
          {paymentTitle(item)}
        </Text>
        <Text style={styles.txnMeta}>{meta}</Text>
        {refund ? <Text style={styles.txnRefund}>{refund}</Text> : null}
      </View>
      <Text style={[styles.txnAmount, inactive ? styles.txnMuted : null]}>{paymentAmountLabel(item)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionLabel: { ...typography.label, color: colors.textMuted, textTransform: 'uppercase', marginLeft: spacing.xs },
  list: { gap: spacing.sm },
  errorBox: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  errorText: { ...typography.body, color: colors.text },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  noMembershipTitle: { ...typography.h3, color: colors.text },
  noMembershipBody: { ...typography.body, color: colors.textMuted },
  planRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  planName: { ...typography.h2, color: colors.text, flexShrink: 1 },
  planPrice: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.accent },
  planPeriod: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },
  planStatus: { ...typography.body, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardText: { flex: 1, color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
  paymentAction: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 14 },
  changeRow: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 15 },
  historyCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  more: { paddingVertical: spacing.sm },
  txn: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md },
  txnDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  txnText: { flex: 1, gap: 2 },
  txnTitle: { color: colors.text, fontFamily: fonts.bodyMedium, fontSize: 14 },
  txnMeta: { color: colors.textSubtle, fontFamily: fonts.body, fontSize: 12 },
  txnRefund: { color: colors.success, fontFamily: fonts.body, fontSize: 12 },
  txnAmount: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 14 },
  txnMuted: { color: colors.textSubtle },
});
