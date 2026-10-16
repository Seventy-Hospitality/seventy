import {
  courtCountFor,
  durationProblem,
  gridSlotMinutes,
  pickCourt,
  slotPrice,
  sportsFrom,
  timesFor,
  withinHours,
} from '../court-picker';
import { asCourtId, type AvailabilitySlot, type CourtAvailability, type SlotStatus } from '../../../lib/clutch';
import { makeCourt, makeCourtAvailability, makeSlot } from '../../../lib/clutch/fixtures';

const C1 = asCourtId('c1');
const C2 = asCourtId('c2');
const C3 = asCourtId('c3');
const T1 = asCourtId('t1');

/** One court's slots from 18:00 in 30-minute steps, with the given statuses. */
function row(
  courtId: ReturnType<typeof asCourtId>,
  statuses: SlotStatus[],
  over: Partial<CourtAvailability> = {},
  price: (i: number) => number = () => 1500,
): CourtAvailability {
  const slots: AvailabilitySlot[] = statuses.map((status, i) => {
    const start = 18 * 60 + i * 30;
    const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return makeSlot({ court_id: courtId, start_time: hh(start), end_time: hh(start + 30), status, price_cents: price(i) });
  });
  return makeCourtAvailability(courtId, { court_name: `Court ${courtId}`, ...over }, slots);
}

describe('sportsFrom', () => {
  it('lists distinct court types in court sort order', () => {
    const courts = [
      makeCourt({ id: asCourtId('a'), court_type: 'tennis', sort_order: 3 }),
      makeCourt({ id: asCourtId('b'), court_type: 'pickleball', sort_order: 1 }),
      makeCourt({ id: asCourtId('c'), court_type: 'tennis', sort_order: 2 }),
      makeCourt({ id: asCourtId('d'), court_type: 'badminton', sort_order: 4 }),
    ];
    expect(sportsFrom(courts)).toEqual(['pickleball', 'tennis', 'badminton']);
  });

  it('keeps the given order on equal sort orders and handles no courts', () => {
    const courts = [
      makeCourt({ id: asCourtId('a'), court_type: 'badminton', sort_order: 0 }),
      makeCourt({ id: asCourtId('b'), court_type: 'tennis', sort_order: 0 }),
    ];
    expect(sportsFrom(courts)).toEqual(['badminton', 'tennis']);
    expect(sportsFrom([])).toEqual([]);
  });

  it('counts courts per sport', () => {
    const courts = [
      makeCourt({ court_type: 'tennis' }),
      makeCourt({ court_type: 'tennis' }),
      makeCourt({ court_type: 'badminton' }),
    ];
    expect(courtCountFor(courts, 'tennis')).toBe(2);
    expect(courtCountFor(courts, 'padel')).toBe(0);
  });
});

describe('timesFor', () => {
  it('offers a start when at least one court of the sport is free there', () => {
    const grid = [
      row(C1, ['booked', 'available', 'booked']),
      row(C2, ['available', 'booked', 'booked']),
    ];
    const times = timesFor(grid, 'badminton');
    expect(times.map((t) => t.start)).toEqual(['18:00', '18:30']);
    expect(times[0]).toMatchObject({ end: '18:30', freeCourts: 1 });
  });

  it('never offers past, booked or maintenance slots', () => {
    const grid = [row(C1, ['past', 'maintenance', 'booked', 'available'])];
    expect(timesFor(grid, 'badminton').map((t) => t.start)).toEqual(['19:30']);
  });

  it('ignores other sports and sorts by time', () => {
    const grid = [
      row(T1, ['available', 'available'], { court_type: 'tennis' }),
      row(C1, ['booked', 'available']),
    ];
    expect(timesFor(grid, 'badminton').map((t) => t.start)).toEqual(['18:30']);
    expect(timesFor(grid, 'tennis').map((t) => t.start)).toEqual(['18:00', '18:30']);
    expect(timesFor(grid, 'squash')).toEqual([]);
  });

  it('counts free courts and shows the first free court price, flagging differences', () => {
    const grid = [
      row(C1, ['available'], {}, () => 2000),
      row(C2, ['available'], {}, () => 1500),
    ];
    const [only] = timesFor(grid, 'badminton');
    expect(only.freeCourts).toBe(2);
    expect(only.price.cents).toBe(2000);
    expect(only.pricesVary).toBe(true);
  });

  it('counts a moved booking own slots as free', () => {
    const grid = [row(C1, ['booked', 'booked', 'available'])];
    const own = { court_id: C1, start_time: '18:00:00', end_time: '18:30:00' };
    expect(timesFor(grid, 'badminton', { own }).map((t) => t.start)).toEqual(['18:00', '19:00']);
  });
});

describe('pickCourt', () => {
  it('picks the court free for the whole range', () => {
    const grid = [row(C1, ['available', 'booked']), row(C2, ['available', 'available'])];
    expect(pickCourt(grid, 'badminton', '18:00', '19:00')?.court_id).toBe(C2);
  });

  it('is deterministic: the first qualifying court in grid order', () => {
    const grid = [
      row(C1, ['available', 'available']),
      row(C2, ['available', 'available']),
      row(C3, ['available', 'available']),
    ];
    expect(pickCourt(grid, 'badminton', '18:00', '19:00')?.court_id).toBe(C1);
    expect(pickCourt([...grid].reverse(), 'badminton', '18:00', '19:00')?.court_id).toBe(C3);
  });

  it('returns null when every court is free somewhere but none for all of it', () => {
    // C1 free 18:00-18:30, C2 free 18:30-19:00: a start is offered at each, but
    // no single court holds the hour.
    const grid = [row(C1, ['available', 'booked']), row(C2, ['booked', 'available'])];
    expect(timesFor(grid, 'badminton').map((t) => t.start)).toEqual(['18:00', '18:30']);
    expect(pickCourt(grid, 'badminton', '18:00', '19:00')).toBeNull();
  });

  it('refuses a range crossing a booked, maintenance or past slot', () => {
    expect(pickCourt([row(C1, ['available', 'booked', 'available'])], 'badminton', '18:00', '19:30')).toBeNull();
    expect(pickCourt([row(C1, ['available', 'maintenance'])], 'badminton', '18:00', '19:00')).toBeNull();
    expect(pickCourt([row(C1, ['past', 'available'])], 'badminton', '18:00', '19:00')).toBeNull();
  });

  it('refuses a range with a gap in the grid (a missing slot)', () => {
    const court = row(C1, ['available', 'available', 'available']);
    court.slots.splice(1, 1); // 18:30 is not on the grid at all
    expect(pickCourt([court], 'badminton', '18:00', '19:30')).toBeNull();
    expect(pickCourt([court], 'badminton', '19:00', '19:30')?.court_id).toBe(C1);
  });

  it('refuses a range off the grid or empty', () => {
    const grid = [row(C1, ['available', 'available'])];
    expect(pickCourt(grid, 'badminton', '18:15', '18:45')).toBeNull();
    expect(pickCourt(grid, 'badminton', '18:00', '18:00')).toBeNull();
    expect(pickCourt(grid, 'badminton', '18:30', '19:30')).toBeNull();
  });

  it('respects a court maximum booking length', () => {
    const grid = [
      row(C1, ['available', 'available', 'available'], { max_booking_duration_minutes: 60 }),
      row(C2, ['available', 'available', 'available'], { max_booking_duration_minutes: null }),
    ];
    expect(pickCourt(grid, 'badminton', '18:00', '19:30')?.court_id).toBe(C2);
    expect(pickCourt(grid, 'badminton', '18:00', '19:00')?.court_id).toBe(C1);
  });

  it('only picks courts of the sport', () => {
    const grid = [row(T1, ['available', 'available'], { court_type: 'tennis' })];
    expect(pickCourt(grid, 'badminton', '18:00', '19:00')).toBeNull();
    expect(pickCourt(grid, 'tennis', '18:00', '19:00')?.court_id).toBe(T1);
  });

  it('accepts HH:MM:SS times from booking rows', () => {
    const grid = [row(C1, ['available', 'available'])];
    expect(pickCourt(grid, 'badminton', '18:00:00', '19:00:00')?.court_id).toBe(C1);
  });

  it('lets a moved booking reuse its own slots and prefers its own court', () => {
    const grid = [
      row(C1, ['available', 'available', 'available']),
      row(C2, ['booked', 'booked', 'available']),
    ];
    const own = { court_id: C2, start_time: '18:00:00', end_time: '19:00:00' };
    // Shift by 30 minutes: C2 is free for it counting its own slots, and wins
    // over C1 although C1 comes first.
    expect(pickCourt(grid, 'badminton', '18:30', '19:30', { own })?.court_id).toBe(C2);
    // Without the own range, C2's booked slots block it.
    expect(pickCourt(grid, 'badminton', '18:30', '19:30')?.court_id).toBe(C1);
  });

  it('does not treat someone else booking on another court as own', () => {
    const grid = [row(C1, ['booked', 'available'])];
    const own = { court_id: C2, start_time: '18:00', end_time: '18:30' };
    expect(pickCourt(grid, 'badminton', '18:00', '19:00', { own })).toBeNull();
  });
});

describe('slotPrice', () => {
  it('returns the grid figures untouched', () => {
    expect(slotPrice(makeSlot({ price_cents: 1250, member_price_cents: 1250, currency: 'USD', is_peak: true }))).toEqual({
      cents: 1250,
      currency: 'USD',
      memberPrice: true,
      peak: true,
    });
    expect(slotPrice(makeSlot({ price_cents: 2000, member_price_cents: null })).memberPrice).toBe(false);
    expect(slotPrice(makeSlot({ price_cents: 2000, member_price_cents: 1500 })).memberPrice).toBe(false);
  });
});

describe('durationProblem and gridSlotMinutes', () => {
  const rules = { min_duration_minutes: 60, max_duration_minutes: 120 };
  it('checks min and max duration', () => {
    expect(durationProblem(30, rules)).toBe('too_short');
    expect(durationProblem(60, rules)).toBeNull();
    expect(durationProblem(120, rules)).toBeNull();
    expect(durationProblem(150, rules)).toBe('too_long');
    expect(durationProblem(600, { min_duration_minutes: 30, max_duration_minutes: 0 })).toBeNull();
    expect(durationProblem(15, { min_duration_minutes: null, max_duration_minutes: null })).toBeNull();
  });

  it('reads the slot length off the grid', () => {
    expect(gridSlotMinutes([row(C1, ['available'])])).toBe(30);
    expect(gridSlotMinutes([])).toBeNull();
  });
});

describe('midnight: Clutch writes the end of the day as 00:00', () => {
  /** The last two slots of a day: 23:00-23:30 and 23:30-00:00. */
  function lateRow(courtId: ReturnType<typeof asCourtId>, statuses: SlotStatus[]): CourtAvailability {
    const slots = [
      makeSlot({ court_id: courtId, start_time: '23:00', end_time: '23:30', status: statuses[0] }),
      makeSlot({ court_id: courtId, start_time: '23:30', end_time: '00:00', status: statuses[1] }),
    ];
    return makeCourtAvailability(courtId, {}, slots);
  }

  it('books a range that ends at midnight, whether asked as 24:00 or 00:00', () => {
    const grid = [lateRow(C1, ['available', 'available'])];
    expect(pickCourt(grid, 'badminton', '23:00', '24:00')?.court_id).toBe(C1);
    expect(pickCourt(grid, 'badminton', '23:00', '00:00')?.court_id).toBe(C1);
    expect(pickCourt(grid, 'badminton', '23:30', '00:00:00')?.court_id).toBe(C1);
  });

  it('offers the last slot and keeps it last in time order', () => {
    const grid = [lateRow(C1, ['available', 'available'])];
    const times = timesFor(grid, 'badminton');
    expect(times.map((t) => t.start)).toEqual(['23:00', '23:30']);
    expect(times[1].end).toBe('00:00');
  });

  it('reads the slot length of a slot ending at midnight as 30, not -1410', () => {
    const court = makeCourtAvailability(C1, {}, [
      makeSlot({ court_id: C1, start_time: '23:30', end_time: '00:00' }),
    ]);
    expect(gridSlotMinutes([court])).toBe(30);
  });

  it("counts a moved booking's own slots up to midnight as free", () => {
    const grid = [lateRow(C1, ['booked', 'booked'])];
    const own = { court_id: C1, start_time: '23:00:00', end_time: '00:00:00' };
    expect(timesFor(grid, 'badminton', { own }).map((t) => t.start)).toEqual(['23:00', '23:30']);
    expect(pickCourt(grid, 'badminton', '23:00', '24:00', { own })?.court_id).toBe(C1);
  });

  it('respects a maximum length across midnight', () => {
    const grid = [
      makeCourtAvailability(C1, { max_booking_duration_minutes: 30 }, [
        makeSlot({ court_id: C1, start_time: '23:00', end_time: '23:30' }),
        makeSlot({ court_id: C1, start_time: '23:30', end_time: '00:00' }),
      ]),
    ];
    expect(pickCourt(grid, 'badminton', '23:00', '00:00')).toBeNull();
    expect(pickCourt(grid, 'badminton', '23:30', '00:00')?.court_id).toBe(C1);
  });
});

describe('withinHours', () => {
  const hours = [
    { day_of_week: 1, open_time: '08:00:00', close_time: '00:00:00', is_closed: false },
    { day_of_week: 2, open_time: '08:00:00', close_time: '22:00:00', is_closed: false },
    { day_of_week: 3, open_time: '08:00:00', close_time: '22:00:00', is_closed: true },
  ];

  it('reads a close of 00:00 as midnight at the end of the day', () => {
    expect(withinHours('23:30', '00:00', hours, 1)).toBe(true);
    expect(withinHours('07:30', '08:00', hours, 1)).toBe(false);
  });

  it('closes days marked closed or not listed, and allows everything without hours', () => {
    expect(withinHours('21:30', '22:00', hours, 2)).toBe(true);
    expect(withinHours('22:00', '22:30', hours, 2)).toBe(false);
    expect(withinHours('10:00', '11:00', hours, 3)).toBe(false);
    expect(withinHours('10:00', '11:00', hours, 4)).toBe(false);
    expect(withinHours('10:00', '11:00', null, 4)).toBe(true);
    expect(withinHours('10:00', '11:00', [], 4)).toBe(true);
  });
});
