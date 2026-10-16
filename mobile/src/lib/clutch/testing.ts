/**
 * Test helpers for mocking at the client boundary. Import only from tests.
 *
 *   const mockClutch = createMockClutch();
 *   jest.mock('../../../lib/clutch', () => ({
 *     ...jest.requireActual('../../../lib/clutch'),
 *     clutch: mockClutch,
 *   }));
 *   mockClutch.bookings.create.mockResolvedValue(makeBooking());
 *
 * (Name the variable mock* so jest.mock's hoisted factory may reference it,
 * and create it with `jest.requireActual` inside the factory if hoisting bites.)
 */
import { createClutchClient, type ClutchClient } from './client';
import { ClutchError, type ErrorCode } from './errors';
import { asClubId } from './ids';

export const TEST_CLUB_ID = asClubId('15e24f5f-ee39-4154-8ad6-06942d06cb8a');

type DeepMocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? jest.Mock<R, A>
    : T[K] extends object
      ? DeepMocked<T[K]>
      : T[K];
};

export type MockClutch = DeepMocked<ClutchClient>;

function mockify<T extends object>(source: T): DeepMocked<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'function') out[key] = jest.fn();
    else if (value && typeof value === 'object') out[key] = mockify(value as object);
    else out[key] = value;
  }
  return out as DeepMocked<T>;
}

/** Every endpoint of the real client as a bare jest.fn(), same shape. */
export function createMockClutch(): MockClutch {
  const real = createClutchClient({
    baseUrl: 'http://clutch.test/api/v1',
    clubId: TEST_CLUB_ID,
    expectedClubSlug: '770',
    auth: { getAccessToken: async () => null, refreshAccessToken: async () => null },
    newIdempotencyKey: () => 'test-key',
    fetch: () => Promise.reject(new Error('createMockClutch: unmocked call')),
  });
  return mockify(real);
}

/** A ClutchError as the client would raise it for an API refusal. */
export function clutchError(
  code: ErrorCode,
  status = 409,
  details?: Record<string, unknown>,
  message = code.replace(/_/g, ' '),
): ClutchError {
  return new ClutchError({ code, message, status, kind: 'api', details });
}

/** A network failure (no answer). */
export function networkError(): ClutchError {
  return new ClutchError({ code: 'network_error', message: 'offline', status: 0, kind: 'network' });
}
