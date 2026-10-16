/**
 * The Clutch API client: transport plus one typed function per endpoint.
 *
 * Transport rules (each one is a test in __tests__/client.test.ts):
 * - Every request carries the Supabase access token (AuthPort) as Bearer.
 * - Strict envelope: a success body is exactly `{data, count?}`, a failure is
 *   exactly `{error, message, details?, request_id?}`. `data` is parsed with
 *   the endpoint's schema from contract.gen.ts. Anything else is a ClutchError
 *   of kind 'contract' (Clutch drifted from what the app was built against).
 * - Errors are ClutchError with `code: ErrorCode | 'unknown'`.
 * - 401 -> ONE refresh (shared by concurrent callers) -> retry once. A refresh
 *   that finds the session definitively gone surfaces the 401 (supabase-js has
 *   already signed out, which clears the cache); a transient refresh failure
 *   surfaces a network error and keeps the session.
 * - Every mutation (POST/PUT/PATCH/DELETE) carries an Idempotency-Key. The
 *   caller passes the key of the LOGICAL mutation (useMutationKey) so a user
 *   retry replays instead of acting twice; the client reuses it across its own
 *   retries (after a refresh, and on 409 request_in_flight, which means "the
 *   first attempt is still running": wait and ask again with the same key).
 * - The club is bound at construction: every club-scoped call uses `clubId`,
 *   and `club.verify()` checks at startup that the id is the expected club.
 */
import { z } from 'zod';
import {
  AvailabilityGridSchema,
  AvatarUrlSchema,
  BookingDetailSchema,
  BookingInvitationsSchema,
  BookingListSchema,
  BookingPaymentIntentSchema,
  BookingQuoteSchema,
  BookingSchema,
  ChangeTierResultSchema,
  CheckinTokenSchema,
  ClubSchema,
  CourtListSchema,
  CoverUrlSchema,
  DeleteAccountResultSchema,
  EligibleChangeTiersSchema,
  ErrorEnvelopeSchema,
  GroupActivitySchema,
  GroupDetailSchema,
  GroupIdResultSchema,
  GroupInvitationsSchema,
  GroupInviteLinkSchema,
  GroupInvitePreviewSchema,
  GroupMembersSchema,
  GroupSummariesSchema,
  HomeSchema,
  InvitedResultSchema,
  JoinClubResultSchema,
  MeSchema,
  MembershipTiersPageSchema,
  MyMembershipSchema,
  NoContentSchema,
  NotificationPreferencesSchema,
  PaymentHistorySchema,
  PlayerSearchResultsSchema,
  ProfileSchema,
  RegisteredDeviceSchema,
  RescheduleResultSchema,
  SavedPaymentMethodsSchema,
  SheetBundleSchema,
  SubscribeResultSchema,
  SuccessEnvelopeSchema,
  type Club,
  type NotificationPreferences,
} from './contract.gen';
import { ClutchError } from './errors';
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

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// ─── Client ──────────────────────────────────────────────────────────────────

export function createClutchClient(options: ClutchClientOptions) {
  const {
    baseUrl,
    clubId,
    expectedClubSlug,
    auth,
    newIdempotencyKey,
    timeoutMs = 30_000,
  } = options;
  const doFetch: typeof fetch = options.fetch ?? ((...args) => fetch(...args));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = baseUrl.replace(/\/+$/, '');

  let refreshInFlight: Promise<string | null> | null = null;

  /** Single-flight refresh: concurrent 401s share one refresh and its outcome. */
  function refreshOnce(): Promise<string | null> {
    refreshInFlight ??= auth.refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
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
      body = spec.form; // fetch sets the multipart boundary itself
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

  async function request<S extends z.ZodType>(
    spec: RequestSpec<S>,
  ): Promise<{ data: z.infer<S>; count?: number }> {
    const mutating = spec.method !== 'GET';
    const key = mutating ? (spec.idempotencyKey ?? newIdempotencyKey()) : undefined;

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
        res = await send(spec, token, key);
      }
    }

    for (const delay of IN_FLIGHT_RETRY_DELAYS_MS) {
      if (res.status !== 409) break;
      const peek = ErrorEnvelopeSchema.safeParse(await readJson(res.clone()));
      if (!peek.success || peek.data.error !== 'request_in_flight') break;
      await sleep(delay);
      res = await send(spec, token, key);
    }

    const json = await readJson(res);
    if (!res.ok) {
      const parsed = ErrorEnvelopeSchema.safeParse(json);
      if (!parsed.success) throw contractError(res.status, 'an error');
      throw new ClutchError({
        code: parsed.data.error,
        message: parsed.data.message,
        status: res.status,
        kind: 'api',
        details: parsed.data.details,
      });
    }

    const envelope = SuccessEnvelopeSchema.safeParse(json);
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

  async function page<T>(spec: RequestSpec<z.ZodType<T[]>>): Promise<Page<T>> {
    const { data, count } = await request(spec);
    const items = data as T[];
    return { items, count: count ?? items.length };
  }

  function uploadForm(file: UploadFile): FormData {
    const form = new FormData();
    form.append('file', file as unknown as Blob);
    return form;
  }

  // ── The venue ──

  const club = {
    get: () => call({ method: 'GET', path: `/clubs/${enc(clubId)}`, schema: ClubSchema }),

    /** Startup check: the bound id must be the expected club. */
    async verify(): Promise<Club> {
      const row = await club.get();
      if (row.slug !== expectedClubSlug) throw new ClubMismatchError(expectedClubSlug, row.slug);
      return row;
    },

    courts: () =>
      call({ method: 'GET', path: `/clubs/${enc(clubId)}/courts`, schema: CourtListSchema }),

    availability: (date: string) =>
      call({
        method: 'GET',
        path: `/clubs/${enc(clubId)}/availability`,
        query: { date },
        schema: AvailabilityGridSchema,
      }),

    tiers: () =>
      call({
        method: 'GET',
        path: `/clubs/${enc(clubId)}/membership-tiers`,
        schema: MembershipTiersPageSchema,
      }),

    join: (opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/clubs/${enc(clubId)}/join`,
        schema: JoinClubResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P4: fellow members a member may invite (never the admin roster). */
    searchPlayers: (q: string, limit = 20) =>
      call({
        method: 'GET',
        path: `/clubs/${enc(clubId)}/players`,
        query: { q: q.trim() || undefined, limit },
        schema: PlayerSearchResultsSchema,
      }),
  };

  // ── Bookings ──

  interface BookingRange {
    court_id: CourtId;
    date: string;
    start_time: string;
    end_time: string;
    discount_code?: string;
  }

  const bookings = {
    /** PENDING P4: what createBooking will charge for this range. */
    quote: (range: BookingRange) =>
      call({
        method: 'POST',
        path: '/bookings/quote',
        body: { club_id: clubId, ...range },
        schema: BookingQuoteSchema,
        // A quote changes nothing; a fresh key per call is correct.
      }),

    /** Hold a court: a `pending` booking with a 15-minute hold. */
    create: (range: BookingRange, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/bookings',
        body: { club_id: clubId, ...range },
        schema: BookingSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    get: (id: BookingId) =>
      call({ method: 'GET', path: `/bookings/${enc(id)}`, schema: BookingDetailSchema }),

    /** The payment for a pending booking (or a balance due on a confirmed one). */
    paymentIntent: (id: BookingId, opts?: MutationOptions & { shareCents?: number }) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/payment-intent`,
        body: opts?.shareCents === undefined ? {} : { share_cents: opts.shareCents },
        schema: BookingPaymentIntentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** Simulated deployments only: complete the simulated checkout. */
    paySimulated: (id: BookingId, paymentIntentId: string, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/payment-intent/pay`,
        body: { payment_intent_id: paymentIntentId },
        schema: z.object({ status: z.string() }),
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** Confirm with the COMPLETED intent id (omit only for a free booking). */
    confirm: (id: BookingId, paymentIntentId: string | null, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/confirm`,
        body: paymentIntentId ? { payment_intent_id: paymentIntentId } : {},
        schema: BookingSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    cancel: (id: BookingId, opts?: MutationOptions & { reason?: string }) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/cancel`,
        body: opts?.reason ? { reason: opts.reason } : {},
        schema: BookingSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    reschedule: (
      id: BookingId,
      move: { new_date: string; new_start_time: string; new_end_time: string; new_court_id?: CourtId },
      opts?: MutationOptions,
    ) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/reschedule`,
        body: move,
        schema: RescheduleResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    invitePlayers: (
      id: BookingId,
      playerIds: UserId[],
      opts?: MutationOptions & { shares?: Record<string, number> },
    ) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/players`,
        body: { player_ids: playerIds, ...(opts?.shares ? { shares: opts.shares } : {}) },
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    inviteGroup: (id: BookingId, groupId: GroupId, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/invite-group`,
        body: { group_id: groupId },
        schema: InvitedResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P4: accept or decline an invitation to someone else's booking. */
    respond: (id: BookingId, accept: boolean, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/bookings/${enc(id)}/respond`,
        body: { accept },
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P4: the booker removes a player (or a player leaves: their own id). */
    removePlayer: (id: BookingId, userId: UserId, opts?: MutationOptions) =>
      call({
        method: 'DELETE',
        path: `/bookings/${enc(id)}/players/${enc(userId)}`,
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),
  };

  // ── Groups ──

  const groups = {
    /** The caller's groups AT THIS CLUB (/me/groups spans every club). */
    async list() {
      const all = await call({ method: 'GET', path: '/me/groups', schema: GroupSummariesSchema });
      return all.filter((g) => g.club_id === clubId);
    },

    /** Pending invitations to groups at this club. */
    async invitations() {
      const all = await call({
        method: 'GET',
        path: '/me/group-invitations',
        schema: GroupInvitationsSchema,
      });
      return all.filter((i) => i.club_id === clubId);
    },

    create: (
      input: { name: string; description?: string | null; invitee_user_ids?: UserId[] },
      opts?: MutationOptions,
    ) =>
      call({
        method: 'POST',
        path: '/me/groups',
        body: { club_id: clubId, ...input },
        schema: GroupIdResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    get: (id: GroupId) =>
      call({ method: 'GET', path: `/groups/${enc(id)}`, schema: GroupDetailSchema }),

    members: (id: GroupId) =>
      call({ method: 'GET', path: `/groups/${enc(id)}/members`, schema: GroupMembersSchema }),

    update: (
      id: GroupId,
      input: { name?: string; description?: string | null; clear_cover?: boolean },
      opts?: MutationOptions,
    ) =>
      call({
        method: 'PATCH',
        path: `/groups/${enc(id)}`,
        body: input,
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    delete: (id: GroupId, opts?: MutationOptions) =>
      call({
        method: 'DELETE',
        path: `/groups/${enc(id)}`,
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    leave: (id: GroupId, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/groups/${enc(id)}/leave`,
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    transferOwnership: (id: GroupId, userId: UserId, opts?: MutationOptions) =>
      call({
        method: 'PATCH',
        path: `/groups/${enc(id)}/members/${enc(userId)}`,
        body: { role: 'owner' },
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    removeMember: (id: GroupId, userId: UserId, opts?: MutationOptions) =>
      call({
        method: 'DELETE',
        path: `/groups/${enc(id)}/members/${enc(userId)}`,
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    invite: (id: GroupId, userIds: UserId[], opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/groups/${enc(id)}/invitations`,
        body: { user_ids: userIds },
        schema: InvitedResultSchema,
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
        schema: GroupInviteLinkSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    uploadCover: (id: GroupId, file: UploadFile, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/groups/${enc(id)}/cover-image`,
        form: uploadForm(file),
        schema: CoverUrlSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    activity: (id: GroupId, filter: 'upcoming' | 'past' = 'upcoming') =>
      call({
        method: 'GET',
        path: `/groups/${enc(id)}/activity`,
        query: { filter },
        schema: GroupActivitySchema,
      }),

    previewInvite: (token: string) =>
      call({
        method: 'POST',
        path: '/groups/invite-preview',
        body: { token },
        schema: GroupInvitePreviewSchema,
      }),

    join: (token: string, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/groups/join',
        body: { token },
        schema: GroupIdResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    respondInvitation: (invitationId: GroupInvitationId, accept: boolean, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: `/group-invitations/${enc(invitationId)}/respond`,
        body: { accept },
        schema: GroupIdResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),
  };

  // ── Membership + billing ──

  const membership = {
    get: () =>
      call({
        method: 'GET',
        path: '/me/membership',
        query: { club_id: clubId },
        schema: MyMembershipSchema,
      }),

    eligibleChanges: () =>
      call({
        method: 'GET',
        path: '/me/membership/change',
        query: { club_id: clubId },
        schema: EligibleChangeTiersSchema,
      }),

    /** PENDING P2: start (or resume) a subscription attempt; returns its sheet. */
    subscribe: (tierId: TierId, termsVersion: string, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/me/membership/subscribe',
        body: { club_id: clubId, tier_id: tierId, terms_version: termsVersion },
        schema: SubscribeResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P2: "re-read Stripe now" through Clutch's one state function. */
    confirm: (opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/me/membership/confirm',
        body: { club_id: clubId },
        schema: MyMembershipSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P2: upgrade now (may need a sheet) or schedule a downgrade. */
    change: (tierId: TierId, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/me/membership/change',
        body: { club_id: clubId, tier_id: tierId },
        schema: ChangeTierResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P2: cancel at period end, or now. */
    cancel: (at: 'period_end' | 'now', opts?: MutationOptions) =>
      call({
        method: 'DELETE',
        path: '/me/membership/subscription',
        query: { club_id: clubId, at },
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P2: undo a scheduled cancellation. */
    resume: (opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/me/membership/subscription/resume',
        body: { club_id: clubId },
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),
  };

  const paymentMethods = {
    list: () =>
      call({
        method: 'GET',
        path: '/me/payment-methods',
        query: { club_id: clubId },
        schema: SavedPaymentMethodsSchema,
      }),

    /** PENDING P2: a SetupIntent sheet bundle on the club's account. */
    setupIntent: (opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/me/payment-methods/setup-intent',
        body: { club_id: clubId },
        schema: SheetBundleSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P2: Clutch retrieves the SetupIntent and stores the card it holds. */
    save: (setupIntentId: string, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/me/payment-methods',
        body: { club_id: clubId, setup_intent_id: setupIntentId },
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    setDefault: (cardId: CardId, opts?: MutationOptions) =>
      call({
        method: 'PATCH',
        path: `/me/payment-methods/${enc(cardId)}`,
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    remove: (cardId: CardId, opts?: MutationOptions) =>
      call({
        method: 'DELETE',
        path: `/me/payment-methods/${enc(cardId)}`,
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),
  };

  // ── Me ──

  const me = {
    get: () => call({ method: 'GET', path: '/me', schema: MeSchema }),

    home: () =>
      call({ method: 'GET', path: '/me/home', query: { club_id: clubId }, schema: HomeSchema }),

    bookings: (q: { status?: string; from?: string; limit?: number; offset?: number } = {}) =>
      page({
        method: 'GET',
        path: '/me/bookings',
        query: { club_id: clubId, ...q },
        schema: BookingListSchema,
      }),

    bookingInvitations: () =>
      call({
        method: 'GET',
        path: '/me/bookings',
        query: { club_id: clubId, include: 'invitations' },
        schema: BookingInvitationsSchema,
      }),

    payments: (q: { type?: string; status?: string; limit?: number; offset?: number } = {}) =>
      page({
        method: 'GET',
        path: '/me/payments',
        query: { club_id: clubId, ...q },
        schema: PaymentHistorySchema,
      }),

    profile: () => call({ method: 'GET', path: '/me/profile', schema: ProfileSchema }),

    updateProfile: (input: { full_name?: string; username?: string }, opts?: MutationOptions) =>
      call({
        method: 'PATCH',
        path: '/me/profile',
        body: input,
        schema: ProfileSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    uploadAvatar: (file: UploadFile, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/me/avatar',
        form: uploadForm(file),
        schema: AvatarUrlSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    preferences: () =>
      call({ method: 'GET', path: '/me/preferences', schema: NotificationPreferencesSchema }),

    /** A full replace: every category with push, email and sms. */
    putPreferences: (prefs: NotificationPreferences, opts?: MutationOptions) =>
      call({
        method: 'PUT',
        path: '/me/preferences',
        body: prefs,
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P1: register this device's Expo push token. */
    registerDevice: (input: { token: string; platform: 'ios' | 'android' }, opts?: MutationOptions) =>
      call({
        method: 'POST',
        path: '/me/devices',
        body: input,
        schema: RegisteredDeviceSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P1 */
    unregisterDevice: (token: string, opts?: MutationOptions) =>
      call({
        method: 'DELETE',
        path: `/me/devices/${enc(token)}`,
        schema: NoContentSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),

    /** PENDING P5: signed, short-lived member check-in token for the QR card. */
    checkinToken: () =>
      call({
        method: 'GET',
        path: '/me/checkin-token',
        query: { club_id: clubId },
        schema: CheckinTokenSchema,
      }),

    /**
     * PENDING P5: delete the account. Needs a recent sign-in (step-up);
     * 403 step_up_required asks for one, 409 deletion_blocked lists blockers.
     */
    deleteAccount: (opts?: MutationOptions) =>
      call({
        method: 'DELETE',
        path: '/me/account',
        schema: DeleteAccountResultSchema,
        idempotencyKey: opts?.idempotencyKey,
      }),
  };

  return { clubId, club, bookings, groups, membership, paymentMethods, me };
}

export type ClutchClient = ReturnType<typeof createClutchClient>;
