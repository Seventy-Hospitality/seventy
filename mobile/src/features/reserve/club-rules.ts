/**
 * The club facts the booking screens read: its timezone and the booking rules
 * for one sport (court_type). Clutch enforces every rule on create; the app
 * reads them to shape the UI (how far ahead the date rail goes, the slot
 * length, min and max duration, opening hours) so a member is not offered
 * something Clutch will refuse.
 *
 * Where the rules come from:
 * - bookingParity (Clutch P4): GET /clubs/{club}/booking-rules, per court
 *   type, with whether this member may book that sport at all
 *   (bookable_by_viewer / refusal).
 * - otherwise: the club row's booking_rules (one set for every sport).
 */
import { useMemo } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { clutch, type ClubBookingRules, type ClubDetail } from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { todayDateKey } from './booking';
import type { DayHours } from './court-picker';

/** What the booking screens need to know about booking one sport here. */
export interface SportRules {
  slot_duration_minutes: number;
  /** Null: the club set no minimum. */
  min_duration_minutes: number | null;
  /** Null: the club set no maximum. */
  max_duration_minutes: number | null;
  advance_booking_days: number;
  /** The club's cancellation window in hours; null when not stated. */
  cancellation_hours: number | null;
  /** Per-sport opening hours (P4); null: the grid's own slots are the rule. */
  hours: readonly DayHours[] | null;
  /**
   * Whether this member may book this sport (P4). Null when the app cannot
   * know before asking (without P4 Clutch answers at hold time).
   */
  bookable: boolean | null;
  /** Why not, when `bookable` is false. */
  refusal: 'tier_required' | 'not_club_member' | null;
}

/**
 * Used only while a club has no booking_rules row. Clutch still validates the
 * request with its own defaults, so a wrong guess here costs a refusal with a
 * clear message, never a wrong booking.
 */
export const FALLBACK_BOOKING_RULES: SportRules = {
  slot_duration_minutes: 60,
  min_duration_minutes: 60,
  max_duration_minutes: 120,
  advance_booking_days: 7,
  cancellation_hours: null,
  hours: null,
  bookable: null,
  refusal: null,
};

/** The club row's rules (one set for every sport). */
export function bookingRulesOf(club: Pick<ClubDetail, 'booking_rules'>): SportRules {
  const rules = club.booking_rules;
  if (!rules) return FALLBACK_BOOKING_RULES;
  return {
    slot_duration_minutes: rules.slot_duration_minutes,
    min_duration_minutes: rules.min_duration_minutes,
    max_duration_minutes: rules.max_duration_minutes,
    advance_booking_days: rules.advance_booking_days,
    cancellation_hours: rules.cancellation_hours,
    hours: null,
    bookable: null,
    refusal: null,
  };
}

/**
 * P4's rules for one court type, with the club row filling what P4 leaves
 * null (no advance limit stated, the cancellation window). A sport P4 does
 * not list falls back to the club row entirely.
 */
export function sportRulesFrom(
  parity: ClubBookingRules,
  sport: string,
  club: Pick<ClubDetail, 'booking_rules'>,
): SportRules {
  const base = bookingRulesOf(club);
  const entry = parity.court_types.find((rules) => rules.court_type === sport);
  if (!entry) return base;
  return {
    slot_duration_minutes: entry.slot_duration_minutes || base.slot_duration_minutes,
    min_duration_minutes: entry.min_duration_minutes,
    max_duration_minutes: entry.max_duration_minutes,
    advance_booking_days: entry.advance_booking_days ?? base.advance_booking_days,
    cancellation_hours: base.cancellation_hours,
    hours: entry.hours,
    bookable: entry.bookable_by_viewer,
    refusal: entry.refusal,
  };
}

/** GET /clubs/{club}/booking-rules (P4). Only read with bookingParity on. */
export const bookingRulesQuery = queryOptions({
  queryKey: ['reserve', 'booking-rules'] as const,
  queryFn: () => clutch.club.bookingRules(),
  staleTime: 5 * 60_000,
});

export interface SportRulesState {
  rules: SportRules | null;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * The rules for booking `sport`: P4's per-sport rules when bookingParity is
 * on, else the club row's. A failed P4 read falls back to the club row
 * (Clutch still enforces the real rules on create).
 */
export function useSportRules(sport: string): SportRulesState {
  const club = useClub();
  const parity = clutch.capabilities.bookingParity;
  const perSport = useQuery({ ...bookingRulesQuery, enabled: parity });

  const rules = useMemo(() => {
    if (!club.data) return null;
    if (!parity || !perSport.data) return bookingRulesOf(club.data);
    return sportRulesFrom(perSport.data, sport, club.data);
  }, [club.data, parity, perSport.data, sport]);

  const waitingOnParity = parity && perSport.isPending;
  return {
    rules: waitingOnParity ? null : rules,
    isPending: club.isPending || waitingOnParity,
    isError: club.isError,
    refetch: () => {
      void club.refetch();
      if (parity) void perSport.refetch();
    },
  };
}

/** A timezone Intl can format with, else the device zone (a bad club value). */
export function usableTimezone(zone: string | null | undefined): string {
  const device = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  })();
  if (!zone) return device;
  try {
    todayDateKey(zone);
    return zone;
  } catch {
    return device;
  }
}

/** The club's timezone (device zone while the club row loads). */
export function useClubTimezone(): string {
  const club = useClub();
  const zone = club.data?.timezone;
  return useMemo(() => usableTimezone(zone), [zone]);
}
