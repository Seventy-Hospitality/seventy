/**
 * Pure view-models over Clutch's availability grid (GET
 * /clubs/{club}/availability?date=: every court, every slot, its status and
 * the caller's price).
 *
 * The member picks a sport and a time range; the app picks the court. A start
 * time is offered when at least one court of that sport is free there, and a
 * range is bookable only when ONE court is free for all of it (a booking is
 * one court for one unbroken range). The choice is deterministic: the first
 * qualifying court in grid order, which is Clutch's court sort order, so two
 * renders of the same grid always name the same court.
 *
 * Midnight: Clutch writes the end of the day as "00:00" (a slot 23:30-00:00,
 * a booking ending "00:00:00"). Every end time here goes through
 * endToMinutes, so such an end is 24:00 for ranges, ordering and durations.
 *
 * Nothing here adds, multiplies or discounts money. Prices are the grid's own
 * per-slot figures; the total for a range comes from Clutch (quote, then the
 * hold's price_cents).
 */
import type { AvailabilitySlot, Court, CourtAvailability, CourtId } from '../../lib/clutch';
import { endToMinutes, timeToMinutes, toHHMM } from './booking';

/** GET /clubs/{club}/availability: every court's slot grid for one day. */
export type AvailabilityGrid = readonly CourtAvailability[];

/**
 * A booking's own slots, which the grid shows as `booked` but which are free
 * to that same booking when it moves (reschedule). Only for the grid of the
 * booking's own date.
 */
export interface OwnRange {
  court_id: CourtId;
  start_time: string;
  end_time: string;
}

export interface PickOptions {
  own?: OwnRange | null;
}

/** Distinct court types in court order (sort_order, then the given order). */
export function sportsFrom(courts: readonly Court[]): string[] {
  const ordered = courts
    .map((court, index) => ({ court, index }))
    .sort((a, b) => a.court.sort_order - b.court.sort_order || a.index - b.index);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { court } of ordered) {
    if (!seen.has(court.court_type)) {
      seen.add(court.court_type);
      out.push(court.court_type);
    }
  }
  return out;
}

/** How many courts of each sport the club has (for the Reserve tab rows). */
export function courtCountFor(courts: readonly Court[], sport: string): number {
  return courts.filter((court) => court.court_type === sport).length;
}

function isOwnSlot(court: CourtAvailability, slot: AvailabilitySlot, own?: OwnRange | null) {
  if (!own || own.court_id !== court.court_id) return false;
  const start = timeToMinutes(slot.start_time);
  return start >= timeToMinutes(own.start_time) && start < endToMinutes(own.end_time);
}

/** A slot the caller could book: available, or held by the booking being moved. */
export function isFreeSlot(
  court: CourtAvailability,
  slot: AvailabilitySlot,
  opts: PickOptions = {},
): boolean {
  if (slot.status === 'available') return true;
  return slot.status === 'booked' && isOwnSlot(court, slot, opts.own);
}

function courtsOf(grid: AvailabilityGrid, sport: string): CourtAvailability[] {
  return grid.filter((court) => court.court_type === sport);
}

export interface SlotPrice {
  cents: number;
  currency: string;
  /** The caller is paying a member price for this slot. */
  memberPrice: boolean;
  peak: boolean;
}

/** The grid's own price for one slot, as Clutch quoted it to this caller. */
export function slotPrice(slot: AvailabilitySlot): SlotPrice {
  return {
    cents: slot.price_cents,
    currency: slot.currency,
    memberPrice: slot.member_price_cents !== null && slot.member_price_cents === slot.price_cents,
    peak: slot.is_peak,
  };
}

export interface TimeOption {
  /** "HH:MM" */
  start: string;
  /** "HH:MM" */
  end: string;
  /** Courts of this sport free at this start. */
  freeCourts: number;
  /**
   * The price shown for browsing: the slot price on the court pickCourt
   * would choose for this single slot (the first free court in grid order).
   */
  price: SlotPrice;
  /** Free courts of this sport price this slot differently. */
  pricesVary: boolean;
}

/**
 * Start times to offer for a sport: every slot start where at least one court
 * of that sport is free, in time order. Past, booked and maintenance slots
 * are not offered.
 */
export function timesFor(
  grid: AvailabilityGrid,
  sport: string,
  opts: PickOptions = {},
): TimeOption[] {
  const byStart = new Map<string, { end: string; slots: AvailabilitySlot[] }>();
  for (const court of courtsOf(grid, sport)) {
    for (const slot of court.slots) {
      if (!isFreeSlot(court, slot, opts)) continue;
      const start = toHHMM(slot.start_time);
      const entry = byStart.get(start) ?? { end: toHHMM(slot.end_time), slots: [] };
      entry.slots.push(slot);
      byStart.set(start, entry);
    }
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => timeToMinutes(a) - timeToMinutes(b))
    .map(([start, { end, slots }]) => ({
      start,
      end,
      freeCourts: slots.length,
      price: slotPrice(slots[0]),
      pricesVary: slots.some((slot) => slot.price_cents !== slots[0].price_cents),
    }));
}

/** True when `court` is free for every slot of [start, end), with no gap. */
function freeForRange(
  court: CourtAvailability,
  start: number,
  end: number,
  opts: PickOptions,
): boolean {
  if (end <= start) return false;
  const max = court.max_booking_duration_minutes;
  if (typeof max === 'number' && max > 0 && end - start > max) return false;
  const byStart = new Map(court.slots.map((slot) => [timeToMinutes(slot.start_time), slot]));
  let cursor = start;
  while (cursor < end) {
    const slot = byStart.get(cursor);
    if (!slot || !isFreeSlot(court, slot, opts)) return false;
    const next = endToMinutes(slot.end_time);
    if (next <= cursor) return false;
    cursor = next;
  }
  // A slot that runs past `end` means the range does not sit on the grid.
  return cursor === end;
}

/**
 * The one court of `sport` free for the WHOLE range [start, end), or null.
 * Deterministic: the first such court in grid order, except that a booking
 * being moved stays on its own court when that court is free for the range.
 */
export function pickCourt(
  grid: AvailabilityGrid,
  sport: string,
  start: string,
  end: string,
  opts: PickOptions = {},
): CourtAvailability | null {
  const from = timeToMinutes(start);
  const to = endToMinutes(end);
  const courts = courtsOf(grid, sport);
  const ownCourt = opts.own ? courts.find((court) => court.court_id === opts.own?.court_id) : undefined;
  if (ownCourt && freeForRange(ownCourt, from, to, opts)) return ownCourt;
  return courts.find((court) => freeForRange(court, from, to, opts)) ?? null;
}

/** The slot length the grid uses (minutes), or null for an empty grid. */
export function gridSlotMinutes(grid: AvailabilityGrid): number | null {
  for (const court of grid) {
    const slot = court.slots[0];
    if (slot) {
      const length = endToMinutes(slot.end_time) - timeToMinutes(slot.start_time);
      if (length > 0) return length;
    }
  }
  return null;
}

export type DurationProblem = 'too_short' | 'too_long' | null;

/** Whether a range length sits inside the club's booking rules. */
export function durationProblem(
  minutes: number,
  rules: { min_duration_minutes: number | null; max_duration_minutes: number | null },
): DurationProblem {
  if (rules.min_duration_minutes !== null && minutes < rules.min_duration_minutes) return 'too_short';
  if (rules.max_duration_minutes !== null && rules.max_duration_minutes > 0 && minutes > rules.max_duration_minutes) {
    return 'too_long';
  }
  return null;
}

/** One day's opening hours, as the club or a court type states them. */
export interface DayHours {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

/**
 * Whether [start, end) sits inside the opening hours for `dayOfWeek`
 * (0 = Sunday). A close of 00:00 is midnight at the end of the day. With no
 * hours stated the grid's own slots are the only rule (true); a day with no
 * entry, or marked closed, is closed.
 */
export function withinHours(
  start: string,
  end: string,
  hours: readonly DayHours[] | null,
  dayOfWeek: number,
): boolean {
  if (!hours || hours.length === 0) return true;
  const day = hours.find((entry) => entry.day_of_week === dayOfWeek);
  if (!day || day.is_closed) return false;
  const open = timeToMinutes(day.open_time);
  const close = endToMinutes(day.close_time);
  return timeToMinutes(start) >= open && endToMinutes(end) <= close;
}
