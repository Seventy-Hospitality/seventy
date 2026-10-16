/**
 * The club facts the booking screens read off useClub(): its timezone and its
 * booking rules. Clutch enforces every rule on create; the app reads them to
 * shape the UI (how far ahead the date rail goes, the slot length, min and
 * max duration) so a member is not offered something Clutch will refuse.
 */
import { useMemo } from 'react';
import type { BookingRules, Club } from '../../lib/clutch';
import { useClub } from '../../lib/club';
import { todayDateKey } from './booking';

/**
 * Used only while a club has no booking_rules row. Clutch still validates the
 * request with its own defaults, so a wrong guess here costs a refusal with a
 * clear message, never a wrong booking.
 */
export const FALLBACK_BOOKING_RULES: BookingRules = {
  slot_duration_minutes: 60,
  min_duration_minutes: 60,
  max_duration_minutes: 120,
  advance_booking_days: 7,
  cancellation_hours: null,
};

export function bookingRulesOf(club: Pick<Club, 'booking_rules'>): BookingRules {
  return club.booking_rules ?? FALLBACK_BOOKING_RULES;
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
