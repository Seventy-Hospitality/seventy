import {
  endToMinutes,
  rangeMinutes,
  buildDateStrip,
  clubNow,
  formatMoney,
  formatPrice,
  formatTimeRangeCompact,
  hasStarted,
  pruneSelection,
  selectionRange,
  slotsInRange,
  sportLabel,
  todayDateKey,
  toggleSlot,
} from '../booking';

describe('club clock', () => {
  // 2026-10-17 03:30 UTC is still 2026-10-16 23:30 in New York.
  const lateEvening = new Date('2026-10-17T03:30:00.000Z');

  it('reads today and the time on the club clock, not the device clock', () => {
    expect(todayDateKey('America/New_York', lateEvening)).toBe('2026-10-16');
    expect(todayDateKey('UTC', lateEvening)).toBe('2026-10-17');
    expect(clubNow('America/New_York', lateEvening)).toEqual({ date: '2026-10-16', minutes: 23 * 60 + 30 });
  });

  it('knows whether a booking has started on the club clock', () => {
    const tz = 'America/New_York';
    expect(hasStarted({ date: '2026-10-16', start_time: '23:00:00' }, tz, lateEvening)).toBe(true);
    expect(hasStarted({ date: '2026-10-16', start_time: '23:45:00' }, tz, lateEvening)).toBe(false);
    expect(hasStarted({ date: '2026-10-17', start_time: '06:00:00' }, tz, lateEvening)).toBe(false);
    expect(hasStarted({ date: '2026-10-15', start_time: '23:59:00' }, tz, lateEvening)).toBe(true);
  });

  it('builds the date rail from today plus the advance days', () => {
    expect(buildDateStrip('2026-10-30', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(buildDateStrip('2026-10-30', -1)).toEqual(['2026-10-30']);
  });
});

describe('contiguous selection', () => {
  it('extends, restarts and shrinks a run', () => {
    expect(toggleSlot([], '18:00', 30)).toEqual(['18:00']);
    expect(toggleSlot(['18:00'], '18:30', 30)).toEqual(['18:00', '18:30']);
    expect(toggleSlot(['18:00'], '17:30', 30)).toEqual(['17:30', '18:00']);
    expect(toggleSlot(['18:00'], '20:00', 30)).toEqual(['20:00']);
    expect(toggleSlot(['18:00', '18:30', '19:00'], '18:00', 30)).toEqual(['18:30', '19:00']);
    expect(toggleSlot(['18:00', '18:30', '19:00'], '18:30', 30)).toEqual(['18:00']);
  });

  it('prunes to the longest offered run', () => {
    expect(pruneSelection(['18:00', '18:30', '19:00', '19:30'], ['18:00', '19:00', '19:30'], 30)).toEqual([
      '19:00',
      '19:30',
    ]);
    expect(pruneSelection(['18:00'], [], 30)).toEqual([]);
  });

  it('turns a selection into a range and back', () => {
    expect(selectionRange(['18:30', '18:00'], 30)).toEqual({ start: '18:00', end: '19:00', minutes: 60 });
    expect(selectionRange([], 30)).toBeNull();
    expect(slotsInRange('18:00:00', '19:30:00', 30)).toEqual(['18:00', '18:30', '19:00']);
  });
});

describe('formatting', () => {
  it('formats money Clutch sent without changing it', () => {
    expect(formatMoney(3000, 'USD')).toBe('$30.00');
    expect(formatMoney(1250, 'usd')).toBe('$12.50');
    expect(formatPrice(3000, 'USD')).toBe('$30');
    expect(formatPrice(1250, 'USD')).toBe('$12.50');
  });

  it('formats times and sports', () => {
    expect(formatTimeRangeCompact('21:30', '23:30:00')).toBe('9:30-11:30PM');
    expect(formatTimeRangeCompact('11:00', '13:00')).toBe('11:00AM-1:00PM');
    expect(sportLabel('pickleball')).toBe('Pickleball');
    expect(sportLabel('padel_tennis')).toBe('Padel tennis');
  });
});

describe('midnight end times', () => {
  it('reads an end of 00:00 or 00:00:00 as 24:00', () => {
    expect(endToMinutes('00:00')).toBe(1440);
    expect(endToMinutes('00:00:00')).toBe(1440);
    expect(endToMinutes('23:30')).toBe(1410);
    expect(rangeMinutes('23:00:00', '00:00:00')).toBe(60);
    expect(rangeMinutes('18:00', '19:30')).toBe(90);
  });

  it('restores the slots of a booking that ends at midnight', () => {
    expect(slotsInRange('23:00:00', '00:00:00', 30)).toEqual(['23:00', '23:30']);
  });

  it('formats a range ending at midnight', () => {
    expect(formatTimeRangeCompact('23:00', '00:00')).toBe('11:00PM-12:00AM');
  });
});
