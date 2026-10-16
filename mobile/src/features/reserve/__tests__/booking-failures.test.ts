import { describeBookingFailure, type FailureAction } from '../booking-failures';
import { ClutchError, type ErrorCode } from '../../../lib/clutch';
import { clutchError, networkError } from '../../../lib/clutch/testing';

describe('describeBookingFailure', () => {
  const cases: Array<[ErrorCode, FailureAction]> = [
    ['slot_already_booked', 'pick-time'],
    ['slot_unavailable', 'pick-time'],
    ['court_not_available', 'pick-time'],
    ['cannot_book_past', 'pick-time'],
    ['advance_booking_exceeded', 'pick-time'],
    ['duration_out_of_range', 'pick-time'],
    ['booking_changed', 'pick-time'],
    ['booking_not_pending', 'pick-time'],
    ['not_club_member', 'membership'],
    ['members_only', 'membership'],
    ['tier_required', 'membership'],
    ['no_show_penalty', 'none'],
    ['waiver_required', 'waiver'],
    ['club_stripe_not_connected', 'none'],
    ['payment_failed', 'retry-payment'],
    ['payment_requires_action', 'retry-payment'],
    ['payment_not_verified', 'check-again'],
    ['payment_processing', 'check-again'],
    ['rate_limit_exceeded', 'retry'],
    ['cancellation_window_passed', 'none'],
    ['reschedule_costs_more', 'pick-time'],
    ['booking_not_found', 'refresh'],
  ];

  it.each(cases)('%s -> %s', (code, action) => {
    const failure = describeBookingFailure(clutchError(code));
    expect(failure.action).toBe(action);
    expect(failure.title.length).toBeGreaterThan(0);
    expect(failure.message.length).toBeGreaterThan(0);
  });

  it('never shows the message Clutch sent', () => {
    const failure = describeBookingFailure(clutchError('slot_unavailable', 409, undefined, 'RAW SERVER PROSE'));
    expect(failure.message).not.toContain('RAW SERVER PROSE');
    expect(failure.title).not.toContain('RAW SERVER PROSE');
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
    const failure = describeBookingFailure(networkError());
    expect(failure).toMatchObject({ action: 'retry', title: 'No connection' });
  });

  it('falls back to a generic retry for unknown codes, contract drift and non-Clutch errors', () => {
    const unknown = new ClutchError({ code: 'brand_new_code', message: 'x', status: 409, kind: 'api' });
    expect(unknown.code).toBe('unknown');
    expect(describeBookingFailure(unknown).action).toBe('retry');
    const drift = new ClutchError({ code: 'invalid_response', message: 'x', status: 200, kind: 'contract' });
    expect(describeBookingFailure(drift).action).toBe('retry');
    expect(describeBookingFailure(new Error('boom')).action).toBe('retry');
  });
});
