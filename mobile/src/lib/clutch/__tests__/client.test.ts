import { createClutchClient, ClubMismatchError, type AuthPort } from '../client';
import { ClutchError } from '../errors';
import { asBookingId, asClubId, asCourtId, asGroupId } from '../ids';
import {
  makeAuthSession,
  makeBookingInvitation,
  makeChargedBooking,
  makeClub,
  makeGroupSummary,
  makeMyBooking,
} from '../fixtures';
import { ClutchUnavailableError, CAPABILITIES } from '../capabilities';

const CLUB = asClubId('15e24f5f-ee39-4154-8ad6-06942d06cb8a');

type Client = ReturnType<typeof createClutchClient>;

interface FakeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  clone(): FakeResponse;
}

function reply(status: number, body: unknown): FakeResponse {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const res: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    clone: () => reply(status, body),
  };
  return res;
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function setup(
  responses: FakeResponse[],
  auth?: Partial<AuthPort>,
  capabilities: Record<keyof typeof CAPABILITIES, boolean> = { ...CAPABILITIES },
) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    });
    const next = queue.shift();
    if (!next) throw new Error('unexpected request');
    return next as unknown as Response;
  });
  let keys = 0;
  const port: AuthPort = {
    getAccessToken: jest.fn(async () => 'token-1'),
    refreshAccessToken: jest.fn(async () => 'token-2'),
    ...auth,
  };
  const client = createClutchClient({
    baseUrl: 'https://clutch.test/api/v1/',
    clubId: CLUB,
    expectedClubSlug: '770',
    auth: port,
    newIdempotencyKey: () => `idem-${++keys}`,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => undefined,
    capabilities,
  });
  return { client, calls, port };
}

describe('transport', () => {
  it('sends the access token and parses data through the contract', async () => {
    const { client, calls } = setup([reply(200, { data: makeClub() })]);
    const club = await client.club.get();
    expect(club.slug).toBe('770');
    expect(calls[0].url).toBe(`https://clutch.test/api/v1/clubs/${CLUB}`);
    expect(calls[0].headers.Authorization).toBe('Bearer token-1');
    expect(calls[0].headers['Idempotency-Key']).toBeUndefined();
  });

  it('binds the club to club-scoped calls', async () => {
    const { client, calls } = setup([reply(200, { data: [] })]);
    await client.club.availability('2026-10-20');
    expect(calls[0].url).toBe(`https://clutch.test/api/v1/clubs/${CLUB}/availability?date=2026-10-20`);
  });

  it('raises a typed ClutchError from the error envelope', async () => {
    const { client } = setup([
      reply(409, { error: 'slot_already_booked', message: 'Someone else took that slot.' }),
    ]);
    const err = await client.bookings
      .create({ court_id: asCourtId('c1'), date: '2026-10-20', start_time: '18:00', end_time: '19:00' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClutchError);
    expect((err as ClutchError).code).toBe('slot_already_booked');
    expect((err as ClutchError).status).toBe(409);
    expect((err as ClutchError).kind).toBe('api');
  });

  it('keeps an unknown code as unknown with the wire value in rawCode', async () => {
    const { client } = setup([reply(409, { error: 'brand_new_code', message: 'New.' })]);
    const err = (await client.club.courts().catch((e: unknown) => e)) as ClutchError;
    expect(err.code).toBe('unknown');
    expect(err.rawCode).toBe('brand_new_code');
  });

  it('carries structured details', async () => {
    const { client } = setup([
      reply(409, { error: 'waiver_required', message: 'Sign it.', details: { club_id: CLUB } }),
    ]);
    const err = (await client.club.courts().catch((e: unknown) => e)) as ClutchError;
    expect(err.details).toEqual({ club_id: CLUB });
  });

  it('rejects a success body that is not exactly {data, count?}', async () => {
    const { client } = setup([reply(200, { data: [], extra: true })]);
    const err = (await client.club.courts().catch((e: unknown) => e)) as ClutchError;
    expect(err.kind).toBe('contract');
  });

  it('rejects data that does not match the endpoint schema', async () => {
    const { client } = setup([reply(200, { data: { slug: 770 } })]);
    const err = (await client.club.get().catch((e: unknown) => e)) as ClutchError;
    expect(err.kind).toBe('contract');
  });

  it('rejects an error body that is not the documented envelope', async () => {
    const { client } = setup([reply(500, '<html>oops</html>')]);
    const err = (await client.club.courts().catch((e: unknown) => e)) as ClutchError;
    expect(err.kind).toBe('contract');
    expect(err.status).toBe(500);
  });

  it('reports a network failure as kind network, status 0', async () => {
    const { client } = setup([]);
    const err = (await client.club.courts().catch((e: unknown) => e)) as ClutchError;
    expect(err.kind).toBe('network');
    expect(err.status).toBe(0);
  });

  it('returns list counts from paged endpoints', async () => {
    const { client } = setup([reply(200, { data: [], count: 42 })]);
    const page = await client.me.bookings({ limit: 10 });
    expect(page).toEqual({ items: [], count: 42 });
  });
});

describe('auth', () => {
  it('refreshes once after a 401 and retries with the new token and a new key', async () => {
    const { client, calls, port } = setup([
      reply(401, { error: 'session_expired', message: 'Expired.' }),
      reply(201, { data: makeChargedBooking() }),
    ]);
    await client.bookings.create(
      { court_id: asCourtId('c1'), date: '2026-10-20', start_time: '18:00', end_time: '19:00' },
      { idempotencyKey: 'logical-1' },
    );
    expect(port.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(calls[1].headers.Authorization).toBe('Bearer token-2');
    // Clutch cached the 401 under the first key; the retry is a new attempt.
    expect(calls[0].headers['Idempotency-Key']).toBe('logical-1');
    expect(calls[1].headers['Idempotency-Key']).toBe('idem-1');
  });

  it('asks the session to refresh for the token each request was refused with', async () => {
    // The session store runs one refresh for concurrent callers (auth-session tests).
    const refresh = jest.fn(async () => 'token-2');
    const { client, calls } = setup(
      [
        reply(401, { error: 'session_expired', message: 'x' }),
        reply(401, { error: 'auth_required', message: 'x' }),
        reply(200, { data: [] }),
        reply(200, { data: [] }),
      ],
      { refreshAccessToken: refresh },
    );
    await Promise.all([client.club.courts(), client.club.courts()]);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenNthCalledWith(1, 'token-1');
    expect(refresh).toHaveBeenNthCalledWith(2, 'token-1');
    expect(calls.slice(2).map((c) => c.headers.Authorization)).toEqual(['Bearer token-2', 'Bearer token-2']);
  });

  it('never retries as someone else: no token from the refresh means no retry', async () => {
    // e.g. the member signed out and another signed in while this was in flight.
    const { client, calls } = setup([reply(401, { error: 'session_expired', message: 'x' })], {
      refreshAccessToken: jest.fn(async () => null),
    });
    await client.me.unregisterDevice('push-token').catch(() => undefined);
    expect(calls).toHaveLength(1);
  });

  it.each(['mfa_required', 'invalid_credentials'])('answers a 401 %s without refreshing', async (code) => {
    const { client, calls, port } = setup([reply(401, { error: code, message: 'x' })]);
    const err = (await client.auth.setPassword('new-password-1').catch((e: unknown) => e)) as ClutchError;
    expect(err.code).toBe(code);
    expect(port.refreshAccessToken).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('refreshes after a 401 whose body cannot be read', async () => {
    const { client, port } = setup([reply(401, 'gateway said no'), reply(200, { data: [] })]);
    await client.club.courts();
    expect(port.refreshAccessToken).toHaveBeenCalledWith('token-1');
  });

  it('surfaces the 401 when the session is definitively gone', async () => {
    const { client } = setup([reply(401, { error: 'session_expired', message: 'x' })], {
      refreshAccessToken: jest.fn(async () => null),
    });
    const err = (await client.club.courts().catch((e: unknown) => e)) as ClutchError;
    expect(err.code).toBe('session_expired');
    expect(err.status).toBe(401);
  });

  it('keeps the session on a transient refresh failure', async () => {
    const { client } = setup([reply(401, { error: 'session_expired', message: 'x' })], {
      refreshAccessToken: jest.fn(async () => {
        throw new Error('offline');
      }),
    });
    const err = (await client.club.courts().catch((e: unknown) => e)) as ClutchError;
    expect(err.kind).toBe('network');
  });

  it('does not refresh for an anonymous caller', async () => {
    const { client, port } = setup([reply(401, { error: 'auth_required', message: 'x' })], {
      getAccessToken: jest.fn(async () => null),
    });
    await client.me.get().catch(() => undefined);
    expect(port.refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe('idempotency', () => {
  it('gives every mutation a key and reads none', async () => {
    const { client, calls } = setup([reply(200, { data: { joined: true, status: 'active', role: 'player' } }), reply(200, { data: [] })]);
    await client.club.join();
    await client.club.courts();
    expect(calls[0].headers['Idempotency-Key']).toBe('idem-1');
    expect(calls[1].headers['Idempotency-Key']).toBeUndefined();
  });

  it('waits and retries with the same key while the first attempt is in flight', async () => {
    const { client, calls } = setup([
      reply(409, { error: 'request_in_flight', message: 'Still running.' }),
      reply(409, { error: 'request_in_flight', message: 'Still running.' }),
      reply(200, { data: makeChargedBooking({ status: 'confirmed' }) }),
    ]);
    const booking = await client.bookings.confirm(asBookingId('b1'), 'pi_1', { idempotencyKey: 'k' });
    expect(booking.status).toBe('confirmed');
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.headers['Idempotency-Key']))).toEqual(new Set(['k']));
    expect(calls[0].body).toEqual({ payment_intent_id: 'pi_1' });
  });

  it('does not retry any other 409', async () => {
    const { client, calls } = setup([reply(409, { error: 'booking_changed', message: 'Changed.' })]);
    await client.bookings.confirm(asBookingId('b1'), 'pi_1').catch(() => undefined);
    expect(calls).toHaveLength(1);
  });
});

describe('club binding', () => {
  it('verify() accepts the expected club', async () => {
    const { client } = setup([reply(200, { data: makeClub() })]);
    await expect(client.club.verify()).resolves.toMatchObject({ slug: '770' });
  });

  it('verify() refuses a club id that resolves to another club', async () => {
    const { client } = setup([reply(200, { data: makeClub({ slug: 'lisc' }) })]);
    await expect(client.club.verify()).rejects.toBeInstanceOf(ClubMismatchError);
  });

  it('filters /me/groups to the bound club', async () => {
    const mine = makeGroupSummary();
    const elsewhere = makeGroupSummary({
      id: asGroupId('90000000-0000-4000-8000-000000000002'),
      club_id: asClubId('aaaaaaaa-0000-4000-8000-000000000000'),
    });
    const { client } = setup([reply(200, { data: [mine, elsewhere] })]);
    expect(await client.groups.list()).toEqual([mine]);
  });

  it('sends club_id in bodies of club-scoped mutations', async () => {
    const { client, calls } = setup([reply(201, { data: makeChargedBooking() })]);
    await client.bookings.create({
      court_id: asCourtId('c1'),
      date: '2026-10-20',
      start_time: '18:00',
      end_time: '19:00',
    });
    expect(calls[0].body).toMatchObject({ club_id: CLUB, court_id: 'c1' });
  });
});

describe('lists', () => {
  it('splits /me/bookings by kind', async () => {
    const { client } = setup([
      reply(200, { data: [makeMyBooking(), makeBookingInvitation()], count: 2 }),
      reply(200, { data: [makeMyBooking(), makeBookingInvitation()], count: 2 }),
    ]);
    const page = await client.me.bookings();
    expect(page.items.map((b) => b.kind)).toEqual(['booking']);
    const invitations = await client.me.bookingInvitations();
    expect(invitations.map((b) => b.kind)).toEqual(['invitation']);
  });
});

describe('requests', () => {
  it('omits an empty invitee list when creating a group', async () => {
    const { client, calls } = setup([reply(201, { data: { group_id: '90000000-0000-4000-8000-000000000001' } })]);
    await client.groups.create({ name: 'Doubles', invitee_user_ids: [] });
    expect(calls[0].body).not.toHaveProperty('invitee_user_ids');
  });

  it('sends midnight as 00:00', async () => {
    const { client, calls } = setup([reply(201, { data: makeChargedBooking() })]);
    await client.bookings.create({ court_id: asCourtId('c1'), date: '2026-10-20', start_time: '23:00', end_time: '24:00' });
    expect(calls[0].body).toMatchObject({ start_time: '23:00', end_time: '00:00' });
  });

  it('sends a multipart upload with a fresh key each time', async () => {
    const { client, calls } = setup([
      reply(500, { error: 'upload_failed', message: 'x' }),
      reply(201, { data: 'https://cdn/avatar.png' }),
    ]);
    await client.me.uploadAvatar({ uri: 'file://a.png', name: 'a.png', type: 'image/png' }).catch(() => undefined);
    await client.me.uploadAvatar({ uri: 'file://a.png', name: 'a.png', type: 'image/png' });
    expect(calls[0].headers['Idempotency-Key']).not.toBe(calls[1].headers['Idempotency-Key']);
  });

  it('asks P2 checkouts for the sheet bundle', async () => {
    const caps = { ...CAPABILITIES, nativePayments: true };
    const bundle = {
      client_secret: 'pi_1_secret_x',
      intent_type: 'payment',
      customer_id: 'cus_1',
      ephemeral_key_secret: 'ek_1',
      stripe_account: 'acct_1',
      simulated: false,
      payment_intent_id: 'pi_1',
      subtotal_cents: 3000,
      tax_cents: 0,
    };
    const { client, calls } = setup([reply(200, { data: bundle })], undefined, caps);
    await client.bookings.paymentIntent(asBookingId('b1'));
    expect(calls[0].body).toEqual({ sheet: true });
  });
});

describe('capabilities', () => {
  it('refuses a gated call locally without reaching Clutch', async () => {
    const { client, calls } = setup([], undefined, { ...CAPABILITIES, bookingParity: false });
    expect(() =>
      client.bookings.quote({ court_id: asCourtId('c1'), date: '2026-10-20', start_time: '18:00', end_time: '19:00' }),
    ).toThrow(ClutchUnavailableError);
    expect(calls).toHaveLength(0);
  });
});

describe('sign-in calls', () => {
  const session = { data: makeAuthSession() };
  const accepted = { data: { ok: true, message: 'If that address has an account, a code is on its way.' } };
  const ok = { data: { ok: true } };

  it.each([
    ['token', (c: Client) => c.auth.token('a@x.com', 'pw-123456'), '/auth/token', { email: 'a@x.com', password: 'pw-123456' }, { data: makeAuthSession() }],
    ['refresh', (c: Client) => c.auth.refresh('refresh-9'), '/auth/refresh', { refresh_token: 'refresh-9' }, { data: makeAuthSession() }],
    [
      'sendCode',
      (c: Client) => c.auth.sendCode({ email: 'a@x.com', create_user: true, full_name: 'Alex' }),
      '/auth/otp',
      { email: 'a@x.com', create_user: true, full_name: 'Alex' },
      accepted,
    ],
    ['verifyCode', (c: Client) => c.auth.verifyCode('a@x.com', '123456'), '/auth/otp/verify', { email: 'a@x.com', code: '123456' }, session],
    [
      'idToken',
      (c: Client) => c.auth.idToken({ provider: 'apple', id_token: 'jwt', nonce: 'raw-nonce' }),
      '/auth/id-token',
      { provider: 'apple', id_token: 'jwt', nonce: 'raw-nonce' },
      session,
    ],
  ])('%s is anonymous: POST %s with its body and no Bearer', async (_name, run, path, body, answer) => {
    const { client, calls, port } = setup([reply(200, answer)]);
    await run(client);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`https://clutch.test/api/v1${path}`);
    expect(calls[0].body).toEqual(body);
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(port.getAccessToken).not.toHaveBeenCalled();
  });

  it('never refreshes after an anonymous call is refused: the 401 is the answer', async () => {
    const { client, calls, port } = setup([reply(401, { error: 'invalid_credentials', message: 'Wrong.' })]);
    const err = (await client.auth.token('a@x.com', 'wrong-pass').catch((e: unknown) => e)) as ClutchError;
    expect(err.code).toBe('invalid_credentials');
    expect(port.refreshAccessToken).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['setPassword', (c: Client) => c.auth.setPassword('pw-123456'), 'POST', '/auth/password', { password: 'pw-123456' }, ok],
    ['signOut', (c: Client) => c.auth.signOut('global'), 'POST', '/auth/signout', { scope: 'global' }, ok],
    [
      'linkIdentity',
      (c: Client) => c.auth.linkIdentity({ provider: 'google', id_token: 'jwt', nonce: 'n' }),
      'POST',
      '/me/identities',
      { provider: 'google', id_token: 'jwt', nonce: 'n' },
      session,
    ],
    ['unlinkIdentity', (c: Client) => c.auth.unlinkIdentity('id/1'), 'DELETE', '/me/identities/id%2F1', {}, ok],
  ])("%s acts as the member: %s %s with the member's Bearer", async (_name, run, method, path, body, answer) => {
    const { client, calls } = setup([reply(200, answer)]);
    await run(client);
    expect(calls[0].method).toBe(method);
    expect(calls[0].url).toBe(`https://clutch.test/api/v1${path}`);
    expect(calls[0].body).toEqual(body);
    expect(calls[0].headers.Authorization).toBe('Bearer token-1');
    expect(calls[0].headers['Idempotency-Key']).toBeDefined();
  });

  it("lists the member's identities with their Bearer", async () => {
    const identity = { provider: 'email', identity_id: 'i1', created_at: null, last_sign_in_at: null, email: 'a@x.com' };
    const { client, calls } = setup([reply(200, { data: [identity] })]);
    expect(await client.auth.identities()).toEqual([identity]);
    expect(calls[0].url).toBe('https://clutch.test/api/v1/me/identities');
    expect(calls[0].headers.Authorization).toBe('Bearer token-1');
  });
});
