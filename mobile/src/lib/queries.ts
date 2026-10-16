/**
 * Shared react-query keys + read definitions for Clutch data that more than
 * one feature reads. Every feature uses THESE keys for these reads so one
 * invalidation reaches every screen (e.g. after a booking is confirmed,
 * invalidate `queryKeys.bookings` and `queryKeys.home`).
 *
 * Feature-private reads may define their own keys, prefixed with the feature
 * name, but never a second key for a read listed here.
 */
import { queryOptions } from '@tanstack/react-query';
import { clutch, type BookingId, type GroupId } from './clutch';

export const queryKeys = {
  club: ['club'] as const,
  me: ['me'] as const,
  home: ['home'] as const,
  membership: ['membership'] as const,
  tiers: ['tiers'] as const,
  eligibleTierChanges: ['membership', 'eligible-changes'] as const,
  paymentMethods: ['payment-methods'] as const,
  payments: ['payments'] as const,
  preferences: ['preferences'] as const,
  checkinToken: ['checkin-token'] as const,
  courts: ['courts'] as const,
  availability: (date: string) => ['availability', date] as const,
  bookings: ['bookings'] as const,
  booking: (id: BookingId) => ['bookings', 'detail', id] as const,
  bookingInvitations: ['bookings', 'invitations'] as const,
  groups: ['groups'] as const,
  group: (id: GroupId) => ['groups', 'detail', id] as const,
  groupActivity: (id: GroupId, filter: 'upcoming' | 'past') => ['groups', 'activity', id, filter] as const,
  groupInvitations: ['groups', 'invitations'] as const,
};

/** GET /me: profile + club memberships. Membership facts are uncertain until P3 (see contract). */
export const meQuery = queryOptions({ queryKey: queryKeys.me, queryFn: () => clutch.me.get() });

export const homeQuery = queryOptions({ queryKey: queryKeys.home, queryFn: () => clutch.me.home() });

/** GET /me/membership at this club: role + tier subscription. */
export const membershipQuery = queryOptions({
  queryKey: queryKeys.membership,
  queryFn: () => clutch.membership.get(),
});

/** The club's tiers plus the caller's subscription. */
export const tiersQuery = queryOptions({
  queryKey: queryKeys.tiers,
  queryFn: () => clutch.club.tiers(),
  staleTime: 5 * 60_000,
});

export const paymentMethodsQuery = queryOptions({
  queryKey: queryKeys.paymentMethods,
  queryFn: () => clutch.paymentMethods.list(),
});

export const preferencesQuery = queryOptions({
  queryKey: queryKeys.preferences,
  queryFn: () => clutch.me.preferences(),
});

export const courtsQuery = queryOptions({
  queryKey: queryKeys.courts,
  queryFn: () => clutch.club.courts(),
  staleTime: 10 * 60_000,
});

export const availabilityQuery = (date: string) =>
  queryOptions({
    queryKey: queryKeys.availability(date),
    queryFn: () => clutch.club.availability(date),
    staleTime: 15_000,
  });

export const bookingQuery = (id: BookingId) =>
  queryOptions({ queryKey: queryKeys.booking(id), queryFn: () => clutch.bookings.get(id) });

export const bookingInvitationsQuery = queryOptions({
  queryKey: queryKeys.bookingInvitations,
  queryFn: () => clutch.me.bookingInvitations(),
});

export const groupsQuery = queryOptions({ queryKey: queryKeys.groups, queryFn: () => clutch.groups.list() });

export const groupQuery = (id: GroupId) =>
  queryOptions({ queryKey: queryKeys.group(id), queryFn: () => clutch.groups.get(id) });

export const groupInvitationsQuery = queryOptions({
  queryKey: queryKeys.groupInvitations,
  queryFn: () => clutch.groups.invitations(),
});
