import { describeBookingFailure, type FailureAction } from '../booking-failures';
import { ClutchError, ClutchUnavailableError, ERROR_CODES, type ErrorCode } from '../../../lib/clutch';
import { clutchError, networkError } from '../../../lib/clutch/testing';

const ACTIONS: FailureAction[] = [
  'pick-time',
  'retry',
  'retry-payment',
  'check-again',
  'membership',
  'waiver',
  'none',
  'refresh',
];

describe('describeBookingFailure', () => {
  const cases: Array<[ErrorCode, FailureAction]> = [
    ['slot_already_booked', 'pick-time'],
    ['slot_unavailable', 'pick-time'],
    ['court_not_available', 'pick-time'],
    ['cannot_book_past', 'pick-time'],
    ['advance_booking_exceeded', 'pick-time'],
    ['duration_out_of_range', 'pick-time'],
    ['slot_not_on_grid', 'pick-time'],
    ['outside_hours', 'pick-time'],
    ['max_bookings_reached', 'pick-time'],
    ['booking_changed', 'pick-time'],
    ['booking_not_pending', 'pick-time'],
    ['not_club_member', 'membership'],
    ['tier_required', 'membership'],
    ['no_show_penalty', 'none'],
    ['waiver_required', 'waiver'],
    ['club_stripe_not_connected', 'none'],
    ['payment_failed', 'retry-payment'],
    ['payment_requires_action', 'retry-payment'],
    ['payment_incomplete', 'retry-payment'],
    ['payment_required', 'retry-payment'],
    ['payment_not_verified', 'check-again'],
    ['payment_processing', 'check-again'],
    ['payment_mismatch', 'refresh'],
    ['payment_returned', 'refresh'],
    ['move_not_applied', 'pick-time'],
    ['internal_error', 'retry'],
    ['upstream_error', 'retry'],
    ['rate_limit_exceeded', 'retry'],
    ['cancellation_window_passed', 'none'],
    ['booking_not_found', 'refresh'],
    ['not_found', 'refresh'],
  ];

  it.each(cases)('%s -> %s', (code, action) => {
    const failure = describeBookingFailure(clutchError(code));
    expect(failure.action).toBe(action);
    expect(failure.title.length).toBeGreaterThan(0);
    expect(failure.message.length).toBeGreaterThan(0);
  });

  it('maps EVERY code Clutch can send to a defined outcome', () => {
    for (const code of ERROR_CODES) {
      const failure = describeBookingFailure(clutchError(code));
      expect(ACTIONS).toContain(failure.action);
      expect(failure.message.length).toBeGreaterThan(0);
    }
  });

  it('never shows the message Clutch sent', () => {
    const failure = describeBookingFailure(clutchError('slot_unavailable', 409, undefined, 'RAW SERVER PROSE'));
    expect(failure.message).not.toContain('RAW SERVER PROSE');
    expect(failure.title).not.toContain('RAW SERVER PROSE');
  });

  it('says a dearer move is not available yet without P4, and asks to pay the difference with it', () => {
    for (const code of ['reschedule_costs_more', 'reschedule_payment_required'] as const) {
      const off = describeBookingFailure(clutchError(code, 402), { bookingParity: false });
      expect(off.action).toBe('pick-time');
      expect(off.message).toContain('not available in the app yet');
      const on = describeBookingFailure(clutchError(code, 402), { bookingParity: true });
      expect(on.action).toBe('retry-payment');
    }
  });

  it('explains why a paid move was not made and that the payment is coming back', () => {
    const failure = describeBookingFailure(clutchError('move_not_applied', 409, { reason: 'slot_already_booked' }));
    expect(failure.message).toContain('Someone booked that time first.');
    expect(failure.message).toContain('being returned');
  });

  it('says when booking opens again after a no show', () => {
    const failure = describeBookingFailure(clutchError('no_show_penalty', 403, { until: '2026-10-20T00:00:00Z' }));
    expect(failure.until).toBe('2026-10-20T00:00:00Z');
    expect(failure.message).toContain('Oct 20');
  });

  it('carries the club of a missing waiver', () => {
    const failure = describeBookingFailure(clutchError('waiver_required', 403, { club_id: 'club-1' }));
    expect(failure.clubId).toBe('club-1');
  });

  it('treats no answer as retry with connection copy', () => {
    expect(describeBookingFailure(networkError())).toMatchObject({ action: 'retry', title: 'No connection' });
  });

  it('re-reads the booking for unknown codes, contract drift and non-Clutch errors', () => {
    const unknown = new ClutchError({ code: 'brand_new_code', message: 'x', status: 409, kind: 'api' });
    expect(unknown.code).toBe('unknown');
    expect(describeBookingFailure(unknown).action).toBe('refresh');
    const drift = new ClutchError({ code: 'invalid_response', message: 'x', status: 200, kind: 'contract' });
    expect(describeBookingFailure(drift).action).toBe('refresh');
    expect(describeBookingFailure(new Error('boom')).action).toBe('refresh');
  });

  it('says an unavailable capability is not available yet', () => {
    expect(describeBookingFailure(new ClutchUnavailableError('bookingParity'))).toMatchObject({
      action: 'none',
      title: 'Not available yet',
    });
  });
});
