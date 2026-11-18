import { createHoldSession } from '../hold-session';
import { asBookingId } from '../../../lib/clutch';

const A = asBookingId('a');
const B = asBookingId('b');

function setup() {
  const cancel = jest.fn();
  const onLockChange = jest.fn();
  const session = createHoldSession({ cancel, onLockChange });
  return { session, cancel, onLockChange };
}

describe('hold session', () => {
  it('adopts the live attempt and releases it with a cancel', () => {
    const { session, cancel } = setup();
    const attempt = session.beginAttempt();
    session.holdCreated(A, attempt);
    expect(session.heldId).toBe(A);
    session.release();
    expect(cancel).toHaveBeenCalledWith(A);
    expect(session.heldId).toBeNull();
  });

  it('cancels an orphaned hold that lands late, never the live one', () => {
    const { session, cancel } = setup();
    const first = session.beginAttempt();
    const second = session.beginAttempt();
    session.holdCreated(B, second);
    session.holdCreated(A, first);
    expect(cancel).toHaveBeenCalledWith(A);
    expect(cancel).not.toHaveBeenCalledWith(B);
    expect(session.heldId).toBe(B);
  });

  it('cancels a hold that lands after the member backed out', () => {
    const { session, cancel } = setup();
    const attempt = session.beginAttempt();
    session.release();
    session.holdCreated(A, attempt);
    expect(cancel).toHaveBeenCalledWith(A);
  });

  it('does not cancel while a payment is settling, and clears the lock', () => {
    const { session, cancel, onLockChange } = setup();
    session.holdCreated(A, session.beginAttempt());
    session.setPaymentLocked(true);
    expect(onLockChange).toHaveBeenLastCalledWith(true);
    session.release();
    expect(cancel).not.toHaveBeenCalled();
    expect(session.paymentLocked).toBe(false);
  });

  it('settle forgets the hold without cancelling', () => {
    const { session, cancel } = setup();
    session.holdCreated(A, session.beginAttempt());
    session.settle();
    session.release();
    expect(cancel).not.toHaveBeenCalled();
  });
});
