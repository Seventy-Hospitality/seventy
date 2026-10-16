/**
 * Pure booking helpers shared by the booking wizard, the booking screens and
 * other features that render bookings: club wall-clock time math, date keys
 * on the club's calendar, contiguous slot selection, and formatters.
 *
 * Clutch speaks the club's wall clock: availability slots are "HH:MM", booking
 * rows are "HH:MM:SS", dates are "YYYY-MM-DD", all in the club's timezone. The
 * app never converts them to device time; it only formats them.
 *
 * Money is formatted here and never computed: every figure comes from Clutch
 * (a slot's price_cents, a quote, a booking's price_cents, a due).
 */
import type { Booking } from '../../lib/clutch';

/** A booking's status, as every booking shape in the contract spells it. */
export type BookingStatus = Booking['status'];

// ── Wall-clock time ──

/** "18:00" or "18:00:00" to "18:00". */
export function toHHMM(time: string): string {
  return time.slice(0, 5);
}

/** "HH:MM[:SS]" to minutes from the club's midnight. */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Minutes from the club's midnight for the END of a range. Clutch writes the
 * end of the day as "00:00" (and "00:00:00"; the client also sends "24:00" as
 * "00:00"), so an end of 00:00 after any start is midnight at the end of the
 * day: 1440, never 0.
 */
export function endToMinutes(end: string): number {
  // A range never ends at the midnight it starts from, so 00:00 as an end is
  // always the midnight that closes the day.
  const minutes = timeToMinutes(end);
  return minutes === 0 ? 24 * 60 : minutes;
}

/** The length of [start, end) in minutes, reading an end of 00:00 as midnight. */
export function rangeMinutes(start: string, end: string): number {
  return endToMinutes(end) - timeToMinutes(start);
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** "21:30" -> "9:30PM" (the Figma slot style: no space before the meridiem). */
export function formatSlotTime(time: string): string {
  const minutes = timeToMinutes(time) % (24 * 60);
  const hours24 = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(rest).padStart(2, '0')}${meridiem}`;
}

/** One slot row label: "4:00PM - 4:30PM". */
export function formatSlotRange(start: string, end: string): string {
  return `${formatSlotTime(start)} - ${formatSlotTime(end)}`;
}

/**
 * Compact range for headers and cards: "9:30-11:30PM" (the first meridiem is
 * dropped when both ends share it).
 */
export function formatTimeRangeCompact(start: string, end: string): string {
  const from = formatSlotTime(start);
  const to = formatSlotTime(end);
  const meridiem = from.slice(-2);
  if (to.endsWith(meridiem)) return `${from.slice(0, -2)}-${to}`;
  return `${from}-${to}`;
}

/** "2 hours" / "1 hour" / "90 min". */
export function formatDuration(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return `${minutes} min`;
}

// ── Date keys ("YYYY-MM-DD" on the club's calendar) ──

/** A date key as a Date at local noon (immune to DST edges; for formatting only). */
export function dateKeyToDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = clockFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    clockFormatters.set(timezone, formatter);
  }
  return formatter;
}

/**
 * The club's wall clock at `now`: its date key and minutes past its midnight.
 * Clutch decides "today", "past" and the booking horizon on this clock, so near
 * midnight the device and the club disagree and the club wins.
 */
export function clubNow(timezone: string, now: Date = new Date()): { date: string; minutes: number } {
  const parts = clockFormatter(timezone).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '00';
  const hours = Number(part('hour')) % 24;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: hours * 60 + Number(part('minute')),
  };
}

export function todayDateKey(timezone: string, now: Date = new Date()): string {
  return clubNow(timezone, now).date;
}

/** True once the club's clock has reached `date` at `time`. */
export function hasStarted(
  booking: { date: string; start_time: string },
  timezone: string,
  now: Date = new Date(),
): boolean {
  const clock = clubNow(timezone, now);
  if (booking.date !== clock.date) return booking.date < clock.date;
  return timeToMinutes(booking.start_time) <= clock.minutes;
}

export function addDaysToDateKey(key: string, days: number): string {
  const date = dateKeyToDate(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

/** The booking horizon as date keys, today first: today plus `advanceDays`. */
export function buildDateStrip(todayKey: string, advanceDays: number): string[] {
  const days = Math.max(0, advanceDays) + 1;
  return Array.from({ length: days }, (_, i) => addDaysToDateKey(todayKey, i));
}

/** Date-strip tile parts: { weekday: "MON", day: "6" }. */
export function formatStripDay(key: string): { weekday: string; day: string } {
  const date = dateKeyToDate(key);
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    day: String(date.getDate()),
  };
}

/** "Mon, Jul 6" */
export function formatDateHeading(key: string): string {
  return dateKeyToDate(key).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** "Monday, Jul 6" */
export function formatDateLong(key: string): string {
  return dateKeyToDate(key).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** "July 6, 2026" */
export function formatDateFull(key: string): string {
  return dateKeyToDate(key).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Contiguous slot selection ──

function sortTimes(times: string[]): string[] {
  return [...times].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

/**
 * Toggles a slot start while keeping the selection contiguous (a booking is
 * one unbroken range):
 * - next to an end of the run extends it;
 * - away from the run starts a new selection at that slot;
 * - deselecting the first slot shrinks from the front;
 * - deselecting any other slot keeps the run up to (excluding) it.
 */
export function toggleSlot(selected: string[], slot: string, slotMinutes: number): string[] {
  const sorted = sortTimes(selected);
  const at = timeToMinutes(slot);
  const index = sorted.findIndex((entry) => timeToMinutes(entry) === at);

  if (index === -1) {
    if (sorted.length === 0) return [slot];
    const first = timeToMinutes(sorted[0]);
    const last = timeToMinutes(sorted[sorted.length - 1]);
    if (at === first - slotMinutes) return [slot, ...sorted];
    if (at === last + slotMinutes) return [...sorted, slot];
    return [slot];
  }
  if (index === 0) return sorted.slice(1);
  return sorted.slice(0, index);
}

/**
 * Keeps a selection valid after the grid refetches: drops starts that are no
 * longer offered, then keeps the longest remaining contiguous run.
 */
export function pruneSelection(
  selected: string[],
  offered: Iterable<string>,
  slotMinutes: number,
): string[] {
  const offeredSet = new Set(offered);
  const kept = sortTimes(selected.filter((slot) => offeredSet.has(slot)));
  if (kept.length === 0) return [];
  let best: string[] = [];
  let run: string[] = [kept[0]];
  for (let i = 1; i < kept.length; i++) {
    if (timeToMinutes(kept[i]) === timeToMinutes(kept[i - 1]) + slotMinutes) {
      run.push(kept[i]);
    } else {
      if (run.length > best.length) best = run;
      run = [kept[i]];
    }
  }
  return run.length > best.length ? run : best;
}

export interface TimeRange {
  /** "HH:MM" */
  start: string;
  /** "HH:MM" */
  end: string;
  minutes: number;
}

/** The range a contiguous selection of slot starts covers, or null when empty. */
export function selectionRange(selected: string[], slotMinutes: number): TimeRange | null {
  if (selected.length === 0) return null;
  const sorted = sortTimes(selected);
  const start = timeToMinutes(sorted[0]);
  const end = timeToMinutes(sorted[sorted.length - 1]) + slotMinutes;
  return { start: minutesToTime(start), end: minutesToTime(end), minutes: end - start };
}

/** The slot starts inside [start, end): restores a selection from a booking. */
export function slotsInRange(start: string, end: string, slotMinutes: number): string[] {
  const out: string[] = [];
  const last = endToMinutes(end);
  for (let at = timeToMinutes(start); at < last; at += slotMinutes) {
    out.push(minutesToTime(at));
  }
  return out;
}

// ── Money (formatting only) ──

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, whole: boolean): Intl.NumberFormat {
  const key = `${currency}:${whole}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.toUpperCase(),
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
      });
    } catch {
      formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
      });
    }
    moneyFormatters.set(key, formatter);
  }
  return formatter;
}

/** Always two decimals: "$20.00" (totals, amounts paid, dues). */
export function formatMoney(cents: number, currency: string): string {
  return moneyFormatter(currency, false).format(cents / 100);
}

/** "$20" for whole amounts, "$2.50" otherwise (slot prices, chips). */
export function formatPrice(cents: number, currency: string): string {
  return moneyFormatter(currency, cents % 100 === 0).format(cents / 100);
}

// ── Words ──

/** court_type to UI copy: "pickleball" -> "Pickleball", "padel_tennis" -> "Padel tennis". */
export function sportLabel(courtType: string): string {
  const words = courtType.replace(/[_-]+/g, ' ').trim();
  if (!words) return 'Court';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'On hold',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No show',
};

export function bookingStatusLabel(status: BookingStatus): string {
  return BOOKING_STATUS_LABELS[status];
}

const PLAYER_STATUS_LABELS: Record<string, string> = {
  invited: 'Invited',
  accepted: 'Accepted',
  declined: 'Declined',
};

/** A player row's status (`invited`, `accepted`, `declined`; Clutch types it as a string). */
export function playerStatusLabel(status: string): string {
  return PLAYER_STATUS_LABELS[status] ?? sportLabel(status);
}
