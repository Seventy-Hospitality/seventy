import { bookingRulesOf, FALLBACK_BOOKING_RULES, sportRulesFrom } from '../club-rules';
import { makeBookingRules, makeClub, makeCourtTypeRules } from '../../../lib/clutch/fixtures';

describe('sport rules', () => {
  it("reads the club row's rules without P4", () => {
    expect(bookingRulesOf(makeClub())).toMatchObject({
      slot_duration_minutes: 30,
      min_duration_minutes: 30,
      max_duration_minutes: 120,
      advance_booking_days: 14,
      cancellation_hours: 24,
      bookable: null,
    });
    expect(bookingRulesOf(makeClub({ booking_rules: null }))).toBe(FALLBACK_BOOKING_RULES);
  });

  it("takes P4's per-sport rules, filling what P4 leaves null from the club", () => {
    const hours = [{ day_of_week: 1, open_time: '08:00:00', close_time: '00:00:00', is_closed: false }];
    const parity = makeBookingRules({
      court_types: [
        makeCourtTypeRules({
          court_type: 'tennis',
          slot_duration_minutes: 60,
          min_duration_minutes: 60,
          max_duration_minutes: null,
          advance_booking_days: null,
          hours,
          bookable_by_viewer: false,
          refusal: 'tier_required',
        }),
      ],
    });
    const rules = sportRulesFrom(parity, 'tennis', makeClub());
    expect(rules).toMatchObject({
      slot_duration_minutes: 60,
      min_duration_minutes: 60,
      max_duration_minutes: null,
      advance_booking_days: 14,
      cancellation_hours: 24,
      bookable: false,
      refusal: 'tier_required',
    });
    expect(rules.hours).toEqual(hours);
    // A sport P4 does not list falls back to the club row.
    expect(sportRulesFrom(parity, 'padel', makeClub())).toEqual(bookingRulesOf(makeClub()));
  });
});
