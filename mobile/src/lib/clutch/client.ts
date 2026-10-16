/**
 * The Clutch API client: transport plus one typed function per endpoint.
 *
 * Response shapes come only from contract.gen.ts (generated from Clutch's
 * OpenAPI document) and contract.pending.ts (hand-written for operations of
 * branches not in that document yet). Calls whose server route is not
 * available are gated by capabilities.ts and refuse locally.
 *
 * Transport rules (each one is a test in __tests__/client.test.ts):
 * - Every request carries the Supabase access token (AuthPort) as Bearer.
 * - Strict envelope: success is `{data, count?}`, failure `{error, message,
 *   details?, request_id?}`; `data` is parsed with the endpoint's schema
 *   (unknown fields are ignored, missing or mistyped ones fail as a
 *   ClutchError of kind 'contract').
 * - Errors are ClutchError with `code: ErrorCode | 'unknown'`.
 * - 401 -> ONE refresh (shared by concurrent callers) -> retry once with a
 *   NEW Idempotency-Key: Clutch caches every answer below 500 under a key,
 *   the 401 included, so retrying with the same key would replay the 401.
 * - Every mutation carries an Idempotency-Key: the caller's (one per logical
 *   mutation, useMutationKey) or a fresh one. 409 request_in_flight waits and
 *   retries with the same key. A multipart upload gets a fresh key per send
 *   (its body boundary changes, so the same key would be "reused").
 * - The club is bound at construction; `club.verify()` checks its slug.
 */
import { z } from 'zod';
import {
  AddBookingPlayersResponseSchema,
  CancelBookingResponseSchema,
  ConfirmBookingResponseSchema,
  CreateBookingResponseSchema,
  CreateGroupInviteLinkResponseSchema,
  CreateGroupResponseSchema,
  DeleteGroupResponseSchema,
  ErrorSchema,
  GetBookingResponseSchema,
  GetClubAvailabilityResponseSchema,
  GetClubResponseSchema,
  GetGroupActivityResponseSchema,
  GetGroupMembersResponseSchema,
  GetGroupResponseSchema,
  GetMeResponseSchema,
  GetMyClubMembershipResponseSchema,
  GetMyGroupInvitationsResponseSchema,
  GetMyGroupsResponseSchema,
  GetMyHomeResponseSchema,
  GetMyPreferencesResponseSchema,
  GetMyProfileResponseSchema,
  InviteGroupToBookingResponseSchema,
  InviteToGroupResponseSchema,
  JoinClubResponseSchema,
  JoinGroupResponseSchema,
  LeaveGroupResponseSchema,
  ListClubCourtsResponseSchema,
  ListClubMembershipTiersResponseSchema,
  ListMyBookingsResponseSchema,
  ListMyNotificationsResponseSchema,
  ListMyPaymentsResponseSchema,
  MarkMyNotificationsReadResponseSchema,
  PreviewGroupInviteResponseSchema,
  RemoveGroupMemberResponseSchema,
  ReplaceMyPreferencesResponseSchema,
  RescheduleBookingResponseSchema,
  RespondToGroupInvitationResponseSchema,
  UpdateGroupMemberResponseSchema,
  UpdateGroupResponseSchema,
  UpdateMyProfileResponseSchema,
  UploadGroupCoverResponseSchema,
  UploadMyAvatarResponseSchema,
  type BookingInvitation,
  type ClubDetail,
  type MyBooking,
  type NotificationPreferences,
} from './contract.gen';
import {
  AccountDeletionPreviewSchema,
  BookingCheckoutSchema,
  BookingQuoteSchema,
  CancelSubscriptionResultSchema,
  ChangeTierResultSchema,
  CheckinTokenSchema,
  ClubBookingRulesSchema,
  ClubPlayersSchema,
  DeleteAccountResultSchema,
  EligibleChangeTiersSchema,
  InvitationAnswerSchema,
  LegacyBookingCheckoutSchema,
  MembershipConfirmSchema,
  MoveCheckoutSchema,
  MyMembershipBillingSchema,
  ParityBookingSchema,
  PlayerRemovalSchema,
  RegisteredDeviceSchema,
  RemovedCardSchema,
  RemovedDeviceSchema,
  VerifiedDeviceSchema,
  RescheduleQuoteSchema,
  ResumeSubscriptionResultSchema,
  SavedCardSchema,
  SavedCardsSchema,
  SetupIntentSchema,
  ShareCheckoutSchema,
  ShareSettledSchema,
  SimulatedPaySchema,
  SubscribeResultSchema,
  type BookingCheckout,
  type LegacyBookingCheckout,
} from './contract.pending';
import { CAPABILITIES, ClutchUnavailableError, type Capabilities, type Capability } from './capabilities';
import { ClutchError } from './errors';
import type { MembershipView } from './membership-view';
import type {
  BookingId,
  CardId,
  ClubId,
  CourtId,
  GroupId,
  GroupInvitationId,
  TierId,
  UserId,
} from './ids';

// ─── Ports ───────────────────────────────────────────────────────────────────

/** How the client reads and refreshes the Supabase session (lib/clutch/index.ts). */
export interface AuthPort {
  /** The current access token, or null when signed out. */
  getAccessToken(): Promise<string | null>;
  /**
   * Refresh the session once after a 401. Resolves the new access token, or
   * null when the session is definitively gone (supabase-js signs out).
   * Rejects when the refresh could not be attempted (network): transient.
   */
  refreshAccessToken(): Promise<string | null>;
}

export interface ClutchClientOptions {
  /** API base including the version segment, e.g. https://host/api/v1. */
  baseUrl: string;
  clubId: ClubId;
  /** The slug `clubId` must resolve to (startup check). */
  expectedClubSlug: string;
  auth: AuthPort;
  newIdempotencyKey: () => string;
  capabilities?: Capabilities;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** A React Native file part for multipart uploads. */
export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

export interface MutationOptions {
  /** The logical mutation's key (useMutationKey). A fresh one when omitted. */
  idempotencyKey?: string;
}

export interface Page<T> {
  items: T[];
  count: number;
}

export class ClubMismatchError extends Error {
  constructor(
    readonly expectedSlug: string,
    readonly actualSlug: string,
  ) {
    super(`This build is bound to club "${expectedSlug}" but its id resolves to "${actualSlug}".`);
    this.name = 'ClubMismatchError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestSpec<S extends z.ZodType> {
  method: Method;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  form?: FormData;
  schema: S;
  idempotencyKey?: string;
}

const IN_FLIGHT_RETRY_DELAYS_MS = [400, 800, 1600, 3200];

/** The `data` schema of a generated `{ data }` response schema. */
function dataOf<S extends z.ZodObject<{ data: z.ZodType }>>(schema: S): S['shape']['data'] {
  return schema.shape.data;
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

/** A time the API accepts: "HH:MM" (Clutch's grid also says 24:00 for midnight). */
function wireTime(time: string): string {
  const hm = time.slice(0, 5);
  return hm === '24:00' ? '00:00' : hm;
}

export interface BookingRange {
  court_id: CourtId;
  date: string;
  start_time: string;
  end_time: string;
  discount_code?: string;
}

export interface BookingMove {
  new_date: string;
  new_start_time: string;
  new_end_time: string;
  new_court_id?: CourtId;
}

function rangeBody(range: BookingRange) {
  return { ...range, start_time: wireTime(range.start_time), end_time: wireTime(range.end_time) };
}

function moveBody(move: BookingMove) {
  return {
    ...move,
    new_start_time: wireTime(move.new_start_time),
    new_end_time: wireTime(move.new_end_time),
  };
}

// ─── Client ──────────────────────────────────────────────────────────────────

export function createClutchClient(options: ClutchClientOptions) {
  const {
    baseUrl,
    clubId,
    expectedClubSlug,
    auth,
    newIdempotencyKey,
    capabilities = CAPABILITIES,
    timeoutMs = 30_000,
  } = options;
  const doFetch: typeof fetch = options.fetch ?? ((...args) => fetch(...args));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = baseUrl.replace(/\/+$/, '');

  let refreshInFlight: Promise<string | null> | null = null;

  function refreshOnce(): Promise<string | null> {
    refreshInFlight ??= auth.refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  function need(capability: Capability): void {
    if (!capabilities[capability]) throw new ClutchUnavailableError(capability);
  }

  function buildUrl(path: string, query?: RequestSpec<z.ZodType>['query']): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    return `${base}${path}${qs ? `?${qs}` : ''}`;
  }

  async function send(
    spec: RequestSpec<z.ZodType>,
    token: string | null,
    idempotencyKey: string | undefined,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let body: BodyInit | undefined;
    if (spec.form) {
      body = spec.form;
    } else if (spec.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(spec.body ?? {});
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await doFetch(buildUrl(spec.path, spec.query), {
        method: spec.method,
        headers,
        body,
        signal: controller?.signal,
      });
    } catch (err) {
      throw new ClutchError({
        code: 'network_error',
        message:
          err instanceof Error && err.name === 'AbortError'
            ? 'Clutch did not answer in time.'
            : 'Could not reach Clutch. Check your connection.',
        status: 0,
        kind: 'network',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  function contractError(status: number, what: string): ClutchError {
    return new ClutchError({
      code: 'invalid_response',
      message: `Clutch answered ${what} that does not match the app's contract.`,
      status,
      kind: 'contract',
    });
  }

  const SuccessEnvelope = z.object({ data: z.unknown(), count: z.number().int().optional() }).strict();

  async function request<S extends z.ZodType>(
    spec: RequestSpec<S>,
  ): Promise<{ data: z.infer<S>; count?: number }> {
    const mutating = spec.method !== 'GET';
    const keyFor = (): string | undefined =>
      mutating ? (spec.form ? newIdempotencyKey() : (spec.idempotencyKey ?? newIdempotencyKey())) : undefined;
    let key = keyFor();

    let token = await auth.getAccessToken();
    let res = await send(spec, token, key);

    if (res.status === 401 && token) {
      let refreshed: string | null;
      try {
        refreshed = await refreshOnce();
      } catch {
        throw new ClutchError({
          code: 'network_error',
          message: 'Could not refresh your session. Check your connection and try again.',
          status: 0,
          kind: 'network',
        });
      }
      if (refreshed) {
        token = refreshed;
        // The 401 is cached under the first key; this is a new attempt.
        key = mutating ? newIdempotencyKey() : undefined;
        res = await send(spec, token, key);
      }
    }

    for (const delay of IN_FLIGHT_RETRY_DELAYS_MS) {
      if (res.status !== 409) break;
      const peek = ErrorSchema.safeParse(await readJson(res.clone()));
      if (!peek.success || peek.data.error !== 'request_in_flight') break;
      await sleep(delay);
      res = await send(spec, token, key);
    }

    const json = await readJson(res);
    if (!res.ok) {
      const parsed = ErrorSchema.safeParse(json);
      if (!parsed.success) throw contractError(res.status, 'an error');
      throw new ClutchError({
        code: parsed.data.error,
        message: parsed.data.message,
        status: res.status,
        kind: 'api',
        details: parsed.data.details,
      });
    }

    const envelope = SuccessEnvelope.safeParse(json);
    if (!envelope.success) throw contractError(res.status, 'a body');
    const data = spec.schema.safeParse(envelope.data.data);
    if (!data.success) {
      if (__DEV__) {
        console.warn(`[clutch] ${spec.method} ${spec.path} contract mismatch`, data.error.issues);
      }
      throw contractError(res.status, `${spec.method} ${spec.path} data`);
    }
    return { data: data.data, count: envelope.data.count };
  }

  async function call<S extends z.ZodType>(spec: RequestSpec<S>): Promise<z.infer<S>> {
    return (await request(spec)).data;
  }

  function uploadForm(file: UploadFile): FormData {
    const form = new FormData();
    form.append('file', file as unknown as Blob);
    return form;
  }

  // ── The venue ──

  const club = {
    get: () => call({ method: 'GET', path: `/clubs/${enc(clubId)}`, schema: dataOf(GetClubResponseSchema) }),

    /** Startup check: the bound id must be the expected club. */
    async verify(): Promise<ClubDetail> {
      const row = await club.get();
      if (row.slug !== expectedClubSlug) throw new ClubMismatchError(expectedClubSlug, row.slug);
      return row;
    },

    courts: () =>
      call({ method: 'GET', path: `/clubs/${enc(clubId)}/courts`, schema: dataOf(ListClubCourtsResponseSchema) }),

    availability: (date: string) =>
      call({
        method: 'GET',
        path: `/clubs/${enc(clubId)}/availability`,
        query: { date },
        schema: dataOf(GetClubAvailabilityResponseSchema),
      }),

    tiers: () =>
      call({
        method: 'GET',
        path: `/clubs/${enc(clubId)}/membership-tiers`,
        schema: dataOf(ListClubMembershipTiersResponseSchema),
      }),

    join: (opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/clubs/${enc(clubId)}/join`,
        schema: dataOf(JoinClubResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** P4: booking rules per court type, with whether the caller may book each. */
    bookingRules: () => {
      need('bookingParity');
      return call({ method: 'GET', path: `/clubs/${enc(clubId)}/booking-rules`, schema: ClubBookingRulesSchema });
    },

    /** P4: fellow members a member may invite (never the admin roster). */
    searchPlayers: (q: string, limit = 20) => {
      need('bookingParity');
      return call({
        method: 'GET',
        path: `/clubs/${enc(clubId)}/players`,
        query: { q: q.trim() || undefined, limit },
        schema: ClubPlayersSchema,
      });
    },
  };

  // ── Bookings ──

  const bookings = {
    /** P4: what booking this range would charge, tax included (`total_cents`). */
    quote: (range: BookingRange) => {
      need('bookingParity');
      return call({
        method: 'POST',
        path: '/bookings/quote',
        body: { club_id: clubId, ...rangeBody(range) },
        schema: BookingQuoteSchema,
      });
    },

    /** Hold a court: a `pending` booking with a 15-minute hold. */
    create: (range: BookingRange, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/bookings',
        body: { club_id: clubId, ...rangeBody(range) },
        schema: dataOf(CreateBookingResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    get: (id: BookingId) =>
      call({ method: 'GET', path: `/bookings/${enc(id)}`, schema: dataOf(GetBookingResponseSchema) }),

    /**
     * The booker's checkout for what they owe on their booking. With P2 it
     * asks for the sheet bundle (customer + ephemeral key); before P2 it is
     * main's shape, which has neither.
     */
    paymentIntent: (
      id: BookingId,
      opts?: MutationOptions & { shareCents?: number },
    ): Promise<BookingCheckout | LegacyBookingCheckout> => {
      const body: Record<string, unknown> = opts?.shareCents === undefined ? {} : { share_cents: opts.shareCents };
      if (capabilities.nativePayments) {
        return call({
          method: 'POST',
          path: `/bookings/${enc(id)}/payment-intent`,
          body: { ...body, sheet: true },
          schema: BookingCheckoutSchema,
          idempotencyKey: opts?.idempotencyKey,
        });
      }
      return call({
        method: 'POST',
        path: `/bookings/${enc(id)}/payment-intent`,
        body,
        schema: LegacyBookingCheckoutSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** Simulated deployments only: complete the simulated checkout. */
    paySimulated: (id: BookingId, paymentIntentId: string, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/payment-intent/pay`,
        body: { payment_intent_id: paymentIntentId },
        schema: SimulatedPaySchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** Confirm with the COMPLETED intent id (omit only for a free booking). */
    confirm: (id: BookingId, paymentIntentId: string | null, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/confirm`,
        body: paymentIntentId ? { payment_intent_id: paymentIntentId } : {},
        schema: dataOf(ConfirmBookingResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    cancel: (id: BookingId, opts?: MutationOptions & { reason?: string }) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/cancel`,
        body: opts?.reason ? { reason: opts.reason } : {},
        schema: dataOf(CancelBookingResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** A move that costs no more (P4: 402 reschedule_payment_required when it does). */
    reschedule: (id: BookingId, move: BookingMove, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/reschedule`,
        body: moveBody(move),
        schema: dataOf(RescheduleBookingResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    /**
     * P4: let go of the caller's own UNPAID hold. Only while it is still
     * pending, under the booking's lock: a booking the server confirmed
     * meanwhile answers 409 booking_not_pending (details.status).
     */
    release: (id: BookingId, opts?: MutationOptions) => {
      need('bookingParity');
      return call({
        method: 'POST',
        path: `/bookings/${enc(id)}/release`,
        schema: ParityBookingSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P4: what moving would cost; `payment_required` means pay the difference first. */
    rescheduleQuote: (id: BookingId, move: BookingMove) => {
      need('bookingParity');
      return call({
        method: 'POST',
        path: `/bookings/${enc(id)}/reschedule/quote`,
        body: moveBody(move),
        schema: RescheduleQuoteSchema,
      });
    },

    /** P4: a move order and the intent for the difference plus tax. */
    reschedulePaymentIntent: (id: BookingId, move: BookingMove, opts?: MutationOptions) => {
      need('bookingParity');
      return call({
        method: 'POST',
        path: `/bookings/${enc(id)}/reschedule/payment-intent`,
        body: moveBody(move),
        schema: MoveCheckoutSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P4: make the paid move with its payment. */
    rescheduleConfirm: (id: BookingId, paymentIntentId: string, opts?: MutationOptions) => {
      need('bookingParity');
      return call({
        method: 'POST',
        path: `/bookings/${enc(id)}/reschedule/confirm`,
        body: { payment_intent_id: paymentIntentId },
        schema: ParityBookingSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P4: a player's checkout for their share of someone else's booking. */
    sharePaymentIntent: (id: BookingId, opts?: MutationOptions) => {
      need('bookingParity');
      return call({
        method: 'POST',
        path: `/bookings/${enc(id)}/shares/payment-intent`,
        schema: ShareCheckoutSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P4: record the player's share payment. */
    shareConfirm: (id: BookingId, paymentIntentId: string, opts?: MutationOptions) => {
      need('bookingParity');
      return call({
        method: 'POST',
        path: `/bookings/${enc(id)}/shares/confirm`,
        body: { payment_intent_id: paymentIntentId },
        schema: ShareSettledSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    invitePlayers: (
      id: BookingId,
      playerIds: UserId[],
      opts?: MutationOptions & { shares?: Record<string, number> },
    ) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/players`,
        body: { player_ids: playerIds, ...(opts?.shares ? { shares: opts.shares } : {}) },
        schema: dataOf(AddBookingPlayersResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    inviteGroup: (id: BookingId, groupId: GroupId, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/invite-group`,
        body: { group_id: groupId },
        schema: dataOf(InviteGroupToBookingResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** P4: accept or decline an invitation to someone else's booking. */
    respond: (id: BookingId, accept: boolean, opts?: MutationOptions) => {
      need('bookingParity');
      return call({
        method: 'POST',
        path: `/bookings/${enc(id)}/respond`,
        body: { accept },
        schema: InvitationAnswerSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P4: the booker removes a player, or a player leaves (their own id). */
    removePlayer: (id: BookingId, userId: UserId, opts?: MutationOptions) => {
      need('bookingParity');
      return call({
        method: 'DELETE',
        path: `/bookings/${enc(id)}/players/${enc(userId)}`,
        schema: PlayerRemovalSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },
  };

  // ── Groups ──

  const groups = {
    /** The caller's groups AT THIS CLUB (/me/groups spans every club). */
    async list() {
      const all = await call({ method: 'GET', path: '/me/groups', schema: dataOf(GetMyGroupsResponseSchema) });
      return all.filter((g) => g.club_id === clubId);
    },

    /** Pending invitations to groups at this club. */
    async invitations() {
      const all = await call({
        method: 'GET',
        path: '/me/group-invitations',
        schema: dataOf(GetMyGroupInvitationsResponseSchema),
      });
      return all.filter((i) => i.club_id === clubId);
    },

    /** `invitee_user_ids` is sent only when non-empty (Clutch refuses []). */
    create: (
      input: { name: string; description?: string | null; invitee_user_ids?: UserId[] },
      opts?: MutationOptions,
    ) => {
      const { invitee_user_ids, ...rest } = input;
      return call({
        method: 'POST',
        path: '/me/groups',
        body: {
          club_id: clubId,
          ...rest,
          ...(invitee_user_ids && invitee_user_ids.length > 0 ? { invitee_user_ids } : {}),
        },
        schema: dataOf(CreateGroupResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    get: (id: GroupId) => call({ method: 'GET', path: `/groups/${enc(id)}`, schema: dataOf(GetGroupResponseSchema) }),

    members: (id: GroupId) =>
      call({ method: 'GET', path: `/groups/${enc(id)}/members`, schema: dataOf(GetGroupMembersResponseSchema) }),

    update: (
      id: GroupId,
      input: { name?: string; description?: string | null; clear_cover?: boolean },
      opts?: MutationOptions,
    ) =>
      call({
        method: 'PATCH',
        path: `/groups/${enc(id)}`,
        body: input,
        schema: dataOf(UpdateGroupResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    delete: (id: GroupId, opts?: MutationOptions) =>
      call({
        method: 'DELETE',
        path: `/groups/${enc(id)}`,
        schema: dataOf(DeleteGroupResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    leave: (id: GroupId, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/groups/${enc(id)}/leave`,
        schema: dataOf(LeaveGroupResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    transferOwnership: (id: GroupId, userId: UserId, opts?: MutationOptions) =>
      call({
        method: 'PATCH',
        path: `/groups/${enc(id)}/members/${enc(userId)}`,
        body: { role: 'owner' },
        schema: dataOf(UpdateGroupMemberResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    removeMember: (id: GroupId, userId: UserId, opts?: MutationOptions) =>
      call({
        method: 'DELETE',
        path: `/groups/${enc(id)}/members/${enc(userId)}`,
        schema: dataOf(RemoveGroupMemberResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    invite: (id: GroupId, userIds: UserId[], opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/groups/${enc(id)}/invitations`,
        body: { user_ids: userIds },
        schema: dataOf(InviteToGroupResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    inviteLink: (
      id: GroupId,
      input: { expires_in_days?: number; max_uses?: number; rotate?: boolean } = {},
      opts?: MutationOptions,
    ) =>
      call({
        method: 'POST',
        path: `/groups/${enc(id)}/invite-link`,
        body: input,
        schema: dataOf(CreateGroupInviteLinkResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** Multipart: each send gets a fresh key (the body boundary changes). */
    uploadCover: (id: GroupId, file: UploadFile) =>
      call({
        method: 'POST',
        path: `/groups/${enc(id)}/cover-image`,
        form: uploadForm(file),
        schema: dataOf(UploadGroupCoverResponseSchema),
      }),

    activity: (id: GroupId, filter: 'upcoming' | 'past' = 'upcoming') =>
      call({
        method: 'GET',
        path: `/groups/${enc(id)}/activity`,
        query: { filter },
        schema: dataOf(GetGroupActivityResponseSchema),
      }),

    previewInvite: (token: string) =>
      call({
        method: 'POST',
        path: '/groups/invite-preview',
        body: { token },
        schema: dataOf(PreviewGroupInviteResponseSchema),
      }),

    join: (token: string, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/groups/join',
        body: { token },
        schema: dataOf(JoinGroupResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    respondInvitation: (invitationId: GroupInvitationId, accept: boolean, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/group-invitations/${enc(invitationId)}/respond`,
        body: { accept },
        schema: dataOf(RespondToGroupInvitationResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),
  };

  // ── Membership + billing ──

  const membership = {
    /** The caller's membership here: the billing view with P2, club standing before it. */
    async get(): Promise<MembershipView> {
      if (capabilities.nativePayments) {
        const data = await call({
          method: 'GET',
          path: '/me/membership',
          query: { club_id: clubId },
          schema: MyMembershipBillingSchema,
        });
        return { kind: 'billing', data };
      }
      const data = await call({
        method: 'GET',
        path: '/me/membership',
        query: { club_id: clubId },
        schema: dataOf(GetMyClubMembershipResponseSchema),
      });
      return { kind: 'standing', data };
    },

    /** P2: tiers on the same interval, each an upgrade or a downgrade. */
    eligibleChanges: () => {
      need('nativePayments');
      return call({
        method: 'GET',
        path: '/me/membership/change',
        query: { club_id: clubId },
        schema: EligibleChangeTiersSchema,
      });
    },

    /** P2: start (or resume) a subscription attempt; answers its sheet bundle. */
    subscribe: (tierId: TierId, termsVersion: string, opts?: MutationOptions) => {
      need('nativePayments');
      return call({
        method: 'POST',
        path: '/me/membership/subscribe',
        body: { club_id: clubId, tier_id: tierId, terms_version: termsVersion, sheet: true },
        schema: SubscribeResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P2: "ask Stripe now" through Clutch's one state function. */
    confirm: (opts?: MutationOptions) => {
      need('nativePayments');
      return call({
        method: 'POST',
        path: '/me/membership/confirm',
        body: { club_id: clubId },
        schema: MembershipConfirmSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P2: upgrade now (may need a sheet), schedule a downgrade, or cancel a scheduled one. */
    change: (tierId: TierId, opts?: MutationOptions) => {
      need('nativePayments');
      return call({
        method: 'POST',
        path: '/me/membership/change',
        body: { club_id: clubId, tier_id: tierId, sheet: true },
        schema: ChangeTierResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P2: cancel at period end, or now. */
    cancel: (at: 'period_end' | 'now', opts?: MutationOptions) => {
      need('nativePayments');
      return call({
        method: 'DELETE',
        path: '/me/membership/subscription',
        query: { club_id: clubId, at },
        schema: CancelSubscriptionResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P2: undo a cancellation at period end. */
    resume: (opts?: MutationOptions) => {
      need('nativePayments');
      return call({
        method: 'POST',
        path: '/me/membership/subscription/resume',
        body: { club_id: clubId },
        schema: ResumeSubscriptionResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },
  };

  const paymentMethods = {
    /** Cards on file here (main has this route; P2 projects it). */
    list: () =>
      call({
        method: 'GET',
        path: '/me/payment-methods',
        query: { club_id: clubId },
        schema: SavedCardsSchema,
      }),

    /** P2: a SetupIntent sheet bundle (with the ephemeral key) on the club's account. */
    setupIntent: (opts?: MutationOptions) => {
      need('nativePayments');
      return call({
        method: 'POST',
        path: '/me/payment-methods/setup-intent',
        body: { club_id: clubId, sheet: true },
        schema: SetupIntentSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P2: Clutch retrieves the SetupIntent and stores the card it holds. */
    save: (setupIntentId: string, opts?: MutationOptions) => {
      need('nativePayments');
      return call({
        method: 'POST',
        path: '/me/payment-methods',
        body: { club_id: clubId, setup_intent_id: setupIntentId },
        schema: SavedCardSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P2: the default moves on Stripe too (customer and live subscription). */
    setDefault: (cardId: CardId, opts?: MutationOptions) => {
      need('nativePayments');
      return call({
        method: 'PATCH',
        path: `/me/payment-methods/${enc(cardId)}`,
        schema: SavedCardSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P2: refuses (card_in_use_by_subscription) or re-points a live subscription's card. */
    remove: (cardId: CardId, opts?: MutationOptions) => {
      need('nativePayments');
      return call({
        method: 'DELETE',
        path: `/me/payment-methods/${enc(cardId)}`,
        schema: RemovedCardSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },
  };

  // ── Me ──

  const me = {
    get: () => call({ method: 'GET', path: '/me', schema: dataOf(GetMeResponseSchema) }),

    home: () =>
      call({ method: 'GET', path: '/me/home', query: { club_id: clubId }, schema: dataOf(GetMyHomeResponseSchema) }),

    /** The caller's own bookings here (those they booked). */
    async bookings(q: { status?: string; from?: string; limit?: number; offset?: number } = {}): Promise<Page<MyBooking>> {
      const { data, count } = await request({
        method: 'GET',
        path: '/me/bookings',
        query: { club_id: clubId, ...q },
        schema: dataOf(ListMyBookingsResponseSchema),
      });
      const items = data.filter((row): row is MyBooking => row.kind === 'booking');
      return { items, count: count ?? items.length };
    },

    /** Pending invitations to other people's bookings here. */
    async bookingInvitations(): Promise<BookingInvitation[]> {
      const data = await call({
        method: 'GET',
        path: '/me/bookings',
        query: { club_id: clubId, include: 'invitations' },
        schema: dataOf(ListMyBookingsResponseSchema),
      });
      return data.filter((row): row is BookingInvitation => row.kind === 'invitation');
    },

    async payments(q: { type?: string; status?: string; limit?: number; offset?: number } = {}) {
      const { data, count } = await request({
        method: 'GET',
        path: '/me/payments',
        query: { club_id: clubId, ...q },
        schema: dataOf(ListMyPaymentsResponseSchema),
      });
      return { items: data, count: count ?? data.length };
    },

    profile: () => call({ method: 'GET', path: '/me/profile', schema: dataOf(GetMyProfileResponseSchema) }),

    updateProfile: (input: { full_name?: string; username?: string }, opts?: MutationOptions) =>
      call({
        method: 'PATCH',
        path: '/me/profile',
        body: input,
        schema: dataOf(UpdateMyProfileResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** Multipart: each send gets a fresh key (the body boundary changes). */
    uploadAvatar: (file: UploadFile) =>
      call({
        method: 'POST',
        path: '/me/avatar',
        form: uploadForm(file),
        schema: dataOf(UploadMyAvatarResponseSchema),
      }),

    preferences: () => call({ method: 'GET', path: '/me/preferences', schema: dataOf(GetMyPreferencesResponseSchema) }),

    /** A full replace: every category with push, email and sms. */
    putPreferences: (prefs: NotificationPreferences, opts?: MutationOptions) =>
      call({
        method: 'PUT',
        path: '/me/preferences',
        body: prefs,
        schema: dataOf(ReplaceMyPreferencesResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** The in-app inbox (what push notices open). */
    async notifications(q: { limit?: number; offset?: number } = {}) {
      const { data, count } = await request({
        method: 'GET',
        path: '/me/notifications',
        query: q,
        schema: dataOf(ListMyNotificationsResponseSchema),
      });
      return { items: data, count: count ?? data.length };
    },

    /** Mark one notice read (`id`) or all of them (`all: true`). */
    markNotificationsRead: (input: { id: string } | { all: true }, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/me/notifications',
        body: input,
        schema: dataOf(MarkMyNotificationsReadResponseSchema),
        idempotencyKey: opts?.idempotencyKey,
      }),

    /**
     * P1: register this install's Expo push token (idempotent; call on every
     * launch and sign-in). 202 `verification_required`: the token is another
     * account's; prove the device with the pushed code (verifyDevice).
     */
    registerDevice: (
      input: { token: string; platform: 'ios' | 'android'; device_secret: string },
      opts?: MutationOptions,
    ) => {
      need('pushDevices');
      return call({
        method: 'POST',
        path: '/me/devices',
        body: input,
        schema: RegisteredDeviceSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P1: complete a `verification_required` registration with the pushed code. */
    verifyDevice: (input: { token: string; code: string }, opts?: MutationOptions) => {
      need('pushDevices');
      return call({
        method: 'POST',
        path: '/me/devices/verify',
        body: input,
        schema: VerifiedDeviceSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P1: stop pushing to this install; the token travels in the body. */
    unregisterDevice: (token: string, opts?: MutationOptions) => {
      need('pushDevices');
      return call({
        method: 'DELETE',
        path: '/me/devices',
        body: { token },
        schema: RemovedDeviceSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },

    /** P5: signed, short-lived member check-in token for the QR card. */
    checkinToken: () => {
      need('checkinToken');
      return call({ method: 'GET', path: '/me/checkin-token', query: { club_id: clubId }, schema: CheckinTokenSchema });
    },

    /** P5: blockers + step-up state, before asking for a fresh sign-in. */
    accountDeletion: () => {
      need('accountDeletion');
      return call({ method: 'GET', path: '/me/account/deletion', schema: AccountDeletionPreviewSchema });
    },

    /**
     * P5: delete the account for good. 403 step_up_required (details:
     * StepUpState), 409 account_deletion_blocked (details: DeletionBlockers)
     * or refunds_pending, 500 account_deletion_failed (nothing deleted).
     */
    deleteAccount: (opts?: MutationOptions) => {
      need('accountDeletion');
      return call({
        method: 'DELETE',
        path: '/me/account',
        schema: DeleteAccountResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      });
    },
  };

  return { clubId, capabilities, club, bookings, groups, membership, paymentMethods, me };
}

export type ClutchClient = ReturnType<typeof createClutchClient>;
