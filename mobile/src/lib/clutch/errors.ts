/**
 * Clutch's error vocabulary and the one error type the app handles.
 *
 * Every Clutch failure is `{ error, message, details? }` where `error` is a
 * stable snake_case code. The app branches ONLY on `ClutchError.code`, never
 * on `message` (prose, not load-bearing). A code the app does not know
 * arrives as `code: 'unknown'` with the wire value kept in `rawCode`, so a
 * switch over ErrorCode stays honest when Clutch adds a code.
 *
 * The vocabulary is the generated one (OpenAPI components.schemas.ErrorCode)
 * plus the codes of branches not in the document yet (contract.pending.ts).
 */
import { GENERATED_ERROR_CODES } from './contract.gen';
import { PENDING_ERROR_CODES } from './contract.pending';
import { ClutchUnavailableError } from './capabilities';

export const ERROR_CODES = [...GENERATED_ERROR_CODES, ...PENDING_ERROR_CODES] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const KNOWN = new Set<string>(ERROR_CODES);

export function isErrorCode(value: string): value is ErrorCode {
  return KNOWN.has(value);
}

/**
 * - `api`: Clutch answered with an error envelope.
 * - `network`: no answer (offline, DNS, timeout); status 0.
 * - `contract`: Clutch answered something that is not the documented shape.
 */
export type ClutchErrorKind = 'api' | 'network' | 'contract';

export class ClutchError extends Error {
  readonly code: ErrorCode | 'unknown';
  /** The code exactly as Clutch sent it (equals `code` unless unknown). */
  readonly rawCode: string;
  readonly status: number;
  readonly kind: ClutchErrorKind;
  readonly details?: Record<string, unknown>;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    kind: ClutchErrorKind;
    details?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = 'ClutchError';
    this.rawCode = init.code;
    this.code = isErrorCode(init.code) ? init.code : 'unknown';
    this.status = init.status;
    this.kind = init.kind;
    this.details = init.details;
  }
}

export function isClutchError(err: unknown): err is ClutchError {
  return err instanceof ClutchError;
}

/** True when `err` is a ClutchError carrying one of `codes`. */
export function hasCode(err: unknown, ...codes: ErrorCode[]): err is ClutchError {
  return err instanceof ClutchError && err.code !== 'unknown' && codes.includes(err.code);
}

/**
 * A failure worth retrying with the SAME Idempotency-Key: nothing durable was
 * decided (no answer, a 5xx, or the first attempt is still running). Clutch
 * caches every response below 500 under the key, so retrying a 4xx with the
 * same key would only replay it.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof ClutchUnavailableError) return false;
  if (!(err instanceof ClutchError)) return true;
  if (err.kind === 'network') return true;
  if (err.kind === 'contract') return false;
  return err.status >= 500 || err.code === 'request_in_flight';
}

/** Compile-time exhaustiveness guard for `switch (err.code)`. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}
